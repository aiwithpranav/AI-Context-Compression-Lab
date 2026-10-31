# ADR-0005: Information loss is measured with an LLM question-answering test

**Status:** Accepted · 2026-10-31

## Context
The first version scored "concept coverage" by keyword overlap. That is circular for the extractive engine (it keeps sentences containing the keywords it is scored on) and it punishes good paraphrasing, so an LLM rewrite scores low even when the meaning is intact.

## Decision
Measure what a reader would experience:
1. write questions with gold answers from the original;
2. answer them using only the compressed text, replying `NOT FOUND` otherwise;
3. grade the answers and list claims in the compressed text that the original does not support.

Score = (correct + ½·partial) ÷ questions. Keep keyword coverage, labelled as a heuristic.

## Consequences
+ Comparable across engines and levels; surfaces hallucinations, not just omissions.
− Costs three model calls and sends the original text twice.
− An LLM grading LLM output can be biased, and 8 questions is a small sample. Treat it as a signal, not ground truth.
− Not available when there is no source text (videos).
