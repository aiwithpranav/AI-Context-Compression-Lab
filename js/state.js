/**
 * state.js
 * Application state manager.
 * Single source of truth for all app state.
 * Provides a simple pub/sub mechanism for UI components to react to changes.
 */

const AppState = (() => {

  // Internal state object
  const _state = {
    inputText: '',
    mode: null,           // 'summary' | 'keypoints' | 'both'
    isProcessing: false,
    results: null,        // { summary?, keyPoints?, stats, preservation, memoryTrick }
    error: null,
    hasResults: false,
  };

  // Event listeners registry
  const _listeners = {};

  /**
   * Subscribe to state change events.
   * @param {string} event - e.g. 'inputChange', 'processingStart', 'resultsReady', 'error', 'clear'
   * @param {Function} callback
   */
  function on(event, callback) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(callback);
  }

  /**
   * Emit an event to all listeners.
   * @param {string} event
   * @param {*} [data]
   */
  function emit(event, data) {
    (_listeners[event] || []).forEach(fn => fn(data));
  }

  /**
   * Update the input text and fire inputChange event.
   * @param {string} text
   */
  function setInputText(text) {
    _state.inputText = text;
    emit('inputChange', text);
  }

  /**
   * Set the active compression mode.
   * @param {'summary'|'keypoints'|'both'} mode
   */
  function setMode(mode) {
    _state.mode = mode;
    emit('modeChange', mode);
  }

  /**
   * Begin processing — sets flag and emits event.
   */
  function startProcessing() {
    _state.isProcessing = true;
    _state.error = null;
    _state.results = null;
    emit('processingStart');
  }

  /**
   * Processing complete — store results and emit.
   * @param {Object} results
   */
  function setResults(results) {
    _state.results = results;
    _state.isProcessing = false;
    _state.hasResults = true;
    emit('resultsReady', results);
  }

  /**
   * Store an error and emit.
   * @param {string} message
   */
  function setError(message) {
    _state.error = message;
    _state.isProcessing = false;
    emit('error', message);
  }

  /**
   * Reset all state to initial.
   */
  function clearAll() {
    _state.inputText = '';
    _state.mode = null;
    _state.isProcessing = false;
    _state.results = null;
    _state.error = null;
    _state.hasResults = false;
    emit('clear');
  }

  /**
   * Read a specific state property.
   * @param {string} key
   * @returns {*}
   */
  function get(key) {
    return _state[key];
  }

  return {
    on,
    emit,
    setInputText,
    setMode,
    startProcessing,
    setResults,
    setError,
    clearAll,
    get,
  };

})();
