/**
 * speech.js
 * Text-to-speech for the compressed output, using the browser's built-in
 * speechSynthesis (free, offline-capable, no API key).
 *
 * Chrome silently stops long utterances, so text is spoken sentence by
 * sentence. Only one thing plays at a time.
 */

const Speech = (() => {

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  let queue = [];
  let activeOwner = null;   // id of the button/card currently playing
  let rate = 1;
  let onStateChange = () => {};

  function isSupported() { return supported; }

  function setRate(r) { rate = r; }

  /** Called with (ownerId | null, 'playing' | 'paused' | 'stopped'). */
  function onState(fn) { onStateChange = fn; }

  function _pickVoice(lang) {
    const voices = window.speechSynthesis.getVoices();
    return voices.find(v => v.lang === lang)
        || voices.find(v => v.lang.startsWith(lang.split('-')[0]))
        || null;
  }

  // Devanagari text (Marathi/Hindi) needs a different voice from English.
  function _detectLang(text) {
    return /[ऀ-ॿ]/.test(text) ? 'hi-IN' : 'en-US';
  }

  function _splitForSpeech(text) {
    return text.match(/[^.!?]+[.!?]*/g)?.map(s => s.trim()).filter(Boolean) || [text];
  }

  function _next() {
    if (queue.length === 0) {
      const owner = activeOwner;
      activeOwner = null;
      onStateChange(owner, 'stopped');
      return;
    }
    const lang = _detectLang(queue[0]);
    const u = new SpeechSynthesisUtterance(queue.shift());
    u.rate = rate;
    u.lang = lang;
    const voice = _pickVoice(lang);
    if (voice) u.voice = voice;
    u.onend = _next;
    u.onerror = (e) => { if (e.error !== 'canceled' && e.error !== 'interrupted') _next(); };
    window.speechSynthesis.speak(u);
  }

  /** Start reading `text`. Replaces anything already playing. */
  function play(owner, text) {
    if (!supported || !text) return;
    stop();
    activeOwner = owner;
    queue = _splitForSpeech(text);
    onStateChange(owner, 'playing');
    _next();
  }

  function pause() {
    if (!supported || !activeOwner) return;
    window.speechSynthesis.pause();
    onStateChange(activeOwner, 'paused');
  }

  function resume() {
    if (!supported || !activeOwner) return;
    window.speechSynthesis.resume();
    onStateChange(activeOwner, 'playing');
  }

  function stop() {
    if (!supported) return;
    const owner = activeOwner;
    queue = [];
    activeOwner = null;
    window.speechSynthesis.cancel();
    if (owner) onStateChange(owner, 'stopped');
  }

  function getOwner() { return activeOwner; }

  return { isSupported, setRate, onState, play, pause, resume, stop, getOwner };

})();
