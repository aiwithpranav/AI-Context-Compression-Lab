/**
 * app.js
 * Application entry point.
 * Wires button clicks to the processing pipeline.
 * Handles the full flow: validate → process → render.
 */

(function () {

  // ─── Processing Pipeline ──────────────────────────────────────────────────

  /**
   * Run the full compression pipeline for a given mode.
   * @param {'summary'|'keypoints'|'both'} mode
   */
  async function runCompression(mode) {
    const text  = AppState.get('inputText').trim();
    const level = _getSelectedLevel();

    // ── Input Validation ──
    if (!text || text.length === 0) {
      AppState.setError('Please paste some text before compressing. The input field is empty.');
      return;
    }

    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < 10) {
      AppState.setError('Your text is too short. Please provide at least a few sentences for meaningful compression.');
      return;
    }

    if (text.length > 500_000) {
      AppState.setError('Your text is very large. Please paste a shorter excerpt (under ~100,000 words) for best results.');
      return;
    }

    // ── Begin Processing ──
    AppState.setMode(mode);
    AppState.startProcessing();

    // Small async yield so the browser paints the loading UI before heavy
    // synchronous computation begins.
    await _nextFrame();
    await _delay(400);

    try {
      // ── Core Computations ──
      let summary    = null;
      let keyPoints  = null;
      let compressedText = '';

      if (mode === 'summary' || mode === 'both') {
        const result = Summarizer.generateSummary(text, level);
        summary = result.summary;
      }

      await _delay(350);

      if (mode === 'keypoints' || mode === 'both') {
        keyPoints = KeyPoints.extractKeyPoints(text, level);
      }

      // Build the "compressed text" for analytics:
      // For 'both', combine summary + key points joined as prose.
      if (mode === 'both') {
        compressedText = [summary || '', keyPoints ? keyPoints.join(' ') : ''].join(' ').trim();
      } else if (mode === 'summary') {
        compressedText = summary || '';
      } else {
        compressedText = keyPoints ? keyPoints.join(' ') : '';
      }

      await _delay(350);

      // ── Analytics ──
      const stats = Statistics.computeStats(text, compressedText);

      await _delay(300);

      // ── Concept Coverage / Preservation ──
      const preservation = Preservation.evaluatePreservation(text, compressedText);

      await _delay(250);

      // ── Memory Trick ──
      const memoryTrick = MemoryTrick.generateMemoryTrick(text, keyPoints || []);

      // ── Done ──
      AppState.setResults({
        mode,
        level,
        summary,
        keyPoints,
        stats,
        preservation,
        memoryTrick,
      });

    } catch (err) {
      console.error('[app.js] Processing error:', err);
      AppState.setError('An unexpected error occurred during compression. Please try again with different text.');
    }
  }

  // ─── Compression Level ────────────────────────────────────────────────────

  /**
   * Read the currently selected compression level from the radio buttons.
   * @returns {'light'|'balanced'|'aggressive'}
   */
  function _getSelectedLevel() {
    const radios = document.querySelectorAll('input[name="compression-level"]');
    for (const radio of radios) {
      if (radio.checked) return radio.value;
    }
    return 'balanced'; // safe default
  }

  // ─── Utility Helpers ──────────────────────────────────────────────────────

  function _nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  function _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Button Wiring ────────────────────────────────────────────────────────

  function _wireButtons() {
    const btnSummary   = document.getElementById('btn-summary');
    const btnKeyPoints = document.getElementById('btn-keypoints');
    const btnBoth      = document.getElementById('btn-both');

    if (btnSummary)   btnSummary.addEventListener('click',   () => runCompression('summary'));
    if (btnKeyPoints) btnKeyPoints.addEventListener('click', () => runCompression('keypoints'));
    if (btnBoth)      btnBoth.addEventListener('click',      () => runCompression('both'));
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    UI.initUI();
    _wireButtons();

    // Textarea auto-resize
    const textarea = document.getElementById('input-textarea');
    if (textarea) {
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 600) + 'px';
      });
    }

    // Scroll reveal for hero flow diagram items
    const flowItems = document.querySelectorAll('.flow-item');
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) entry.target.classList.add('visible');
        });
      }, { threshold: 0.2 });
      flowItems.forEach(item => observer.observe(item));
    } else {
      flowItems.forEach(item => item.classList.add('visible'));
    }
  });

})();
