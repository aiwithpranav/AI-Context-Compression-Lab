# ADR-0003: LLM results are requested as schema-constrained JSON

**Status:** Accepted · 2026-10-31

## Context
The UI needs typed data (summary, key points with times, action items, a memory aid), not free text. Parsing prose is fragile.

## Decision
Every LLM call that feeds the UI sends a JSON schema: OpenAI `response_format: json_schema` with `strict: true`; Gemini `responseSchema`, falling back to plain JSON mode with the schema in the prompt if a model rejects it. The schema is built per request so the model is only asked for what the chosen mode needs.

Transcript points cite a **line number** and video points a **clock time**. The server maps line numbers to real timestamps and validates clock times; a model-supplied time that is not a valid time is dropped.

## Consequences
+ Predictable output; fewer tokens (only requested fields); timestamps cannot be invented for transcripts.
− Strict mode requires every field to be required and `additionalProperties: false`.
− Video times come from the model and can still be wrong (only malformed ones are caught).
− Free-form answers (video Q&A) are plain text with `[M:SS]` citations that the UI turns into links.
