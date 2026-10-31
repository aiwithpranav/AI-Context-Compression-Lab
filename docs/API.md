# HTTP API

Served by `server/index.js` on `http://localhost:3000` (set `PORT` / `HOST`). Used by the web page; documented here for developers and tests.

**Conventions**

- JSON routes are `POST` and require `Content-Type: application/json` (otherwise `415`). This also forces a CORS preflight, which blocks other websites from calling them.
- Every request must pass the **request guard**: loopback `Host` header (or one listed in `ALLOWED_HOSTS`) and, if an `Origin` header is sent, it must match the host. Otherwise `403`.
- Errors are `{ "error": "<message safe to show a user>" }`.
- `time` values are **seconds** (number) or `null` when unknown.

## Status codes

| Code | Meaning |
|---|---|
| 400 | Invalid input (missing text, bad mode/level, not a YouTube link, malformed JSON or URL) |
| 401 | A provider rejected the API key |
| 403 | Request guard refused the request; or Gemini refused access to the video |
| 405 | Wrong HTTP method |
| 413 | Body too large |
| 415 | JSON route called without `application/json` |
| 422 | Unreadable/unsupported upload; model declined or truncated its answer |
| 429 | Provider rate limit or free-tier quota |
| 502 | Provider unreachable, or returned an unreadable reply |
| 503 | Required API key not configured (message says which variable to set) |

## Limits

| Item | Limit |
|---|---|
| Text per request | 600,000 characters (UI allows 500,000) |
| JSON body | 3 MB |
| Document upload | 15 MB |
| Recording upload | 200 MB |
| Audio briefing text | 15,000 characters |
| Question | 1,000 characters |
| Chat history | last 20 turns, each trimmed to 4,000 characters |

---

## `GET /api/status`

Which engines are configured. Never calls a provider.

```json
{
  "text":  { "provider": "openai", "model": "gpt-4o-mini", "ready": true },
  "video": { "provider": "gemini", "model": null, "ready": true }
}
```

`video.model` is `null` until the first video request picks a model (or `GEMINI_MODEL` is set).

## `GET /api/transcript?url=<youtube-url>[&lang=en]`

YouTube captions, preferring `lang` (default `en`), falling back to the video's first track.

```json
{ "videoId": "dQw4w9WgXcQ", "language": "en", "segments": [{ "start": 1.2, "text": "…" }] }
```

`400` not a YouTube link · `502` no captions or fetch failed (the message says to paste a transcript instead).

## `POST /api/extract?name=<filename>`

Body: the **raw file bytes**. Only the extension of `name` is used: `.pdf`, `.docx`, `.xlsx`, `.csv`.

```json
{ "kind": "pdf", "text": "…", "pages": 3 }
```

`kind` is `pdf`, `docx` or `sheet`; `pages` only for PDFs. Spreadsheets render as `Sheet: <name>` followed by `a | b | c` rows.
`422` for unsupported type, legacy `.doc`/`.xls`, corrupt or password-protected file, empty file, or a PDF with no text layer (scanned).

## `POST /api/compress` *(OpenAI)*

```json
{
  "text": "…",
  "mode": "summary | keypoints | both",
  "level": "light | balanced | aggressive",
  "chunks": [{ "start": 12.5, "text": "…" }]
}
```

`chunks` is optional: pass the timed chunks of a transcript to get timestamps back.

```json
{
  "summary": "…",
  "keyPoints": [{ "text": "…", "time": 65 }],
  "actions":   [{ "text": "…", "time": 5 }],
  "memoryTrick": { "type": "Concept Chain", "text": "Plan → Test → Ship", "explanation": "…" },
  "model": "gpt-4o-mini"
}
```

`summary` is `null` unless `mode` includes it; `keyPoints` likewise. `actions` is `null` unless `chunks` were sent. `503` if `OPENAI_API_KEY` is missing.

## `POST /api/tokens`

```json
{ "texts": ["first text", "second text"] }      →      { "tokens": [3, 3] }
```

1–4 texts. Exact counts from OpenAI's tokenizer, computed locally — **needs no API key**. `tokens` is `null` if a text cannot be tokenised.

## `POST /api/evaluate` *(OpenAI, 3 model calls)*

```json
{ "original": "…", "compressed": "…" }
```

```json
{
  "score": 0.625,
  "results": [{ "question": "…", "gold": "…", "answer": "…", "verdict": "correct | partial | incorrect | not_found" }],
  "unsupportedClaims": ["…"],
  "model": "gpt-4o-mini"
}
```

## `POST /api/media/upload?name=<filename>` *(Gemini)*

Body: the **raw bytes** of a meeting recording. The type is taken from the extension of `name`: `.mp3 .wav .m4a .aac .ogg .flac` (audio) or `.mp4 .mov .webm .mpeg .mpg .avi .wmv .3gp` (video). Up to 200 MB. The file is sent on to Gemini's file store and **not kept by this server**.

```json
{ "fileUri": "https://generativelanguage.googleapis.com/v1beta/files/abc123", "mimeType": "audio/mpeg", "kind": "audio" }
```

`422` unsupported type · `413` over 200 MB · `400` empty · `503` no Gemini key · `429`/`502` Gemini limits or failure. Video files are processed by Gemini before the call returns (can take a while for long recordings).

## `POST /api/media/delete`

```json
{ "fileUri": "https://generativelanguage.googleapis.com/v1beta/files/abc123" }   →   { "deleted": true }
```

Deletes an uploaded recording from Gemini now (it would expire after 48 hours anyway). Only URIs inside Gemini's own file store are accepted (`400` otherwise).

## `POST /api/tts` *(OpenAI text-to-speech)*

```json
{ "text": "Summary. … Key points. 1. … Decisions and action items. 1. …" }
```

Responds with **`audio/mpeg`** (an MP3), not JSON. Text over 4,000 characters is spoken in pieces and joined into one file. `400` empty text · `413` over 15,000 characters · `503` no OpenAI key. Model: `OPENAI_TTS_MODEL` (default `gpt-4o-mini-tts`).

## `POST /api/video/compress` *(Gemini)*

```json
{ "url": "https://youtu.be/<id>", "mode": "both", "level": "balanced" }
```

For an uploaded recording send `media` (and optionally `kind`) instead of `url`:

```json
{ "media": { "fileUri": "…/files/abc123", "mimeType": "audio/mpeg" }, "kind": "audio", "mode": "both", "level": "balanced" }
```

`videoId` is `null` in the response for a recording (there is no YouTube moment to link to).

```json
{
  "videoId": "<id>",
  "summary": "…",
  "keyPoints": [{ "text": "…", "time": 65 }],
  "actions": [{ "text": "…", "time": 5 }],
  "memoryTrick": { "type": "…", "text": "…", "explanation": "…" },
  "tokens": { "original": 4674, "compressed": 210 },
  "model": "gemini-flash-lite-latest"
}
```

`model` is the model that actually answered (it may be a fallback). `tokens.original` is the **video's** token count (Gemini's prompt tokens minus our own prompt text); either value may be `null` if Gemini's counter failed. Times that are not valid clock times are returned as `null`. `503` if `GEMINI_API_KEY` is missing; `429` on free-tier limits; `400`/`403` for private or unavailable videos.

## `POST /api/video/ask` *(Gemini)*

`url` can be replaced by `media` here too.

```json
{
  "url": "https://youtu.be/<id>",
  "question": "What are the main steps?",
  "history": [{ "role": "user", "text": "…" }, { "role": "model", "text": "…" }]
}
```

```json
{ "answer": "Mixing happens first [0:12], then baking [1:05].", "model": "gemini-flash-lite-latest" }
```

The video is attached to the first turn only. Entries in `history` with an unknown `role` or non-string `text` are ignored.
