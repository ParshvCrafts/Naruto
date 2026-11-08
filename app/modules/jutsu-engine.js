// jutsu-engine.js — Sign confirmation + jutsu activation
import { ENGINE } from './config.js';

export default class JutsuEngine {
  constructor() {
    this._window      = new Array(ENGINE.WINDOW_SIZE).fill(ENGINE.NONE_CLASS);  // sliding window, init to None
    this._windowIdx   = 0;
    this._handlers    = {};                       // jutsuName → callback
    this._active      = false;
    this._activeTimer = null;
    this._SHADOW_CLONE_CLASS = ENGINE.SHADOW_CLONE_CLASS;
    this._NONE_CLASS         = ENGINE.NONE_CLASS;
    this._CONFIRM_THRESHOLD  = ENGINE.CONFIRM_THRESHOLD;
    this._CONF_MIN           = ENGINE.CONF_MIN;  // minimum per-frame confidence to accept a prediction

    // Sequence jutsu support
    this._sequences     = {};     // jutsuName → { sequence: int[], timeoutMs: number }
    this._seqBuffer     = [];     // confirmed signs so far in active sequence
    this._seqLastTime   = 0;      // timestamp of last confirmed sign
    this._seqTimeout    = ENGINE.SEQ_TIMEOUT_MS;  // ms before incomplete sequence resets
    this._seqActive     = null;   // jutsuName currently in progress
    this._seqCooldownUntil = 0;   // anti-cross-seed: no NEW sequence may start before this (B6/§A)
    this._frozenAt      = 0;      // >0 while sequence-timeout clock is paused (carousel open)
    this._ready         = null;   // name of a mode:'ready' sequence awaiting its activation gesture
    this._readyAt       = 0;
    this._character     = null;   // 'naruto' | 'sasuke' | null — gates jutsu activation
    this._activeJutsu   = null;   // name of currently active jutsu, or null
  }

  onActivation(jutsuName, callback) {
    this._handlers[jutsuName] = callback;
  }

  /**
   * @param {string} jutsuName
   * @param {number[]} sequence
   * @param {number|{timeoutMs?:number, mode?:'activate'|'ready'}} [opts]
   *   mode 'activate' (default) fires onActivation immediately on completion;
   *   mode 'ready' instead raises a READY signal (getReady) so the caller can gate
   *   activation on a further gesture (Chidori right palm, Fireball mouth). A plain
   *   number is treated as timeoutMs for backward compatibility.
   */
  registerSequence(jutsuName, sequence, opts = {}) {
    const o = typeof opts === 'number' ? { timeoutMs: opts } : opts;
    this._sequences[jutsuName] = {
      sequence,
      timeoutMs: o.timeoutMs ?? 5000,
      mode:      o.mode ?? 'activate',
    };
  }

  /** Gate jutsu to character. null disables all jutsu (selection pending). */
  setCharacter(character) {
    this._character = character;
  }

  update(classId, confidence) {
    if (this._active) return;
    if (classId === this._NONE_CLASS || confidence < this._CONF_MIN) {
      this._window.fill(this._NONE_CLASS);  // reset on None/low confidence
      // A confirmed None window clears the anti-cross-seed cooldown (§A).
      if (!this._seqActive) this._seqCooldownUntil = 0;
      return;
    }
    this._window[this._windowIdx] = classId;
    this._windowIdx = (this._windowIdx + 1) % this._window.length;

    const count = this._window.filter(c => c === classId).length;
    const ratio = count / this._window.length;
    if (ratio >= this._CONFIRM_THRESHOLD) {
      this._checkActivation(classId);
    }
  }

  _checkActivation(classId) {
    if (!this._character) return;  // no character selected — no jutsu

    // Shadow Clone — single sign, no sequence
    if (classId === this._SHADOW_CLONE_CLASS) {
      if (this._character === 'naruto') this._activate('shadowClone');
      return;
    }

    // Sequence jutsu — Sasuke only
    if (this._character !== 'sasuke') return;

    // Sequence jutsu — check timeout first (use active sequence's timeout if set)
    const now = performance.now();
    const activeTimeout = this._seqActive
      ? (this._sequences[this._seqActive]?.timeoutMs ?? this._seqTimeout)
      : this._seqTimeout;
    if (now - this._seqLastTime > activeTimeout) {
      this._seqBuffer = [];
      this._seqActive = null;
    }
    this._seqLastTime = now;

    // Anti-cross-seed (§A): while cooling down, no NEW sequence may start.
    // A sequence already in progress (seqActive) is unaffected.
    const startingNew = !this._seqActive;
    if (startingNew && now < this._seqCooldownUntil) return;

    // Find matching sequence prefix (lock to active sequence once started)
    for (const [name, def] of Object.entries(this._sequences)) {
      if (this._seqActive && name !== this._seqActive) continue;
      const expected = def.sequence[this._seqBuffer.length];
      if (classId === expected) {
        this._seqBuffer.push(classId);
        this._seqActive = name;
        this._window.fill(this._NONE_CLASS);  // require fresh confirmation for next sign
        console.log(`[engine] sequence ${name}: ${this._seqBuffer.length}/${def.sequence.length}`);

        if (this._seqBuffer.length === def.sequence.length) {
          this._seqBuffer = [];
          this._seqActive = null;
          if (def.mode === 'ready') {
            // Signal READY; the app gates final activation on a further gesture.
            this._ready   = name;
            this._readyAt = performance.now();
            console.log(`[engine] READY: ${name}`);
          } else {
            this._activate(name);
          }
        }
        return;
      }
    }

    // Wrong sign mid-sequence → reset + start anti-cross-seed cooldown (§A)
    if (this._seqActive) {
      console.log('[engine] wrong sign — sequence reset');
      this._seqBuffer = [];
      this._seqActive = null;
      this._seqCooldownUntil = now + ENGINE.SEQ_COOLDOWN_MS;
    }
  }

  _activate(jutsuName) {
    if (this._active) return;
    this._active     = true;
    this._activeJutsu = jutsuName;
    this._window.fill(this._NONE_CLASS);
    console.log(`[engine] ACTIVATE: ${jutsuName}`);
    if (this._handlers[jutsuName]) this._handlers[jutsuName]();
    // Shadow Clone persists until manual Release gesture — no auto-reset.
    // All other jutsu auto-reset after 8s as a safety net.
    if (jutsuName !== 'shadowClone') {
      this._activeTimer = setTimeout(() => { this.reset(); }, ENGINE.AUTO_RESET_MS);
    }
  }

  isActive()      { return this._active; }
  getActiveJutsu() { return this._activeJutsu; }

  /** @returns {string|null} name of a sequence that completed in mode:'ready', or null. */
  getReady() { return this._ready; }
  /** Consume the READY signal (call once the app has transitioned to the READY state). */
  clearReady() { this._ready = null; this._readyAt = 0; }

  /**
   * Pause the sequence-timeout clock (call when carousel opens — §A freeze, B6).
   * While frozen the caller must also skip engine.update() entirely.
   */
  freezeTimeout() {
    if (!this._frozenAt) this._frozenAt = performance.now();
  }

  /** Resume the clock, crediting the frozen interval so mid-sequence progress survives. */
  unfreezeTimeout() {
    if (this._frozenAt) {
      const elapsed = performance.now() - this._frozenAt;
      this._seqLastTime += elapsed;
      this._seqCooldownUntil += elapsed;
      this._frozenAt = 0;
    }
  }

  getSequenceState() {
    if (!this._seqActive) return { jutsuName: null, completed: [], pending: [] };
    const def = this._sequences[this._seqActive];
    return {
      jutsuName: this._seqActive,
      completed: this._seqBuffer.slice(),
      pending:   def.sequence.slice(this._seqBuffer.length)
    };
  }

  getWindowFillRatio(classId) {
    const count = this._window.filter(c => c === classId).length;
    return count / this._window.length;
  }

  reset() {
    clearTimeout(this._activeTimer);
    this._active      = false;
    this._activeJutsu = null;
    this._seqBuffer   = [];
    this._seqActive   = null;
    this._seqLastTime = 0;
    this._seqCooldownUntil = 0;
    this._frozenAt    = 0;
    this._ready       = null;
    this._readyAt     = 0;
    this._window.fill(this._NONE_CLASS);
    this._windowIdx = 0;
    console.log('[engine] reset');
  }
}
