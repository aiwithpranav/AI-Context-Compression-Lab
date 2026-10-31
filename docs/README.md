# Documentation

| Document | Question it answers | Phase |
|---|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | What must the product do, for whom, and how do we know? | Requirements |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How is it built, and how does data flow? | Design |
| [adr/](adr/) | Why were the important choices made? | Design |
| [API.md](API.md) | What does the server expose? | Design / Implementation |
| [SECURITY.md](SECURITY.md) | What can go wrong, and what protects against it? | Design / Verification |
| [TEST_PLAN.md](TEST_PLAN.md) | How is it verified, and what is not? | Verification |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | How do I change it safely? | Maintenance |
| [../CHANGELOG.md](../CHANGELOG.md) | What changed in each release? | Release |

## How the project was built

1. **Requirements** — goals, users, numbered functional and non-functional requirements, scope limits (`REQUIREMENTS.md`).
2. **Design** — components, data flows and failure behaviour; decisions recorded as ADRs.
3. **Implementation** — small modules with one responsibility; provider-neutral prompts; no build step.
4. **Verification** — automated tests that need no API keys, regression tests for every defect found, and a manual checklist for what fakes cannot prove (`TEST_PLAN.md`).
5. **Security review** — threat list with mitigations and accepted risks (`SECURITY.md`); a secret scan before publishing.
6. **Release** — CI on Node 22 and 24, changelog, exit criteria in the test plan.

## Honest status

Everything that can be checked without real API keys is automated (112 tests against **fake OpenAI and Gemini APIs**). The developer then ran the real thing on 2026-10-31: text compression and the 3-step LLM evaluation (OpenAI), Gemini summaries and multi-turn questions on a 14-minute talk (including a question the video cannot answer), the recording pipeline (upload → summary → questions in English and Marathi → delete), summary MP3s and whole-video audio; the maintainer also confirmed a video Q&A round and whole-video audio on a real video. **Not yet checked:** a long Zoom/Meet MP4, listening on a phone with the screen locked, and the audio-to-video length ratio on a full-length video. See `TEST_PLAN.md`.
