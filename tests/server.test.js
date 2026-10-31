/**
 * Tests for server.js routes and document extraction, over real HTTP,
 * with the OpenAI and Gemini APIs replaced by fakes.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { fakeOpenAI, fakeGemini } from './fakes.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(fixtures, name));

let openaiFake, geminiFake, server, base, normaliseCaptionTimes;

before(async () => {
  openaiFake = await fakeOpenAI();
  geminiFake = await fakeGemini();
  process.env.OPENAI_BASE_URL = openaiFake.url;
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.GEMINI_BASE_URL = geminiFake.url;
  process.env.GEMINI_API_KEY = 'test-gemini';

  const mod = await import('../server.js');
  normaliseCaptionTimes = mod.normaliseCaptionTimes;
  server = mod.createServer();
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.close(); openaiFake.close(); geminiFake.close(); });

const postJson = (route, body) => fetch(base + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const upload = (name, buf) => fetch(`${base}/api/extract?name=${encodeURIComponent(name)}`, { method: 'POST', body: buf });

// ─── Status & static files ─────────────────────────────────────────────────

test('GET /api/status lists both engines', async () => {
  const body = await (await fetch(base + '/api/status')).json();
  assert.equal(body.text.ready, true);
  assert.equal(body.video.ready, true);
});

test('server code and dependencies are never served', async () => {
  for (const p of ['/server.js', '/server/llm.js', '/package.json', '/.env', '/node_modules/openai/package.json', '/tests/fakes.js']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/js/app.js')).status, 200);
});

// ─── Document upload ───────────────────────────────────────────────────────

test('extracts text from a PDF', async () => {
  const body = await (await upload('report.pdf', fixture('sample.pdf'))).json();
  assert.equal(body.kind, 'pdf');
  assert.equal(body.pages, 1);
  assert.match(body.text, /revenue grew twelve percent/);
});

test('extracts text from a Word document', async () => {
  const body = await (await upload('notes.docx', fixture('sample.docx'))).json();
  assert.match(body.text, /Project kickoff notes\.\n\nMeera owns the design review/);
});

test('extracts a spreadsheet as readable rows, including formula results', async () => {
  const body = await (await upload('sales.xlsx', fixture('sample.xlsx'))).json();
  assert.equal(body.kind, 'sheet');
  assert.equal(body.text, 'Sheet: Sales\nRegion | Q1 | Q2\nNorth | 120 | 150\nSouth | 90 | 99');
});

test('reads CSV with quoted commas and escaped quotes', async () => {
  const body = await (await upload('team.csv', fixture('sample.csv'))).json();
  assert.equal(body.text, 'Name | Role | Note\nAsha | Lead | Owns launch, budget\nRahul | Dev | Said "ship Friday"');
});

test('upload errors are clear', async () => {
  const unsupported = await upload('virus.exe', Buffer.from('MZ'));
  assert.equal(unsupported.status, 422);
  assert.match((await unsupported.json()).error, /Unsupported file type/);

  const oldFormat = await upload('legacy.doc', Buffer.from('x'));
  assert.match((await oldFormat.json()).error, /Save it as \.docx/);

  const broken = await upload('broken.pdf', Buffer.from('this is not a pdf'));
  assert.equal(broken.status, 422);
  assert.match((await broken.json()).error, /corrupted or password-protected/);

  const empty = await upload('empty.pdf', Buffer.alloc(0));
  assert.match((await empty.json()).error, /empty/);

  const wrongVerb = await fetch(`${base}/api/extract?name=a.pdf`);
  assert.equal(wrongVerb.status, 405);
});

// ─── JSON routes ───────────────────────────────────────────────────────────

test('POST /api/compress validates input', async () => {
  assert.equal((await postJson('/api/compress', { text: '', mode: 'both' })).status, 400);
  assert.equal((await postJson('/api/compress', { text: 'hello there world', mode: 'nope' })).status, 400);
  assert.equal((await postJson('/api/compress', { text: 'hello there world', mode: 'both', level: 'extreme' })).status, 400);
  assert.equal((await fetch(base + '/api/compress')).status, 405);
});

test('POST /api/compress returns the OpenAI result', async () => {
  const res = await postJson('/api/compress', { text: 'A text that is long enough to compress.', mode: 'both', level: 'balanced' });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.summary, 'Short rewritten summary.');
  assert.equal(body.model, 'gpt-4o-mini');
});

test('POST /api/tokens returns exact counts', async () => {
  const body = await (await postJson('/api/tokens', { texts: ['Hello world', 'Hello world again and again'] })).json();
  assert.equal(body.tokens.length, 2);
  assert.ok(body.tokens[1] > body.tokens[0]);
  assert.equal((await postJson('/api/tokens', { texts: [] })).status, 400);
});

test('POST /api/video/compress and /api/video/ask use Gemini', async () => {
  const summary = await (await postJson('/api/video/compress', { url: 'https://youtu.be/dQw4w9WgXcQ', mode: 'both', level: 'balanced' })).json();
  assert.equal(summary.videoId, 'dQw4w9WgXcQ');
  assert.equal(summary.keyPoints[0].time, 65);

  const answer = await (await postJson('/api/video/ask', { url: 'https://youtu.be/dQw4w9WgXcQ', question: 'What happens?' })).json();
  assert.match(answer.answer, /\[1:05\]/);

  const bad = await postJson('/api/video/compress', { url: 'not a link', mode: 'both', level: 'light' });
  assert.equal(bad.status, 400);
});

test('missing keys return 503 with instructions, not a crash', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const res = await postJson('/api/video/compress', { url: 'https://youtu.be/dQw4w9WgXcQ', mode: 'both', level: 'light' });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /GEMINI_API_KEY/);
  } finally {
    process.env.GEMINI_API_KEY = saved;
  }
});

test('bad request bodies are rejected with the right status', async () => {
  const notJson = await fetch(base + '/api/compress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json' });
  assert.equal(notJson.status, 400);
  // text/plain is what a cross-site form or fetch can send without a CORS preflight
  const wrongType = await fetch(base + '/api/compress', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(wrongType.status, 415);
});

// ─── Security: the server holds API keys, so only the local page may use it ───

const rawRequest = (headers, urlPath = '/api/status', method = 'GET') => new Promise((resolve, reject) => {
  const port = server.address().port;
  const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject);
  req.end();
});

test('requests with a foreign Host header are refused (DNS rebinding)', async () => {
  assert.equal(await rawRequest({ Host: 'evil.example.com' }), 403);
  assert.equal(await rawRequest({ Host: `localhost:${server.address().port}` }), 200);
  assert.equal(await rawRequest({ Host: `[::1]:${server.address().port}` }), 200);
});

test('requests from another website (Origin mismatch) are refused', async () => {
  const host = `127.0.0.1:${server.address().port}`;
  assert.equal(await rawRequest({ Host: host, Origin: 'https://evil.example.com' }, '/api/compress', 'POST'), 403);
  assert.equal(await rawRequest({ Host: host, Origin: `http://${host}` }), 200);
});

test('extra hostnames can be allowed explicitly', async () => {
  process.env.ALLOWED_HOSTS = 'lab.internal';
  try {
    assert.equal(await rawRequest({ Host: 'lab.internal' }), 200);
  } finally {
    delete process.env.ALLOWED_HOSTS;
  }
});

test('a malformed URL gets a 400 and does not crash the server', async () => {
  assert.equal(await rawRequest({ Host: `127.0.0.1:${server.address().port}` }, '/%'), 400);
  assert.equal((await fetch(base + '/api/status')).status, 200, 'server is still alive');
});

// ─── YouTube caption time units (regression: a 59-second video showed hours) ─

test('caption times in milliseconds are converted, even for a short video', () => {
  // srv3 captions: offset and duration in ms. A 59 s video ends near 58000.
  const raw = [
    { text: 'hello', offset: 1200, duration: 2400 },
    { text: 'world', offset: 30000, duration: 3100 },
    { text: 'bye', offset: 58000, duration: 1500 },
  ];
  assert.deepEqual(normaliseCaptionTimes(raw).map(s => s.start), [1.2, 30, 58]);
});

test('caption times already in seconds are left alone', () => {
  const raw = [
    { text: 'hello', offset: 1.2, duration: 2.4 },
    { text: 'world', offset: 30, duration: 3.1 },
    { text: 'bye', offset: 3500, duration: 4 },   // a long video: 3500 s is a real timestamp
  ];
  assert.deepEqual(normaliseCaptionTimes(raw).map(s => s.start), [1.2, 30, 3500]);
});
