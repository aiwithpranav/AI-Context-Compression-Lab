/**
 * textProcessor.js
 * Core NLP processing module.
 * Handles sentence splitting, TF-IDF-style importance scoring,
 * stop-word filtering, and sentence ranking.
 */

const TextProcessor = (() => {

  // Common English stop words to exclude from importance scoring
  const STOP_WORDS = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with',
    'by','from','is','are','was','were','be','been','being','have','has',
    'had','do','does','did','will','would','could','should','may','might',
    'shall','can','need','dare','ought','used','that','this','these','those',
    'it','its','itself','he','she','they','we','you','i','me','him','her',
    'us','them','my','your','his','our','their','what','which','who','whom',
    'when','where','why','how','all','each','every','both','few','more',
    'most','other','some','such','no','not','only','same','so','than','too',
    'very','just','as','if','then','because','while','although','though',
    'however','therefore','thus','hence','also','yet','still','even','about',
    'above','after','again','against','before','between','during','into',
    'through','under','until','up','out','over','below','off','around',
  ]);

  /**
   * Split text into an array of clean sentences.
   * Handles abbreviations (Mr., Dr., etc.) and decimal numbers.
   * @param {string} text
   * @returns {string[]}
   */
  function tokenizeIntoSentences(text) {
    if (!text || text.trim().length === 0) return [];

    // Protect common abbreviations and decimals from being split
    const protected_text = text
      .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|Ltd|Inc|Corp|vs|etc|e\.g|i\.e)\./gi, '$1<DOT>')
      .replace(/(\d+)\.(\d+)/g, '$1<DOT>$2');

    const rawSentences = protected_text
      .split(/(?<=[.!?])\s+(?=[A-Z"'(])/g);

    const cleaned = rawSentences
      .map(s => s.replace(/<DOT>/g, '.').trim())
      .filter(s => s.length > 10); // discard trivially short fragments

    // Fallback: if no sentence boundaries were found (e.g., no punctuation),
    // try splitting on newlines or very long chunks
    if (cleaned.length <= 1 && text.length > 200) {
      const byNewline = text.split(/\n+/).map(s => s.trim()).filter(s => s.length > 10);
      if (byNewline.length > 1) return byNewline;

      // Last resort: chunk by approximate sentence length (80–150 chars at word boundaries)
      const words = text.split(/\s+/);
      const chunks = [];
      let chunk = [];
      let charCount = 0;
      for (const word of words) {
        chunk.push(word);
        charCount += word.length + 1;
        if (charCount > 120 && chunk.length > 6) {
          chunks.push(chunk.join(' '));
          chunk = [];
          charCount = 0;
        }
      }
      if (chunk.length > 0) chunks.push(chunk.join(' '));
      return chunks.filter(s => s.length > 10);
    }

    return cleaned;
  }

  /**
   * Tokenize a sentence into meaningful words (lowercased, stop-words removed).
   * @param {string} sentence
   * @returns {string[]}
   */
  function extractKeywords(sentence) {
    return sentence
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  }

  /**
   * Compute term frequency (TF) for each word across the whole document.
   * @param {string[]} sentences
   * @returns {Map<string, number>} word → frequency count
   */
  function computeTermFrequency(sentences) {
    const freq = new Map();
    sentences.forEach(sentence => {
      extractKeywords(sentence).forEach(word => {
        freq.set(word, (freq.get(word) || 0) + 1);
      });
    });
    return freq;
  }

  /**
   * Compute inverse document frequency (IDF) for each word.
   * Words appearing in many sentences get a lower score.
   * @param {string[]} sentences
   * @returns {Map<string, number>}
   */
  function computeIDF(sentences) {
    const docFreq = new Map();
    const n = sentences.length;

    sentences.forEach(sentence => {
      const words = new Set(extractKeywords(sentence));
      words.forEach(word => {
        docFreq.set(word, (docFreq.get(word) || 0) + 1);
      });
    });

    const idf = new Map();
    docFreq.forEach((count, word) => {
      idf.set(word, Math.log((n + 1) / (count + 1)) + 1);
    });

    return idf;
  }

  /**
   * Score each sentence by summing TF-IDF scores of its keywords.
   * Position bias: earlier and final sentences get a small boost.
   * @param {string[]} sentences
   * @returns {{ sentence: string, score: number, index: number }[]}
   */
  function rankSentences(sentences) {
    if (sentences.length === 0) return [];

    const tf = computeTermFrequency(sentences);
    const idf = computeIDF(sentences);
    const maxTF = Math.max(...tf.values()) || 1;
    const n = sentences.length;

    return sentences.map((sentence, index) => {
      const words = extractKeywords(sentence);
      if (words.length === 0) return { sentence, score: 0, index };

      // TF-IDF sum for all keywords in sentence
      let tfidfSum = 0;
      words.forEach(word => {
        const normalizedTF = (tf.get(word) || 0) / maxTF;
        const idfScore = idf.get(word) || 1;
        tfidfSum += normalizedTF * idfScore;
      });

      // Normalize by sentence length to avoid bias toward long sentences
      let score = tfidfSum / words.length;

      // Position bias: first 15% and last 10% of sentences get a boost
      const relativePos = index / n;
      if (relativePos <= 0.15) score *= 1.25;
      else if (relativePos >= 0.90) score *= 1.10;

      // Penalize very short sentences
      if (words.length < 4) score *= 0.6;

      return { sentence, score, index };
    });
  }

  /**
   * Get top-N unique keywords from text (by TF-IDF score).
   * @param {string} text
   * @param {number} n
   * @returns {string[]}
   */
  function getTopKeywords(text, n = 8) {
    const sentences = tokenizeIntoSentences(text);
    if (sentences.length === 0) return extractKeywords(text).slice(0, n);

    const tf = computeTermFrequency(sentences);
    const idf = computeIDF(sentences);

    const scored = [];
    tf.forEach((freq, word) => {
      scored.push({ word, score: freq * (idf.get(word) || 1) });
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map(item => item.word);
  }

  return {
    tokenizeIntoSentences,
    extractKeywords,
    rankSentences,
    getTopKeywords,
    STOP_WORDS,
  };

})();
