/**
 * Tests for the LLM layer (server/llm.js, prompts, providers) against fake
 * OpenAI and Gemini APIs. They check our request/response handling, not the
 * quality of the models' answers.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fakeOpenAI, fakeGemini } from './fakes.js';

let openaiFake, geminiFake, llm, P, openaiProvider, geminiProvider;

before(async () => {
  openaiFake = await fakeOpenAI();
  geminiFake = await fakeGemini();
  process.env.OPENAI_BASE_URL = openaiFake.url;
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.GEMINI_BASE_URL = geminiFake.url;
  process.env.GEMINI_API_KEY = 'test-gemini';
  delete process.env.GEMINI_MODEL;
  delete process.env.OPENAI_MODEL;
  llm = await import('../server/llm.js');
  P = await import('../server/prompts.js');
  openaiProvider = await import('../server/providers/openai.js');
  geminiProvider = await import('../server/providers/gemini.js');
  openaiProvider.resetClient();
  geminiProvider.resetCache();
});

after(() => { openaiFake.close(); geminiFake.close(); });

const chunks = [
  { start: 5, text: 'We need to finish load testing.' },
  { start: 65, text: 'Rahul will run the tests by Friday.' },
];

// ─── Pure helpers ──────────────────────────────────────────────────────────

test('status reports each provider and whether its key is set', () => {
  const s = llm.status();
  assert.equal(s.text.provider, 'openai');
  assert.equal(s.text.ready, true);
  assert.equal(s.video.provider, 'gemini');
  assert.equal(s.video.ready, true);
});

test('buildSource numbers transcript lines with timestamps', () => {
  const src = P.buildSource('ignored', chunks);
  assert.equal(src.tag, 'transcript');
  assert.match(src.body, /^\[1\] \(0:05\) We need/);
  assert.match(src.body, /\[2\] \(1:05\) Rahul/);
});

test('schema only asks for what the mode and source need', () => {
  const kp = P.buildCompressSchema({ mode: 'keypoints', kind: 'text' });
  assert.deepEqual([...kp.required].sort(), ['key_points', 'memory_trick']);
  const both = P.buildCompressSchema({ mode: 'both', kind: 'transcript' });
  assert.deepEqual([...both.required].sort(), ['action_items', 'key_points', 'memory_trick', 'summary']);
  const video = P.buildCompressSchema({ mode: 'both', kind: 'video' });
  assert.deepEqual(video.properties.key_points.items.required, ['text', 'time']);
  assert.equal(both.additionalProperties, false);
});

test('key point limit scales with length, capped by the level', () => {
  assert.equal(P.keyPointLimit('balanced', 150), 3);    // a ~1-minute video
  assert.equal(P.keyPointLimit('balanced', 5000), 6);   // long text: the level's cap
  assert.equal(P.keyPointLimit('aggressive', 5000), 4);
  assert.equal(P.keyPointLimit('light', 10), 2);        // never fewer than 2
});

test('text prompt carries the level and the word target', () => {
  const source = { words: 1000, numbered: false };
  assert.match(P.buildCompressSystem({ level: 'light', mode: 'both', source }), /about 500 words/);
  assert.match(P.buildCompressSystem({ level: 'aggressive', mode: 'both', source }), /about 150 words/);
});

test('parseClock reads M:SS and H:MM:SS, rejects nonsense', () => {
  assert.equal(P.parseClock('1:05'), 65);
  assert.equal(P.parseClock('01:02:03'), 3723);
  assert.equal(P.parseClock('75:30'), 75 * 60 + 30);   // long videos: minutes can exceed 59 without an hour part
  assert.equal(P.parseClock('9:99:99'), null);          // not a real time
  assert.equal(P.parseClock('1:75'), null);
  assert.equal(P.parseClock('soon'), null);
  assert.equal(P.parseClock(undefined), null);
});

test('resolveClockTimes drops times beyond the video length', () => {
  const out = P.resolveClockTimes([{ text: 'a', time: '0:30' }, { text: 'b', time: '5:00' }, { text: 'c', time: 'x' }], 60);
  assert.deepEqual(out, [{ text: 'a', time: 30 }, { text: 'b', time: null }, { text: 'c', time: null }]);
});

test('toGeminiSchema upper-cases types and drops additionalProperties', () => {
  const out = geminiProvider.toGeminiSchema(P.buildCompressSchema({ mode: 'summary', kind: 'text' }));
  assert.equal(out.type, 'OBJECT');
  assert.equal(out.properties.summary.type, 'STRING');
  assert.equal(out.properties.memory_trick.properties.type.enum.length, 4);
  assert.ok(!('additionalProperties' in out));
});

test('scoreVerdicts: correct=1, partial=0.5, others 0', () => {
  const v = [{ verdict: 'correct' }, { verdict: 'partial' }, { verdict: 'incorrect' }, { verdict: 'not_found' }];
  assert.equal(P.scoreVerdicts(v, 4), 0.375);
  assert.equal(P.scoreVerdicts([], 0), 0);
});

// ─── Text engine (OpenAI) ──────────────────────────────────────────────────

test('compress sends a strict json_schema request and maps the reply to timestamps', async () => {
  openaiFake.requests.length = 0;
  const out = await llm.compress({ text: 'x', mode: 'both', level: 'balanced', chunks });

  const sent = openaiFake.requests[0].body;
  assert.equal(sent.model, 'gpt-4o-mini');
  assert.equal(sent.response_format.type, 'json_schema');
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.match(sent.messages[1].content, /<transcript>/);

  assert.equal(out.summary, 'Short rewritten summary.');
  assert.deepEqual(out.keyPoints[0], { text: 'Point A', time: 65 });
  assert.deepEqual(out.actions[0], { text: 'Rahul runs load tests by Friday', time: 5 });
});

test('compress on plain text returns no action items', async () => {
  const out = await llm.compress({ text: 'Some plain document text here.', mode: 'summary', level: 'light' });
  assert.equal(out.actions, null);
});

test('token counts are exact, local, and need no key', () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const [a, b] = llm.countTokens(['Hello world', 'Hello world, this is a longer sentence.']);
    assert.ok(Number.isInteger(a) && a >= 2 && a < 6);
    assert.ok(b > a);
  } finally {
    process.env.OPENAI_API_KEY = saved;
  }
});

test('text features say what to set when the key is missing', async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(llm.compress({ text: 'x', mode: 'summary', level: 'light' }), /OPENAI_API_KEY/);
  } finally {
    process.env.OPENAI_API_KEY = saved;
  }
});

test('OpenAI errors become friendly messages with the right status', async () => {
  openaiFake.failNext(429, 'quota');
  await assert.rejects(llm.compress({ text: 'x', mode: 'summary', level: 'light' }), (e) => e.httpStatus === 429 && /rate limit|quota/i.test(e.message));
  openaiFake.failNext(401, 'bad key');
  await assert.rejects(llm.compress({ text: 'x', mode: 'summary', level: 'light' }), (e) => e.httpStatus === 401 && /OPENAI_API_KEY/.test(e.message));
  openaiFake.failNext(404, 'model not found');
  await assert.rejects(llm.compress({ text: 'x', mode: 'summary', level: 'light' }), (e) => /OPENAI_MODEL/.test(e.message));
});

test('evaluate runs generate → answer → judge and scores the result', async () => {
  openaiFake.requests.length = 0;
  const out = await llm.evaluate({ original: 'Long original text.', compressed: 'Short.' });

  assert.equal(openaiFake.requests.length, 3);
  assert.equal(out.score, 0.375);
  assert.deepEqual(out.results.map(r => r.verdict), ['correct', 'partial', 'incorrect', 'not_found']);
  assert.deepEqual(out.unsupportedClaims, ['Launch is on the 5th']);

  // The answering step must see the compressed text only — never the original.
  const answerCall = openaiFake.requests.map(r => r.body).find(b => b.messages[0].content.startsWith('Answer'));
  assert.ok(!answerCall.messages[1].content.includes('Long original text.'));
});

// ─── Video engine (Gemini) ─────────────────────────────────────────────────

test('rankModels prefers fast, stable models and drops previews and non-text models', () => {
  const ranked = geminiProvider.rankModels([
    'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-pro',
    'gemini-3.5-flash-image', 'gemini-3-flash-preview', 'gemini-omni-flash-preview',
    'gemini-flash-latest', 'gemini-flash-lite-latest',
  ]);
  assert.deepEqual(ranked, [
    'gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.5-flash-lite',
    'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-flash',
  ]);
});

test('the default Gemini model is speed-first, not simply the newest', async () => {
  await llm.videoAsk({ url: 'https://youtu.be/dQw4w9WgXcQ', question: 'hi' });
  assert.equal(llm.status().video.model, 'gemini-flash-lite-latest');
});

test('videoCompress gives Gemini the YouTube URL and maps times and tokens', async () => {
  geminiFake.requests.length = 0;
  const out = await llm.videoCompress({ url: 'https://youtu.be/dQw4w9WgXcQ', mode: 'both', level: 'balanced' });

  const gen = geminiFake.requests.find(r => r.path.includes(':generateContent')).body;
  assert.equal(gen.contents[0].parts[0].fileData.fileUri, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(gen.generationConfig.responseMimeType, 'application/json');
  assert.equal(gen.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_LOW');
  assert.equal(gen.generationConfig.responseSchema.type, 'OBJECT');

  assert.equal(out.videoId, 'dQw4w9WgXcQ');
  assert.equal(out.summary, 'Short rewritten summary.');
  assert.deepEqual(out.keyPoints[0], { text: 'Point A', time: 65 });
  assert.equal(out.actions[0].time, 5);
  assert.ok(out.tokens.original > 4000 && out.tokens.original < 5000, 'video tokens = prompt tokens minus our own prompt text');
  assert.ok(out.tokens.compressed > 0);
});

test('videoCompress rejects links that are not YouTube videos', async () => {
  await assert.rejects(llm.videoCompress({ url: 'https://example.com/x', mode: 'both', level: 'light' }), /valid YouTube link/);
});

test('video features say what to set when the Gemini key is missing', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(llm.videoCompress({ url: 'https://youtu.be/dQw4w9WgXcQ', mode: 'both', level: 'light' }), /GEMINI_API_KEY/);
  } finally {
    process.env.GEMINI_API_KEY = saved;
  }
});

test('Gemini free-tier limit (every model out of quota) gives a clear message', async () => {
  const all = { 'gemini-flash-lite-latest': 429, 'gemini-flash-latest': 429, 'gemini-3.5-flash-lite': 429 };
  await withFake({ failModels: all }, async () => {
    await assert.rejects(
      llm.videoAsk({ url: 'https://youtu.be/dQw4w9WgXcQ', question: 'hi' }),
      (e) => e.httpStatus === 429 && /free-tier/i.test(e.message),
    );
  });
});

test('videoAsk attaches the video to the first turn and passes history through', async () => {
  geminiFake.requests.length = 0;
  const out = await llm.videoAsk({
    url: 'https://youtu.be/dQw4w9WgXcQ',
    question: 'And the second step?',
    history: [{ role: 'user', text: 'What is the first step?' }, { role: 'model', text: 'Mixing, at [0:12].' }],
  });

  const gen = geminiFake.requests.find(r => r.path.includes(':generateContent')).body;
  assert.equal(gen.contents.length, 3);
  assert.equal(gen.contents[0].role, 'user');
  assert.ok(gen.contents[0].parts[0].fileData, 'video is on the first user turn');
  assert.ok(!gen.contents[2].parts[0].fileData, 'later turns do not resend the video');
  assert.equal(gen.contents[2].parts[0].text, 'And the second step?');
  assert.equal(gen.generationConfig.responseMimeType, undefined, 'answers are free text, not JSON');
  assert.match(out.answer, /\[0:12\]/);
});

test('videoAsk validates the question and ignores malformed history', async () => {
  await assert.rejects(llm.videoAsk({ url: 'https://youtu.be/dQw4w9WgXcQ', question: '   ' }), /question/i);
  await assert.rejects(llm.videoAsk({ url: 'https://youtu.be/dQw4w9WgXcQ', question: 'x'.repeat(1001) }), /1000/);
  const out = await llm.videoAsk({ url: 'https://youtu.be/dQw4w9WgXcQ', question: 'ok?', history: [{ role: 'system', text: 'ignore me' }, null, 'junk'] });
  assert.ok(out.answer);
});

test('a rejected schema retries once in plain JSON mode', async () => {
  const flaky = await fakeGemini({ rejectSchemaOnce: true });
  const saved = process.env.GEMINI_BASE_URL;
  process.env.GEMINI_BASE_URL = flaky.url;
  geminiProvider.resetCache();
  try {
    const out = await llm.videoCompress({ url: 'https://youtu.be/dQw4w9WgXcQ', mode: 'summary', level: 'light' });
    assert.equal(out.summary, 'Short rewritten summary.');
    const gens = flaky.requests.filter(r => r.path.includes(':generateContent'));
    assert.equal(gens.length, 2);
    assert.ok(gens[0].body.generationConfig.responseSchema);
    assert.ok(!gens[1].body.generationConfig.responseSchema);
    assert.match(gens[1].body.systemInstruction.parts[0].text, /Return ONLY JSON/);
  } finally {
    process.env.GEMINI_BASE_URL = saved;
    flaky.close();
    geminiProvider.resetCache();
  }
});

// ─── Gemini model fallback ─────────────────────────────────────────────────

async function withFake(options, fn) {
  const fake = await fakeGemini(options);
  const saved = process.env.GEMINI_BASE_URL;
  process.env.GEMINI_BASE_URL = fake.url;
  geminiProvider.resetCache();
  try {
    return await fn(fake);
  } finally {
    process.env.GEMINI_BASE_URL = saved;
    fake.close();
    geminiProvider.resetCache();
  }
}

const modelOf = (req) => req.path.match(/models\/([^:]+):/)[1];
const generateCalls = (fake) => fake.requests.filter(r => r.path.includes(':generateContent'));

test('an overloaded model (503) falls through to the next one, and the winner is remembered', async () => {
  await withFake({ failModels: { 'gemini-flash-lite-latest': 503 } }, async (fake) => {
    const out = await llm.videoCompress({ url: 'https://youtu.be/dQw4w9WgXcQ', mode: 'summary', level: 'light' });
    assert.deepEqual(generateCalls(fake).map(modelOf), ['gemini-flash-lite-latest', 'gemini-flash-latest']);
    assert.equal(out.model, 'gemini-flash-latest');

    fake.requests.length = 0;
    await llm.videoAsk({ url: 'https://youtu.be/dQw4w9WgXcQ', question: 'next question' });
    assert.deepEqual(generateCalls(fake).map(modelOf), ['gemini-flash-latest'], 'goes straight to the model that worked');
  });
});

test('a retired model (404) and a quota error (429) also fall through', async () => {
  await withFake({ failModels: { 'gemini-flash-lite-latest': 404, 'gemini-flash-latest': 429 } }, async (fake) => {
    const out = await llm.videoCompress({ url: 'https://youtu.be/dQw4w9WgXcQ', mode: 'summary', level: 'light' });
    assert.equal(generateCalls(fake).length, 3);
    assert.equal(out.model, 'gemini-3.5-flash-lite');
  });
});

test('when every candidate fails the user gets a clear message', async () => {
  const all = { 'gemini-flash-lite-latest': 503, 'gemini-flash-latest': 503, 'gemini-3.5-flash-lite': 503 };
  await withFake({ failModels: all }, async () => {
    await assert.rejects(
      llm.videoCompress({ url: 'https://youtu.be/dQw4w9WgXcQ', mode: 'summary', level: 'light' }),
      (e) => e.httpStatus === 503 && /overloaded/i.test(e.message),
    );
  });
});

test('errors that another model cannot fix do not trigger a fallback', async () => {
  await withFake({ failModels: { 'gemini-flash-lite-latest': 403 } }, async (fake) => {
    await assert.rejects(llm.videoCompress({ url: 'https://youtu.be/dQw4w9WgXcQ', mode: 'summary', level: 'light' }), (e) => e.httpStatus === 403);
    assert.equal(generateCalls(fake).length, 1);
  });
});

test('GEMINI_MODEL pins one model and disables the fallback', async () => {
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  try {
    await withFake({ failModels: { 'gemini-3.8-flash': 503 } }, async (fake) => {
      await assert.rejects(llm.videoCompress({ url: 'https://youtu.be/dQw4w9WgXcQ', mode: 'summary', level: 'light' }), /overloaded/i);
      assert.deepEqual(generateCalls(fake).map(modelOf), ['gemini-3.8-flash']);
    });
  } finally {
    delete process.env.GEMINI_MODEL;
  }
});

// ─── Meeting recordings (Gemini Files API) ─────────────────────────────────

const mp3 = Buffer.from('ID3 fake mp3 bytes');
const uploaded = async () => llm.uploadMedia({ buffer: mp3, filename: 'weekly-sync.MP3' });

test('mediaTypeFor takes the type from the extension and knows audio from video', () => {
  assert.deepEqual(P.mediaTypeFor('standup.MP3'), { mimeType: 'audio/mpeg', kind: 'audio' });
  assert.deepEqual(P.mediaTypeFor('call.m4a'), { mimeType: 'audio/mp4', kind: 'audio' });
  assert.deepEqual(P.mediaTypeFor('zoom_0.mp4'), { mimeType: 'video/mp4', kind: 'video' });
  assert.equal(P.mediaTypeFor('notes.pdf'), null);
  assert.equal(P.mediaTypeFor('malware.exe'), null);
  assert.equal(P.mediaTypeFor('noextension'), null);
});

test('the prompt for a recording talks about listening, not watching', () => {
  const audio = P.buildVideoSystem({ level: 'balanced', mode: 'both', media: 'audio' });
  const video = P.buildVideoSystem({ level: 'balanced', mode: 'both', media: 'video' });
  assert.match(audio, /audio recording/);
  assert.match(audio, /Never invent names/);
  assert.match(video, /what is shown on screen/);
  assert.doesNotMatch(audio, /shown on screen/);
});

test('question prompt asks for one bracketed time per citation, never a range', () => {
  assert.match(P.VIDEO_QA_SYSTEM, /square brackets, one time per bracket, never a range/);
});

test('question prompt pins the answer language to the question language', () => {
  assert.match(P.VIDEO_QA_SYSTEM, /same language as the question/);
  assert.match(P.VIDEO_QA_SYSTEM, /Never switch to another language/);
});

test('uploadMedia uses the resumable protocol and returns the file reference', async () => {
  geminiFake.requests.length = 0;
  const out = await uploaded();

  const start = geminiFake.requests.find(r => r.path === '/upload/v1beta/files');
  assert.equal(start.headers['x-goog-upload-protocol'], 'resumable');
  assert.equal(start.headers['x-goog-upload-header-content-type'], 'audio/mpeg');
  assert.equal(start.headers['x-goog-upload-header-content-length'], String(mp3.length));
  const finish = geminiFake.requests.find(r => r.path.startsWith('/upload/session/'));
  assert.equal(finish.headers['x-goog-upload-command'], 'upload, finalize');
  assert.equal(finish.bytes, mp3.length);

  assert.equal(out.kind, 'audio');
  assert.equal(out.mimeType, 'audio/mpeg');
  assert.match(out.fileUri, /\/v1beta\/files\/fake\d+$/);
});

test('uploadMedia waits until Gemini has finished processing the file', async () => {
  await withFake({ processingPolls: 2 }, async (fake) => {
    const out = await llm.uploadMedia({ buffer: mp3, filename: 'meeting.mp4' });
    assert.ok(out.fileUri);
    const polls = fake.requests.filter(r => r.method === 'GET' && /\/files\/fake/.test(r.path));
    assert.equal(polls.length, 2, 'checked the status until it was ACTIVE');
  });
});

test('uploadMedia rejects unsupported and oversize files before uploading', async () => {
  geminiFake.requests.length = 0;
  await assert.rejects(llm.uploadMedia({ buffer: mp3, filename: 'notes.pdf' }), (e) => e.httpStatus === 422 && /Unsupported recording type/.test(e.message));
  await assert.rejects(llm.uploadMedia({ buffer: { length: P.MAX_MEDIA_BYTES + 1 }, filename: 'huge.mp4' }), (e) => e.httpStatus === 413 && /200 MB/.test(e.message));
  assert.equal(geminiFake.requests.length, 0, 'nothing was sent to Gemini');
});

test('a recording is summarised from its file reference, with time stamps', async () => {
  const media = await uploaded();
  geminiFake.requests.length = 0;
  const out = await llm.videoCompress({ media: { fileUri: media.fileUri, mimeType: media.mimeType }, kind: 'audio', mode: 'both', level: 'balanced' });

  const gen = geminiFake.requests.find(r => r.path.includes(':generateContent')).body;
  assert.deepEqual(gen.contents[0].parts[0].fileData, { mimeType: 'audio/mpeg', fileUri: media.fileUri });
  assert.match(gen.systemInstruction.parts[0].text, /audio recording/);
  assert.equal(out.videoId, null, 'a recording has no YouTube id, so no YouTube links');
  assert.equal(out.keyPoints[0].time, 65);
});

test('questions about a recording attach the same file', async () => {
  const media = await uploaded();
  geminiFake.requests.length = 0;
  const out = await llm.videoAsk({ media: { fileUri: media.fileUri, mimeType: media.mimeType }, question: 'Who owns load testing?' });
  const gen = geminiFake.requests.find(r => r.path.includes(':generateContent')).body;
  assert.equal(gen.contents[0].parts[0].fileData.fileUri, media.fileUri);
  assert.ok(out.answer);
});

test('only files in the Gemini file store can be referenced', async () => {
  const bad = [
    'https://evil.example.com/v1beta/files/abc',
    `${process.env.GEMINI_BASE_URL}/files/../models`,
    `${process.env.GEMINI_BASE_URL}/files/abc/extra`,
    'file:///etc/passwd',
    42,
    undefined,
  ];
  for (const fileUri of bad) {
    await assert.rejects(llm.videoAsk({ media: { fileUri, mimeType: 'audio/mpeg' }, question: 'hi' }), (e) => e.httpStatus === 400, String(fileUri));
    await assert.rejects(llm.deleteMedia({ fileUri }), (e) => e.httpStatus === 400, String(fileUri));
  }
});

test('deleteMedia removes the file from Gemini', async () => {
  const media = await uploaded();
  geminiFake.requests.length = 0;
  assert.deepEqual(await llm.deleteMedia({ fileUri: media.fileUri }), { deleted: true });
  assert.ok(geminiFake.requests.some(r => r.method === 'DELETE' && r.path.endsWith(media.fileUri.split('/').pop())));
  await assert.rejects(llm.videoAsk({ media: { fileUri: media.fileUri, mimeType: media.mimeType }, question: 'still there?' }), /refused access/);
});

test('recording features say what to set when the Gemini key is missing', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(llm.uploadMedia({ buffer: mp3, filename: 'a.mp3' }), /GEMINI_API_KEY/);
  } finally {
    process.env.GEMINI_API_KEY = saved;
  }
});

// ─── Audio briefing (OpenAI text-to-speech) ────────────────────────────────

test('splitForSpeech keeps every piece under the limit and loses no text', () => {
  const sentence = 'This is one sentence of a briefing. ';
  const text = sentence.repeat(400);
  const chunks = llm.splitForSpeech(text, 3500);
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every(c => c.length <= 3500));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').length, text.replace(/\s+/g, ' ').trim().length);

  assert.deepEqual(llm.splitForSpeech('One. Two! Three?'), ['One. Two! Three?']);
  assert.deepEqual(llm.splitForSpeech('x'.repeat(9000), 3500).map(c => c.length), [3500, 3500, 2000], 'text with no punctuation is cut at the limit');
});

test('textToSpeech sends the text to OpenAI and returns the MP3 bytes', async () => {
  openaiFake.requests.length = 0;
  const out = await llm.textToSpeech({ text: 'Summary. Short rewritten summary.' });
  const sent = openaiFake.requests.find(r => r.path.endsWith('/audio/speech')).body;
  assert.equal(sent.model, 'gpt-4o-mini-tts');
  assert.equal(sent.response_format, 'mp3');
  assert.equal(sent.input, 'Summary. Short rewritten summary.');
  assert.equal(out.subarray(0, 3).toString(), 'ID3');
});

test('a long briefing is spoken in several requests and joined into one file', async () => {
  openaiFake.requests.length = 0;
  const text = 'This is one sentence of a briefing. '.repeat(250);   // ~9,000 characters
  const out = await llm.textToSpeech({ text });
  const calls = openaiFake.requests.filter(r => r.path.endsWith('/audio/speech'));
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.body.input.length <= 4096));
  assert.equal(out.toString().split('ID3').length - 1, 3, 'three pieces joined');
});

test('textToSpeech refuses empty text and anything over the cost guard', async () => {
  await assert.rejects(llm.textToSpeech({ text: '   ' }), (e) => e.httpStatus === 400);
  await assert.rejects(llm.textToSpeech({ text: 'a. '.repeat(llm.TTS_MAX_CHARS) }), (e) => e.httpStatus === 413);
});

test('text-to-speech says what to set when the OpenAI key is missing', async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(llm.textToSpeech({ text: 'hello there' }), /OPENAI_API_KEY/);
  } finally {
    process.env.OPENAI_API_KEY = saved;
  }
});

// ─── The whole video as audio ──────────────────────────────────────────────

// ~9,000 characters of numbered "talk": three speech pieces, each starting with its own number
const longTalk = Array.from({ length: 150 }, (_, i) => `Part ${String(i + 1).padStart(3, '0')}. ${'Words of the talk. '.repeat(3)}`).join('');
const videoUrl = 'https://youtu.be/dQw4w9WgXcQ';
const markers = (mp3) => [...mp3.toString().matchAll(/"(Part \d{3})/g)].map(m => m[1]);

test('the whole video is transcribed in full, then voiced and joined in order', async () => {
  await withFake({ transcript: longTalk }, async (gem) => {
    openaiFake.requests.length = 0;
    const { mp3, chars } = await llm.videoToAudio({ url: videoUrl });

    // Gemini was asked for plain text (not JSON), with room for a long answer
    const ask = gem.requests.find(r => r.path.includes(':generateContent')).body;
    assert.match(ask.systemInstruction.parts[0].text, /Transcribe everything that is said/);
    assert.equal(ask.generationConfig.responseMimeType, undefined);
    assert.equal(ask.generationConfig.maxOutputTokens, 32768);
    assert.equal(ask.contents[0].parts[0].fileData.fileUri, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    assert.equal(chars, longTalk.trim().length);
    const spoken = openaiFake.requests.filter(r => r.path.endsWith('/audio/speech'));
    assert.ok(spoken.length >= 3 && spoken.every(r => r.body.input.length <= 3500));
    assert.equal(spoken.map(r => r.body.input).join(' ').replace(/\s+/g, ' ').length, longTalk.replace(/\s+/g, ' ').trim().length, 'no text lost');

    // The first piece answers last, yet it must still come first in the file
    const order = markers(mp3);
    assert.equal(order[0], 'Part 001');
    assert.deepEqual(order, [...order].sort());
  });
});

test('pieces are voiced in parallel, but never more than four at a time', async () => {
  await withFake({ transcript: 'Part 001. ' + 'A sentence that fills the piece. '.repeat(1000) }, async () => {
    openaiFake.speech.maxInflight = 0;
    await llm.videoToAudio({ url: videoUrl });
    assert.ok(openaiFake.speech.maxInflight >= 2, 'ran in parallel');
    assert.ok(openaiFake.speech.maxInflight <= 4, 'stayed within the limit');
  });
});

test('an uploaded recording can be turned into audio too', async () => {
  await withFake({ transcript: longTalk }, async (gem) => {
    const media = await llm.uploadMedia({ buffer: Buffer.from('ID3 audio'), filename: 'weekly.mp3' });
    gem.requests.length = 0;
    await llm.videoToAudio({ media: { fileUri: media.fileUri, mimeType: media.mimeType } });
    const ask = gem.requests.find(r => r.path.includes(':generateContent')).body;
    assert.deepEqual(ask.contents[0].parts[0].fileData, { mimeType: 'audio/mpeg', fileUri: media.fileUri });
    assert.equal(ask.contents[0].parts[1].text, 'Transcribe this recording.');
  });
});

test('a video with no speech says so instead of making silent audio', async () => {
  await withFake({ transcript: 'NO SPEECH' }, async () => {
    openaiFake.requests.length = 0;
    await assert.rejects(llm.videoToAudio({ url: videoUrl }), (e) => e.httpStatus === 422 && /Nobody speaks/.test(e.message));
    assert.equal(openaiFake.requests.length, 0, 'no speech was paid for');
  });
});

test('a transcript cut off by the output limit is refused, not turned into a short audio', async () => {
  await withFake({ transcript: longTalk.slice(0, 2000), transcriptFinish: 'MAX_TOKENS' }, async () => {
    openaiFake.requests.length = 0;
    await assert.rejects(llm.videoToAudio({ url: videoUrl }), (e) => e.httpStatus === 422 && /too much speech/.test(e.message));
    assert.equal(openaiFake.requests.length, 0);
  });
});

test('very long speech is refused before any text-to-speech is paid for', async () => {
  await withFake({ transcript: 'Part 001. ' + 'Long. '.repeat(10000) }, async () => {
    openaiFake.requests.length = 0;
    await assert.rejects(llm.videoToAudio({ url: videoUrl }), (e) => e.httpStatus === 413 && /too much speech/.test(e.message));
    assert.equal(openaiFake.requests.length, 0);
  });
});

test('a model with a lower output limit is retried with a smaller one', async () => {
  await withFake({ transcript: longTalk, rejectBigOutput: true }, async (gem) => {
    const { chars } = await llm.videoToAudio({ url: videoUrl });
    assert.equal(chars, longTalk.trim().length);
    const asks = gem.requests.filter(r => r.path.includes(':generateContent')).map(r => r.body.generationConfig.maxOutputTokens);
    assert.deepEqual(asks, [32768, 8192]);
  });
});

test('whole-video audio needs both keys, and checks before calling anything', async () => {
  await withFake({ transcript: longTalk }, async (gem) => {
    const savedOpenAI = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      gem.requests.length = 0;
      await assert.rejects(llm.videoToAudio({ url: videoUrl }), /OPENAI_API_KEY/);
      assert.equal(gem.requests.length, 0, 'did not spend Gemini quota before noticing the missing key');
    } finally {
      process.env.OPENAI_API_KEY = savedOpenAI;
    }
    const savedGemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      await assert.rejects(llm.videoToAudio({ url: videoUrl }), /GEMINI_API_KEY/);
    } finally {
      process.env.GEMINI_API_KEY = savedGemini;
    }
  });
});

test('a bad link is refused before anything is called', async () => {
  await assert.rejects(llm.videoToAudio({ url: 'not a link' }), (e) => e.httpStatus === 400);
});
