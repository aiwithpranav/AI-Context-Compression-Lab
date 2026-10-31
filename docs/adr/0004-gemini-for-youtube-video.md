# ADR-0004: Gemini reads YouTube videos directly from their URL

**Status:** Accepted · 2026-10-31

## Context
Users want to paste a YouTube link and get a summary and answers, like the summaries built into Google's own apps. Captions are unreliable (missing, auto-generated, wrong language) and say nothing about what is shown on screen. Downloading video is fragile and against YouTube's terms.

## Decision
Use the Gemini API, which accepts a public YouTube URL as input. Request low media resolution to save tokens. Pick the newest plain "flash" model the key can list (`GEMINI_MODEL` overrides). Keep the captions-only path as a fallback that works with any engine.

## Consequences
+ No download and no captions needed; sees speech and visuals; has a free tier.
+ Q&A works by re-attaching the video to the first turn.
− Public videos only; subject to free-tier limits (daily video hours, per-minute quota) and to Google's data-use terms for free usage.
− Requires a separate key from the text provider.
− Source text is unavailable, so keyword coverage and the QA evaluation do not apply to videos.
− **Integration verified only against a fake API so far** — see TEST_PLAN section 3.

## Alternatives considered
Captions plus a text LLM (kept as a fallback); scraping the Gemini or YouTube web UI (violates terms, breaks often); downloading audio and running speech-to-text (heavy, out of scope for v1.0).
