/**
 * preservation.js
 * Meaning Preservation & Concept Coverage evaluation module.
 *
 * HOW IT WORKS (transparent heuristic — not semantic AI):
 *   1. Take the original's top keywords by TF-IDF (about 30% of its vocabulary,
 *      between 5 and 20, so short texts are not judged on noise).
 *   2. Coverage = the fraction of those keywords that appear anywhere in the
 *      compressed text, after light stemming.
 *   3. Map the score to High / Moderate / Low.
 *
 * IMPORTANT: This is a keyword-matching heuristic.
 * It estimates concept coverage — not true semantic equivalence.
 * A high score means key terms are present; it does not guarantee
 * that the full meaning or context is preserved.
 *
 * All values are dynamically computed — never hardcoded.
 */

const Preservation = (() => {

  /**
   * Evaluate concept coverage between original and compressed text.
   *
   * @param {string} original
   * @param {string} compressed
   * @param {number} [topN=20] - Number of top keywords to compare
   * @returns {{
   *   score: number,
   *   percentage: number,
   *   level: 'High'|'Moderate'|'Low',
   *   explanation: string,
   *   matchedKeywords: number,
   *   totalKeywords: number,
   *   disclaimer: string
   * }}
   */
  function evaluatePreservation(original, compressed, topN = 20) {
    if (!original || !compressed) {
      return _empty('Unable to evaluate — missing original or compressed text.');
    }

    // Short texts have few distinct terms; comparing 20 "top" keywords would
    // mostly compare noise. Use about 30% of the vocabulary, between 5 and topN.
    const vocabulary = new Set(TextProcessor.extractKeywords(original).map(_stem));
    const n = Math.min(topN, Math.max(5, Math.ceil(vocabulary.size * 0.3)));

    const origKeywords = [...new Set(TextProcessor.getTopKeywords(original, n).map(_stem))];
    if (origKeywords.length === 0) {
      return _empty('Not enough distinct keywords to evaluate concept coverage.');
    }

    // Coverage: how many of the original's key concepts appear anywhere in the
    // compressed text (not only among its own top keywords).
    const compressedTerms = new Set(TextProcessor.extractKeywords(compressed).map(_stem));
    const matched = origKeywords.filter(kw => compressedTerms.has(kw)).length;

    const score = matched / origKeywords.length;
    const percentage = Math.round(score * 100);
    const { level, explanation } = _interpretScore(score, matched, origKeywords.length);

    return {
      score:           parseFloat(score.toFixed(3)),
      percentage,
      level,
      explanation,
      matchedKeywords: matched,
      totalKeywords:   origKeywords.length,
      disclaimer:      'Concept coverage is a keyword-matching heuristic. It estimates how many important terms are retained — not full semantic equivalence. Rewritten (LLM) text can score low here even when the meaning is intact; use the LLM evaluation for that.',
    };
  }

  // Light stemming so "compress", "compressed", "compressing" and "compression" count as
  // one concept. Each rule only applies if at least 4 letters remain.
  const STEM_RULES = [
    [/(ation|ion)s?$/, ''],
    [/(ing|ed)$/, ''],
    [/es$/, ''],
    [/([^s])s$/, '$1'],
    [/e$/, ''],
  ];

  function _stem(word) {
    let w = word;
    for (const [pattern, replacement] of STEM_RULES) {
      const next = w.replace(pattern, replacement);
      if (next.length >= 4) w = next;
    }
    return w;
  }

  /**
   * Map a numeric blended score to a qualitative level and explanation.
   * @param {number} score
   * @param {number} matched
   * @param {number} total
   * @returns {{ level: string, explanation: string }}
   */
  function _interpretScore(score, matched, total) {
    if (score >= 0.60) {
      return {
        level: 'High',
        explanation: `${matched} of ${total} key concepts are present in the compressed version. Concept coverage is high — the compressed text retains the main topics and most supporting ideas.`,
      };
    } else if (score >= 0.35) {
      return {
        level: 'Moderate',
        explanation: `${matched} of ${total} key concepts are present. Concept coverage is moderate — the compressed text covers the main ideas but some supporting detail has been removed.`,
      };
    } else {
      return {
        level: 'Low',
        explanation: `Only ${matched} of ${total} key concepts are present. Concept coverage is low — significant information may have been omitted. Consider using a lighter compression level.`,
      };
    }
  }

  /**
   * Return an empty/error result.
   * @param {string} msg
   */
  function _empty(msg) {
    return {
      score: 0,
      percentage: 0,
      level: 'Low',
      explanation: msg,
      matchedKeywords: 0,
      totalKeywords: 0,
      disclaimer: 'Concept coverage is a keyword-matching heuristic.',
    };
  }

  /**
   * Get CSS class for the preservation level.
   * @param {'High'|'Moderate'|'Low'} level
   * @returns {string}
   */
  function getLevelClass(level) {
    return { High: 'level-high', Moderate: 'level-moderate', Low: 'level-low' }[level] || 'level-low';
  }

  /**
   * Get icon for a level.
   * @param {'High'|'Moderate'|'Low'} level
   * @returns {string}
   */
  function getLevelIcon(level) {
    return { High: '✓', Moderate: '~', Low: '!' }[level] || '?';
  }

  return {
    evaluatePreservation,
    getLevelClass,
    getLevelIcon,
  };

})();
