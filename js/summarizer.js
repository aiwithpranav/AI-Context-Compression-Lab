/**
 * summarizer.js
 * Extractive summarization module.
 * Selects the highest-importance sentences from the input,
 * reorders them in original document order, and joins them into
 * a cohesive summary paragraph.
 *
 * Compression level affects how many sentences are kept:
 *   light      → ~50% of sentences (preserve most meaning)
 *   balanced   → ~35% of sentences (balance between size and meaning)
 *   aggressive → ~20% of sentences (maximum reduction)
 *
 * The algorithm always ensures a minimum of 2 sentences are kept,
 * and caps the output at 70% of the original sentence count so that
 * "light" compression still produces a meaningfully shorter result.
 */

const Summarizer = (() => {

  // Ratio of sentences to keep per compression level
  const LEVEL_RATIOS = {
    light:      0.50,
    balanced:   0.35,
    aggressive: 0.20,
  };

  // Absolute minimum sentences to always include (prevents empty output)
  const MIN_SENTENCES = 2;

  /**
   * Generate an extractive summary at a given compression level.
   *
   * Strategy:
   *  1. Split into sentences and rank via TF-IDF.
   *  2. Select top-K sentences based on level ratio, subject to min/max guards.
   *  3. Re-sort by original index to preserve narrative flow.
   *  4. Join with a space.
   *
   * @param {string} text - Original input text
   * @param {'light'|'balanced'|'aggressive'} [level='balanced'] - Compression level
   * @returns {{ summary: string, selectedCount: number, totalCount: number, level: string }}
   */
  function generateSummary(text, level = 'balanced', presplit = null) {
    const sentences = presplit || TextProcessor.tokenizeIntoSentences(text);

    if (sentences.length === 0) {
      return { summary: '', selectedCount: 0, totalCount: 0, level };
    }

    const ratio = LEVEL_RATIOS[level] ?? LEVEL_RATIOS.balanced;

    // Number of sentences to keep
    // — always at least MIN_SENTENCES
    // — never more than the total count
    const targetCount = Math.min(
      sentences.length,
      Math.max(MIN_SENTENCES, Math.floor(sentences.length * ratio))
    );

    const ranked = TextProcessor.rankSentences(sentences);

    // Take the top-K by score
    const topK = [...ranked]
      .sort((a, b) => b.score - a.score)
      .slice(0, targetCount);

    // Restore original reading order
    const ordered = topK.sort((a, b) => a.index - b.index);

    // Build the summary paragraph
    const summary = ordered
      .map(item => _cleanSentence(item.sentence))
      .join(' ');

    return {
      summary,
      selectedCount: ordered.length,
      totalCount: sentences.length,
      level,
    };
  }

  /**
   * Get the human-readable description of a compression level.
   * @param {'light'|'balanced'|'aggressive'} level
   * @returns {string}
   */
  function getLevelDescription(level) {
    const descriptions = {
      light:      'Preserves most information with moderate length reduction.',
      balanced:   'Balances compression with information preservation.',
      aggressive: 'Maximum context reduction; essential meaning retained.',
    };
    return descriptions[level] || descriptions.balanced;
  }

  /**
   * Get the ratio for a given level (used externally for key-point count).
   * @param {'light'|'balanced'|'aggressive'} level
   * @returns {number}
   */
  function getRatioForLevel(level) {
    return LEVEL_RATIOS[level] ?? LEVEL_RATIOS.balanced;
  }

  /**
   * Clean up a sentence: fix multiple spaces, capitalize first letter.
   * @param {string} sentence
   * @returns {string}
   */
  function _cleanSentence(sentence) {
    return sentence
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[a-z]/, c => c.toUpperCase());
  }

  return {
    generateSummary,
    getLevelDescription,
    getRatioForLevel,
    LEVEL_RATIOS,
  };

})();
