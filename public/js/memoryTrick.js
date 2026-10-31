/**
 * memoryTrick.js
 * Memory aid generation module.
 *
 * Generates human-memorable aids from the actual content of the input.
 * All tricks are derived from real keywords — nothing is generic or pre-written.
 *
 * Strategy priority:
 *   1. Short Phrase    — a concise sentence capturing the core idea
 *   2. Concept Chain   — logical flow of top 4–5 key concepts
 *   3. Mnemonic        — short acronym with meaningful word expansion (≤5 concepts)
 *   4. Mental Analogy  — a simple "think of it like..." comparison
 *
 * Raw letter-string acronyms (e.g. "ICCITWB") are avoided.
 * If a clean acronym can't be formed, the system falls back gracefully.
 */

const MemoryTrick = (() => {

  // Common analogy templates, filled with actual keywords from the text
  const ANALOGY_TEMPLATES = [
    (main, rest) => `Think of ${main} like packing a suitcase: keep what is essential (${rest}), leave behind what is not.`,
    (main, rest) => `Imagine ${main} as a funnel: a wide input of ideas (${rest}) is narrowed down to what truly matters.`,
    (main, rest) => `${main} works like a highlight marker: it identifies the most important parts — ${rest} — and lets the rest fade out.`,
    (main, rest) => `Picture ${main} as a map: it shows the key landmarks (${rest}) without drawing every single road.`,
  ];

  /**
   * Generate a memory trick based on the original text and its key points.
   * @param {string} originalText
   * @param {string[]} keyPoints - Array of bullet-point strings
   * @returns {{ type: string, mnemonic: string, explanation: string }}
   */
  function generateMemoryTrick(originalText, keyPoints = []) {
    const source = keyPoints.length > 0 ? keyPoints.join(' ') : originalText;
    const topKeywords = TextProcessor.getTopKeywords(source, 10);

    if (topKeywords.length === 0) {
      return {
        type: 'Phrase',
        mnemonic: 'Compress to the core.',
        explanation: 'Provide more varied text to generate a personalised memory aid.',
      };
    }

    // Strategy 1: Short Phrase from top 3 keywords
    if (topKeywords.length >= 3) {
      const phraseResult = _buildShortPhrase(topKeywords.slice(0, 5), originalText);
      if (phraseResult) return phraseResult;
    }

    // Strategy 2: Concept Chain (4–5 keywords)
    if (topKeywords.length >= 4) {
      return _buildConceptChain(topKeywords.slice(0, 5));
    }

    // Strategy 3: Meaningful Mnemonic (≤5 short words)
    const mnemonicCandidates = topKeywords.filter(w => w.length <= 8).slice(0, 5);
    if (mnemonicCandidates.length >= 3) {
      const mnemonicResult = _buildMnemonic(mnemonicCandidates);
      if (mnemonicResult) return mnemonicResult;
    }

    // Strategy 4: Mental Analogy fallback
    return _buildAnalogy(topKeywords.slice(0, 4));
  }

  /**
   * Build a short memorable phrase from top keywords.
   * Creates a concise 6–10 word sentence that reads naturally.
   * @param {string[]} words
   * @param {string} originalText
   * @returns {{ type, mnemonic, explanation } | null}
   */
  function _buildShortPhrase(words, originalText) {
    const main  = _capitalize(words[0]);
    const rest  = words.slice(1, 4).map(_capitalize).join(', ');
    const last  = _capitalize(words[words.length > 1 ? 1 : 0]);

    // Build a context-aware short phrase
    const phrase = `${main}: understand ${rest}, preserve the meaning.`;

    return {
      type: 'Short Phrase',
      mnemonic: phrase,
      explanation: `Use this phrase to recall the core topic. "${main}" is the central concept; "${rest}" are the key supporting ideas you should remember.`,
    };
  }

  /**
   * Build a concept-chain showing logical flow between key ideas.
   * @param {string[]} words
   * @returns {{ type, mnemonic, explanation }}
   */
  function _buildConceptChain(words) {
    const concepts = words.map(_capitalize);
    const chain    = concepts.join(' → ');

    return {
      type: 'Concept Chain',
      mnemonic: chain,
      explanation: `Trace the chain from left to right: start with "${concepts[0]}", follow through each linked concept, and arrive at "${concepts[concepts.length - 1]}". Recalling this order helps reconstruct the core narrative.`,
    };
  }

  /**
   * Build a meaningful mnemonic: a short acronym where each letter has a
   * proper word — not a random letter string.
   * Rejects acronyms longer than 6 characters.
   * @param {string[]} words
   * @returns {{ type, mnemonic, explanation } | null}
   */
  function _buildMnemonic(words) {
    if (words.length < 3 || words.length > 6) return null;

    const letters   = words.map(w => w[0].toUpperCase());
    const acronym   = letters.join('-');

    // Each letter expands to its full word
    const expansion = words.map(w => _capitalize(w)).join(' · ');
    const phrase    = `${acronym} = ${expansion}`;

    return {
      type: 'Mnemonic',
      mnemonic: phrase,
      explanation: `Each letter stands for a key concept: ${expansion}. Say the letters aloud in order to recall the main ideas of the text.`,
    };
  }

  /**
   * Build a mental analogy using a template filled with real keywords.
   * @param {string[]} words
   * @returns {{ type, mnemonic, explanation }}
   */
  function _buildAnalogy(words) {
    const main = words[0] || 'information';
    const rest = words.slice(1, 4).map(_capitalize).join(', ') || 'key details';

    // Pick a template based on a simple hash of the main word (deterministic per input)
    const templateIndex = main.length % ANALOGY_TEMPLATES.length;
    const analogy = ANALOGY_TEMPLATES[templateIndex](_capitalize(main), rest);

    return {
      type: 'Mental Analogy',
      mnemonic: analogy,
      explanation: `This analogy connects "${_capitalize(main)}" to a familiar concept, making it easier to recall the relationship between the key ideas: ${rest}.`,
    };
  }

  /**
   * Capitalize the first letter of a word.
   * @param {string} w
   * @returns {string}
   */
  function _capitalize(w) {
    if (!w) return '';
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  /**
   * Get the display icon for a memory trick type.
   * @param {string} type
   * @returns {string}
   */
  function getTrickIcon(type) {
    const icons = {
      'Short Phrase':   '💬',
      'Concept Chain':  '🔗',
      'Mnemonic':       '🔤',
      'Mental Analogy': '🎯',
      'Phrase':         '💬',
    };
    return icons[type] || '🧠';
  }

  return {
    generateMemoryTrick,
    getTrickIcon,
  };

})();
