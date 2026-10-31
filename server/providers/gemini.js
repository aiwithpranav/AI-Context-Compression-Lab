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
// Names, availability and speed change often, and the newest model is usually the
// most overloaded (measured: a 19-second video took 190 s on the newest flash model,
// which answered "high demand", versus ~7 s on the flash-lite alias). So the default
// is speed-first, and a failing model falls through to the next candidate.
// GEMINI_MODEL pins one model and disables the fallback.

const FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
const MAX_CANDIDATES = 3;

let _candidates = null;   // ranked model ids, discovered once
let _model = null;        // the model that last answered successfully

export function resetCache() { _candidates = null; _model = null; }

/** The model that last answered (or the pinned one), else null before the first call. */
export function knownModel() { return process.env.GEMINI_MODEL || _model; }

/**
 * Order model ids by "fast and stable first":
 *   1. gemini-flash-lite-latest  2. gemini-flash-latest
 *   3. gemini-N-flash-lite (newest N first)  4. gemini-N-flash (newest N first)
 * Previews, image/audio/live/omni models and anything else are left out.
 */
export function rankModels(ids) {
  const key = (id) => {
    if (id === 'gemini-flash-lite-latest') return [0, 0];
    if (id === 'gemini-flash-latest') return [1, 0];
    const m = id.match(/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/);
    return m ? [m[2] ? 2 : 3, -Number(m[1])] : null;
  };
  return ids
    .map(id => ({ id, k: key(id) }))
    .filter(x => x.k)
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1])
    .map(x => x.id);
}

async function candidates() {
  if (process.env.GEMINI_MODEL) return [process.env.GEMINI_MODEL];
  if (!_candidates) {
    try {
      const data = await request('models?pageSize=200', { method: 'GET', timeoutMs: 20000 });
      const ids = (data.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => String(m.name).replace(/^models\//, ''));
      const ranked = rankModels(ids).slice(0, MAX_CANDIDATES);
      _candidates = ranked.length ? ranked : FALLBACK_MODELS;
    } catch {
      _candidates = FALLBACK_MODELS;
    }
  }
  return _candidates;
}

/** The model to use for follow-up calls (token counting): the last good one, else the first candidate. */
export async function model() {
  return knownModel() || (await candidates())[0];
}

// Overloaded, retired, rate-limited or too slow: another model may still work.
const FALL_THROUGH = new Set([404, 429, 500, 503, 504]);

async function withFallback(fn) {
  const list = await candidates();
  // Try the model that worked last time first.
  const order = _model && list.includes(_model) ? [_model, ...list.filter(m => m !== _model)] : list;
  let lastError;
  for (const m of order) {
    try {
      const result = await fn(m);
      _model = m;
      return result;
    } catch (err) {
      if (!(err instanceof GeminiHttpError) || !FALL_THROUGH.has(err.upstreamStatus)) throw err;
      lastError = err;
    }
  }
  throw lastError;
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
  if (status === 503 || status === 500) {
    return new GeminiHttpError('Gemini is overloaded right now. Wait a minute and try again.', 503, status, msg);
  }
  return new GeminiHttpError(`Gemini API error (${status}).`, 502, status, msg);
}

// Generous: a long video can genuinely take a while, but nothing should hang for minutes.
const GENERATE_TIMEOUT_MS = 150_000;

async function request(path, { method = 'POST', body, timeoutMs = 30_000 } = {}) {
  let res;
  try {
    res = await fetch(`${baseUrl()}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err && err.name === 'TimeoutError') {
      throw new GeminiHttpError('Gemini took too long to respond. Try again, or try a shorter video.', 504, 504, 'timeout');
    }
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

async function generateWith(m, { system, contents, schema, lowResolution }) {
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
    return readResponse(await request(path, { body: full, timeoutMs: GENERATE_TIMEOUT_MS }));
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
    return readResponse(await request(path, { body: plain, timeoutMs: GENERATE_TIMEOUT_MS }));
  }
}

/**
 * Structured call, optionally about a YouTube video.
 * Returns { data, usage: { inputTokens } } like the OpenAI provider.
 */
export async function generateJson({ system, user, schema, videoUrl, lowResolution = false }) {
  const parts = [...(videoUrl ? [videoPart(videoUrl)] : []), { text: user }];
  const contents = [{ role: 'user', parts }];
  const { text, usage } = await withFallback(m => generateWith(m, { system, contents, schema, lowResolution }));
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

  const body = (config) => ({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: config });

  const data = await withFallback(async (m) => {
    const path = `models/${m}:generateContent`;
    try {
      return await request(path, { body: body({ maxOutputTokens: 2048, mediaResolution: 'MEDIA_RESOLUTION_LOW' }), timeoutMs: GENERATE_TIMEOUT_MS });
    } catch (err) {
      if (err instanceof GeminiHttpError && err.upstreamStatus === 400 && /resolution|unknown name/i.test(err.upstreamMessage)) {
        return request(path, { body: body({ maxOutputTokens: 2048 }), timeoutMs: GENERATE_TIMEOUT_MS });
      }
      throw err;
    }
  });
  return readResponse(data).text;
}

/** Exact token count for plain text, using Gemini's tokenizer (free endpoint). */
export async function countTextTokens(text) {
  const m = await model();
  const data = await request(`models/${m}:countTokens`, { body: { contents: [{ parts: [{ text }] }] } });
  return data.totalTokens;
}
