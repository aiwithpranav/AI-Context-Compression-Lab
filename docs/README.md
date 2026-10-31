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
6. **Release** — CI on Node 20 and 22, changelog, exit criteria in the test plan.

## Honest status

Everything that can be checked without real API keys is automated. Automated tests use **fake OpenAI and Gemini APIs**. Real-key checks so far: Gemini video summaries (19-second and 14-minute public videos, timings recorded in ADR-0004) and the OpenAI text flow, which the maintainer reported working. **Not yet checked with real keys:** video Q&A (MT-7), the LLM evaluation (MT-3), documents through the LLM engine, and long-running behaviour. See `TEST_PLAN.md`.
