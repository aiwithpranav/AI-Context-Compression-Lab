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

      // Listen (text-to-speech) buttons
      btnListenSummary:      document.getElementById('btn-listen-summary'),
      btnListenKeyPoints:    document.getElementById('btn-listen-keypoints'),

      // Video chat card
      chatCard:              document.getElementById('video-chat-card'),
      chatLog:               document.getElementById('video-chat-log'),
      chatInput:             document.getElementById('video-chat-input'),
      btnChatAsk:            document.getElementById('btn-video-ask'),

      // Comparison + LLM evaluation cards
      compareCard:           document.getElementById('compare-card'),
      compareBody:           document.getElementById('compare-body'),
      evalCard:              document.getElementById('eval-card'),
      btnEvaluate:           document.getElementById('btn-evaluate'),
      evalStatus:            document.getElementById('eval-status'),
      evalResult:            document.getElementById('eval-result'),

      // Action items card (transcripts only)
      actionsCard:           document.getElementById('actions-card'),
      actionsList:           document.getElementById('actions-list'),

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

  const PROCESSING_TEXT = {
    extractive: { label: 'Compressing locally...',  sub: 'Ranking sentences with TF-IDF' },
    llm:        { label: 'Asking OpenAI...',        sub: 'Rewriting your text in its own words' },
    video:      { label: 'Gemini is watching the video...', sub: 'Longer videos can take a minute or two' },
  };

  function showProcessing(engine = 'extractive') {
    Speech.stop();
    _hideAllResultCards();
    _showSection(els.processingSection);
    _hideSection(els.resultsSection);
    _hideSection(els.errorState);
    _hideSection(els.emptyState);

    const text = PROCESSING_TEXT[engine] || PROCESSING_TEXT.extractive;
    if (els.processingLabel)    els.processingLabel.textContent = text.label;
    if (els.processingSubLabel) els.processingSubLabel.textContent = text.sub;

    _setButtonsDisabled(true);
  }

  function hideProcessing() {
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

    const { mode, level, summary, keyPoints, keyPointTimes, actions, videoId, stats, preservation, memoryTrick } = results;

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
      _renderKeyPointsCard(keyPoints, keyPointTimes, videoId);
      _showCard(els.keypointsCard);
    } else {
      _hideCard(els.keypointsCard);
    }

    // — Action Items Card (only when a transcript was used and something was found) —
    if (actions && actions.length > 0) {
      _renderActionsCard(actions, videoId);
      _showCard(els.actionsCard);
    } else {
      _hideCard(els.actionsCard);
    }

    // — Analytics Card —
    _renderAnalyticsCard(stats);
    _showCard(els.analyticsCard);

    // — Concept Coverage / Preservation Card (needs original text, so not for videos) —
    if (preservation) {
      _renderPreservationCard(preservation);
      _showCard(els.preservationCard);
    } else {
      _hideCard(els.preservationCard);
    }

    // — Memory Trick Card —
    _renderMemoryCard(memoryTrick);
    _showCard(els.memoryCard);

    // — LLM evaluation card (needs the original text, so not for videos) —
    _resetEvaluation();
    if (_evalAvailable && results.originalText) _showCard(els.evalCard); else _hideCard(els.evalCard);

    // — Ask-about-the-video chat (Gemini results only) —
    if (results.engine === 'video') _showCard(els.chatCard); else _hideCard(els.chatCard);

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

    if (els.summaryOrigLen)   els.summaryOrigLen.textContent   = stats.originalChars === null ? 'the video' : Tokenizer.formatNumber(stats.originalChars) + ' chars';
    if (els.summaryCompLen)   els.summaryCompLen.textContent   = Tokenizer.formatNumber(stats.compressedChars) + ' chars';
    if (els.summaryRatio)     els.summaryRatio.textContent     = Statistics.formatRatio(stats.compressionRatio);
    if (els.summaryReduction) els.summaryReduction.textContent = Statistics.formatPercent(stats.contextReduction) + ' less';
  }

  function _renderKeyPointsCard(keyPoints, times, videoId) {
    if (!els.keypointsList) return;
    els.keypointsList.innerHTML = '';

    if (!keyPoints || keyPoints.length === 0) {
      els.keypointsList.innerHTML = '<li class="kp-empty">No key points extracted.</li>';
      return;
    }

    keyPoints.forEach((point, i) => {
      els.keypointsList.appendChild(_buildTimedItem(point, times ? times[i] : null, videoId));
    });
  }

  function _renderActionsCard(actions, videoId) {
    if (!els.actionsList) return;
    els.actionsList.innerHTML = '';
    actions.forEach(a => {
      els.actionsList.appendChild(_buildTimedItem(a.text, a.time, videoId));
    });
  }

  /**
   * A list item with an optional timestamp chip (a link to the exact moment
   * when the source is a YouTube video).
   */
  function _buildTimedItem(text, startSec, videoId) {
    const li = document.createElement('li');
    li.className = 'key-point-item';

    if (typeof startSec === 'number') {
      const label = Transcript.formatTime(startSec);
      li.dataset.time = label;
      const chip = videoId ? document.createElement('a') : document.createElement('span');
      chip.className = 'kp-time';
      chip.textContent = label;
      if (videoId) {
        chip.href = Transcript.timestampUrl(videoId, startSec);
        chip.target = '_blank';
        chip.rel = 'noopener noreferrer';
        chip.title = 'Open the video at this moment';
      }
      li.appendChild(chip);
    }

    const span = document.createElement('span');
    span.className = 'kp-text';
    span.textContent = text;
    li.appendChild(span);
    return li;
  }

  function _renderAnalyticsCard(stats) {
    const set = (el, val) => { if (el) el.textContent = val; };

    set(els.statOrigChars,        stats.originalChars === null ? '—' : Tokenizer.formatNumber(stats.originalChars));
    set(els.statOrigWords,        stats.originalWords === null ? '—' : Tokenizer.formatNumber(stats.originalWords));
    set(els.statOrigTokens,       Statistics.formatTokens(stats.originalTokens, stats.tokensAreExact));
    set(els.statCompChars,        Tokenizer.formatNumber(stats.compressedChars));
    set(els.statCompWords,        Tokenizer.formatNumber(stats.compressedWords));
    set(els.statCompTokens,       Statistics.formatTokens(stats.compressedTokens, stats.tokensAreExact));
    set(els.statTokensSaved,      Statistics.formatTokens(stats.tokensSaved, stats.tokensAreExact));
    document.querySelectorAll('.a-stat--tokens .a-stat-label').forEach(l => {
      l.textContent = stats.tokensAreExact ? 'Tokens (exact)' : 'Est. Tokens';
    });
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

  // ─── Engine Comparison ───────────────────────────────────────────────────

  function renderComparison(rows) {
    if (!els.compareBody || !rows || rows.length === 0) return;
    els.compareBody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      const cells = [
        r.label,
        r.level,
        (r.exact ? '' : '~') + Tokenizer.formatNumber(r.tokens),
        Statistics.formatPercent(r.reduction),
        Statistics.formatRatio(r.ratio),
        r.coverage + '%',
        r.qa === null ? '—' : r.qa + '%',
      ];
      cells.forEach(c => {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      });
      els.compareBody.appendChild(tr);
    });
    _showCard(els.compareCard);
  }

  // ─── LLM Evaluation (QA test) ────────────────────────────────────────────

  let _evalAvailable = false;

  function setEvaluationAvailable(available) {
    _evalAvailable = available;
  }

  function _resetEvaluation() {
    if (els.evalResult) els.evalResult.innerHTML = '';
    if (els.evalStatus) els.evalStatus.textContent = '';
    if (els.btnEvaluate) els.btnEvaluate.disabled = false;
  }

  function setEvaluationBusy(busy) {
    if (els.btnEvaluate) els.btnEvaluate.disabled = busy;
    if (els.evalStatus) els.evalStatus.textContent = busy ? 'Running 3 Claude calls: questions, answers, grading...' : '';
    if (busy && els.evalResult) els.evalResult.innerHTML = '';
  }

  function renderEvaluationError(message) {
    if (!els.evalResult) return;
    els.evalResult.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'source-status source-status--error';
    p.textContent = message;
    els.evalResult.appendChild(p);
  }

  const VERDICT_LABELS = { correct: '✓ Correct', partial: '~ Partial', incorrect: '✗ Wrong', not_found: '∅ Missing' };

  function renderEvaluation(evaluation) {
    if (!els.evalResult) return;
    els.evalResult.innerHTML = '';

    const pct = Math.round(evaluation.score * 100);
    const score = document.createElement('p');
    score.className = 'eval-score';
    score.textContent = pct + '% of questions answered correctly from the compressed text';
    els.evalResult.appendChild(score);

    const table = document.createElement('table');
    table.className = 'compare-table';
    table.innerHTML = '<thead><tr><th>Question</th><th>Answer from compressed text</th><th>Result</th></tr></thead>';
    const tbody = document.createElement('tbody');
    evaluation.results.forEach(r => {
      const tr = document.createElement('tr');
      [r.question, r.answer, VERDICT_LABELS[r.verdict] || r.verdict].forEach((c, i) => {
        const td = document.createElement('td');
        td.textContent = c;
        if (i === 2) td.className = 'verdict verdict--' + r.verdict;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    els.evalResult.appendChild(table);

    const claims = evaluation.unsupportedClaims || [];
    const faith = document.createElement('div');
    faith.className = 'eval-faith';
    const head = document.createElement('strong');
    head.textContent = claims.length === 0
      ? 'Faithfulness: no unsupported claims found.'
      : 'Faithfulness: ' + claims.length + ' claim(s) not supported by the original:';
    faith.appendChild(head);
    if (claims.length > 0) {
      const ul = document.createElement('ul');
      claims.forEach(c => { const li = document.createElement('li'); li.textContent = c; ul.appendChild(li); });
      faith.appendChild(ul);
    }
    els.evalResult.appendChild(faith);
  }

  // ─── Ask About The Video (chat) ──────────────────────────────────────────

  const CHAT_SUGGESTIONS = [
    'What are the main takeaways?',
    'Explain it simply, as if I am new to this.',
    'Which numbers, names or dates are mentioned?',
  ];
  let _onChatSuggestion = () => {};

  function onChatSuggestion(fn) { _onChatSuggestion = fn; }

  /** Start a fresh conversation for a newly summarised video. */
  function resetVideoChat() {
    if (!els.chatLog) return;
    els.chatLog.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'chat-suggestions';
    CHAT_SUGGESTIONS.forEach(q => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hint-chip chat-chip';
      b.textContent = q;
      b.addEventListener('click', () => _onChatSuggestion(q));
      row.appendChild(b);
    });
    els.chatLog.appendChild(row);
  }

  /** Turn "[1:23]" in an answer into links that open the video at that moment. */
  function _appendWithTimeLinks(parent, text, videoId) {
    const pattern = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
    let last = 0, m;
    while ((m = pattern.exec(text)) !== null) {
      parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const sec = Transcript.parseTimestamp(m[1]);
      if (sec !== null && videoId) {
        const a = document.createElement('a');
        a.className = 'kp-time';
        a.href = Transcript.timestampUrl(videoId, sec);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = m[1];
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(m[0]));
      }
      last = m.index + m[0].length;
    }
    parent.appendChild(document.createTextNode(text.slice(last)));
  }

  /** role: 'user' | 'model' | 'error' */
  function appendChatMessage(role, text, videoId) {
    if (!els.chatLog) return;
    const sug = els.chatLog.querySelector('.chat-suggestions');
    if (sug) sug.remove();

    const msg = document.createElement('div');
    msg.className = 'chat-msg chat-msg--' + role;
    if (role === 'model') _appendWithTimeLinks(msg, text, videoId);
    else msg.textContent = text;
    els.chatLog.appendChild(msg);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function setChatBusy(busy) {
    if (els.btnChatAsk) els.btnChatAsk.disabled = busy;
    if (els.chatInput) els.chatInput.disabled = busy;
    if (!els.chatLog) return;
    const existing = els.chatLog.querySelector('.chat-msg--pending');
    if (busy && !existing) {
      const p = document.createElement('div');
      p.className = 'chat-msg chat-msg--model chat-msg--pending';
      p.textContent = 'Gemini is watching and thinking…';
      els.chatLog.appendChild(p);
      els.chatLog.scrollTop = els.chatLog.scrollHeight;
    } else if (!busy && existing) {
      existing.remove();
      els.chatInput?.focus();
    }
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

  function _itemToPlainText(li) {
    const body = li.querySelector('.kp-text')?.textContent ?? li.textContent;
    return '• ' + (li.dataset.time ? `[${li.dataset.time}] ` : '') + body;
  }

  // ─── Listen (Text-to-Speech) ─────────────────────────────────────────────

  function _initListenButtons() {
    const buttons = [els.btnListenSummary, els.btnListenKeyPoints].filter(Boolean);

    if (!Speech.isSupported()) {
      buttons.forEach(b => b.classList.add('hidden'));
      return;
    }

    const sources = () => ({
      summary:   () => els.summaryText ? els.summaryText.textContent : '',
      keypoints: () => [...(els.keypointsList?.querySelectorAll('.kp-text') || [])]
                         .map(n => n.textContent).join(' '),
    });

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const owner = btn.dataset.listen;
        if (Speech.getOwner() === owner) {
          // Same button again: toggle pause / resume
          btn.dataset.state === 'paused' ? Speech.resume() : Speech.pause();
        } else {
          Speech.play(owner, sources()[owner]());
        }
      });
    });

    const labels = { playing: '⏸ Pause', paused: '▶ Resume', stopped: '🔊 Listen' };
    Speech.onState((owner, state) => {
      buttons.forEach(btn => {
        const mine = btn.dataset.listen === owner;
        const s = mine ? state : 'stopped';
        btn.dataset.state = s;
        btn.textContent = labels[s];
        btn.classList.toggle('copied', s === 'playing');
      });
    });
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
    Speech.stop();
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
    [els.summaryCard, els.keypointsCard, els.actionsCard, els.compareCard, els.evalCard, els.chatCard, els.analyticsCard, els.preservationCard, els.memoryCard]
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
        const text  = items.map(_itemToPlainText).join('\n');
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

    _initListenButtons();

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
    AppState.on('processingStart', (engine) => showProcessing(engine));
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
    renderComparison,
    resetVideoChat,
    appendChatMessage,
    setChatBusy,
    onChatSuggestion,
    setEvaluationAvailable,
    setEvaluationBusy,
    renderEvaluation,
    renderEvaluationError,
    showError,
    clearAll,
    copyText,
    els: () => els,
  };

})();
