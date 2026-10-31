/**
 * Fake OpenAI and Gemini APIs for tests: no keys, no network, no cost.
 * They answer according to the prompt they receive and record every request.
 */

import http from 'node:http';

function listen(handler) {
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', c => parts.push(c));
    req.on('end', () => {
      const bytes = Buffer.concat(parts);
      let body = {};
      try { body = bytes.length ? JSON.parse(bytes.toString('utf8')) : {}; } catch { /* binary upload */ }
      handler(req, res, body, bytes);
    });
  });
  return new Promise(resolve => server.listen(0, () => resolve(server)));
}

/** What a model "says" for each kind of prompt the app sends. */
function answerFor(system, schema) {
  const required = schema?.required || [];
  if (system.includes('compress') || system.includes('You summarise')) {
    const out = {};
    if (required.includes('summary')) out.summary = 'Short rewritten summary.';
    const video = JSON.stringify(schema).includes('"time"');
    const point = (text, n, time) => (video ? { text, time } : { text, source_ref: n });
    if (required.includes('key_points')) out.key_points = [point('Point A', 2, '1:05'), point('Point B', 0, '9:99:99')];
    if (required.includes('action_items')) out.action_items = [point('Rahul runs load tests by Friday', 1, '0:05')];
    out.memory_trick = { type: 'Short Phrase', text: 'Test then ship', explanation: 'Load testing gates the release.' };
    return out;
  }
  if (system.startsWith('Write')) {
    return { questions: [1, 2, 3, 4].map(i => ({ question: `Q${i}?`, answer: `A${i}` })) };
  }
  if (system.startsWith('Answer')) {
    return { answers: [{ id: 1, answer: 'A1' }, { id: 2, answer: 'partly' }, { id: 3, answer: 'wrong' }, { id: 4, answer: 'NOT FOUND' }] };
  }
  if (system.startsWith('You grade')) {
    return {
      verdicts: [{ id: 1, verdict: 'correct' }, { id: 2, verdict: 'partial' }, { id: 3, verdict: 'incorrect' }, { id: 4, verdict: 'not_found' }],
      unsupported_claims: ['Launch is on the 5th'],
    };
  }
  throw new Error('unexpected prompt: ' + system.slice(0, 50));
}

/** @returns {Promise<{ url: string, requests: object[], close: () => void, failNext: (status, message) => void }>} */
export async function fakeOpenAI() {
  const requests = [];
  let failure = null;
  const server = await listen((req, res, body) => {
    requests.push({ path: req.url, body });

    // Text-to-speech: answer with fake "MP3" bytes that echo the input length.
    if (req.url.endsWith('/audio/speech')) {
      res.setHeader('content-type', 'audio/mpeg');
      return res.end(Buffer.concat([Buffer.from('ID3'), Buffer.from(`[${body.input.length} chars, voice ${body.voice}]`)]));
    }

    res.setHeader('content-type', 'application/json');
    if (failure && failure.times > 0) {
      failure.times--;
      res.statusCode = failure.status;
      return res.end(JSON.stringify({ error: { message: failure.message, type: 'error' } }));
    }
    const system = body.messages[0].content;
    const out = answerFor(system, body.response_format?.json_schema?.schema);
    res.end(JSON.stringify({
      id: 'chatcmpl_fake', object: 'chat.completion', created: 0, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(out) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => server.close(),
    // The OpenAI SDK retries 429/5xx twice by itself, so fail 3 times to surface the error.
    failNext: (status, message) => { failure = { status, message, times: status === 429 || status >= 500 ? 3 : 1 }; },
  };
}

/**
 * `rejectSchemaOnce` makes the first generateContent call fail with a schema
 * error, to exercise the plain-JSON retry.
 * `processingPolls` makes an uploaded file report PROCESSING for that many status checks first.
 * `failModels` maps a model id to an HTTP status it always answers with
 * (e.g. { 'gemini-flash-lite-latest': 503 }), to exercise the model fallback.
 */
export async function fakeGemini({ rejectSchemaOnce = false, failModels = {}, processingPolls = 0 } = {}) {
  const requests = [];
  const files = new Map();      // id -> { state, polls }
  let nextFile = 1;
  let rejected = false;
  let failure = null;
  const server = await listen((req, res, body, bytes) => {
    requests.push({ path: req.url, method: req.method, body, headers: req.headers, bytes: bytes?.length });
    res.setHeader('content-type', 'application/json');
    const send = (obj, status = 200) => { res.statusCode = status; res.end(JSON.stringify(obj)); };
    const origin = `http://127.0.0.1:${server.address().port}`;

    // ── Files API (resumable upload, status, delete) ──
    if (req.url === '/upload/v1beta/files' && req.headers['x-goog-upload-command'] === 'start') {
      res.setHeader('x-goog-upload-url', `${origin}/upload/session/${nextFile}`);
      return res.end('{}');
    }
    if (req.url.startsWith('/upload/session/')) {
      const id = `fake${nextFile++}`;
      files.set(id, { polls: processingPolls, mimeType: req.headers['content-type'] || 'audio/mpeg' });
      return send({ file: { name: `files/${id}`, uri: `${origin}/v1beta/files/${id}`, mimeType: 'audio/mpeg', state: processingPolls > 0 ? 'PROCESSING' : 'ACTIVE' } });
    }
    const fileMatch = req.url.match(/^\/v1beta\/files\/([A-Za-z0-9_-]+)$/);
    if (fileMatch) {
      const id = fileMatch[1];
      if (req.method === 'DELETE') { files.delete(id); return send({}); }
      const f = files.get(id);
      if (!f) return send({ error: { message: `You do not have permission to access the File ${id} or it may not exist.` } }, 403);
      if (f.polls > 0) f.polls--;
      return send({ name: `files/${id}`, uri: `${origin}/v1beta/files/${id}`, mimeType: 'audio/mpeg', state: f.polls > 0 ? 'PROCESSING' : 'ACTIVE' });
    }


    if (failure) {
      const f = failure; failure = null;
      return send({ error: { message: f.message } }, f.status);
    }
    if (req.url.startsWith('/v1beta/models?')) {
      const names = [
        'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash',
        'gemini-3.5-pro', 'gemini-3.5-flash-image', 'gemini-3-flash-preview', 'gemini-omni-flash-preview',
        'gemini-flash-latest', 'gemini-flash-lite-latest',
      ];
      return send({ models: names.map(n => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) });
    }
    if (req.url.includes(':countTokens')) {
      return send({ totalTokens: Math.ceil(body.contents[0].parts[0].text.length / 4) });
    }
    if (req.url.includes(':generateContent')) {
      const model = req.url.match(/models\/([^:]+):/)?.[1];
      // A referenced uploaded file must still exist (deleted or expired files are refused, as by the real API).
      for (const turn of body.contents || []) {
        for (const part of turn.parts || []) {
          const id = part.fileData?.fileUri?.match(/\/files\/([A-Za-z0-9_-]+)$/)?.[1];
          if (id && !files.has(id)) return send({ error: { message: `You do not have permission to access the File ${id} or it may not exist.` } }, 403);
        }
      }
      if (failModels[model]) return send({ error: { message: `fake failure for ${model}` } }, failModels[model]);
      const cfg = body.generationConfig || {};
      if (rejectSchemaOnce && !rejected && cfg.responseSchema) {
        rejected = true;
        return send({ error: { message: 'Invalid JSON payload received. Unknown name "responseSchema"' } }, 400);
      }
      const system = body.systemInstruction.parts[0].text;
      const asking = !cfg.responseMimeType;
      const text = asking
        ? 'It is explained at [0:12], then repeated at [1:05].'
        : JSON.stringify(answerFor(system, cfg.responseSchema ? { required: Object.keys(cfg.responseSchema.properties), ...cfg.responseSchema } : plainSchema(system)));
      return send({
        candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 50 },
      });
    }
    send({ error: { message: 'not found' } }, 404);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/v1beta`,
    requests,
    close: () => server.close(),
    failNext: (status, message) => { failure = { status, message }; },
  };
}

// When the schema was moved into the prompt (plain-JSON retry), recover it from there.
function plainSchema(system) {
  const m = system.match(/Return ONLY JSON matching this schema:\n(.+)$/s);
  return m ? JSON.parse(m[1]) : undefined;
}
