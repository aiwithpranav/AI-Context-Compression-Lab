/**
 * llmClient.js
 * Browser side of the LLM features. Every call goes to our own server, which
 * holds the API keys — a key never reaches the browser.
 *
 *   text  → OpenAI   (compress, evaluate)
 *   video → Gemini   (watch a YouTube link, summarise, answer questions)
 */

const LLMClient = (() => {

  let _status = { server: false };

  async function _send(path, init) {
    let res;
    try {
      res = await fetch(path, init);
    } catch {
      throw new Error('Cannot reach the server. Start it with "npm start".');
    }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON response */ }
    if (!res.ok) throw new Error((data && data.error) || `Server error (${res.status}).`);
    return data;
  }

  const _post = (path, body) => _send(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // ─── Status ──────────────────────────────────────────────────────────────

  /** Ask the server which engines are configured. Never throws. */
  async function loadStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      _status = data && data.text ? { server: true, ...data } : { server: false };
    } catch {
      _status = { server: false };
    }
    return _status;
  }

  const getStatus = () => _status;
  const serverUp = () => Boolean(_status.server);
  const textReady = () => Boolean(_status.text && _status.text.ready);
  const videoReady = () => Boolean(_status.video && _status.video.ready);

  /** Why the engine can't be used right now (null if it can). */
  function textUnavailableReason() {
    if (!serverUp()) return 'Needs the server: run "npm start" and open http://localhost:3000.';
    if (!textReady()) return 'Server is running but OPENAI_API_KEY is not set. See the README.';
    return null;
  }

  function videoUnavailableReason() {
    if (!serverUp()) return 'Needs the server: run "npm start" and open http://localhost:3000.';
    if (!videoReady()) return 'Add a free GEMINI_API_KEY (aistudio.google.com/apikey) to let Gemini watch the video.';
    return null;
  }

  // ─── Text (OpenAI) ───────────────────────────────────────────────────────

  /**
   * @returns {Promise<{ summary: string|null, keyPoints: {text,time}[]|null,
   *   actions: {text,time}[]|null, memoryTrick: object, model: string }>}
   */
  function compress({ text, mode, level, chunks }) {
    return _post('/api/compress', { text, mode, level, chunks });
  }

  /** Exact token counts, one per text, from OpenAI's tokenizer. Null if unavailable. */
  async function countTokens(texts) {
    if (!serverUp()) return null;
    try {
      return (await _post('/api/tokens', { texts })).tokens;
    } catch {
      return null;   // fall back to the local estimate
    }
  }

  function evaluate({ original, compressed }) {
    return _post('/api/evaluate', { original, compressed });
  }

  // ─── Video (Gemini) ──────────────────────────────────────────────────────

  /**
   * @returns {Promise<{ videoId: string, summary: string|null, keyPoints: {text,time}[]|null,
   *   actions: {text,time}[], memoryTrick: object, tokens: {original,compressed}, model: string }>}
   */
  function videoCompress({ url, mode, level }) {
    return _post('/api/video/compress', { url, mode, level });
  }

  /** history: [{ role: 'user'|'model', text }] */
  function videoAsk({ url, question, history }) {
    return _post('/api/video/ask', { url, question, history });
  }

  // ─── Documents ───────────────────────────────────────────────────────────

  /** Send a PDF / DOCX / XLSX / CSV to the server and get its text back. */
  function extractFile(file) {
    return _send('/api/extract?name=' + encodeURIComponent(file.name), { method: 'POST', body: file });
  }

  return {
    loadStatus, getStatus, serverUp, textReady, videoReady,
    textUnavailableReason, videoUnavailableReason,
    compress, countTokens, evaluate,
    videoCompress, videoAsk,
    extractFile,
  };

})();
