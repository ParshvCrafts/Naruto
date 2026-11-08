// debug-input.js — Keyboard-driven simulated detector inputs (02-design §G).
//
// Every gesture feature gets a keyboard fallback that goes through the SAME code
// path as the real detector (hard product rule). This module holds the simulated
// state; app.js reads it at the single point where detector outputs are consumed,
// so all downstream state transitions are exercised identically.
//
// Keys (wired in app.js):
//   1..9,0,-,=  inject seal classId 0..11 for INJECT_FRAMES at conf 0.99
//   k           inject KageBunshin (12)
//   g           simulate left release sign (release clones / arm rasengan in S15)
//   p           toggle simulated right open palm (chidori/rasengan activate, S15/16)
//   m           toggle simulated mouth-open (fireball, S17)

const INJECT_FRAMES  = 50;   // frames a seal injection persists (> 45-window * 0.70 confirm)
const RELEASE_FRAMES = 15;   // frames the simulated release sign holds (> RELEASE.HOLD_THRESHOLD)

// Keyboard key → seal classId (0..11). '0' = 9 (Bird), '-' = 10 (Dog), '=' = 11 (Boar).
export const SEAL_KEYMAP = Object.freeze({
  '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5,
  '7': 6, '8': 7, '9': 8, '0': 9, '-': 10, '=': 11,
});

export default class DebugInput {
  constructor() {
    this._signClass    = -1;   // classId currently being injected, or -1
    this._signFrames   = 0;    // frames remaining for sign injection
    this._releaseFrames = 0;   // frames remaining for simulated release sign
    this._rightPalm    = false;// toggled right-open-palm sim
    this._mouthOpen    = false;// toggled mouth-open sim (S17)
  }

  // ─── Setters (called from keydown) ───────────────────────────────────────────

  /** Inject a seal classId for INJECT_FRAMES frames at high confidence. */
  injectSign(classId) { this._signClass = classId; this._signFrames = INJECT_FRAMES; }

  /** Simulate the left release sign for RELEASE_FRAMES frames (one 'g' press). */
  pulseReleaseSign() { this._releaseFrames = RELEASE_FRAMES; }

  toggleRightPalm() { this._rightPalm = !this._rightPalm; return this._rightPalm; }
  toggleMouthOpen() { this._mouthOpen = !this._mouthOpen; return this._mouthOpen; }

  // ─── Per-frame consumption (called from app.js onResults) ────────────────────

  /**
   * Consume one frame of a pending seal injection.
   * @returns {{classId:number, confidence:number}|null} override, or null if none active
   */
  consumeSignOverride() {
    if (this._signFrames > 0) {
      this._signFrames--;
      return { classId: this._signClass, confidence: 0.99 };
    }
    return null;
  }

  /** True while a simulated release sign is active; consumes one frame. */
  consumeReleaseSign() {
    if (this._releaseFrames > 0) { this._releaseFrames--; return true; }
    return false;
  }

  isRightPalmSim() { return this._rightPalm; }
  isMouthOpenSim() { return this._mouthOpen; }

  /** Clear all simulated inputs (e.g. on jutsu reset). */
  clear() {
    this._signClass = -1; this._signFrames = 0; this._releaseFrames = 0;
    this._rightPalm = false; this._mouthOpen = false;
  }
}
