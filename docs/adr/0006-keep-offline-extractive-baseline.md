# ADR-0006: Keep the offline extractive engine alongside the LLM engines

**Status:** Accepted · 2026-10-31

## Context
The project began as a classical TF-IDF summarizer. LLMs now do the main work, but the baseline is still useful.

## Decision
Keep it as a selectable engine and as the comparison baseline.

## Consequences
+ Works with no key, no network and no cost; cannot hallucinate; fast; explainable.
+ Makes the question "does an LLM actually do better, and at what cost?" answerable with data (the engine comparison table).
− A second code path to maintain; English-only keyword logic.
