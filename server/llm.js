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
 * What the model should watch or listen to: a public YouTube link, or a file
 * the user uploaded earlier ({ fileUri, mimeType } from uploadMedia).
 * @returns {{ videoId: string|null, videoUrl?: string, media?: { fileUri: string, mimeType: string } }}
 */
function sourceFrom({ url, media }) {
  if (media) {
    if (!gemini.isGeminiFileUri(media.fileUri) || typeof media.mimeType !== 'string') {
      throw new LlmError('That recording is not valid. Upload it again.', 400);
    }
    return { videoId: null, media: { fileUri: media.fileUri, mimeType: media.mimeType } };
  }
  const video = videoUrlFrom(url);
  return { videoId: video.id, videoUrl: video.url };
}

/** Upload a meeting recording (audio or video) to Gemini so it can be summarised. */
export async function uploadMedia({ buffer, filename }) {
  requireVideo();
  const type = P.mediaTypeFor(filename);
  if (!type) throw new LlmError(`Unsupported recording type. Use ${Object.keys(P.MEDIA_TYPES).join(', ')}.`, 422);
  if (buffer.length > P.MAX_MEDIA_BYTES) {
    throw new LlmError(`That file is over ${P.MAX_MEDIA_BYTES / 1024 / 1024} MB. Export the audio only, or trim the recording.`, 413);
  }
  const { fileUri, mimeType } = await gemini.uploadFile(buffer, type.mimeType, filename);
  return { fileUri, mimeType, kind: type.kind };
}

/** Delete an uploaded recording from Gemini now (it would expire after 48 hours anyway). */
export async function deleteMedia({ fileUri }) {
  requireVideo();
  if (!gemini.isGeminiFileUri(fileUri)) throw new LlmError('That recording is not valid.', 400);
  try { await gemini.deleteFile(fileUri); } catch { /* already gone or expired: nothing to do */ }
  return { deleted: true };
}

/**
 * Summary / key points / action items for a public YouTube video or an uploaded
 * recording. Gemini watches or listens, so this works without captions.
 */
export async function videoCompress({ url, media, mode, level, kind = 'video' }) {
  requireVideo();
  const source = sourceFrom({ url, media });
  const system = P.buildVideoSystem({ level, mode, media: media ? kind : 'video' });
  const user = media && kind === 'audio' ? 'Summarize this recording.' : 'Summarize this video.';

  const { data, usage } = await gemini.generateJson({
    system, user, videoUrl: source.videoUrl, media: source.media, lowResolution: true,
    schema: P.buildCompressSchema({ mode, kind: 'video' }),
  });

  const keyPoints = data.key_points ? P.resolveClockTimes(data.key_points) : null;
  const compressedText = [data.summary, ...(keyPoints || []).map(k => k.text)].filter(Boolean).join(' ');

  // Token counts from Gemini's own tokenizer: the media, and what the summary costs.
  // The request's prompt text is subtracted so "original" is just the media.
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
    videoId: source.videoId,
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

/** Answer a question about the video or recording, with earlier turns for context. */
export async function videoAsk({ url, media, question, history = [] }) {
  requireVideo();
  const source = sourceFrom({ url, media });
  if (typeof question !== 'string' || !question.trim()) throw new LlmError('Type a question about it.', 400);
  if (question.length > MAX_QUESTION) throw new LlmError(`Keep the question under ${MAX_QUESTION} characters.`, 400);

  const turns = (Array.isArray(history) ? history : [])
    .filter(h => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string')
    .slice(-MAX_HISTORY)
    .map(h => ({ role: h.role, text: h.text.slice(0, MAX_TURN) }));

  const answer = await gemini.askVideo({
    system: P.VIDEO_QA_SYSTEM, videoUrl: source.videoUrl, media: source.media, history: turns, question: question.trim(),
  });
  return { answer, model: await gemini.model() };
}

// ─── Audio briefing (OpenAI text-to-speech) ────────────────────────────────

const TTS_CHUNK_CHARS = 3500;                 // the API accepts up to 4096 per request
export const TTS_MAX_CHARS = 15_000;          // summary briefing: about 10 minutes of speech
export const FULL_AUDIO_MAX_CHARS = 45_000;   // whole video: about 45 minutes of speech (a cost guard)
const TTS_PARALLEL = 4;                       // measured: one 3,500-character piece takes ~30 s to voice

/** Split text at sentence ends into pieces the speech API accepts. */
export function splitForSpeech(text, limit = TTS_CHUNK_CHARS) {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?।]+[.!?।]*\s*/g) || [text];
  const chunks = [];
  let current = '';
  for (const raw of sentences) {
    // A single enormous "sentence" (no punctuation) is cut at the limit.
    for (let s = raw; s.length > 0; s = s.slice(limit)) {
      const piece = s.slice(0, limit);
      if ((current + piece).length > limit && current) { chunks.push(current.trim()); current = ''; }
      current += piece;
      if (s.length <= limit) break;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** Run `fn` over `items` with at most `limit` in flight, keeping the results in order. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

/** Speak text as one MP3: split, voice the pieces in parallel, join them in order. */
async function speakAll(text) {
  const parts = await mapLimit(splitForSpeech(text), TTS_PARALLEL, chunk => openai.speak(chunk));
  return Buffer.concat(parts);
}

/** Turn text into one MP3 (the summary briefing, for listening on the go). */
export async function textToSpeech({ text }) {
  requireText();
  if (typeof text !== 'string' || !text.trim()) throw new LlmError('There is no text to turn into audio.', 400);
  if (text.length > TTS_MAX_CHARS) throw new LlmError(`That is too long for one audio file (over ${TTS_MAX_CHARS} characters). Use a shorter compression level.`, 413);
  return speakAll(text);
}

/**
 * The whole video (or recording) as audio: Gemini writes down everything that is
 * said, in full, and a voice reads it. The audio is about as long as the speech in
 * the video — close to the original length, not identical, because it is a
 * different voice. (The original audio track is not copied.)
 * @returns {{ mp3: Buffer, chars: number }}
 */
export async function videoToAudio({ url, media }) {
  requireVideo();
  requireText();
  const source = sourceFrom({ url, media });

  const transcript = (await gemini.transcribe({
    system: P.TRANSCRIBE_SYSTEM,
    user: media ? 'Transcribe this recording.' : 'Transcribe this video.',
    videoUrl: source.videoUrl, media: source.media,
  })).trim();

  if (/^NO SPEECH\.?$/i.test(transcript)) {
    throw new LlmError('Nobody speaks in this video, so there is nothing to turn into audio.', 422);
  }
  if (transcript.length > FULL_AUDIO_MAX_CHARS) {
    throw new LlmError(`This video has too much speech to convert (about ${Math.round(transcript.length / 15 / 60)} minutes of audio; the limit is about ${Math.round(FULL_AUDIO_MAX_CHARS / 15 / 60)}). Try a shorter video.`, 413);
  }
  return { mp3: await speakAll(transcript), chars: transcript.length };
}
