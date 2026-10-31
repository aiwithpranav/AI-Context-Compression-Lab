# ADR-0007: Count tokens locally with a real tokenizer

**Status:** Accepted · 2026-10-31

## Context
Token counts drive the headline metrics. The original used `(chars/4 + words×1.3)/2`, an unlabelled guess that is poor for code and non-English text.

## Decision
Use `gpt-tokenizer` (o200k) on the server for exact OpenAI-style counts. It runs locally, so it needs no key and no API call. When the server is not reachable the UI falls back to the estimate and marks it with `~`. For videos, use Gemini's own prompt-token count (minus our prompt text) and its `countTokens` endpoint.

## Consequences
+ Exact, free, offline-capable; estimates are honestly labelled.
− Counts are for OpenAI's tokenizer; other models tokenize differently, so "tokens saved" is exact for OpenAI-family models and indicative for others. Video and text token counts are not directly comparable.
