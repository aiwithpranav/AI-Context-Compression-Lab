# Context Compression Lab

**Compress text, documents and YouTube videos with LLMs — and measure how much meaning survives.**

Paste a link to a YouTube video and Gemini watches it, summarizes it, and answers your questions about it. Paste text or upload a PDF, Word, Excel or CSV file and OpenAI compresses it. A classical offline engine (TF-IDF) runs alongside as a baseline, tokens are counted with a real tokenizer, and an LLM quiz tests whether the compressed version still carries the meaning.

---

## The problem

LLMs read **tokens**, and every model has a **context window**. Long documents, meeting recordings and chat histories eat that window and cost money. Compression makes them smaller — but every removed sentence may remove something that mattered. This project asks:

> **How much can you shrink something before the meaning starts to go, and does an LLM do it better than a classical algorithm?**

---

## What it does

| Input | What happens |
|---|---|
| **Pasted text** | Compressed by the **Extractive** engine (offline) or **OpenAI**. Summary, key points and a memory aid, at three levels (Light / Balanced / Aggressive). |
| **YouTube link** | **Gemini watches the video** (speech and what's on screen) — no captions needed. You get a summary, timestamped key points (each links to that moment) and action items. Then **ask it questions** about the video. |
| **PDF · Word · Excel · CSV** | Text is extracted on the server, then compressed like pasted text. Spreadsheets become readable rows. |
| **Meeting transcripts** (`.vtt` / `.srt` from Zoom, Meet, Teams) or `.txt` | Timestamped key points and a Decisions & Action Items list. |
| **Meeting recording** (`.mp3` `.m4a` `.wav` `.mp4` `.mov` `.webm`, ≤ 200 MB) | Gemini **listens** and returns a summary, key points and action items with timestamps; ask it questions. Zoom and Google Meet **links** are private, so download the recording and upload the file (or upload the `.vtt` transcript). The file is deleted from Gemini on Clear or tab close. |
| **Captions only** | Alternative to Gemini for a YouTube link: loads the caption track as text, so it works with any engine, including offline. |

Also: in the **Video Link** tab you choose between **Summarize with Gemini** (summary + key points + questions), **🎧 Audio** (the same, then an MP3 briefing in one click) and **Captions only**; and **Listen on the go** — an **MP3 audio briefing** (summary, key points, action items) made with OpenAI text-to-speech, to play or download and listen to on a phone, for example while driving; **Listen** (free browser voice, reads the summary aloud), **exact token counts**, an **Engine Comparison** table, and an **LLM evaluation** ("Did the meaning survive?").

---

## Which model does what

| Job | Provider | Why |
|---|---|---|
| Text compression, evaluation | **OpenAI** (`gpt-4o-mini` by default) | Strict JSON-schema output. Set `OPENAI_MODEL` for another model. |
| YouTube video summary + questions | **Gemini** (`gemini-flash-lite-latest` first, with automatic fallback) | Gemini accepts a YouTube URL directly as input, and has a free tier. Speed-first: see below. |
| Audio briefing (MP3) | **OpenAI** text-to-speech (`gpt-4o-mini-tts` by default) | Real audio file that keeps playing with the phone locked; browser voices do not. Costs a fraction of a cent per briefing. |
| Token counts | OpenAI's tokenizer, **locally** | Exact, free, needs no key. For videos, Gemini's own token counts. |
| Offline baseline | TF-IDF extractive | No key, no network. Can't rewrite or hallucinate. |

---

## How it works

```
                      ┌─────────────────────────── browser ───────────────────────────┐
 text · files ·       │  subtitle parsing · extractive engine (offline) · results UI   │
 YouTube link ───────►│  Listen (text-to-speech) · engine comparison · video chat       │
                      └───────┬───────────────────────────────────────────────────────┘
                              │  /api/compress /tokens /evaluate /extract /video/*
                      ┌───────▼─────────────── server/index.js ───────────────────────┐
                      │  holds the API keys · parses PDF/DOCX/XLSX · fetches captions  │
                      │  server/llm.js ─┬─► providers/openai.js  (text)                │
                      │                 └─► providers/gemini.js  (video, REST)         │
                      │  server/prompts.js  provider-neutral prompts + JSON schemas    │
                      └─────────────────────────────────────────────────────────────────┘
```

### LLM compression
- **Structured output.** Every call carries a JSON schema (OpenAI: strict `json_schema`; Gemini: `responseSchema`, with an automatic plain-JSON retry if a model rejects it), so the reply is typed JSON. The schema only asks for what the chosen mode needs.
- **Grounded timestamps.** For transcripts the model gets numbered lines (`[12] (3:41) …`) and returns the *line number* of each point; the server maps it to a real time. For video, times come back as `M:SS`, are validated strictly, and invalid ones are dropped rather than shown.
- **Scales with the input.** Summary length follows the source length and level; key points are capped by both the level and the text length (a one-minute video does not get eight bullets).
- **Faithfulness rules.** Use only the source; keep names, numbers, dates and decisions; same language as the source; treat the source as data, not instructions (prompt-injection guard).
- **Video Q&A** attaches the video to the first turn and sends the last 20 turns of history; answers cite moments as `[1:23]`, which become links.

### Measuring information preservation
Keyword overlap is a weak proxy — it even *punishes* good paraphrasing. So there is an LLM test (`evaluate()`):

1. The model writes 8 questions with gold answers from the **original** text.
2. It answers them using **only the compressed text** (`NOT FOUND` otherwise).
3. A judge grades each answer (correct / partial / incorrect / missing) and lists claims in the compressed text that the original does not support.

Score = (correct + ½·partial) ÷ questions. Keyword **concept coverage** is still shown, as a labelled heuristic: top TF-IDF keywords (about 30% of the vocabulary, 5–20), light stemming, ties broken by word length — not by position, which would favour opening sentences.

### Extractive baseline
Sentences are scored with TF-IDF plus a position boost, the top-K kept in original order, key points diversity-filtered. Free, offline, fast, explainable.

---

## Running it

Requires Node 20.12+.

```bash
npm install
cp .env.example .env      # then fill in the keys you have
npm start
```

Open <http://localhost:3000>.

| Key | For | Where to get it |
|---|---|---|
| `OPENAI_API_KEY` | Text compression and evaluation | platform.openai.com |
| `GEMINI_API_KEY` | YouTube video summary and questions | **Free** key: aistudio.google.com/apikey |

Both are optional. **Without any key** you still get the offline engine, document upload, transcripts, captions, exact token counts and Listen — the LLM options are greyed out with the reason. Opening `public/index.html` directly (no server) gives the offline engine and subtitle/text files only.

Optional: `OPENAI_MODEL`, `OPENAI_TTS_MODEL`, `GEMINI_MODEL` (pins one model and turns off the fallback; default is speed-first with fallback), `PORT`, `HOST` (default `127.0.0.1`), `ALLOWED_HOSTS` (extra hostnames, e.g. behind a reverse proxy).

**Gemini speed:** measured with a real free-tier key (Oct 2026): a 19-second video took about 6 s and a 14-minute talk about 27 s on `gemini-flash-lite-latest`; the newest flash model answered "high demand" and took 190 s. Speed varies with Google's load. For higher quality at lower speed, set `GEMINI_MODEL=gemini-flash-latest`.

**Gemini free tier:** Google limits free usage (a few hours of YouTube video per day, plus per-minute limits) and may use free-tier inputs to improve its models. Public videos only. A 429 error means a limit was hit — wait and retry.

### Tests

```bash
npm test
```

95 tests: transcript and subtitle parsing, the extractive engine, stats, document extraction (PDF / DOCX / XLSX / CSV fixtures), the server routes and request guard over real HTTP, and the OpenAI and Gemini layers against **fake APIs**. CI runs them on Node 20 and 22. They verify our request/response handling — structured-output schemas, timestamp mapping, retries, error messages, the 3-step evaluation. They do **not** verify the models' answer quality, and they cannot catch changes in the real OpenAI/Gemini APIs.

---

## Project structure

```
.
├── public/                          Everything the browser may load (the only thing served)
│   ├── index.html, style.css        UI
│   └── js/                          Browser code
│       ├── app.js                   Pipelines: text, video, chat, uploads, engine comparison
│       ├── llmClient.js             Calls our server (never holds a key)
│       ├── transcript.js, speech.js Subtitles → timed chunks; text-to-speech
│       └── textProcessor / summarizer / keyPoints / statistics / preservation / …
├── server/                          Backend — never served to the browser
│   ├── index.js                     Entry point: routes, request guard, static files, YouTube captions
│   ├── llm.js                       Orchestrates providers: compress, evaluate, videoCompress, videoAsk
│   ├── prompts.js                   Prompts, JSON schemas, pure helpers (provider-neutral)
│   ├── providers/openai.js          Text engine + local tokenizer
│   ├── providers/gemini.js          Video engine (REST), model ranking + fallback, schema retry
│   ├── extract.js                   PDF / DOCX / XLSX / CSV → text
│   └── youtube.js                   Link parsing
├── tests/                           node:test suites, fake APIs, document fixtures
├── docs/                            Requirements, architecture, ADRs, API, security, test plan
├── .github/                         CI workflow, PR and issue templates
└── package.json, .env.example, CHANGELOG.md, CONTRIBUTING.md
```

---

## Design decisions and limitations

- **Keys stay on the server, and the server stays local.** It listens on `127.0.0.1` only and rejects foreign `Host` / `Origin` headers and non-JSON posts, so other devices and other websites can't spend your keys. It has no login or rate limiting — don't expose it publicly. Uploads are processed in memory and not stored. Details: [docs/SECURITY.md](docs/SECURITY.md).
- **Recordings:** speech recognition mishears names (a test heard "Meera" as "Neira"), and Gemini does not label speakers, so check action-item owners. Recordings are buffered in memory while uploading (≤ 200 MB); export long video meetings as audio first. Recordings go to Google, briefing text to OpenAI.
- **Videos have no source text**, so keyword coverage and the QA evaluation don't apply to them; stats use Gemini's token counts (the "original" is the video's token count, which depends on video length and resolution — requests use low frame resolution to save tokens).
- **Gemini is only partly field-verified.** Video summaries were run against real videos, and the maintainer confirmed a real question-and-answer round; unanswerable questions and long multi-turn chats have not been checked. The free-tier models, YouTube-URL support and field names change; the model is chosen speed-first (the newest model is often overloaded) and falls through to the next candidate on 503/404/429/timeouts, and the schema falls back to plain JSON. Very long videos may hit free-tier token limits.
- **The evaluator is an LLM too.** It can be biased toward its own phrasing, and 8 questions is a small sample — a useful signal, not ground truth. Evaluation costs 3 calls, with the full original text sent twice.
- **Documents:** scanned PDFs (images) need OCR and are not supported; old `.doc` / `.xls` must be re-saved as `.docx` / `.xlsx`. Spreadsheets are summarised as text rows, which suits the LLM engine better than the extractive one.
- **YouTube captions** use the unofficial `youtube-transcript` package and can break without notice.
- **Extractive engine** understands English keywords only.
- **Dependencies:** `exceljs` pulls in an older `uuid` that `npm audit` flags (moderate). The flagged code path (buffer arguments to uuid v3/v5/v6) is not used by this project.
- **Not done yet:** transcribing uploaded audio/video files, query-aware (RAG) compression, a benchmark across many texts, prompt compression, chat-history compression.

---

## Documentation

| | |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | What it must do (numbered requirements, traceability to tests) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flows, failure behaviour |
| [docs/adr/](docs/adr/) | Why the key decisions were made |
| [docs/API.md](docs/API.md) | HTTP endpoints, limits, error codes |
| [docs/SECURITY.md](docs/SECURITY.md) | Threats, mitigations, accepted risks |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | What is tested, what is not, and the manual checklist for real API keys |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [CHANGELOG.md](CHANGELOG.md) | Workflow and release notes |

---

## Concepts demonstrated

Tokens and context windows · extractive vs abstractive summarization · exact vs estimated token counting · structured outputs with JSON schemas across two providers · multimodal input (video by URL) · grounding model output to source positions · prompt-injection resistance · LLM-as-judge evaluation (QA-based and faithfulness) · why proxy metrics mislead · keeping API secrets server-side · testing LLM integrations against fake APIs.
