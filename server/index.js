/**
 * server/index.js
 * Entry point: static files (public/) + API.
 *
 *   GET  /api/status                → which engines are configured
 *   GET  /api/transcript?url=<yt>   → captions: { videoId, segments: [{ start, text }], language }
 *   POST /api/extract?name=<file>   → text from a PDF / DOCX / XLSX / CSV upload (raw bytes)
 *   POST /api/compress              → OpenAI summary / key points / action items for text
 *   POST /api/tokens                → exact token counts (local tokenizer)
 *   POST /api/evaluate              → QA-based information-preservation score
 *   POST /api/video/compress        → Gemini summary of a YouTube video or an uploaded recording
 *   POST /api/video/ask             → Gemini answer to a question about it
 *   POST /api/media/upload?name=    → upload a meeting recording (audio/video, raw bytes) to Gemini
 *   POST /api/media/delete          → delete an uploaded recording from Gemini
 *   POST /api/tts                   → MP3 of a text (OpenAI text-to-speech), for listening on the go
 *   POST /api/video/audio           → MP3 of the WHOLE video: Gemini writes out everything said, a voice reads it
 *
 * The browser cannot fetch YouTube captions (CORS), parse office files, or be
 * trusted with API keys, so those live here. The offline extractive engine,
 * subtitle parsing and text-to-speech stay client-side.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { YoutubeTranscript } from 'youtube-transcript';
import * as llm from './llm.js';
import { extractFromFile, ExtractError } from './extract.js';
import { extractVideoId } from './youtube.js';
import { MAX_MEDIA_BYTES } from './prompts.js';
import { checkNodeVersion } from './runtime.js';

// Repository layout: public/ is everything the browser may load; server/ never is.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Load .env from the project root, whatever directory the server was started from.
// Real environment variables win.
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env — fine */ }
const MAX_JSON_BYTES = 3_000_000;    // ~500k chars of text plus JSON overhead
const MAX_UPLOAD_BYTES = 15_000_000;    // documents (recordings: MAX_MEDIA_BYTES, 200 MB)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
};

const { LlmError } = llm;

// ─── Request guard ─────────────────────────────────────────────────────────
// The server holds paid API keys, so only the local machine's own page may use it:
//  - the Host header must be a loopback name (blocks DNS-rebinding from other sites)
//  - a browser Origin, if sent, must match the Host (blocks cross-site requests)
// Set ALLOWED_HOSTS=name1,name2 to allow extra hostnames (e.g. behind a reverse proxy).

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function hostnameOf(hostHeader) {
  const h = String(hostHeader || '').toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
}

export function isAllowedRequest(req) {
  const extra = (process.env.ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  if (![...LOCAL_HOSTS, ...extra].includes(hostnameOf(req.headers.host))) return false;
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host.toLowerCase() !== String(req.headers.host).toLowerCase()) return false; }
    catch { return false; }
  }
  return true;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new LlmError('That is too large.', 413)); req.destroy(); return; }
      parts.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    throw new LlmError('Send JSON with Content-Type: application/json.', 415);
  }
  const buf = await readBody(req, MAX_JSON_BYTES);
  try { return JSON.parse(buf.toString('utf8') || '{}'); }
  catch { throw new LlmError('Request body must be JSON.', 400); }
}

// ─── YouTube captions ──────────────────────────────────────────────────────

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

/**
 * The package returns milliseconds for some caption formats and seconds for
 * others. A caption lasts a few seconds, so a median duration >= 100 can only
 * be milliseconds. (Judging by the last timestamp is wrong for short videos.)
 */
export function normaliseCaptionTimes(raw) {
  const durations = raw.map(r => r.duration).filter(Number.isFinite).sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : 0;
  const inMs = median >= 100;
  return raw
    .map(r => ({ start: inMs ? r.offset / 1000 : r.offset, text: decodeEntities(r.text) }))
    .filter(s => s.text);
}

async function handleTranscript(url, res) {
  const videoId = extractVideoId(url.searchParams.get('url') || '');
  if (!videoId) return sendJson(res, 400, { error: 'That does not look like a valid YouTube link.' });

  try {
    // Prefer English (or ?lang=xx); if that track doesn't exist, take whatever the video has.
    const lang = url.searchParams.get('lang') || 'en';
    const raw = await YoutubeTranscript.fetchTranscript(videoId, { lang }).catch(async (err) => {
      // The error lists the tracks the video does have, e.g. "en-US, ar"
      const available = (String(err.message).match(/Available languages: (.+)$/)?.[1] || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const close = available.find(l => l.split('-')[0] === lang.split('-')[0]);
      return YoutubeTranscript.fetchTranscript(videoId, close ? { lang: close } : undefined);
    });
    const segments = normaliseCaptionTimes(raw);
    if (segments.length === 0) throw new Error('empty');
    sendJson(res, 200, { videoId, language: raw[0]?.lang || null, segments });
  } catch (err) {
    const msg = String(err && err.message || err);
    const friendly = /disabled|no transcript|not available|empty/i.test(msg)
      ? 'This video has no captions available. Paste its transcript or upload a .vtt/.srt file instead.'
      : 'Could not fetch the transcript. Check the link, or paste the transcript manually.';
    console.error('[transcript]', videoId, msg);
    sendJson(res, 502, { error: friendly });
  }
}

// ─── API routes ────────────────────────────────────────────────────────────

const isText = (v, max = 600_000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const MODES = ['summary', 'keypoints', 'both'];
const LEVELS = ['light', 'balanced', 'aggressive'];

function checkModeAndLevel(body) {
  if (!MODES.includes(body.mode)) throw new LlmError('Invalid mode.', 400);
  if (body.level !== undefined && !LEVELS.includes(body.level)) throw new LlmError('Invalid compression level.', 400);
}

const JSON_ROUTES = {
  '/api/compress': async (body) => {
    if (!isText(body.text)) throw new LlmError('Provide the text to compress.', 400);
    checkModeAndLevel(body);
    const chunks = Array.isArray(body.chunks)
      ? body.chunks.filter(c => c && typeof c.text === 'string' && Number.isFinite(c.start))
      : undefined;
    return llm.compress({ text: body.text, mode: body.mode, level: body.level, chunks });
  },
  '/api/tokens': async (body) => {
    if (!Array.isArray(body.texts) || body.texts.length === 0 || body.texts.length > 4 || !body.texts.every(t => isText(t))) {
      throw new LlmError('Provide 1–4 texts.', 400);
    }
    return { tokens: llm.countTokens(body.texts) };
  },
  '/api/evaluate': async (body) => {
    if (!isText(body.original) || !isText(body.compressed)) throw new LlmError('Provide original and compressed text.', 400);
    return llm.evaluate({ original: body.original, compressed: body.compressed });
  },
  '/api/video/compress': async (body) => {
    checkModeAndLevel(body);
    return llm.videoCompress({
      url: body.url, media: body.media, kind: body.kind === 'audio' ? 'audio' : 'video',
      mode: body.mode, level: body.level,
    });
  },
  '/api/video/ask': async (body) => {
    return llm.videoAsk({ url: body.url, media: body.media, question: body.question, history: body.history });
  },
  '/api/media/delete': async (body) => llm.deleteMedia({ fileUri: body.fileUri }),
};

async function handleJsonRoute(route, req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' });
  try {
    sendJson(res, 200, await route(await readJson(req)));
  } catch (err) {
    if (err instanceof LlmError) return sendJson(res, err.httpStatus, { error: err.message });
    console.error('[api]', err);
    sendJson(res, 500, { error: 'Unexpected server error.' });
  }
}

async function handleExtract(url, req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' });
  try {
    const buffer = await readBody(req, MAX_UPLOAD_BYTES);
    if (buffer.length === 0) throw new ExtractError('The file is empty.');
    sendJson(res, 200, await extractFromFile(buffer, url.searchParams.get('name') || ''));
  } catch (err) {
    if (err instanceof ExtractError) return sendJson(res, 422, { error: err.message });
    if (err instanceof LlmError) return sendJson(res, err.httpStatus, { error: err.message });
    console.error('[extract]', err);
    sendJson(res, 500, { error: 'Unexpected server error.' });
  }
}

/** Raw-bytes upload of a meeting recording; the file is sent on to Gemini and not kept here. */
async function handleMediaUpload(url, req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' });
  try {
    const buffer = await readBody(req, MAX_MEDIA_BYTES);
    if (buffer.length === 0) throw new LlmError('The file is empty.', 400);
    sendJson(res, 200, await llm.uploadMedia({ buffer, filename: url.searchParams.get('name') || '' }));
  } catch (err) {
    if (err instanceof LlmError) return sendJson(res, err.httpStatus, { error: err.message });
    console.error('[media]', err);
    sendJson(res, 500, { error: 'Unexpected server error.' });
  }
}

/** Text in, MP3 out. */
async function handleTts(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' });
  try {
    const { text } = await readJson(req);
    const mp3 = await llm.textToSpeech({ text });
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': mp3.length, 'Cache-Control': 'no-store' });
    res.end(mp3);
  } catch (err) {
    if (err instanceof LlmError) return sendJson(res, err.httpStatus, { error: err.message });
    console.error('[tts]', err);
    sendJson(res, 500, { error: 'Unexpected server error.' });
  }
}

/** A whole video (or recording) in, one MP3 out. Slow: transcription, then speech. */
async function handleVideoAudio(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' });
  try {
    const body = await readJson(req);
    const { mp3, chars } = await llm.videoToAudio({ url: body.url, media: body.media });
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg', 'Content-Length': mp3.length, 'Cache-Control': 'no-store',
      'X-Transcript-Chars': String(chars),
    });
    res.end(mp3);
  } catch (err) {
    if (err instanceof LlmError) return sendJson(res, err.httpStatus, { error: err.message });
    console.error('[video-audio]', err);
    sendJson(res, 500, { error: 'Unexpected server error.' });
  }
}

// ─── Static files ──────────────────────────────────────────────────────────

async function handleStatic(url, res) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if (rel === '/') rel = '/index.html';

  // Only files inside public/ are served — never server code, tests, docs or .env.
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(404); return res.end('Not found'); }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

export function createServer() {
  return http.createServer((req, res) => {
    if (!isAllowedRequest(req)) { res.writeHead(403); return res.end('Forbidden'); }

    let url;
    try { url = new URL(req.url, `http://${req.headers.host}`); }
    catch { res.writeHead(400); return res.end('Bad request'); }

    // Handlers answer their own errors; this is the last line of defence so one bad
    // request can never take the whole server down.
    const run = (handler) => Promise.resolve(handler()).catch((err) => {
      console.error('[server]', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });

    if (url.pathname === '/api/status') return sendJson(res, 200, llm.status());
    if (url.pathname === '/api/transcript') return run(() => handleTranscript(url, res));
    if (url.pathname === '/api/extract') return run(() => handleExtract(url, req, res));
    if (url.pathname === '/api/media/upload') return run(() => handleMediaUpload(url, req, res));
    if (url.pathname === '/api/tts') return run(() => handleTts(req, res));
    if (url.pathname === '/api/video/audio') return run(() => handleVideoAudio(req, res));
    if (JSON_ROUTES[url.pathname]) return run(() => handleJsonRoute(JSON_ROUTES[url.pathname], req, res));
    run(() => handleStatic(url, res));
  });
}

// Start listening only when run directly (`npm start`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = checkNodeVersion();
  if (!runtime.ok) { console.error(runtime.message); process.exit(1); }
  const PORT = process.env.PORT || 3000;
  // Loopback only by default: anyone who can reach this server can spend your API keys.
  const HOST = process.env.HOST || '127.0.0.1';
  createServer().listen(PORT, HOST, () => console.log(`Context Compression Lab → http://localhost:${PORT}`));
}
