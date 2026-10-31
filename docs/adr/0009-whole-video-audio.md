# ADR-0009: "Audio of the whole video" is a transcript read aloud, not the original audio

**Status:** Accepted · 2026-10-31

## Context
Users want to turn a whole video into audio (for example to listen to a long talk while driving), separate from a summary. Ideally a 10-minute video gives 10 minutes of audio.

## Decision
The Video Link tab has two choices: *Summarize with Gemini* (summary, key points, questions) and *Audio* (the whole video as audio). *Audio* works in two steps: **Gemini writes out everything that is said**, in full and in order, as plain prose; then **OpenAI text-to-speech reads it**, in pieces voiced in parallel (max four at once) and joined in order into one MP3. The audio button under a *summary* is separate and speaks only the summary (or the key points when no summary was asked for).

We do **not** extract the original audio track: that needs downloading from YouTube, which YouTube's terms prohibit, and it would not work for private meeting links either.

## Consequences
+ Works for any public video Gemini can read and for uploaded recordings; the result is a normal MP3 that plays with the phone locked.
+ Content is complete: the prompt forbids summarising, and a transcript cut off by the model's output limit is refused instead of producing a short audio.
− **Length is close to, not equal to, the video.** Measured with real keys: a 14-minute talk (≈ 12,300 characters) became about 12 minutes of audio, ≈ 15 % shorter, because pauses, laughter and music are not spoken. The UI shows the real audio length and says so.
− The voice is synthetic, not the speaker; music, sound effects and on-screen text that is not spoken are lost.
− Cost and time grow with the video: roughly 20 s to transcribe plus 30–60 s to voice a 14-minute talk; text-to-speech costs about a cent or two per minute of audio. Capped at about 45,000 characters (≈ 45 minutes). Videos with more speech than the model can write in one answer (~30 minutes) are refused.

## Alternatives considered
- *Extract and convert the video's own audio (yt-dlp / ffmpeg)* — exact length and the original voice, but violates YouTube's terms; rejected for public links. (For the user's own uploaded recordings, an audio-only export is simply the file they already have.)
- *Speak the Gemini summary at a slower rate to hit the video length* — not the full content; rejected.
- *Stretch the voice (speed setting) to match the video length exactly* — needs the video's duration and degrades the voice; not done for v1.0.
