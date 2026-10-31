# ADR-0008: Meeting recordings go through Gemini's file store, and briefings are real MP3s

**Status:** Accepted · 2026-10-31

## Context
The intended users are employees who need the content of a Zoom or Google Meet meeting, including while driving. Two problems:

1. Meeting recordings are **private**. A Zoom or Meet link needs the owner's login or passcode, so neither Gemini nor this server can fetch it. YouTube links work only because those videos are public.
2. Listening while driving needs audio that keeps playing with the phone **locked**. The browser's built-in speech synthesis (the free *Listen* button) stops when the screen locks or the tab goes to the background.

## Decision
1. **Recordings are uploaded as files.** The browser sends the raw bytes (≤ 200 MB, extension allow-list) to the server, which uploads them to the **Gemini Files API** (resumable protocol), waits until the file is ACTIVE, and then uses its `fileUri` for summaries and questions. Nothing is stored locally; the file is deleted on Clear / new recording / tab close, and Google expires it after 48 hours anyway. Zoom/Meet **links** are explicitly out of scope; the UI says to download the recording first. Existing paths remain for Zoom/Meet **transcripts** (`.vtt`).
2. **The briefing is an MP3 made by OpenAI text-to-speech** (`gpt-4o-mini-tts`, configurable), played from a `blob:` URL with a download button. Text is capped at 15,000 characters and split into ≤ 3,500-character pieces that are joined. The free browser *Listen* button stays for quick use at a desk.

## Consequences
+ Works for private meetings, with no meeting-platform integration, OAuth or admin approval.
+ The MP3 can be saved to a phone and keeps playing with the screen locked.
+ Both Gemini routes (`/api/video/*`) serve YouTube and recordings; the UI and tests share one path.
− Large recordings are buffered in memory and upload can take minutes; the 200 MB cap means long **video** recordings should be exported as audio first.
− Briefings cost money (a fraction of a cent for a typical summary) and send the summary text to OpenAI; recordings are sent to Google. Both are disclosed in the UI and in SECURITY.md.
− Speech recognition mishears names (a real test heard "Meera" as "Neira" and "Mira" in the same recording). Key points are as reliable as the audio, so action-item owners should be checked.
− Gemini does not label who is speaking; the prompt tells it not to invent names.

## Alternatives considered
- *Zoom / Google Drive API integration* — needs OAuth apps, admin consent and per-vendor code; rejected for v1.0.
- *Server fetches a shared link* — fragile (links are web pages, not files) and an SSRF risk.
- *Transcribe with a speech-to-text model, then summarise the text* — an extra paid step and loses audio nuance; Gemini accepts audio directly.
- *Browser speech synthesis only* — free, but stops when the screen locks, so it fails the driving use case.
