# Changelog

All notable changes. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-31

First release with LLM engines. The baseline (initial upload) was a browser-only extractive summarizer with estimated token counts.

### Added
- **OpenAI text engine**: rewrites text as summary, key points and a memory aid, with strict JSON-schema output (FR-2).
- **Gemini video engine**: paste a public YouTube link and Gemini watches it — summary, timestamped key points, action items — plus **ask questions about the video** with clickable `[M:SS]` citations (FR-10, FR-11).
- **Document upload**: PDF, Word (.docx), Excel (.xlsx), CSV (FR-7); `.vtt` / `.srt` / `.txt` transcripts with timestamped key points and a Decisions & Action Items list (FR-8).
- **Captions only** option for YouTube links (FR-9).
- **Exact token counts** from a local OpenAI-compatible tokenizer (FR-3, ADR-0007).
- **LLM evaluation** ("Did the meaning survive?"): question-answering test plus unsupported-claim detection (FR-5, ADR-0005) and an **engine comparison** table (FR-6).
- **Listen**: read the summary or key points aloud (FR-12).
- Node server (`server/index.js`) holding API keys, fetching captions and parsing uploads (ADR-0001).
- 72 automated tests (no API keys needed), CI on Node 20 and 22, documentation set under `docs/`.

### Changed
- Project layout: browser files moved to `public/` (the only directory the server serves) and the server entry point to `server/index.js`.
- Concept coverage: dropped the Jaccard term, scales the keyword set to text length, uses light stemming, and breaks ties by word length instead of position (ADR-0005).
- Key points scale with text length, so a one-minute video no longer gets a long list.
- "Summary + Key Points" statistics no longer double-count sentences that appear in both.
- Loading screen shows what is really happening; the artificial delays were removed.
- Results show token counts without `~` when exact, and dashes instead of invented numbers when a value is unknown.

### Fixed
- Video summaries could take minutes: the newest Gemini model was auto-picked and was overloaded (190 s for a 19-second video). The default is now speed-first with automatic fallback to the next model on 503/404/429/timeouts, and a 150 s timeout per attempt. Measured afterwards: 19-second video ≈ 6 s, 14-minute talk ≈ 27 s.
- A 59-second video was shown as hours long: caption times in milliseconds were read as seconds. The unit is now chosen from the median caption duration.
- Key points mapped to the wrong source sentence when two sentences were identical.
- Very large inputs could overflow the call stack while ranking sentences.
- Unsupported file types were silently read as plain text.
- Invalid model-supplied timestamps (for example `9:99:99`) were displayed.
- The Summary card always said "Extractive", even for OpenAI and Gemini results; it now names the engine.
- The Action Items hint said "keyword matching" for model-extracted items, and the evaluation card still named the old provider; both reworded.
- Timestamp chips inside chat answers had excess spacing.

### Security
- Server binds to `127.0.0.1` by default and rejects foreign `Host` / `Origin` headers and non-JSON content types (cross-site and DNS-rebinding protection).
- A malformed URL no longer crashes the server.
- Only front-end files are served; `.env` is git-ignored. See `docs/SECURITY.md`.

### Known issues
- Automated tests use fake APIs. Verified by hand with real keys: Gemini video summaries, a video question-and-answer round and the OpenAI text flow. Not yet: the LLM evaluation (MT-3) and the unanswerable-question and multi-turn parts of MT-7 (`docs/TEST_PLAN.md`).
- `npm audit` reports moderate advisories via `exceljs` → `uuid`; the affected code path is not used (see `docs/SECURITY.md`).
- No license file yet; `package.json` declares ISC by default and the owner should confirm.
