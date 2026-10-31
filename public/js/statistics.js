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
   * @property {boolean} tokensAreExact  true when counted by a real tokenizer, false when estimated
   * @property {boolean} sourceIsVideo  original size is only known as a token count (null chars/words)
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
  function computeStats(original, compressed, exactTokens = null, opts = {}) {
    // A video has no source text: its size is only known as a token count from Gemini.
    const sourceIsVideo = Boolean(opts.sourceIsVideo);

    const originalChars   = sourceIsVideo ? null : Tokenizer.countChars(original);
    const compressedChars = Tokenizer.countChars(compressed);
    const originalWords   = sourceIsVideo ? null : Tokenizer.countWords(original);
    const compressedWords = Tokenizer.countWords(compressed);

    let originalTokens, compressedTokens, tokensAreExact;
    if (sourceIsVideo) {
      originalTokens   = opts.originalTokens ?? null;
      compressedTokens = opts.compressedTokens ?? Tokenizer.estimateTokens(compressed);
      tokensAreExact   = opts.originalTokens != null && opts.compressedTokens != null;
    } else {
      // exactTokens = [original, compressed] from a real tokenizer, when available
      tokensAreExact   = Array.isArray(exactTokens);
      originalTokens   = tokensAreExact ? exactTokens[0] : Tokenizer.estimateTokens(original);
      compressedTokens = tokensAreExact ? exactTokens[1] : Tokenizer.estimateTokens(compressed);
    }

    // Ratios need both sizes; null means "unknown", shown as a dash.
    const known = originalTokens !== null && originalTokens > 0;
    const tokensSaved = known ? Math.max(0, originalTokens - compressedTokens) : null;

    // Compression ratio: how many times smaller is the output? (floor at 1.0×)
    const compressionRatio = known ? Math.max(1, originalTokens / Math.max(1, compressedTokens)) : null;

    // Context reduction as a percentage
    const contextReduction = known
      ? Math.max(0, ((originalTokens - compressedTokens) / originalTokens) * 100)
      : null;

    const reduction = (o, c) => (o ? Math.max(0, ((o - c) / o) * 100) : 0);
    const charReduction = sourceIsVideo ? null : reduction(originalChars, compressedChars);
    const wordReduction = sourceIsVideo ? null : reduction(originalWords, compressedWords);
    const round = (v, d) => (v === null ? null : parseFloat(v.toFixed(d)));

    return {
      tokensAreExact,
      sourceIsVideo,
      originalChars,
      compressedChars,
      originalWords,
      compressedWords,
      originalTokens,
      compressedTokens,
      tokensSaved,
      compressionRatio: round(compressionRatio, 2),
      contextReduction: round(contextReduction, 1),
      charReduction: round(charReduction, 1),
      wordReduction: round(wordReduction, 1),
    };
  }

  /**
   * Format a compression ratio for display, e.g. "3.29×"
   * @param {number} ratio
   * @returns {string}
   */
  function formatRatio(ratio) {
    return ratio === null || ratio === undefined ? '—' : `${ratio.toFixed(2)}×`;
  }

  /**
   * Format a percentage for display, e.g. "69.6%"
   * @param {number} pct
   * @returns {string}
   */
  function formatPercent(pct) {
    return pct === null || pct === undefined ? '—' : `${pct.toFixed(1)}%`;
  }

  /**
   * Format token count with tilde prefix, e.g. "~340"
   * @param {number} tokens
   * @returns {string}
   */
  function formatTokens(tokens, exact = false) {
    if (tokens === null || tokens === undefined) return '—';
    return `${exact ? '' : '~'}${Tokenizer.formatNumber(tokens)}`;
  }


  return {
    computeStats,
    formatRatio,
    formatPercent,
    formatTokens,
  };

})();
