/**
 * preservation.js
 * Meaning Preservation & Concept Coverage evaluation module.
 *
 * HOW IT WORKS (transparent heuristic — not semantic AI):
 *   1. Extract the top N keywords from both the original and compressed texts
 *      using TF-IDF scoring.
 *   2. Compute keyword coverage: fraction of original's top keywords that
 *      appear in the compressed version.
 *   3. Compute Jaccard similarity for a secondary signal.
 *   4. Blend both into a 0–1 score and map to High / Moderate / Low.
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

    const origKeywords = new Set(TextProcessor.getTopKeywords(original, topN));
    const compKeywords = new Set(TextProcessor.getTopKeywords(compressed, topN));

    if (origKeywords.size === 0) {
      return _empty('Not enough distinct keywords to evaluate concept coverage.');
    }

    // Keyword coverage: what fraction of original's top concepts appear in compressed?
    const intersection = [...origKeywords].filter(kw => compKeywords.has(kw));
    const union = new Set([...origKeywords, ...compKeywords]);

    const coverageScore = intersection.length / origKeywords.size;
    const jaccardScore  = union.size > 0 ? intersection.length / union.size : 0;

    // Weighted blend: keyword coverage is the primary metric
    const blendedScore = (coverageScore * 0.65) + (jaccardScore * 0.35);
    const percentage   = Math.round(blendedScore * 100);

    const { level, explanation } = _interpretScore(blendedScore, intersection.length, origKeywords.size);

    return {
      score:           parseFloat(blendedScore.toFixed(3)),
      percentage,
      level,
      explanation,
      matchedKeywords: intersection.length,
      totalKeywords:   origKeywords.size,
      disclaimer:      'Concept coverage is a keyword-matching heuristic. It estimates how many important terms are retained — not full semantic equivalence.',
    };
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
