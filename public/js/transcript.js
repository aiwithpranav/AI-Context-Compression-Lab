/**
 * transcript.js
 * Turns videos / meeting recordings into text the compression pipeline can use.
 *
 * Sources:
 *   - YouTube link  → server.js fetches the captions (/api/transcript)
 *   - .vtt / .srt   → parsed locally (Zoom, Meet, Teams and YouTube exports)
 *
 * Captions have no punctuation, so sentence splitting would fail. Instead the
 * segments are grouped into "chunks" (~8–30 words) that act as sentences and
 * keep their start time, so key points can link back to the exact moment.
 */

const Transcript = (() => {

  // Active transcript: { source, videoId, segments, chunks, text }
  let current = null;

  // ─── Parsing ─────────────────────────────────────────────────────────────

  /**
   * "00:01:02.500", "01:02,500" or "1:02" → seconds. Null if not a timestamp.
   */
  function parseTimestamp(s) {
    const m = String(s).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
    if (!m) return null;
    return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +('0.' + m[4]) : 0);
  }

  /**
   * Parse WebVTT / SRT text into segments. Returns null if no cues are found
   * (i.e. the file is plain text).
   * @returns {{ start: number, text: string }[] | null}
   */
  function parseSubtitles(raw) {
    const segments = [];
    const blocks = raw.replace(/\r/g, '').split(/\n{2,}/);

    for (const block of blocks) {
      const lines = block.split('\n');
      const timeIdx = lines.findIndex(l => l.includes('-->'));
      if (timeIdx === -1) continue;

      const start = parseTimestamp(lines[timeIdx].split('-->')[0]);
      if (start === null) continue;

      const text = _cleanCaption(lines.slice(timeIdx + 1).join(' '));
      if (text) segments.push({ start, text });
    }

    return segments.length > 0 ? _dedupe(segments) : null;
  }

  function _cleanCaption(s) {
    return s
      .replace(/<[^>]+>/g, '')                                  // <c>, <00:00:01.000> tags
      // sound/audience cues: [Music], (Laughter), (applause) …
      .replace(/[\[(]\s*(?:music|applause|laughter|laughs|cheering|silence|inaudible|crosstalk)[^\])]*[\])]/gi, '')
      .replace(/^\s*>>\s*/g, '')                                // speaker-change marker
      .replace(/\s+/g, ' ')
      .trim();
  }

  // YouTube auto-captions repeat the previous line in the next cue.
  function _dedupe(segments) {
    return segments.filter((seg, i) => i === 0 || seg.text !== segments[i - 1].text);
  }

  // ─── Chunking ────────────────────────────────────────────────────────────

  const MIN_WORDS = 8;
  const MAX_WORDS = 30;

  /**
   * Group caption segments into sentence-like chunks, each with a start time.
   * @param {{ start: number, text: string }[]} segments
   * @returns {{ start: number, text: string }[]}
   */
  function buildChunks(segments) {
    const chunks = [];
    let words = [];
    let start = 0;

    const flush = () => {
      if (words.length === 0) return;
      let text = words.join(' ').replace(/[,;:\-–—\s]+$/, '');
      if (!/[.!?"”]$/.test(text)) text += '.';
      chunks.push({ start, text: text.charAt(0).toUpperCase() + text.slice(1) });
      words = [];
    };

    for (const seg of segments) {
      const clean = _cleanCaption(seg.text);
      if (!clean) continue;
      if (words.length === 0) start = seg.start;
      words.push(...clean.split(' '));

      const endsSentence = /[.!?]$/.test(clean);
      if ((endsSentence && words.length >= MIN_WORDS) || words.length >= MAX_WORDS) flush();
    }
    flush();
    return chunks;
  }

  // ─── Loading ─────────────────────────────────────────────────────────────

  /**
   * Make a transcript the active source.
   * @param {{ start: number, text: string }[]} segments
   * @param {{ source: string, videoId?: string }} meta
   * @returns {{ text: string, chunks: object[], duration: number }}
   */
  function load(segments, meta) {
    const chunks = buildChunks(segments);
    const text = chunks.map(c => c.text).join(' ');
    current = { ...meta, segments, chunks, text };
    return { text, chunks, duration: segments.length ? segments[segments.length - 1].start : 0 };
  }

  /**
   * The active transcript, but only if the textarea still holds exactly its
   * text. If the user edited it, timestamps no longer line up, so → null.
   */
  function getActiveFor(textareaValue) {
    return current && textareaValue.trim() === current.text.trim() ? current : null;
  }

  function reset() { current = null; }

  async function fetchYouTube(url) {
    let res;
    try {
      res = await fetch('/api/transcript?url=' + encodeURIComponent(url));
    } catch {
      throw new Error('Cannot reach the transcript server. Start it with "npm start" and open http://localhost:3000.');
    }
    let body = null;
    try { body = await res.json(); } catch { /* not JSON — static host without the API */ }
    if (!res.ok || !body) {
      throw new Error((body && body.error) || 'Transcript server not available. Start it with "npm start".');
    }
    return { videoId: body.videoId, segments: body.segments };
  }

  // ─── Meeting helpers ─────────────────────────────────────────────────────

  const ACTION_PATTERN = new RegExp(
    '\\b(?:action items?|follow[- ]?up|to-?do|due (?:on|by)|' +
    'we(?:\'ll| will| need to| should| must)|i(?:\'ll| will)|you(?:\'ll| will| need to)|' +
    'needs? to|we (?:have )?agreed|we decided|next steps?|' +
    'by (?:monday|tuesday|wednesday|thursday|friday|tomorrow|next week|end of))\\b',
    'i'
  );
  // "Meera will send…" — a capitalised name followed by a commitment verb (case-sensitive on purpose)
  const NAMED_ACTION = /\b[A-Z][a-z]{2,} (?:will|should|must)\b/;

  /**
   * Pick chunks that sound like decisions, commitments or tasks.
   * Keyword heuristic — a shortlist to review, not a guarantee.
   * @returns {{ start: number, text: string }[]}
   */
  function findActionItems(chunks, max = 6) {
    return chunks.filter(c => ACTION_PATTERN.test(c.text) || NAMED_ACTION.test(c.text)).slice(0, max);
  }

  // ─── Citations in answers ────────────────────────────────────────────────

  // "[0:12]", "(10:58)", "[11:15-12:15]", "[1:05, 2:10]": times in square or round brackets.
  // A time outside brackets ("at 5:30 pm") is left alone.
  const CITATION = /([\[(])\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–—,]\s*\d{1,2}:\d{2}(?::\d{2})?)*)\s*([\])])/g;
  const TIME = /\d{1,2}:\d{2}(?::\d{2})?/g;

  /**
   * Split an answer into plain pieces and cited moments, so the page can turn
   * each moment into a link. Models do not always follow "cite as [M:SS]", so
   * round brackets and ranges are accepted too.
   * `kind` is 'time' for a moment, 'bracket' for the ( [ ] ) around it, 'text' otherwise.
   * @returns {{ text: string, seconds: number|null, kind: 'text'|'bracket'|'time' }[]}
   */
  function splitTimeRefs(text) {
    const parts = [];
    let last = 0;
    for (const m of String(text).matchAll(CITATION)) {
      if (m.index > last) parts.push({ text: text.slice(last, m.index), seconds: null, kind: 'text' });
      parts.push({ text: m[1], seconds: null, kind: 'bracket' });
      let inner = 0;
      for (const t of m[2].matchAll(TIME)) {
        if (t.index > inner) parts.push({ text: m[2].slice(inner, t.index), seconds: null, kind: 'text' });
        parts.push({ text: t[0], seconds: parseTimestamp(t[0]), kind: 'time' });
        inner = t.index + t[0].length;
      }
      parts.push({ text: m[3], seconds: null, kind: 'bracket' });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last), seconds: null, kind: 'text' });
    return parts;
  }

  // ─── Formatting ──────────────────────────────────────────────────────────

  function formatTime(sec) {
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  function timestampUrl(videoId, sec) {
    return `https://youtu.be/${videoId}?t=${Math.floor(sec)}`;
  }

  return {
    parseTimestamp,
    splitTimeRefs,
    parseSubtitles,
    buildChunks,
    load,
    getActiveFor,
    reset,
    fetchYouTube,
    findActionItems,
    formatTime,
    timestampUrl,
  };

})();
