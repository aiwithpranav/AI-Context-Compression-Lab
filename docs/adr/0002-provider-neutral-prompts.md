# ADR-0002: Prompts and schemas are provider-neutral; providers are thin adapters

**Status:** Accepted · 2026-10-31

## Context
Text uses OpenAI and video uses Gemini. The project first used a different provider, and model names and APIs change frequently.

## Decision
`server/prompts.js` holds prompts, JSON schemas and pure helpers with no network code. Each provider module (`providers/openai.js`, `providers/gemini.js`) only translates a request into that vendor's wire format and returns `{ data, usage }`. `server/llm.js` composes them.

## Consequences
+ A provider can be replaced or added by writing one adapter (the project moved its text engine from one provider to another without rewriting the prompts).
+ Prompts and mapping logic are unit-testable without a network.
− Vendor-specific features (thinking controls, caching) are not used; the schema is the lowest common denominator (strict-mode friendly JSON Schema).

## Alternatives considered
A multi-provider SDK or gateway — adds a dependency and hides behaviour we want to test.
