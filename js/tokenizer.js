/**
 * tokenizer.js
 * Token estimation and text statistics module.
 * Uses a GPT-style approximation: ~4 characters per token on average,
 * refined with word-boundary awareness for better accuracy.
 */

const Tokenizer = (() => {

  /**
   * Estimate token count using a character + word hybrid approach.
   * GPT-family models average ~4 chars/token, but short words are often 1 token.
   * Weighted blend: (charCount / 4 + wordCount) / 2
   * @param {string} text
   * @returns {number}
   */
  function estimateTokens(text) {
    if (!text || text.trim().length === 0) return 0;
    const charEstimate = text.length / 4;
    const wordEstimate = countWords(text) * 1.3; // ~1.3 tokens per word on avg
    return Math.round((charEstimate + wordEstimate) / 2);
  }

  /**
   * Count words (whitespace-delimited non-empty tokens).
   * @param {string} text
   * @returns {number}
   */
  function countWords(text) {
    if (!text || text.trim().length === 0) return 0;
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  /**
   * Count characters (raw, including whitespace).
   * @param {string} text
   * @returns {number}
   */
  function countChars(text) {
    return text ? text.length : 0;
  }

  /**
   * Count sentences using punctuation-aware splitting.
   * @param {string} text
   * @returns {number}
   */
  function countSentences(text) {
    if (!text || text.trim().length === 0) return 0;
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    return sentences.length;
  }

  /**
   * Format a number with thousands separators.
   * @param {number} n
   * @returns {string}
   */
  function formatNumber(n) {
    return n.toLocaleString('en-US');
  }

  return {
    estimateTokens,
    countWords,
    countChars,
    countSentences,
    formatNumber,
  };

})();
