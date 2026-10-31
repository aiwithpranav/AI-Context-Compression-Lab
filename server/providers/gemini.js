/**
 * server/providers/gemini.js
 * Gemini as the video engine. Gemini can watch a public YouTube video straight
 * from its URL (audio and visuals), so no captions or downloads are needed.
 * The free tier of the Gemini API is enough for personal use (Google limits
 * free usage to a few hours of YouTube video per day).
 *
 * Plain REST via fetch: there is no SDK to keep in sync, and GEMINI_BASE_URL
 * lets tests point at a fake server.
 */

import { LlmError } from '../prompts.js';

export const name = 'gemini';

const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
export const ready = () => Boolean(apiKey());
const baseUrl = () => process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';

// ─── Model selection ───────────────────────────────────────────────────────
// Model names and free-tier availability change often. Use GEMINI_MODEL if set,
// otherwise pick the newest plain "flash" model the key can use.

const FALLBACK_MODEL = 'gemini-2.5-flash';
let _model = null;

export function resetCache() { _model = null; }

/** The model name if already known (set by env or discovered), else null. */
export function knownModel() { return process.env.GEMINI_MODEL || _model; }

export async function model() {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (_model) return _model;
  try {
    const data = await request('models?pageSize=200', { method: 'GET' });
    const candidates = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name).replace(/^models\//, ''))
      .map(id => ({ id, match: id.match(/^gemini-(\d+(?:\.\d+)?)-flash$/) }))
      .filter(c => c.match)
      .sort((a, b) => Number(b.match[1]) - Number(a.match[1]));
    _model = candidates[0]?.id || FALLBACK_MODEL;
  } catch {
    _model = FALLBACK_MODEL;
  }
  return _model;
}

// ─── HTTP ──────────────────────────────────────────────────────────────────

class GeminiHttpError extends LlmError {
  constructor(message, httpStatus, upstreamStatus, upstreamMessage) {
    super(message, httpStatus);
    this.upstreamStatus = upstreamStatus;
    this.upstreamMessage = upstreamMessage;
  }
}

function httpError(status, data) {
  const msg = data?.error?.message || '';
  if (/API key not valid|API_KEY_INVALID/i.test(msg) || status === 401) {
    return new GeminiHttpError('The Gemini API key was rejected. Check GEMINI_API_KEY.', 401, status, msg);
  }
  if (status === 429) {
    return new GeminiHttpError('Gemini free-tier limit reached (requests, tokens or daily video hours). Wait a while and try again.', 429, status, msg);
  }
  if (status === 404) {
    return new GeminiHttpError('The Gemini model was not found. Set GEMINI_MODEL to a model your key can use.', 400, status, msg);
  }
  if (status === 403) {
    return new GeminiHttpError(`Gemini refused access${msg ? `: ${msg}` : ''}. The video may be private or restricted.`, 403, status, msg);
  }
  if (status === 400) {
    return new GeminiHttpError(`Gemini could not process this request${msg ? `: ${msg}` : ''}`, 400, status, msg);
  }
  return new GeminiHttpError(`Gemini API error (${status}).`, 502, status, msg);
}

async function request(path, { method = 'POST', body } = {}) {
  let res;
  try {
    res = await fetch(`${baseUrl()}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new LlmError('Could not reach the Gemini API.', 502);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw httpError(res.status, data);
  return data;
}

// ─── Generation ────────────────────────────────────────────────────────────

/** Gemini's Schema is an OpenAPI subset: upper-case types, no additionalProperties. */
export function toGeminiSchema(schema) {
  const out = { type: String(schema.type).toUpperCase() };
  if (schema.enum) out.enum = schema.enum;
  if (schema.required) out.required = schema.required;
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  if (schema.items) out.items = toGeminiSchema(schema.items);
  return out;
}

const BLOCKING_FINISH = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION', 'SPII']);

function readResponse(data) {
  const cand = data.candidates?.[0];
  if (!cand) {
    const reason = data.promptFeedback?.blockReason;
    throw new LlmError(reason ? `Gemini blocked this request (${reason}).` : 'Gemini returned no answer.', 422);
  }
  if (BLOCKING_FINISH.has(cand.finishReason)) throw new LlmError('Gemini declined to process this content.', 422);
  if (cand.finishReason === 'MAX_TOKENS') throw new LlmError('The response was cut off. Try a stronger compression level.', 422);
  const text = (cand.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw new LlmError('Gemini returned an empty answer.', 502);
  return { text, usage: data.usageMetadata || {} };
}

function parseJsonText(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new LlmError('The model returned an unreadable response. Please retry.', 502);
  }
}

const videoPart = (url) => ({ fileData: { fileUri: url } });

async function generate({ system, contents, schema, lowResolution = false }) {
  const m = await model();
  const path = `models/${m}:generateContent`;
  const base = { systemInstruction: { parts: [{ text: system }] }, contents };

  const full = {
    ...base,
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
      ...(schema ? { responseSchema: toGeminiSchema(schema) } : {}),
      // Fewer tokens per frame: plenty for lectures and meetings, and it stretches the free tier.
      ...(lowResolution ? { mediaResolution: 'MEDIA_RESOLUTION_LOW' } : {}),
    },
  };

  try {
    return readResponse(await request(path, { body: full }));
  } catch (err) {
    // Some models reject a schema keyword or media setting. Retry with plain JSON mode,
    // moving the schema into the prompt so the shape is still requested.
    const retryable = err instanceof GeminiHttpError && err.upstreamStatus === 400
      && /schema|resolution|unknown name|invalid json payload|response/i.test(err.upstreamMessage);
    if (!retryable) throw err;
    const plain = {
      ...base,
      systemInstruction: { parts: [{ text: `${system}\n\nReturn ONLY JSON matching this schema:\n${JSON.stringify(schema)}` }] },
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192 },
    };
    return readResponse(await request(path, { body: plain }));
  }
}

/**
 * Structured call, optionally about a YouTube video.
 * Returns { data, usage: { inputTokens } } like the OpenAI provider.
 */
export async function generateJson({ system, user, schema, videoUrl, lowResolution = false }) {
  const parts = [...(videoUrl ? [videoPart(videoUrl)] : []), { text: user }];
  const { text, usage } = await generate({ system, contents: [{ role: 'user', parts }], schema, lowResolution });
  return { data: parseJsonText(text), usage: { inputTokens: usage.promptTokenCount ?? null } };
}

/**
 * Free-text answer about a video. The video is attached to the first turn;
 * `history` is [{ role: 'user'|'model', text }] of earlier turns.
 */
export async function askVideo({ system, videoUrl, history = [], question }) {
  const turns = [...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', text: h.text })), { role: 'user', text: question }];
  const contents = turns.map((t, i) => ({
    role: t.role,
    parts: i === 0 && t.role === 'user' ? [videoPart(videoUrl), { text: t.text }] : [{ text: t.text }],
  }));
  // History must start with the user turn that carries the video.
  if (contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [videoPart(videoUrl), { text: 'Here is the video.' }] });

  const m = await model();
  const data = await request(`models/${m}:generateContent`, {
    body: { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 2048, mediaResolution: 'MEDIA_RESOLUTION_LOW' } },
  }).catch(async (err) => {
    if (err instanceof GeminiHttpError && err.upstreamStatus === 400 && /resolution|unknown name/i.test(err.upstreamMessage)) {
      return request(`models/${m}:generateContent`, {
        body: { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 2048 } },
      });
    }
    throw err;
  });
  return readResponse(data).text;
}

/** Exact token count for plain text, using Gemini's tokenizer (free endpoint). */
export async function countTextTokens(text) {
  const m = await model();
  const data = await request(`models/${m}:countTokens`, { body: { contents: [{ parts: [{ text }] }] } });
  return data.totalTokens;
}
