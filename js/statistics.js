/**
 * statistics.js
 * Compression analytics module.
 * Computes all numeric statistics comparing original vs compressed text.
 * All values are dynamically calculated — nothing is hardcoded.
 */

const Statistics = (() => {

  /**
   * Compute the full compression statistics object.
   * @param {string} original - The full original input text
   * @param {string} compressed - The compressed output (summary or key points joined)
   * @returns {CompressionStats}
   *
   * @typedef {Object} CompressionStats
   * @property {number} originalChars
   * @property {number} compressedChars
   * @property {number} originalWords
   * @property {number} compressedWords
   * @property {number} originalTokens
   * @property {number} compressedTokens
   * @property {number} tokensSaved
   * @property {number} compressionRatio   e.g. 3.2 (means 3.2× smaller)
   * @property {number} contextReduction   e.g. 69.6 (percentage reduction)
   * @property {number} charReduction
   * @property {number} wordReduction
   */
  function computeStats(original, compressed) {
    const originalChars   = Tokenizer.countChars(original);
    const compressedChars = Tokenizer.countChars(compressed);
    const originalWords   = Tokenizer.countWords(original);
    const compressedWords = Tokenizer.countWords(compressed);
    const originalTokens  = Tokenizer.estimateTokens(original);
    const compressedTokens = Tokenizer.estimateTokens(compressed);

    const tokensSaved = Math.max(0, originalTokens - compressedTokens);

    // Compression ratio: how many times smaller is the output? (floor at 1.0×)
    const compressionRatio = originalTokens > 0
      ? Math.max(1, originalTokens / Math.max(1, compressedTokens))
      : 1;

    // Context reduction as a percentage
    const contextReduction = originalTokens > 0
      ? Math.max(0, ((originalTokens - compressedTokens) / originalTokens) * 100)
      : 0;

    const charReduction = originalChars > 0
      ? Math.max(0, ((originalChars - compressedChars) / originalChars) * 100)
      : 0;

    const wordReduction = originalWords > 0
      ? Math.max(0, ((originalWords - compressedWords) / originalWords) * 100)
      : 0;

    return {
      originalChars,
      compressedChars,
      originalWords,
      compressedWords,
      originalTokens,
      compressedTokens,
      tokensSaved,
      compressionRatio: parseFloat(compressionRatio.toFixed(2)),
      contextReduction: parseFloat(contextReduction.toFixed(1)),
      charReduction: parseFloat(charReduction.toFixed(1)),
      wordReduction: parseFloat(wordReduction.toFixed(1)),
    };
  }

  /**
   * Format a compression ratio for display, e.g. "3.29×"
   * @param {number} ratio
   * @returns {string}
   */
  function formatRatio(ratio) {
    return `${ratio.toFixed(2)}×`;
  }

  /**
   * Format a percentage for display, e.g. "69.6%"
   * @param {number} pct
   * @returns {string}
   */
  function formatPercent(pct) {
    return `${pct.toFixed(1)}%`;
  }

  /**
   * Format token count with tilde prefix, e.g. "~340"
   * @param {number} tokens
   * @returns {string}
   */
  function formatTokens(tokens) {
    return `~${Tokenizer.formatNumber(tokens)}`;
  }

  /**
   * Get the reduction level label based on contextReduction percentage.
   * @param {number} pct
   * @returns {string}
   */
  function getReductionLabel(pct) {
    if (pct >= 70) return 'Major';
    if (pct >= 40) return 'Significant';
    if (pct >= 20) return 'Moderate';
    return 'Minimal';
  }

  return {
    computeStats,
    formatRatio,
    formatPercent,
    formatTokens,
    getReductionLabel,
  };

})();
