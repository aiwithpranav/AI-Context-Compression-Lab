/**
 * ui.js
 * UI orchestrator module.
 * Manages all DOM interactions, rendering, animations, and user feedback.
 * Does NOT contain any business logic — that lives in the processing modules.
 */

const UI = (() => {

  // ─── DOM Element References ──────────────────────────────────────────────

  let els = {};

  function _cacheElements() {
    els = {
      textarea:              document.getElementById('input-textarea'),
      charCount:             document.getElementById('stat-chars'),
      wordCount:             document.getElementById('stat-words'),
      tokenCount:            document.getElementById('stat-tokens'),
      btnSummary:            document.getElementById('btn-summary'),
      btnKeyPoints:          document.getElementById('btn-keypoints'),
      btnBoth:               document.getElementById('btn-both'),
      btnClear:              document.getElementById('btn-clear'),
      btnTryAgain:           document.getElementById('btn-try-again'),
      processingSection:     document.getElementById('processing-section'),
      processingLabel:       document.getElementById('processing-label'),
      processingSubLabel:    document.getElementById('processing-sublabel'),
      resultsSection:        document.getElementById('results-section'),
      resultsLevelBadge:     document.getElementById('results-level-badge'),

      // Summary card
      summaryCard:           document.getElementById('summary-card'),
      summaryText:           document.getElementById('summary-text'),
      summaryOrigLen:        document.getElementById('summary-orig-len'),
      summaryCompLen:        document.getElementById('summary-comp-len'),
      summaryRatio:          document.getElementById('summary-ratio'),
      summaryReduction:      document.getElementById('summary-reduction'),
      btnCopySummary:        document.getElementById('btn-copy-summary'),

      // Key Points card
      keypointsCard:         document.getElementById('keypoints-card'),
      keypointsList:         document.getElementById('keypoints-list'),
      btnCopyKeyPoints:      document.getElementById('btn-copy-keypoints'),

      // Analytics card
      analyticsCard:         document.getElementById('analytics-card'),
      statOrigChars:         document.getElementById('stat-orig-chars'),
      statOrigWords:         document.getElementById('stat-orig-words'),
      statOrigTokens:        document.getElementById('stat-orig-tokens'),
      statCompChars:         document.getElementById('stat-comp-chars'),
      statCompWords:         document.getElementById('stat-comp-words'),
      statCompTokens:        document.getElementById('stat-comp-tokens'),
      statTokensSaved:       document.getElementById('stat-tokens-saved'),
      statContextRed:        document.getElementById('stat-context-red'),
      statCompressionRatio:  document.getElementById('stat-compression-ratio'),

      // Preservation / Concept Coverage card
      preservationCard:      document.getElementById('preservation-card'),
      preservationLevel:     document.getElementById('preservation-level'),
      preservationBar:       document.getElementById('preservation-bar'),
      preservationPct:       document.getElementById('preservation-pct'),
      preservationPctLabel:  document.getElementById('preservation-pct-label'),
      preservationText:      document.getElementById('preservation-text'),
      preservationDisclaimer:document.getElementById('preservation-disclaimer'),

      // Memory Trick card
      memoryCard:            document.getElementById('memory-card'),
      memoryType:            document.getElementById('memory-type'),
      memoryMnemonic:        document.getElementById('memory-mnemonic'),
      memoryExplanation:     document.getElementById('memory-explanation'),
      btnCopyMemory:         document.getElementById('btn-copy-memory'),

      // States
      emptyState:            document.getElementById('empty-state'),
      errorState:            document.getElementById('error-state'),
      errorMessage:          document.getElementById('error-message'),
      inputSection:          document.getElementById('input-section'),
    };
  }

  // ─── Processing Animation ────────────────────────────────────────────────

  const PROCESSING_STEPS = [
    { label: 'Analyzing Context...', sub: 'Reading your input text' },
    { label: 'Measuring Text...', sub: 'Counting tokens & words' },
    { label: 'Compressing Information...', sub: 'Extracting key concepts via TF-IDF' },
    { label: 'Evaluating Concept Coverage...', sub: 'Comparing keyword overlap' },
    { label: 'Generating Memory Trick...', sub: 'Building your memory aid' },
    { label: 'Preparing Results...', sub: 'Almost done!' },
  ];

  let _processingInterval = null;
  let _processingStep = 0;

  function showProcessing() {
    _processingStep = 0;
    _hideAllResultCards();
    _showSection(els.processingSection);
    _hideSection(els.resultsSection);
    _hideSection(els.errorState);
    _hideSection(els.emptyState);

    _updateProcessingStep();
    _processingInterval = setInterval(() => {
      _processingStep = (_processingStep + 1) % PROCESSING_STEPS.length;
      _updateProcessingStep();
    }, 800);

    _setButtonsDisabled(true);
  }

  function _updateProcessingStep() {
    const step = PROCESSING_STEPS[_processingStep];
    if (els.processingLabel)    els.processingLabel.textContent = step.label;
    if (els.processingSubLabel) els.processingSubLabel.textContent = step.sub;
  }

  function hideProcessing() {
    if (_processingInterval) {
      clearInterval(_processingInterval);
      _processingInterval = null;
    }
    _hideSection(els.processingSection);
    _setButtonsDisabled(false);
  }

  // ─── Results Rendering ───────────────────────────────────────────────────

  /**
   * Render all result cards based on computed results object.
   * @param {Object} results
   */
  function renderResults(results) {
    hideProcessing();
    _hideSection(els.emptyState);
    _hideSection(els.errorState);
    _showSection(els.resultsSection);

    const { mode, level, summary, keyPoints, stats, preservation, memoryTrick } = results;

    // Show the compression level badge in the results header
    _renderLevelBadge(level);

    // — Summary Card —
    if (mode === 'summary' || mode === 'both') {
      _renderSummaryCard(summary, stats);
      _showCard(els.summaryCard);
    } else {
      _hideCard(els.summaryCard);
    }

    // — Key Points Card —
    if (mode === 'keypoints' || mode === 'both') {
      _renderKeyPointsCard(keyPoints);
      _showCard(els.keypointsCard);
    } else {
      _hideCard(els.keypointsCard);
    }

    // — Analytics Card —
    _renderAnalyticsCard(stats);
    _showCard(els.analyticsCard);

    // — Concept Coverage / Preservation Card —
    _renderPreservationCard(preservation);
    _showCard(els.preservationCard);

    // — Memory Trick Card —
    _renderMemoryCard(memoryTrick);
    _showCard(els.memoryCard);

    // Animate cards in with stagger
    _animateCardsIn();

    // Show Try Again button
    if (els.btnTryAgain) els.btnTryAgain.style.display = 'inline-flex';
  }

  /**
   * Render the compression level badge in the results header.
   * @param {'light'|'balanced'|'aggressive'} level
   */
  function _renderLevelBadge(level) {
    if (!els.resultsLevelBadge) return;

    const labels = {
      light:      { text: '💡 Light Compression',      cls: 'level-badge--light'      },
      balanced:   { text: '⚖️ Balanced Compression',   cls: 'level-badge--balanced'   },
      aggressive: { text: '🗜️ Aggressive Compression', cls: 'level-badge--aggressive' },
    };

    const info = labels[level] || labels.balanced;
    els.resultsLevelBadge.textContent = info.text;
    els.resultsLevelBadge.className   = 'results-level-badge ' + info.cls;
  }

  function _renderSummaryCard(summary, stats) {
    if (!els.summaryText) return;
    els.summaryText.textContent = summary || 'Unable to generate summary.';

    if (els.summaryOrigLen)   els.summaryOrigLen.textContent   = Tokenizer.formatNumber(stats.originalChars) + ' chars';
    if (els.summaryCompLen)   els.summaryCompLen.textContent   = Tokenizer.formatNumber(stats.compressedChars) + ' chars';
    if (els.summaryRatio)     els.summaryRatio.textContent     = Statistics.formatRatio(stats.compressionRatio);
    if (els.summaryReduction) els.summaryReduction.textContent = Statistics.formatPercent(stats.contextReduction) + ' less';
  }

  function _renderKeyPointsCard(keyPoints) {
    if (!els.keypointsList) return;
    els.keypointsList.innerHTML = '';

    if (!keyPoints || keyPoints.length === 0) {
      els.keypointsList.innerHTML = '<li class="kp-empty">No key points extracted.</li>';
      return;
    }

    keyPoints.forEach(point => {
      const li = document.createElement('li');
      li.className = 'key-point-item';
      li.textContent = point;
      els.keypointsList.appendChild(li);
    });
  }

  function _renderAnalyticsCard(stats) {
    const set = (el, val) => { if (el) el.textContent = val; };

    set(els.statOrigChars,        Tokenizer.formatNumber(stats.originalChars));
    set(els.statOrigWords,        Tokenizer.formatNumber(stats.originalWords));
    set(els.statOrigTokens,       Statistics.formatTokens(stats.originalTokens));
    set(els.statCompChars,        Tokenizer.formatNumber(stats.compressedChars));
    set(els.statCompWords,        Tokenizer.formatNumber(stats.compressedWords));
    set(els.statCompTokens,       Statistics.formatTokens(stats.compressedTokens));
    set(els.statTokensSaved,      Statistics.formatTokens(stats.tokensSaved));
    set(els.statContextRed,       Statistics.formatPercent(stats.contextReduction));
    set(els.statCompressionRatio, Statistics.formatRatio(stats.compressionRatio));
  }

  function _renderPreservationCard(preservation) {
    if (!els.preservationLevel) return;

    // Level badge
    els.preservationLevel.textContent = preservation.level;
    els.preservationLevel.className   = 'preservation-badge ' + Preservation.getLevelClass(preservation.level);

    // Percentage + label
    if (els.preservationPct) {
      els.preservationPct.textContent = preservation.percentage + '%';
    }
    if (els.preservationPctLabel) {
      els.preservationPctLabel.textContent = 'concept coverage';
    }

    // Animated progress bar
    if (els.preservationBar) {
      els.preservationBar.style.width = '0%';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          els.preservationBar.style.width  = preservation.percentage + '%';
          els.preservationBar.className    = 'preservation-fill ' + Preservation.getLevelClass(preservation.level);
        });
      });
    }

    // Explanation text
    if (els.preservationText) {
      els.preservationText.textContent = preservation.explanation;
    }

    // Disclaimer
    if (els.preservationDisclaimer) {
      els.preservationDisclaimer.textContent = preservation.disclaimer || '';
    }
  }

  function _renderMemoryCard(memoryTrick) {
    if (!els.memoryMnemonic) return;
    if (els.memoryType)        els.memoryType.textContent        = `${MemoryTrick.getTrickIcon(memoryTrick.type)} ${memoryTrick.type}`;
    if (els.memoryMnemonic)    els.memoryMnemonic.textContent    = memoryTrick.mnemonic;
    if (els.memoryExplanation) els.memoryExplanation.textContent = memoryTrick.explanation;
  }

  // ─── Live Statistics (Input Counter) ────────────────────────────────────

  function updateLiveStats(text) {
    const chars  = Tokenizer.countChars(text);
    const words  = Tokenizer.countWords(text);
    const tokens = Tokenizer.estimateTokens(text);

    if (els.charCount)  els.charCount.textContent  = Tokenizer.formatNumber(chars);
    if (els.wordCount)  els.wordCount.textContent  = Tokenizer.formatNumber(words);
    if (els.tokenCount) els.tokenCount.textContent = '~' + Tokenizer.formatNumber(tokens);
  }

  // ─── Copy Functionality ──────────────────────────────────────────────────

  function copyText(text, buttonEl) {
    if (!text || !text.trim()) return;

    const doFeedback = () => {
      if (!buttonEl) return;
      const original = buttonEl.innerHTML;
      buttonEl.innerHTML = `<span class="copy-icon" aria-hidden="true">✓</span> Copied!`;
      buttonEl.classList.add('copied');
      setTimeout(() => {
        buttonEl.innerHTML = original;
        buttonEl.classList.remove('copied');
      }, 2000);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(doFeedback).catch(() => {
        _clipboardFallback(text);
        doFeedback();
      });
    } else {
      _clipboardFallback(text);
      doFeedback();
    }
  }

  function _clipboardFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
  }

  // ─── Error Handling ──────────────────────────────────────────────────────

  function showError(message) {
    hideProcessing();
    _hideSection(els.emptyState);
    if (els.errorMessage) els.errorMessage.textContent = message;
    _showSection(els.errorState);
  }

  // ─── Clear / Reset ───────────────────────────────────────────────────────

  function clearAll() {
    if (els.textarea) els.textarea.value = '';
    updateLiveStats('');
    _hideSection(els.processingSection);
    _hideSection(els.resultsSection);
    _hideSection(els.errorState);
    _showSection(els.emptyState);
    _hideAllResultCards();
    if (els.btnTryAgain) els.btnTryAgain.style.display = 'none';
    if (els.resultsLevelBadge) {
      els.resultsLevelBadge.textContent = '';
      els.resultsLevelBadge.className = 'results-level-badge';
    }
  }

  // ─── Section / Card Visibility Helpers ──────────────────────────────────

  function _showSection(el) { if (el) el.classList.remove('hidden'); }
  function _hideSection(el) { if (el) el.classList.add('hidden'); }

  function _showCard(el) {
    if (el) {
      el.classList.remove('hidden');
      el.classList.add('card-visible');
    }
  }

  function _hideCard(el) {
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('card-visible');
    }
  }

  function _hideAllResultCards() {
    [els.summaryCard, els.keypointsCard, els.analyticsCard, els.preservationCard, els.memoryCard]
      .forEach(card => {
        if (card) {
          card.classList.add('hidden');
          card.classList.remove('card-visible', 'card-animated');
        }
      });
  }

  function _animateCardsIn() {
    const cards = document.querySelectorAll('#results-section .result-card:not(.hidden)');
    cards.forEach((card, i) => {
      card.style.opacity    = '0';
      card.style.transform  = 'translateY(20px)';
      setTimeout(() => {
        card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        card.style.opacity    = '1';
        card.style.transform  = 'translateY(0)';
        card.classList.add('card-animated');
      }, i * 110);
    });
  }

  // ─── Button State ────────────────────────────────────────────────────────

  function _setButtonsDisabled(disabled) {
    [els.btnSummary, els.btnKeyPoints, els.btnBoth, els.btnClear, els.btnTryAgain].forEach(btn => {
      if (btn) btn.disabled = disabled;
    });
  }

  // ─── Public Init ─────────────────────────────────────────────────────────

  function initUI() {
    _cacheElements();

    // Live input stats
    if (els.textarea) {
      els.textarea.addEventListener('input', () => {
        AppState.setInputText(els.textarea.value);
        updateLiveStats(els.textarea.value);
      });
    }

    // Copy: Summary
    if (els.btnCopySummary) {
      els.btnCopySummary.addEventListener('click', () => {
        const text = els.summaryText ? els.summaryText.textContent : '';
        copyText(text, els.btnCopySummary);
      });
    }

    // Copy: Key Points
    if (els.btnCopyKeyPoints) {
      els.btnCopyKeyPoints.addEventListener('click', () => {
        const items = els.keypointsList ? [...els.keypointsList.querySelectorAll('li')] : [];
        const text  = items.map(li => '• ' + li.textContent).join('\n');
        copyText(text, els.btnCopyKeyPoints);
      });
    }

    // Copy: Memory Trick
    if (els.btnCopyMemory) {
      els.btnCopyMemory.addEventListener('click', () => {
        const mnemonic     = els.memoryMnemonic     ? els.memoryMnemonic.textContent     : '';
        const explanation  = els.memoryExplanation  ? els.memoryExplanation.textContent  : '';
        const text = [mnemonic, explanation].filter(Boolean).join('\n\n');
        copyText(text, els.btnCopyMemory);
      });
    }

    // Clear button
    if (els.btnClear) {
      els.btnClear.addEventListener('click', () => AppState.clearAll());
    }

    // Try Again — scroll to input
    if (els.btnTryAgain) {
      els.btnTryAgain.addEventListener('click', () => {
        els.textarea?.focus();
        els.inputSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // State events
    AppState.on('clear',           () => clearAll());
    AppState.on('processingStart', () => showProcessing());
    AppState.on('resultsReady',    (results) => renderResults(results));
    AppState.on('error',           (msg) => showError(msg));

    clearAll();
  }

  return {
    initUI,
    updateLiveStats,
    showProcessing,
    hideProcessing,
    renderResults,
    showError,
    clearAll,
    copyText,
    els: () => els,
  };

})();
