// log.js — Central throttled logger (replaces stray console.logs, bug B13).
//
//   log.debug(tag, msg, data?)   only prints when debug is enabled
//   log.info / warn / error       always print (error also kept for on-screen strip)
//   log.throttled(tag, ms, msg)   prints at most once per `ms` for that tag
//
// Debug is on when the page URL has ?debug=1, or toggled live with the 'L' key
// (app.js wires the key). When debug is on, the HUD shows FPS + state + last errors
// via log.getRecentErrors().

const _debugFromUrl = (() => {
  try { return new URLSearchParams(window.location.search).get('debug') === '1'; }
  catch { return false; }
})();

class Logger {
  constructor() {
    this._debug        = _debugFromUrl;
    this._throttleLast = {};        // tag → last-print timestamp (ms)
    this._recentErrors = [];        // ring buffer of {t, tag, msg} for HUD
    this._maxErrors    = 3;
  }

  get debugEnabled() { return this._debug; }

  /** Toggle debug on/off (bound to 'L' key). @returns {boolean} new state */
  toggleDebug() {
    this._debug = !this._debug;
    console.log(`[log] debug ${this._debug ? 'ON' : 'OFF'}`);
    return this._debug;
  }

  debug(tag, msg, data) {
    if (!this._debug) return;
    if (data !== undefined) console.log(`[${tag}] ${msg}`, data);
    else                    console.log(`[${tag}] ${msg}`);
  }

  info(tag, msg, data) {
    if (data !== undefined) console.log(`[${tag}] ${msg}`, data);
    else                    console.log(`[${tag}] ${msg}`);
  }

  warn(tag, msg, data) {
    if (data !== undefined) console.warn(`[${tag}] ${msg}`, data);
    else                    console.warn(`[${tag}] ${msg}`);
  }

  error(tag, msg, data) {
    if (data !== undefined) console.error(`[${tag}] ${msg}`, data);
    else                    console.error(`[${tag}] ${msg}`);
    this._recentErrors.push({ t: Date.now(), tag, msg: String(msg) });
    if (this._recentErrors.length > this._maxErrors) this._recentErrors.shift();
  }

  /** Print at most once per `ms` milliseconds for a given tag. */
  throttled(tag, ms, msg, data) {
    const now  = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const last = this._throttleLast[tag] ?? -Infinity;
    if (now - last < ms) return;
    this._throttleLast[tag] = now;
    if (data !== undefined) console.log(`[${tag}] ${msg}`, data);
    else                    console.log(`[${tag}] ${msg}`);
  }

  /** Last few errors for the HUD debug strip (newest last). */
  getRecentErrors() { return this._recentErrors.slice(); }
}

export const log = new Logger();
export default log;
