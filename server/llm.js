/**
 * server/llm.js
 * The LLM features, wired to their providers:
 *
 *   text  → OpenAI   compress(), evaluate(), exact token counts (local tokenizer)
 *   video → Gemini   videoCompress(), videoAsk()  — Gemini watches the YouTube URL itself
 *
 * API keys live in the server's environment and never reach the browser.
 * Prompts, schemas and pure helpers are in prompts.js (provider-neutral).
 */

import * as openai from './providers/openai.js';
import * as gemini from './providers/gemini.js';
import * as P from './prompts.js';
import { extractVideoId, canonicalUrl } from './youtube.js';

export { LlmError } from './prompts.js';
const { LlmError } = P;

// ─── Status ────────────────────────────────────────────────────────────────

export function status() {
  return {
    text:  { provider: openai.name, model: openai.model(), ready: openai.ready() },
    video: { provider: gemini.name, model: gemini.knownModel(), ready: gemini.ready() },
  };
}

function requireText() {
  if (!openai.ready()) throw new LlmError('No OpenAI key configured. Set OPENAI_API_KEY and restart the server.', 503);
}

function requireVideo() {
  if (!gemini.ready()) {
    throw new LlmError('No Gemini key configured. Get a free key at aistudio.google.com, set GEMINI_API_KEY and restart the server.', 503);
  }
}

// ─── Text compression (OpenAI) ─────────────────────────────────────────────

/**
 * @param {{ text: string, mode: 'summary'|'keypoints'|'both', level: string, chunks?: {start:number,text:string}[] }} req
 */
export async function compress({ text, mode, level, chunks }) {
  requireText();
  const source = P.buildSource(text, chunks);
  const { data } = await openai.generateJson({
    system: P.buildCompressSystem({ level, mode, source }),
    user: `<${source.tag}>\n${source.body}\n</${source.tag}>`,
    schema: P.buildCompressSchema({ mode, kind: source.numbered ? 'transcript' : 'text' }),
  });

  return {
    summary: data.summary ?? null,
    keyPoints: data.key_points ? P.resolveRefs(data.key_points, chunks) : null,
    actions: source.numbered ? P.resolveRefs(data.action_items, chunks) : null,
    memoryTrick: data.memory_trick,
    model: openai.model(),
  };
}

/** Exact token counts from OpenAI's tokenizer. Runs locally, so it needs no key. Null if unavailable. */
export function countTokens(texts) {
  return openai.countTokens(texts);
}

// ─── Evaluation (OpenAI) ───────────────────────────────────────────────────

/**
 * Measures information preservation the way a reader would experience it:
 *   1. The model writes questions (with gold answers) from the ORIGINAL.
 *   2. It answers them seeing ONLY the compressed text.
 *   3. A judge grades the answers, and lists claims in the compressed text
 *      that the original does not support (hallucinations).
 */
export async function evaluate({ original, compressed }) {
  requireText();
  const qa = (await openai.generateJson({
    system: P.QA_SYSTEM, user: `<text>\n${original}\n</text>`, schema: P.QA_SCHEMA,
  })).data;
  const questions = qa.questions.slice(0, P.QUESTION_COUNT).map((q, i) => ({ id: i + 1, ...q }));

  const answered = (await openai.generateJson({
    system: P.ANSWER_SYSTEM,
    user: `<text>\n${compressed}\n</text>\n\n<questions>\n${questions.map(q => `${q.id}. ${q.question}`).join('\n')}\n</questions>`,
    schema: P.ANSWER_SCHEMA,
  })).data;
  const answerById = new Map(answered.answers.map(a => [a.id, a.answer]));

  const judged = (await openai.generateJson({
    system: P.JUDGE_SYSTEM,
    user: [
      `<original>\n${original}\n</original>`,
      `<compressed>\n${compressed}\n</compressed>`,
      `<graded>\n${questions.map(q => `${q.id}. Q: ${q.question}\nGold: ${q.answer}\nCandidate: ${answerById.get(q.id) ?? 'NOT FOUND'}`).join('\n\n')}\n</graded>`,
    ].join('\n\n'),
    schema: P.JUDGE_SCHEMA,
  })).data;
  const verdictById = new Map(judged.verdicts.map(v => [v.id, v.verdict]));

  const results = questions.map(q => ({
    question: q.question,
    gold: q.answer,
    answer: answerById.get(q.id) ?? 'NOT FOUND',
    verdict: verdictById.get(q.id) ?? 'incorrect',
  }));

  return {
    score: P.scoreVerdicts(results, results.length),
    results,
    unsupportedClaims: judged.unsupported_claims,
    model: openai.model(),
  };
}

// ─── Video (Gemini) ────────────────────────────────────────────────────────

function videoUrlFrom(input) {
  const id = extractVideoId(input);
  if (!id) throw new LlmError('That does not look like a valid YouTube link.', 400);
  return { id, url: canonicalUrl(id) };
}

/**
 * Summary / key points / action items for a public YouTube video.
 * Gemini watches the video, so this works without captions.
 */
export async function videoCompress({ url, mode, level }) {
  requireVideo();
  const video = videoUrlFrom(url);
  const system = P.buildVideoSystem({ level, mode });
  const user = 'Summarize this video.';

  const { data, usage } = await gemini.generateJson({
    system, user, videoUrl: video.url, lowResolution: true,
    schema: P.buildCompressSchema({ mode, kind: 'video' }),
  });

  const keyPoints = data.key_points ? P.resolveClockTimes(data.key_points) : null;
  const compressedText = [data.summary, ...(keyPoints || []).map(k => k.text)].filter(Boolean).join(' ');

  // Token counts from Gemini's own tokenizer: the video, and what the summary costs.
  // The request's prompt text is subtracted so "original" is just the video.
  let originalTokens = null;
  let compressedTokens = null;
  try {
    const [promptOnly, compressed] = await Promise.all([
      gemini.countTextTokens(`${system}\n${user}`),
      gemini.countTextTokens(compressedText),
    ]);
    compressedTokens = compressed;
    if (usage.inputTokens) originalTokens = Math.max(0, usage.inputTokens - promptOnly);
  } catch { /* leave null: the client falls back to an estimate */ }

  return {
    videoId: video.id,
    summary: data.summary ?? null,
    keyPoints,
    actions: P.resolveClockTimes(data.action_items),
    memoryTrick: data.memory_trick,
    tokens: { original: originalTokens, compressed: compressedTokens },
    model: await gemini.model(),
  };
}

const MAX_QUESTION = 1000;
const MAX_HISTORY = 20;
const MAX_TURN = 4000;

/** Answer a question about the video, with earlier turns for context. */
export async function videoAsk({ url, question, history = [] }) {
  requireVideo();
  const video = videoUrlFrom(url);
  if (typeof question !== 'string' || !question.trim()) throw new LlmError('Type a question about the video.', 400);
  if (question.length > MAX_QUESTION) throw new LlmError(`Keep the question under ${MAX_QUESTION} characters.`, 400);

  const turns = (Array.isArray(history) ? history : [])
    .filter(h => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string')
    .slice(-MAX_HISTORY)
    .map(h => ({ role: h.role, text: h.text.slice(0, MAX_TURN) }));

  const answer = await gemini.askVideo({ system: P.VIDEO_QA_SYSTEM, videoUrl: video.url, history: turns, question: question.trim() });
  return { answer, model: await gemini.model() };
}
