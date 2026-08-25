/**
 * keyPoints.js
 * Key-point extraction module.
 * Identifies the most important distinct concepts from the text
 * and returns them as clean, concise bullet-point strings.
 *
 * Compression level affects the number of points returned:
 *   light      → up to 8 points
 *   balanced   → up to 6 points
 *   aggressive → up to 4 points
 */

const KeyPoints = (() => {

  // Max key points per compression level
  const LEVEL_MAX_POINTS = {
    light:      8,
    balanced:   6,
    aggressive: 4,
  };

  /**
   * Extract the most important key points from text.
   * @param {string} text
   * @param {'light'|'balanced'|'aggressive'} [level='balanced'] - Compression level
   * @returns {string[]} Array of bullet-point strings (no "•" prefix — caller adds it)
   */
  function extractKeyPoints(text, level = 'balanced') {
    const maxPoints = LEVEL_MAX_POINTS[level] ?? LEVEL_MAX_POINTS.balanced;
    const sentences = TextProcessor.tokenizeIntoSentences(text);

    if (sentences.length === 0) return [];
    if (sentences.length <= 2) {
      return sentences.slice(0, maxPoints).map(_trimToKeyPoint);
    }

    const ranked = TextProcessor.rankSentences(sentences);
    const sorted = [...ranked].sort((a, b) => b.score - a.score);

    const selected = [];
    const usedKeywords = new Set();

    for (const item of sorted) {
      if (selected.length >= maxPoints) break;

      const keywords = TextProcessor.extractKeywords(item.sentence);

      // Diversity check: skip if this sentence shares >60% keywords with already selected ones
      if (selected.length > 0 && _overlapRatio(keywords, usedKeywords) > 0.6) continue;

      const keyPoint = _trimToKeyPoint(item.sentence);
      if (keyPoint.length < 8) continue;

      selected.push(keyPoint);
      keywords.forEach(kw => usedKeywords.add(kw));
    }

    // Re-sort by original sentence index for a natural reading order
    const selectedIndices = selected.map(kp => {
      const found = ranked.find(r => _trimToKeyPoint(r.sentence) === kp);
      return found ? found.index : 0;
    });

    const paired = selected.map((kp, i) => ({ kp, idx: selectedIndices[i] }));
    paired.sort((a, b) => a.idx - b.idx);

    return paired.map(p => p.kp);
  }

  /**
   * Calculate how many keywords in `candidateWords` already appear in `existingSet`.
   * @param {string[]} candidateWords
   * @param {Set<string>} existingSet
   * @returns {number} ratio 0–1
   */
  function _overlapRatio(candidateWords, existingSet) {
    if (candidateWords.length === 0 || existingSet.size === 0) return 0;
    const overlap = candidateWords.filter(w => existingSet.has(w)).length;
    return overlap / candidateWords.length;
  }

  /**
   * Trim a sentence to a concise key-point phrase.
   * @param {string} sentence
   * @returns {string}
   */
  function _trimToKeyPoint(sentence) {
    let s = sentence.trim();

    // Remove common leading subordinate conjunctions
    s = s.replace(/^(Although|While|Despite|Even though|Since|Because|Given that|Considering that)\s+/i, '');

    // Trim after a long parenthetical or aside if sentence is long
    if (s.length > 120) {
      s = s.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').trim();
    }

    // Strip trailing "which..." or "that..." clauses if sentence is still long
    if (s.length > 100) {
      s = s.replace(/,\s*(which|that|where|when|as)\b.*/i, '').trim();
    }

    // Clean multiple spaces
    s = s.replace(/\s+/g, ' ').trim();

    // Capitalize first letter
    s = s.charAt(0).toUpperCase() + s.slice(1);

    // Ensure ends with punctuation
    if (s && !s.match(/[.!?]$/)) s += '.';

    return s;
  }

  return {
    extractKeyPoints,
    LEVEL_MAX_POINTS,
  };

})();
