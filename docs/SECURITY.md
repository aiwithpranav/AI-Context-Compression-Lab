# Security and Privacy

Scope: the local Node server and web page in this repository. The supported deployment is **one user on their own machine**. Hosting it publicly is out of scope for v1.0 (see "Not supported").

## 1. Assets

| Asset | Why it matters |
|---|---|
| `OPENAI_API_KEY`, `GEMINI_API_KEY` | Spend money / quota; identify the user to providers. |
| User content (text, documents, video links, questions) | May be private. |
| The user's machine | The server parses uploaded files and fetches URLs. |

## 2. Threats and mitigations

| # | Threat | Mitigation | Verified by |
|---|---|---|---|
| T1 | **Someone on the same network uses the server and spends the user's keys.** | Listens on `127.0.0.1` only. `HOST` must be set deliberately to change it. | Code review (bind address); manual MT-9 |
| T2 | **A malicious website calls `localhost` from the user's browser** (cross-site request). | JSON routes require `Content-Type: application/json`, which forces a CORS preflight the server never approves. A browser `Origin` that does not match the host is refused. | `server.test.js` |
| T3 | **DNS rebinding** (an attacker's domain re-pointed to 127.0.0.1 so the page can read responses). | `Host` header must be `localhost`, `127.0.0.1`, `[::1]` or listed in `ALLOWED_HOSTS`. | `server.test.js` |
| T4 | **Key leakage.** | Keys are read from the environment / `.env` on the server only; `.env` is git-ignored; no endpoint returns them; `/api/status` reports only booleans and model names; the repository was scanned for key patterns before the first push. | Secret scan (release checklist) |
| T5 | **Path traversal / reading server files** through the static handler. | Only files inside `public/` are served (the resolved path must stay under that directory); everything else (`server/`, `.env`, `node_modules`, `tests/`, `docs/`) and any `..` traversal returns 404. Malformed URLs return 400. | `server.test.js` |
| T6 | **XSS from model output or document text.** | All dynamic content is inserted with `textContent` or DOM nodes, never as HTML. Timestamp links are built only from validated numbers and a validated 11-character video id. | Code review; `llm.test.js` (time validation) |
| T7 | **Prompt injection** — text inside a document or video that tries to instruct the model. | Sources are wrapped in tags and the system prompt says they are data to ignore instructions in; outputs are constrained to a JSON schema; the model has no tools and no access to anything but the supplied text. | Manual MT-10 |
| T8 | **Malicious or huge uploads.** | 15 MB cap; extension allow-list; parse errors become a generic 422; nothing is written to disk. | `server.test.js` |
| T9 | **Crashing the server with one bad request.** | Handlers catch their own errors and a final guard answers 500 instead of letting a rejection kill the process; malformed URLs are rejected early. | `server.test.js` |
| T10 | **Supply chain.** | Few direct dependencies; `package-lock.json` committed; CI runs `npm ci` and `npm audit --audit-level=high`. | CI |
| T11 | **A recording leaks or lingers.** Recordings can be sensitive (internal meetings). | Sent only to Gemini; held in server memory just for the upload; deleted from Gemini on Clear, on starting a new recording and on tab close (`keepalive` request); Google expires files after 48 h regardless. The upload hint tells the user where it goes. | `llm.test.js` (delete), `server.test.js` |
| T12 | **Server used to fetch arbitrary URLs / access other files** through the recording reference. | `fileUri` is accepted only if it is inside Gemini's own file store with a plain id (no `..`, extra path, other host); the MIME type comes from the file extension, not from the client. | `llm.test.js` (rejects foreign hosts, traversal, wrong types) |
| T13 | **Unbounded cost from uploads or text-to-speech.** | 200 MB recording cap checked before upload; 15,000-character cap on audio of a summary and about 45,000 characters (≈ 45 minutes) on audio of a whole video, checked before any speech is paid for; at most four speech requests in flight; every route is local-only (T1–T3). | `llm.test.js` |

## 3. Privacy

- **Nothing is stored** by the server. Results live in the browser tab.
- **Third parties.** Choosing the OpenAI engine sends the text to OpenAI; the evaluation sends the original and compressed text. Choosing Gemini video sends the YouTube URL and your questions to Google. Uploading a **meeting recording** sends the audio or video itself to Google (deleted on Clear or tab close, and expired by Google after 48 hours); creating an **audio briefing** sends the summary text to OpenAI. The offline engine, uploads parsing, captions and read-aloud send nothing to model providers (captions are fetched from YouTube).
- **Gemini free tier:** Google's terms for the free tier allow using inputs and outputs to improve its products. Do not use it for confidential material.
- Server logs print error objects for debugging; they do not print user text or keys.

## 4. Known residual risks

| Risk | Status |
|---|---|
| No authentication or rate limiting | Accepted: loopback-only. Required before any public hosting. |
| Models can still produce **wrong or incomplete summaries**, including claims not in the source | Mitigated, not eliminated: the evaluation lists unsupported claims, but it is itself an LLM. |
| Recordings are buffered in memory (up to 200 MB) while uploading; several at once on a small machine could exhaust it | Accepted for single-user local use |
| Document parsers (`unpdf`, `mammoth`, `exceljs`) process untrusted files in the server process; there is no decompression-size limit for Office files | Accepted for local use. Do not expose the server. |
| `npm audit` reports moderate advisories via `exceljs` → `uuid` (< 11.1.1: missing buffer bounds check in v3/v5/v6 when a buffer is supplied) | Accepted for `uuid`: this project never passes a buffer to those functions. A second moderate advisory is reported for the transitive `minimatch` (< 11.0.1); it has **not** been assessed in depth. Revisit when `exceljs` updates, or replace `exceljs`. |
| The unofficial caption package may change behaviour | Isolated to `/api/transcript`; failure shows a message. |
| An oversize request body is cut off (connection reset) rather than answered with a tidy 413 | Cosmetic. |

## 5. Not supported

Multi-user hosting, authentication, per-user quotas, audit logging, encryption of data at rest (nothing is stored). If you need to host this, put it behind an authenticating reverse proxy, set `ALLOWED_HOSTS`, add rate limiting, and review this document again.

## 6. Reporting a vulnerability

Open a private security advisory on the GitHub repository, or contact the maintainer directly. Please do not post exploit details in a public issue.
