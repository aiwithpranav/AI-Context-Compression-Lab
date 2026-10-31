# Requirements Specification

Status: **v1.0** · Owner: project maintainer · Last reviewed: 2026-10-31

This is the source of truth for *what* the product does. Design is in [ARCHITECTURE.md](ARCHITECTURE.md), verification in [TEST_PLAN.md](TEST_PLAN.md). Each requirement has an ID so code, tests and pull requests can refer to it.

## 1. Purpose and scope

Context Compression Lab turns long material — text, documents, meeting transcripts and YouTube videos — into a short form a reader can use instead of the original, and **measures how much meaning was lost** in doing so.

**In scope:** compression with LLMs and a classical baseline, token accounting, loss measurement, video summaries with follow-up questions, document and transcript input.

**Out of scope (v1.0):** transcribing uploaded audio/video files, OCR for scanned PDFs, user accounts or multi-user hosting, storing any user content, public deployment hardening (auth, rate limiting).

## 2. Users

| User | Goal |
|---|---|
| **Student** | Get the meaning of a long lecture, article or PDF quickly, and ask questions about a video. |
| **Meeting participant** | Catch up on a recording or transcript: summary, decisions, action items with timestamps. |
| **LLM engineer / learner** | See how much compression costs in meaning, and compare an LLM against a classical baseline. |

## 3. Functional requirements

Priority: **M** = must, **S** = should.

| ID | Requirement | Pri |
|---|---|---|
| **FR-1** | The user can compress pasted text into a summary, key points, or both, at three levels (Light, Balanced, Aggressive). Higher levels produce shorter output. | M |
| **FR-2** | Two compression engines are available for text: an **offline extractive** engine (no key, no network) and an **LLM** engine (OpenAI) that rewrites in its own words. | M |
| **FR-3** | Every result shows token counts for the original and compressed text, tokens saved, reduction % and compression ratio. Counts are exact (a real tokenizer) when the server is running, and clearly marked as estimates otherwise. | M |
| **FR-4** | The offline engine reports **concept coverage**: the share of the original's key terms present in the compressed text, labelled as a keyword heuristic. | S |
| **FR-5** | The user can run an **LLM evaluation** on a result: questions are written from the original, answered using only the compressed text, and graded; claims in the compressed text that the original does not support are listed. Output is a score plus per-question detail. | M |
| **FR-6** | Running both engines on the same input shows an **engine comparison** table (tokens, reduction, ratio, coverage, QA score). | S |
| **FR-7** | The user can upload **PDF, Word (.docx), Excel (.xlsx) and CSV** files; their text is extracted and compressed like pasted text. Unsupported or unreadable files produce a specific, actionable message. | M |
| **FR-8** | The user can upload **.vtt / .srt** transcripts (Zoom, Meet, Teams) and **.txt** files. For timed transcripts, key points carry timestamps and a **Decisions & Action Items** list is produced. | M |
| **FR-9** | For a YouTube link the user can load the **captions only** as text, usable with either engine. | S |
| **FR-10** | For a public YouTube link the user can have **Gemini watch the video** and return a summary, key points with timestamps (linking to that moment) and action items, with no captions required. | M |
| **FR-11** | After a video summary the user can **ask questions about the video**. Answers are grounded in the video, cite moments as clickable timestamps, and say so when the video does not contain the answer. Conversation context is kept. | M |
| **FR-12** | The user can have the summary or key points **read aloud** (play, pause, resume). | S |
| **FR-13** | The application **degrades gracefully**: with no API keys the offline engine, uploads, transcripts, captions, token counts and read-aloud still work, and unavailable features are disabled with the reason shown. | M |
| **FR-14** | The user can **copy** results and **clear** everything. | S |

## 4. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| **NFR-1** | Security | API keys exist only in the server's environment and are never sent to the browser or committed. |
| **NFR-2** | Security | The server accepts requests only from the local machine's own page (loopback bind, Host and Origin checks, JSON content type required). See [SECURITY.md](SECURITY.md). |
| **NFR-3** | Privacy | User content is processed in memory and never stored by the server. Content is sent to a third party only when the user selects an LLM feature; the README says which provider receives what. |
| **NFR-4** | Correctness | Model output is shown as plain text (never as HTML). Timestamps shown to the user are validated; an invalid time is dropped, not displayed. |
| **NFR-5** | Reliability | A malformed request must not crash the server. Provider failures (bad key, quota, refusal, truncation, unreadable reply) surface as a clear message with an appropriate HTTP status. |
| **NFR-6** | Robustness | The offline engine must handle inputs up to 500,000 characters without freezing the page or exhausting the call stack. |
| **NFR-7** | Honesty | Heuristic metrics are labelled as such. Features that cannot apply (e.g. QA evaluation for a video with no source text) are hidden rather than shown with made-up numbers. |
| **NFR-8** | Maintainability | No build step. Prompts and schemas are provider-neutral so a provider can be replaced without touching them. Behaviour is covered by automated tests that run without API keys. |
| **NFR-9** | Compatibility | Current Chrome, Edge, Firefox and Safari 16.4+; Node.js 20.12 or newer on the server. |
| **NFR-10** | Accessibility | Interactive controls are keyboard-reachable and labelled; status and results use ARIA live regions. |

## 5. Constraints and assumptions

- The LLM engines need the user's own API keys. Gemini offers a free tier with usage limits; OpenAI is paid.
- Gemini can read a YouTube video from its URL only for **public** videos, within Google's current free-tier limits.
- YouTube captions are read through an unofficial package and may stop working without notice.
- Provider model names change; models are configurable (`OPENAI_MODEL`, `GEMINI_MODEL`) and Gemini's is auto-selected.

## 6. Traceability

| Requirement | Design | Automated tests | Manual acceptance |
|---|---|---|---|
| FR-1, FR-2 | ARCHITECTURE §3.1 | `client.test.js` (summary, key points, scaling), `llm.test.js` (compress) | MT-1, MT-2 |
| FR-3 | ADR-0007 | `llm.test.js` (tokens), `client.test.js` (stats), `server.test.js` | MT-1 |
| FR-4 | ADR-0006 | `client.test.js` (coverage) | MT-1 |
| FR-5, FR-6 | ADR-0005 | `llm.test.js` (evaluate, scoring) | MT-3 |
| FR-7 | ARCHITECTURE §3.3 | `server.test.js` (PDF, DOCX, XLSX, CSV, errors) | MT-4 |
| FR-8, FR-9 | ARCHITECTURE §3.2 | `client.test.js` (subtitles, action items), `server.test.js` (caption time units) | MT-5 |
| FR-10, FR-11 | ADR-0004 | `llm.test.js` (video, ask, retry, limits), `server.test.js` | **MT-6, MT-7 (real Gemini key required)** |
| FR-12 | — | — | MT-8 |
| FR-13 | ARCHITECTURE §5 | `llm.test.js` (missing keys), `server.test.js` | MT-9 |
| NFR-1…3 | ADR-0001, SECURITY | `server.test.js` (host, origin, content type, static allowlist) | MT-9 |
| NFR-4 | — | `llm.test.js` (time validation) | — |
| NFR-5 | — | `llm.test.js`, `server.test.js` (errors, malformed URL) | — |
| NFR-6 | — | `client.test.js` (huge vocabulary) | — |

Items marked "real key required" are **not** verified by CI; they need the manual checks in the test plan.
