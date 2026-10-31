# Architecture Decision Records

Short notes on significant decisions: the context, what was decided, and the consequences. Add a new numbered file when a decision is hard to reverse or would surprise a new contributor. Do not edit an accepted ADR to change history — add one that supersedes it.

| # | Decision | Status |
|---|---|---|
| [0001](0001-server-side-api-keys.md) | API keys live on a local server, never in the browser | Accepted |
| [0002](0002-provider-neutral-prompts.md) | Prompts and schemas are provider-neutral; providers are thin adapters | Accepted |
| [0003](0003-structured-output-for-results.md) | LLM results are requested as schema-constrained JSON | Accepted |
| [0004](0004-gemini-for-youtube-video.md) | Gemini reads YouTube videos directly from their URL | Accepted |
| [0005](0005-qa-based-evaluation.md) | Information loss is measured with an LLM question-answering test | Accepted |
| [0006](0006-keep-offline-extractive-baseline.md) | Keep the offline extractive engine alongside the LLM engines | Accepted |
| [0007](0007-local-exact-token-counting.md) | Count tokens locally with a real tokenizer | Accepted |
