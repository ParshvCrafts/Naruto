// release-detector.js — Detects the "Release" hand sign + spoken word to dismiss Shadow Clone.
//
// Release sign (left hand): index finger + middle finger extended upward, ring + pinky curled.
// Dual-condition trigger: BOTH the hand sign AND the spoken word "release" must be detected.
// This prevents false positives from either condition alone.
//
// Web Speech API notes:
//  - Requires Chrome/Edge (or any browser with SpeechRecognition support).
//  - Works on localhost (http://localhost:8765) — no HTTPS required for localhost.
//  - Browser will request microphone permission on first use.

// ─── Geometric thresholds (centralized in config.js — RELEASE) ─────────────────────
import { RELEASE } from './config.js';
const RELEASE_EXTEND_MARGIN = RELEASE.EXTEND_MARGIN;  // index+middle above MCP (y↓)
const RELEASE_CURL_MARGIN   = RELEASE.CURL_MARGIN;    // ring+pinky below MCP
const RELEASE_MAX_WRIST_JOIN = RELEASE.MAX_WRIST_JOIN; // hands closer than this = joined seal, not release

// ─── Hand sign detector ─────────────────────────────────────────────────────────

/**
 * Returns true if leftLmks shows the Release sign:
 * index + middle up, ring + pinky curled — and the right hand is NOT also showing
 * an extended index finger (which would indicate a two-handed sign like Ram or Tiger).
 *
 * @param {Array<{x,y,z}>|null} leftLmks   21 MediaPipe left-hand landmarks, or null
 * @param {Array<{x,y,z}>|null} rightLmks  21 MediaPipe right-hand landmarks, or null
 * @returns {boolean}
 */
export function isReleaseSign(leftLmks, rightLmks = null) {
  if (!leftLmks || leftLmks.length < 21) return false;

  // Release is a left-hand-only sign. If the right hand is also present, two guards
  // reject a forming two-handed seal (Tiger/Ram) — this is the B5 mitigation:
  if (rightLmks && rightLmks.length >= 21) {
    // (a) right index extended → clearly a joined seal, not Release.
    const rIndexUp = rightLmks[8].y < rightLmks[5].y - RELEASE_EXTEND_MARGIN;
    if (rIndexUp) return false;
    // (b) hands joined (wrists close) → a two-handed seal is forming even if the
    //     right index hasn't fully extended yet (half-Tiger transition frames).
    const wristGap = Math.hypot(leftLmks[0].x - rightLmks[0].x, leftLmks[0].y - rightLmks[0].y);
    if (wristGap < RELEASE_MAX_WRIST_JOIN) return false;
  }

  // Index (tip=8, mcp=5) and middle (tip=12, mcp=9) must be extended upward
  const indexUp  = leftLmks[8].y  < leftLmks[5].y  - RELEASE_EXTEND_MARGIN;
  const middleUp = leftLmks[12].y < leftLmks[9].y  - RELEASE_EXTEND_MARGIN;

  // Ring (tip=16, mcp=13) and pinky (tip=20, mcp=17) must be curled
  const ringDown  = leftLmks[16].y > leftLmks[13].y + RELEASE_CURL_MARGIN;
  const pinkyDown = leftLmks[20].y > leftLmks[17].y + RELEASE_CURL_MARGIN;

  return indexUp && middleUp && ringDown && pinkyDown;
}

// ─── Speech listener ────────────────────────────────────────────────────────────

/**
 * Listens continuously for the word "release" using the Web Speech API.
 * The _heard flag is set true when the word is detected and consumed via consumeRelease().
 *
 * Usage:
 *   const sl = new SpeechListener();
 *   sl.start();             // begin listening (on jutsu activation)
 *   sl.consumeRelease();    // returns true once per speech event, then false
 *   sl.stop();              // stop listening (on jutsu end)
 */
export class SpeechListener {
  constructor() {
    this._recognition = null;
    this._heard       = false;
    this._listening   = false;
    this._supported   = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

    if (!this._supported) {
      console.warn('[speech] SpeechRecognition not supported in this browser. Release voice trigger disabled.');
    }
  }

  /** @returns {boolean} Whether the browser supports speech recognition. */
  get isSupported() { return this._supported; }

  /** Start listening for "release". Call on Shadow Clone activation. */
  start() {
    if (!this._supported || this._listening) return;
    this._listening = true;
    this._heard     = false;
    this._startRecognition();
    console.log('[speech] listening for "release"');
  }

  /** Stop listening. Call when Shadow Clone ends. */
  stop() {
    this._listening = false;
    this._heard     = false;
    if (this._recognition) {
      try { this._recognition.abort(); } catch (_) {}
      this._recognition = null;
    }
    console.log('[speech] stopped');
  }

  /**
   * Returns true once when "release" has been heard since the last call.
   * Resets the flag on return — call this each frame when checking release condition.
   */
  consumeRelease() {
    if (this._heard) {
      this._heard = false;
      return true;
    }
    return false;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _startRecognition() {
    if (!this._listening) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous      = false;   // restart after each result for simpler lifecycle
    rec.interimResults  = false;
    rec.lang            = 'en-US';
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript
        .toLowerCase()
        .trim();
      console.log('[speech] heard:', transcript);
      if (transcript.includes('release')) {
        this._heard = true;
        console.log('[speech] RELEASE keyword detected');
      }
    };

    // Auto-restart after each session ends (browser caps single sessions at ~60s)
    rec.onend = () => {
      if (this._listening) {
        setTimeout(() => this._startRecognition(), 150);
      }
    };

    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        // Microphone permission denied — disable and don't retry
        console.warn('[speech] Microphone permission denied — voice release trigger disabled');
        this._listening = false;
        this._recognition = null;
        return;
      }
      // 'no-speech' and 'aborted' are non-fatal — just restart
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[speech] error:', e.error);
      }
      if (this._listening) {
        setTimeout(() => this._startRecognition(), 500);
      }
    };

    try {
      rec.start();
      this._recognition = rec;
    } catch (e) {
      console.warn('[speech] start() threw:', e.message);
      if (this._listening) {
        setTimeout(() => this._startRecognition(), 1000);
      }
    }
  }
}
