# Contributing

## Setup

```bash
git clone https://github.com/aiwithpranav/AI-Context-Compression-Lab.git
cd AI-Context-Compression-Lab
npm install
cp .env.example .env     # optional: add OPENAI_API_KEY / GEMINI_API_KEY
npm start                # http://localhost:3000
npm test                 # no keys needed
```

Node 22 or newer. There is no build step.

## Workflow

1. **Start from a requirement.** Find or add the requirement ID in `docs/REQUIREMENTS.md`. If the change is not covered, update the requirement first.
2. **Branch** from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`, `chore/<short-name>`.
3. **Write the test first for a bug fix** and list it in the regression table in `docs/TEST_PLAN.md`.
4. **Keep commits focused**, using [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.
5. **Open a pull request** using the template. CI (`npm test` on Node 22 and 24) must pass.
6. **Update docs** that your change affects: README, `docs/API.md`, `CHANGELOG.md` (under *Unreleased*), and an ADR if you made a decision that is hard to reverse.

## Repository layout

- `public/` — everything the browser loads (and the only thing the server serves).
- `server/` — backend code; never served. `server/index.js` is the entry point.
- `tests/`, `docs/`, `.github/` — verification, documentation, CI.

Keep that boundary: browser files go in `public/`, anything that touches a key or the file system goes in `server/`.

## Code conventions

- Match the surrounding style (see `.editorconfig`): 2-space indent, LF line endings, single quotes in JS.
- Browser code is plain scripts exposing one global each (`Summarizer`, `UI`, …); load order is in `public/index.html`. Server code is ES modules.
- **Never insert model output or document text as HTML.** Use `textContent` or DOM nodes.
- **Keys stay on the server.** The browser never receives or sends a provider key.
- Prompts, schemas and pure helpers go in `server/prompts.js`; provider-specific wire details go in `server/providers/`. Do not mix them.
- Heuristic metrics must be labelled as heuristics in the UI.

## Adding a provider or model feature

1. Add helpers/schemas to `server/prompts.js` (pure, with tests).
2. Add or extend an adapter in `server/providers/` returning `{ data, usage }` and translating vendor errors into `LlmError` with a friendly message and HTTP status.
3. Extend `tests/fakes.js` to imitate the vendor, then write tests against it.
4. Add the manual real-key check to `docs/TEST_PLAN.md`.

## Adding a document format

Add a parser in `server/extract.js`, a small committed fixture (generate it in `tests/make-fixtures.mjs`), and tests in `tests/server.test.js` for success **and** failure.

## Secrets

Never commit `.env`, keys, or real private documents. Before pushing, search your diff for key patterns (`sk-…`, `AIza…`). If a key was committed, revoke it immediately — deleting it from history is not enough.

## Releasing

1. All exit criteria in `docs/TEST_PLAN.md` §5 are met.
2. Move *Unreleased* entries in `CHANGELOG.md` under a new version heading with the date.
3. Bump `version` in `package.json`, tag `vX.Y.Z`.
