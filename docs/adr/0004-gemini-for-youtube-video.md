# ADR-0004: Gemini reads YouTube videos directly from their URL

**Status:** Accepted · 2026-10-31

## Context
Users want to paste a YouTube link and get a summary and answers, like the summaries built into Google's own apps. Captions are unreliable (missing, auto-generated, wrong language) and say nothing about what is shown on screen. Downloading video is fragile and against YouTube's terms.

## Decision
Use the Gemini API, which accepts a public YouTube URL as input. Request low media resolution to save tokens. Choose the model **speed-first**, not newest-first: rank the key's models as `gemini-flash-lite-latest`, `gemini-flash-latest`, then `gemini-N-flash-lite` and `gemini-N-flash` by newest N (previews and non-text models excluded), keep the top three, and fall through to the next on 404/429/500/503/timeout. `GEMINI_MODEL` pins one model and disables the fallback. Keep the captions-only path as a fallback that works with any engine.

## Consequences
+ No download and no captions needed; sees speech and visuals; has a free tier.
+ Q&A works by re-attaching the video to the first turn.
− Public videos only; subject to free-tier limits (daily video hours, per-minute quota) and to Google's data-use terms for free usage.
− Requires a separate key from the text provider.
− Source text is unavailable, so keyword coverage and the QA evaluation do not apply to videos.
− Field-verified so far: video summaries on two real videos (19 s and 14 min) with a free-tier key. The follow-up question flow (`/api/video/ask`) has only been exercised against a fake API — see TEST_PLAN section 3.

## Measurement behind the model choice
Same 19-second public video, real free-tier key, October 2026:

| Model | Result |
|---|---|
| newest flash (`gemini-3.8-flash`) | 503 "high demand"; the full app call took **190 s** |
| `gemini-flash-latest`, `gemini-3.1-flash-lite` | 503 "high demand" |
| `gemini-3.5-flash` | 36 s (spends tokens thinking) |
| `gemini-flash-lite-latest` | **6.7 s**, no thinking tokens |
| `gemini-2.5-*` | 404, no longer available to new accounts |

The newest models are the most overloaded and some older ones are retired, so "newest" is the wrong default and a fallback chain is required. Trade-off: flash-lite is the smallest model; for harder videos set `GEMINI_MODEL=gemini-flash-latest`.

## Alternatives considered
Captions plus a text LLM (kept as a fallback); scraping the Gemini or YouTube web UI (violates terms, breaks often); downloading audio and running speech-to-text (heavy, out of scope for v1.0).
