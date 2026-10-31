/**
 * app.js
 * Application entry point.
 * Wires button clicks to the processing pipeline.
 * Handles the full flow: validate → process → render.
 */

(function () {

  // ─── Processing Pipeline ──────────────────────────────────────────────────

  // Results of each engine for the current input, for the comparison card.
  let _comparison = { text: null, rows: {} };

  // A YouTube video or an uploaded recording that Gemini has summarised:
  // { url } or { media: { fileUri, mimeType }, kind }, plus { videoId, history }.
  // While set (and the text box is empty), the compress buttons re-run it.
  let _activeVideo = null;

  /**
   * Run the full compression pipeline for a given mode.
   * @param {'summary'|'keypoints'|'both'} mode
   */
  async function runCompression(mode) {
    const text   = AppState.get('inputText').trim();
    const level  = _getSelectedLevel();
    const engine = _getEngine();

    // A Gemini video is active and nothing was typed: compress the video again.
    if (_activeVideo && !text) {
      await runVideoCompression(mode, _activeVideo);
      return;
    }

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
    AppState.startProcessing(engine);
    await _nextFrame();   // let the browser paint the loading state

    try {
      // If the text is an untouched video/meeting transcript, use its timed
      // chunks so key points can link back to the video.
      const transcript = Transcript.getActiveFor(text);

      const out = engine === 'llm'
        ? await _compressWithLLM(text, mode, level, transcript)
        : _compressLocally(text, mode, level, transcript);

      const compressedText = _joinCompressed(out.summary, out.keyPoints);

      // Exact token counts when the server is running; otherwise a local estimate.
      const exactTokens = await LLMClient.countTokens([text, compressedText]);
      const stats = Statistics.computeStats(text, compressedText, exactTokens);
      const preservation = Preservation.evaluatePreservation(text, compressedText);

      const memoryTrick = out.memoryTrick || MemoryTrick.generateMemoryTrick(text, out.keyPoints || []);

      AppState.setResults({
        mode,
        level,
        engine,
        model: out.model || null,
        summary: out.summary,
        keyPoints: out.keyPoints,
        keyPointTimes: out.keyPointTimes,
        actions: out.actions,
        videoId: transcript ? transcript.videoId : null,
        stats,
        preservation,
        memoryTrick,
        originalText: text,
        compressedText,
      });

      _recordComparison(text, engine, level, stats, preservation, out.model);

    } catch (err) {
      console.error('[app.js] Processing error:', err);
      AppState.setError(err && err.message
        ? err.message
        : 'An unexpected error occurred during compression. Please try again with different text.');
    }
  }

  /** Offline engine: TF-IDF extractive summary and key points. */
  function _compressLocally(text, mode, level, transcript) {
    const presplit = transcript ? transcript.chunks.map(c => c.text) : null;
    let summary = null;
    let keyPoints = null;
    let keyPointTimes = null;

    if (mode === 'summary' || mode === 'both') {
      summary = Summarizer.generateSummary(text, level, presplit).summary;
    }
    if (mode === 'keypoints' || mode === 'both') {
      const detailed = KeyPoints.extractKeyPointsDetailed(text, level, presplit);
      keyPoints = detailed.map(p => p.text);
      if (transcript) keyPointTimes = detailed.map(p => transcript.chunks[p.index].start);
    }

    const actions = transcript
      ? Transcript.findActionItems(transcript.chunks).map(a => ({ text: a.text, time: a.start }))
      : null;

    return { summary, keyPoints, keyPointTimes, actions, memoryTrick: null, model: null };
  }

  /** LLM engine: abstractive compression by OpenAI, via our server. */
  async function _compressWithLLM(text, mode, level, transcript) {
    const r = await LLMClient.compress({
      text, mode, level,
      chunks: transcript ? transcript.chunks : undefined,
    });
    return {
      summary: r.summary,
      keyPoints: r.keyPoints ? r.keyPoints.map(p => p.text) : null,
      keyPointTimes: r.keyPoints && transcript ? r.keyPoints.map(p => p.time) : null,
      actions: r.actions && r.actions.length > 0 ? r.actions : null,
      memoryTrick: { type: r.memoryTrick.type, mnemonic: r.memoryTrick.text, explanation: r.memoryTrick.explanation },
      model: r.model,
    };
  }

  /**
   * The text a reader ends up with: the summary plus any key points that are
   * not already quoted in it, so overlap isn't double-counted in the stats.
   */
  function _joinCompressed(summary, keyPoints) {
    const norm = s => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const summaryNorm = summary ? norm(summary) : '';
    const extra = (keyPoints || []).filter(kp => !summaryNorm.includes(norm(kp)));
    return [summary || '', ...extra].join(' ').trim();
  }

  // ─── Engine Selection & Comparison ────────────────────────────────────────

  function _getEngine() {
    const checked = document.querySelector('input[name="engine"]:checked');
    return checked ? checked.value : 'extractive';
  }

  const ENGINE_LABELS = { extractive: 'Extractive (offline)', llm: 'OpenAI (LLM)' };

  function _recordComparison(text, engine, level, stats, preservation, model) {
    if (_comparison.text !== text) _comparison = { text, rows: {} };
    _comparison.rows[engine] = {
      label: ENGINE_LABELS[engine] + (model ? ` · ${model}` : ''),
      level,
      tokens: stats.compressedTokens,
      originalTokens: stats.originalTokens,
      exact: stats.tokensAreExact,
      reduction: stats.contextReduction,
      ratio: stats.compressionRatio,
      coverage: preservation.percentage,
      qa: null,
    };
    UI.renderComparison(Object.values(_comparison.rows));
  }

  async function _updateEngineAvailability() {
    await LLMClient.loadStatus();
    const status = LLMClient.getStatus();

    const llmRadio = document.querySelector('input[name="engine"][value="llm"]');
    const engineHint = document.getElementById('engine-hint');
    const textReason = LLMClient.textUnavailableReason();
    if (llmRadio) llmRadio.disabled = Boolean(textReason);
    if (engineHint) {
      engineHint.textContent = textReason
        ? textReason
        : `OpenAI (${status.text.model}) rewrites the text in its own words. Token counts are exact either way.`;
    }
    UI.setEvaluationAvailable(!textReason);
    UI.setAudioAvailable(!textReason, textReason);

    const videoAudioReason = textReason ? 'Audio needs an OpenAI key. ' + textReason : LLMClient.videoUnavailableReason();
    UI.setVideoAudioAvailable(!videoAudioReason, videoAudioReason);

    const videoHint = document.getElementById('video-hint');
    const videoReason = LLMClient.videoUnavailableReason();
    if (videoHint && videoReason) videoHint.textContent += ' ' + videoReason;
  }

  async function _runEvaluation() {
    const results = AppState.get('results');
    if (!results) return;
    UI.setEvaluationBusy(true);
    try {
      const evaluation = await LLMClient.evaluate({
        original: results.originalText,
        compressed: results.compressedText,
      });
      UI.renderEvaluation(evaluation);
      const row = _comparison.rows[results.engine];
      if (row && _comparison.text === results.originalText) {
        row.qa = Math.round(evaluation.score * 100);
        UI.renderComparison(Object.values(_comparison.rows));
      }
    } catch (err) {
      UI.renderEvaluationError(err.message);
    } finally {
      UI.setEvaluationBusy(false);
    }
  }

  // ─── Video (Gemini) ───────────────────────────────────────────────────────

  /**
   * Gemini watches the YouTube video and returns summary / key points / action
   * items. There is no source text, so the keyword-based metrics and the QA
   * evaluation don't apply; token counts come from Gemini's own tokenizer.
   */
  async function runVideoCompression(mode, source) {
    const level = _getSelectedLevel();
    const isRecording = Boolean(source.media);
    AppState.setMode(mode);
    AppState.startProcessing(isRecording ? 'recording' : 'video');
    await _nextFrame();

    try {
      const r = await LLMClient.videoCompress({ url: source.url, media: source.media, kind: source.kind, mode, level });
      _activeVideo = { url: source.url, media: source.media, kind: source.kind, videoId: r.videoId, history: [] };

      const keyPoints = r.keyPoints ? r.keyPoints.map(p => p.text) : null;
      const compressedText = _joinCompressed(r.summary, keyPoints);

      const stats = Statistics.computeStats(null, compressedText, null, {
        sourceIsVideo: true,
        originalTokens: r.tokens.original,
        compressedTokens: r.tokens.compressed,
      });

      AppState.setResults({
        mode,
        level,
        engine: 'video',
        model: r.model,
        summary: r.summary,
        keyPoints,
        keyPointTimes: r.keyPoints ? r.keyPoints.map(p => p.time) : null,
        actions: r.actions && r.actions.length > 0 ? r.actions : null,
        videoId: r.videoId,
        stats,
        preservation: null,
        memoryTrick: { type: r.memoryTrick.type, mnemonic: r.memoryTrick.text, explanation: r.memoryTrick.explanation },
        originalText: null,
        compressedText,
      });
      UI.resetVideoChat(r.videoId, isRecording ? 'recording' : 'video');
    } catch (err) {
      console.error('[app.js] Video error:', err);
      AppState.setError(err && err.message ? err.message : 'Could not process this video.');
    }
  }

  async function _askAboutVideo(question) {
    if (!_activeVideo) {
      UI.appendChatMessage('error', 'Summarize a video or recording first, then ask about it.');
      return;
    }
    UI.appendChatMessage('user', question);
    UI.setChatBusy(true);
    try {
      const { answer } = await LLMClient.videoAsk({
        url: _activeVideo.url,
        media: _activeVideo.media,
        question,
        history: _activeVideo.history,
      });
      _activeVideo.history.push({ role: 'user', text: question }, { role: 'model', text: answer });
      UI.appendChatMessage('model', answer, _activeVideo.videoId);
    } catch (err) {
      UI.appendChatMessage('error', err.message);
    } finally {
      UI.setChatBusy(false);
    }
  }

  /** Delete the uploaded recording (if any) from Gemini and forget it. */
  async function _discardRecording() {
    const media = _activeVideo && _activeVideo.media;
    _activeVideo = null;
    if (media) await LLMClient.mediaDelete(media.fileUri);
  }

  // ─── Audio briefing (listen on the go) ────────────────────────────────────

  /** What the card's button speaks: the summary — or the key points, if the summary was not asked for. */
  function _summaryAudioText(results) {
    if (results.summary) return results.summary;
    if (results.keyPoints && results.keyPoints.length > 0) {
      return results.keyPoints.map((p, i) => `${i + 1}. ${p}`).join(' ');
    }
    return '';
  }

  async function _makeAudio() {
    const results = AppState.get('results');
    if (!results) return;
    UI.setAudioBusy(true);
    try {
      const text = _summaryAudioText(results);
      if (!text) throw new Error('There is no summary to turn into audio yet.');
      const blob = await LLMClient.tts(text);
      UI.showAudio(blob, `summary-${new Date().toISOString().slice(0, 10)}.mp3`);
    } catch (err) {
      UI.showAudioError(err.message);
    } finally {
      UI.setAudioBusy(false);
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
    // rAF never fires in a hidden tab, so fall back to a timer.
    return new Promise(resolve => {
      requestAnimationFrame(resolve);
      setTimeout(resolve, 100);
    });
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

  // ─── Video / Transcript Sources ──────────────────────────────────────────

  function _setStatus(message, isError = false) {
    const el = document.getElementById('source-status');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('hidden', !message);
    el.classList.toggle('source-status--error', isError);
  }

  /** Put loaded transcript text in the textarea and let the normal input handlers run. */
  function _fillTextarea(text) {
    const textarea = document.getElementById('input-textarea');
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
  }

  function _describe(loaded, label) {
    return `✓ ${label} loaded — ${loaded.chunks.length} segments, ~${Transcript.formatTime(loaded.duration)} long. ` +
           'Choose a compression level and press a button below.';
  }

  /** Upload a meeting recording to Gemini, then summarise it like a video. */
  async function _summarizeRecording(file) {
    const MAX_MB = 200;
    if (file.size > MAX_MB * 1024 * 1024) {
      _setStatus(`That file is ${(file.size / 1024 / 1024).toFixed(0)} MB; the limit is ${MAX_MB} MB. Export the audio only, or trim the recording.`, true);
      return;
    }
    const reason = LLMClient.videoUnavailableReason();
    if (reason) { _setStatus(reason, true); return; }

    await _discardRecording();
    Transcript.reset();
    document.getElementById('input-textarea').value = '';
    AppState.setInputText('');
    UI.updateLiveStats('');

    _setStatus(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)… large recordings can take a few minutes.`);
    try {
      const media = await LLMClient.mediaUpload(file);
      _setStatus(`✓ ${file.name} uploaded. Gemini is analysing it…`);
      await runVideoCompression('both', { media: { fileUri: media.fileUri, mimeType: media.mimeType }, kind: media.kind });
    } catch (err) {
      _setStatus(err.message, true);
    }
  }

  function _wireSources() {
    const tabs   = document.querySelectorAll('.source-tab');
    const panels = {
      video: document.getElementById('source-video'),
      file:  document.getElementById('source-file'),
    };

    tabs.forEach(tab => tab.addEventListener('click', () => {
      tabs.forEach(t => {
        const on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
      });
      Object.entries(panels).forEach(([name, el]) => el.classList.toggle('hidden', name !== tab.dataset.source));
      _setStatus('');
    }));

    // YouTube link
    const btnFetch = document.getElementById('btn-fetch-video');
    const urlInput = document.getElementById('video-url');
    const fetchVideo = async () => {
      const url = urlInput.value.trim();
      if (!url) { _setStatus('Paste a YouTube link first.', true); return; }
      btnFetch.disabled = true;
      _setStatus('Fetching transcript…');
      try {
        const { videoId, segments } = await Transcript.fetchYouTube(url);
        const loaded = Transcript.load(segments, { source: 'youtube', videoId });
        _fillTextarea(loaded.text);
        _setStatus(_describe(loaded, 'Transcript'));
      } catch (err) {
        _setStatus(err.message, true);
      } finally {
        btnFetch.disabled = false;
      }
    };
    btnFetch.addEventListener('click', fetchVideo);

    // Gemini watches the video (needs a Gemini key on the server)
    const btnGemini = document.getElementById('btn-video-gemini');
    const summarizeVideo = async () => {
      const url = urlInput.value.trim();
      if (!url) { _setStatus('Paste a YouTube link first.', true); return; }
      const reason = LLMClient.videoUnavailableReason();
      if (reason) { _setStatus(reason, true); return; }
      _setStatus('');
      document.getElementById('input-textarea').value = '';   // the video is the source now
      AppState.setInputText('');
      UI.updateLiveStats('');
      Transcript.reset();
      btnGemini.disabled = true;
      await _discardRecording();
      await runVideoCompression('both', { url });
      btnGemini.disabled = false;
    };
    btnGemini.addEventListener('click', summarizeVideo);

    // Audio: the WHOLE video as audio (everything said, read aloud) — not a summary.
    const btnVideoAudio = document.getElementById('btn-video-audio');
    const videoToAudio = async () => {
      const url = urlInput.value.trim();
      if (!url) { _setStatus('Paste a YouTube link first.', true); return; }
      const textReason = LLMClient.textUnavailableReason();
      const reason = textReason ? 'Audio needs an OpenAI key. ' + textReason : LLMClient.videoUnavailableReason();
      if (reason) { _setStatus(reason, true); return; }
      _setStatus('');

      btnGemini.disabled = true;
      UI.setVideoAudioBusy(true);
      AppState.setMode('audio');
      AppState.startProcessing('fullaudio');
      await _nextFrame();
      try {
        const blob = await LLMClient.videoAudio({ url });
        UI.showFullAudio(blob, `video-audio-${new Date().toISOString().slice(0, 10)}.mp3`);
      } catch (err) {
        AppState.setError(err && err.message ? err.message : 'Could not turn this video into audio.');
      } finally {
        btnGemini.disabled = false;
        UI.setVideoAudioBusy(false);
      }
    };
    btnVideoAudio.addEventListener('click', videoToAudio);
    urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') summarizeVideo(); });

    // Documents: PDF / DOCX / XLSX / CSV are parsed on the server;
    // subtitles and plain text are read right here in the browser.
    const SERVER_PARSED = ['pdf', 'docx', 'xlsx', 'csv'];
    const LOCAL_TEXT = ['txt', 'vtt', 'srt'];
    const RECORDINGS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4', 'mov', 'webm', 'mpeg', 'mpg', 'avi', 'wmv', '3gp'];
    document.getElementById('transcript-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const ext = file.name.split('.').pop().toLowerCase();
      if (RECORDINGS.includes(ext)) {
        await _summarizeRecording(file);
        return;
      }
      if (!SERVER_PARSED.includes(ext) && !LOCAL_TEXT.includes(ext)) {
        const legacy = { doc: '.docx', xls: '.xlsx' }[ext];
        _setStatus(legacy
          ? `Old .${ext} files aren't supported. Save it as ${legacy} and upload again.`
          : `Unsupported file type ".${ext}". Use a document (PDF, DOCX, XLSX, CSV, TXT), a transcript (VTT, SRT) or a recording (MP3, M4A, WAV, MP4, MOV, WEBM).`, true);
        return;
      }
      try {
        if (SERVER_PARSED.includes(ext)) {
          _setStatus(`Reading ${file.name}…`);
          const doc = await LLMClient.extractFile(file);
          Transcript.reset();
          _fillTextarea(doc.text);
          const pages = doc.pages ? `${doc.pages} page${doc.pages === 1 ? '' : 's'}, ` : '';
          _setStatus(`✓ ${file.name} loaded — ${pages}${Tokenizer.formatNumber(Tokenizer.countWords(doc.text))} words. ` +
                     'Choose a compression level and press a button below.');
          return;
        }
        const raw = await file.text();
        const segments = Transcript.parseSubtitles(raw);
        if (segments) {
          const loaded = Transcript.load(segments, { source: 'file' });
          _fillTextarea(loaded.text);
          _setStatus(_describe(loaded, file.name));
        } else {
          Transcript.reset();
          _fillTextarea(raw.trim());
          _setStatus(`✓ ${file.name} loaded as plain text (no timestamps found).`);
        }
      } catch (err) {
        _setStatus(err.message || 'Could not read that file.', true);
      }
    });

    // Clear wipes the loaded transcript and any status
    AppState.on('clear', () => {
      Transcript.reset();
      _discardRecording();
      _setStatus('');
      urlInput.value = '';
      document.getElementById('transcript-file').value = '';
    });
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    UI.initUI();
    _wireButtons();
    _wireSources();
    _updateEngineAvailability();
    document.getElementById('btn-evaluate')?.addEventListener('click', _runEvaluation);
    AppState.on('clear', () => { _comparison = { text: null, rows: {} }; });

    // Typing or loading other text ends "video mode"
    document.getElementById('input-textarea')?.addEventListener('input', () => { _discardRecording(); });

    // Closing the tab deletes an uploaded recording from Gemini right away.
    window.addEventListener('pagehide', () => {
      if (_activeVideo && _activeVideo.media) LLMClient.mediaDeleteOnExit(_activeVideo.media.fileUri);
    });

    document.getElementById('btn-make-audio')?.addEventListener('click', _makeAudio);

    // Ask-about-the-video chat
    document.getElementById('video-chat-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('video-chat-input');
      const question = input.value.trim();
      if (!question) return;
      input.value = '';
      _askAboutVideo(question);
    });
    UI.onChatSuggestion(_askAboutVideo);

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
