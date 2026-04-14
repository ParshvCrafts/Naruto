// jutsu-engine.js — Sign confirmation + jutsu activation
export default class JutsuEngine {
  constructor() {
    this._window      = new Array(45).fill(13);  // sliding window, init to None
    this._windowIdx   = 0;
    this._handlers    = {};                       // jutsuName → callback
    this._active      = false;
    this._activeTimer = null;
    this._SHADOW_CLONE_CLASS = 12;
    this._NONE_CLASS         = 13;
    this._CONFIRM_THRESHOLD  = 0.70;
    this._CONF_MIN           = 0.85;

    // Sequence jutsu support
    this._sequences   = {};     // jutsuName → { sequence: int[], timeoutMs: number }
    this._seqBuffer   = [];     // confirmed signs so far in active sequence
    this._seqLastTime = 0;      // timestamp of last confirmed sign
    this._seqTimeout  = 5000;   // ms before incomplete sequence resets
    this._seqActive   = null;   // jutsuName currently in progress
  }

  onActivation(jutsuName, callback) {
    this._handlers[jutsuName] = callback;
  }

  registerSequence(jutsuName, sequence, timeoutMs = 5000) {
    this._sequences[jutsuName] = { sequence, timeoutMs };
  }

  update(classId, confidence) {
    if (this._active) return;
    if (classId === this._NONE_CLASS || confidence < this._CONF_MIN) {
      this._window.fill(this._NONE_CLASS);  // reset on None/low confidence
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
    // Shadow Clone — single sign, no sequence
    if (classId === this._SHADOW_CLONE_CLASS) {
      this._activate('shadowClone');
      return;
    }

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
          this._activate(name);
        }
        return;
      }
    }

    // Wrong sign mid-sequence → reset
    if (this._seqActive) {
      console.log('[engine] wrong sign — sequence reset');
      this._seqBuffer = [];
      this._seqActive = null;
    }
  }

  _activate(jutsuName) {
    if (this._active) return;
    this._active = true;
    this._window.fill(this._NONE_CLASS);
    console.log(`[engine] ACTIVATE: ${jutsuName}`);
    if (this._handlers[jutsuName]) this._handlers[jutsuName]();
    // Auto-reset after 8s
    this._activeTimer = setTimeout(() => { this.reset(); }, 8000);
  }

  isActive() { return this._active; }

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
    this._seqBuffer   = [];
    this._seqActive   = null;
    this._seqLastTime = 0;
    this._window.fill(this._NONE_CLASS);
    this._windowIdx = 0;
    console.log('[engine] reset');
  }
}
