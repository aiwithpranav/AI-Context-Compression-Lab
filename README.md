# Context Compression Lab

**Project 02 of the LLM Learning Series**

A browser-based tool that demonstrates how large textual context can be compressed into smaller representations while attempting to preserve important information. Built with pure HTML, CSS, and JavaScript — no backend, no external AI API, no installation required.

---

## Problem Statement

Large Language Models (LLMs) process text as **tokens** — small units of text (roughly 3–4 characters each). Every model has a **context window**: a maximum number of tokens it can process in a single interaction.

This creates a real engineering challenge:

- Long documents, conversation histories, and retrieved content all consume context.
- When context grows too large, it must be truncated or compressed.
- Repeated or low-value information wastes token capacity.
- **But aggressive compression removes important information.**

The core tension is: **how do you make context smaller without losing what matters?**

This project explores that question directly.

---

## Project Objective

This project explores the following concepts:

- Context windows and token limits
- Token estimation from raw text
- Extractive text summarization
- Key-point extraction from unstructured text
- Compression ratios and context reduction
- Concept coverage (how many key ideas survive compression)
- Information preservation — why shorter is not always better
- Memory aids for retaining compressed information

---

## Features

| Feature | Description |
|---|---|
| **Summary** | Extractive paragraph summary at a chosen compression level |
| **Key Points** | Bullet-point extraction of the most important distinct concepts |
| **Summary + Key Points** | Both representations simultaneously |
| **Compression Levels** | Light / Balanced / Aggressive — affects output depth |
| **Token Estimation** | Estimated GPT-style token count for original and compressed text |
| **Context Analytics** | Side-by-side original vs. compressed character, word, and token counts |
| **Compression Ratio** | Original tokens ÷ compressed tokens |
| **Context Reduction** | Percentage of the original context eliminated |
| **Tokens Saved** | Estimated tokens removed from the original context |
| **Concept Coverage** | Keyword-based heuristic estimating how many key concepts survive |
| **Memory Trick** | Algorithmically generated mnemonic, concept chain, or analogy |
| **Copy Buttons** | Copy summary, key points, or memory trick to clipboard |
| **Clear / Try Again** | Reset or scroll back to input |
| **Live Stats** | Real-time character, word, and token counter as you type |
| **Loading States** | Animated step-by-step processing indicator |
| **Responsive Layout** | Mobile-first, fully responsive |

---

## How It Works

```
User Input
    ↓
Text Analysis
(Sentence splitting, TF-IDF keyword scoring)
    ↓
Token Estimation
(Weighted character + word formula)
    ↓
Compression
(Extractive sentence selection based on importance and compression level)
    ↓
Summary / Key Points / Both
    ↓
Compression Metrics
(Characters, words, tokens — original vs. compressed)
    ↓
Concept Coverage
(Keyword overlap heuristic — Jaccard + coverage score)
    ↓
Memory Trick
(Short phrase, concept chain, mnemonic, or mental analogy)
```

---

## LLM Concepts Demonstrated

### Tokens
Tokens are the units LLMs use to process text. A token is roughly 3–4 characters of English text. A 2,000-character article is approximately 400–600 tokens. Understanding token counts is essential for working within context limits.

### Context Window
The context window is the maximum amount of text (measured in tokens) that an LLM can process in a single call. For example, GPT-4 has context windows ranging from 8K to 128K tokens. Content that doesn't fit in the window must be trimmed, summarized, or chunked.

### Context Compression
Compression reduces the number of tokens required to represent the same information. This is valuable when:
- Working with large documents in limited context windows
- Building conversational agents with long memory
- Creating RAG pipelines that inject retrieved context
- Reducing API costs (tokens = cost in hosted LLM APIs)

### Extractive Summarization
This project uses **extractive** summarization: selecting and returning the highest-importance sentences from the original text without rewriting them. It does **not** generate new text. Sentences are ranked using a TF-IDF (Term Frequency–Inverse Document Frequency) scoring algorithm.

### Structured Compression
Key-point extraction represents the same information as a structured bullet list. This is often more token-efficient than a prose paragraph and easier for an LLM to parse when injected as context.

### Information Preservation
Compression is not free. Every sentence removed potentially eliminates a concept, a nuance, or a conclusion. This project makes that trade-off explicit by measuring concept coverage — tracking how many of the original text's key terms survive in the compressed version.

---

## Compression Metrics

### Context Reduction
The percentage of the original token count that was eliminated.

```
Context Reduction = ((Original Tokens − Compressed Tokens) / Original Tokens) × 100
```

### Compression Ratio
How many times smaller the compressed version is compared to the original.

```
Compression Ratio = Original Tokens / Compressed Tokens
```

A ratio of 3.0× means the compressed version uses one third of the original tokens.

### Tokens Saved
The estimated number of tokens removed from the context.

```
Tokens Saved = Original Tokens − Compressed Tokens
```

### Concept Coverage
A heuristic estimate — not a semantic guarantee — of how many important concepts from the original text are present in the compressed version.

**Method:** Extract the top N keywords (by TF-IDF score) from both the original and compressed texts. Compute keyword coverage (fraction of original's top keywords found in compressed) blended with Jaccard similarity.

> **Important:** Concept coverage is a keyword-matching heuristic. A high score means key terms are present in the output. It does **not** prove that the full meaning or context relationships are preserved. True semantic equivalence cannot be measured without an LLM-based evaluation.

---

## Compression Levels

| Level | Sentences Kept | Key Points | Effect |
|---|---|---|---|
| **Light** | ~50% | Up to 8 | Preserves most information; moderate length reduction |
| **Balanced** | ~35% | Up to 6 | Balances compression with information coverage |
| **Aggressive** | ~20% | Up to 4 | Maximum context reduction; only essential ideas |

Each level produces genuinely different output — not just a label change. The same text at Aggressive level will produce a noticeably shorter summary and fewer key points than at Light level.

**Trade-off:** Higher compression → fewer tokens → lower concept coverage. This is expected and is the central lesson of the project.

---

## Example

> *This is an illustrative example only. Actual results will vary by input.*

**Original text** (~600 tokens):
> A long article explaining how neural networks learn through gradient descent, backpropagation, and weight updates...

**Balanced compression summary** (~180 tokens):
> Neural networks learn by adjusting weights through gradient descent. Backpropagation calculates error gradients layer by layer, enabling efficient training on large datasets...

**Concept coverage:** 78% (High) — most key terms retained  
**Context reduction:** ~70% — 420 tokens saved  
**Compression ratio:** ~3.3×

---

## Technology Stack

| Component | Technology |
|---|---|
| UI Structure | HTML5 (semantic elements, ARIA) |
| Styling | Vanilla CSS (custom design system, CSS custom properties) |
| Logic | Vanilla JavaScript (ES6 modules via IIFE pattern) |
| Fonts | Google Fonts — Plus Jakarta Sans + Inter |
| NLP | Custom TF-IDF implementation (no external library) |
| Tokenization | Algorithmic estimation (character + word blend) |
| Backend | None — fully client-side |
| External APIs | None |
| Build Tools | None — direct HTML file loading |

---

## Project Structure

```
AI-Context-Compression-Lab/
├── index.html              ← App shell (all UI structure, ARIA, semantic HTML)
├── style.css               ← Complete design system (23 CSS sections)
├── README.md               ← This file
└── js/
    ├── tokenizer.js        ← Character, word, and GPT-style token estimation
    ├── textProcessor.js    ← Sentence splitting, TF-IDF scoring, keyword extraction
    ├── summarizer.js       ← Extractive summarization with compression levels
    ├── keyPoints.js        ← Diversity-filtered bullet-point extraction
    ├── statistics.js       ← Compression ratio and context analytics
    ├── preservation.js     ← Concept coverage evaluation (Jaccard + coverage)
    ├── memoryTrick.js      ← Memory aid generation (phrase, chain, mnemonic, analogy)
    ├── state.js            ← Pub/sub application state manager
    ├── ui.js               ← DOM orchestration, animations, copy, clear
    └── app.js              ← Pipeline entry point and button wiring
```

---

## Running the Project

No build step, no server, no dependencies.

1. Open `index.html` in any modern browser:
   ```
   d:\AI\LLMs\AI-Context-Compression-Lab\index.html
   ```
2. Paste any text into the input field.
3. Select a compression level (Light / Balanced / Aggressive).
4. Click **Make Summary**, **Key Points**, or **Summary + Key Points**.

**Browser compatibility:** Chrome 80+, Firefox 78+, Edge 80+, Safari 16.4+  
*(Lookbehind regex requires Safari 16.4 or later)*

---

## Future Improvements

The following are clearly labeled as **future work** — they are not currently implemented:

- **Abstractive summarization** — using a real LLM API (e.g. Gemini, OpenAI) to *rewrite* rather than *select* content
- **Semantic similarity evaluation** — using sentence embeddings to measure true meaning preservation instead of keyword overlap
- **Multiple tokenizer models** — GPT-4, Claude, Gemini token counts differ; supporting multiple estimation models
- **Context window visualization** — visual representation of how compressed content fits inside model context limits
- **Benchmarking** — comparing Light / Balanced / Aggressive strategies on standardized texts
- **Larger document support** — chunking and multi-pass compression for book-length inputs
- **Backend API** — server-side processing for heavier NLP (e.g. using spaCy, NLTK, or Transformers)
- **RAG-aware compression** — prioritizing context chunks by relevance to a specific query
- **Multi-language support** — extending the stop-word list and TF-IDF to non-English text
- **Export formats** — download summary as Markdown, plain text, or JSON

---

## Learning Outcomes

This project demonstrates:

1. **Why token limits matter** — context windows are finite; understanding token counts is practical, not theoretical.
2. **Extractive vs. abstractive compression** — selecting existing sentences is fast and explainable; AI-generated paraphrasing is more powerful but requires a model.
3. **The information loss trade-off** — every percentage point of compression carries a risk of losing meaning. This is shown explicitly via concept coverage scores.
4. **Heuristics vs. ground truth** — keyword coverage is a useful proxy for meaning preservation, but it is not a guarantee. The project is honest about this limitation.
5. **Structured representation** — bullet points often convey the same information in fewer tokens than prose.
6. **Practical NLP without a model** — TF-IDF, sentence ranking, and keyword extraction are classical techniques that work well for many compression tasks without requiring a neural network.

---

*Part of the LLM Learning Series — a collection of portfolio projects exploring how large language models work in practice.*
