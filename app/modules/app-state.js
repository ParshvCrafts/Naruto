// app-state.js — Central state machine (single source of truth for mode gating).
// Replaces scattered ad-hoc gates (bugs B6, B14). app.js drives transitions each
// frame; modules query the guard predicates. See docs/master-plan/02-design.md §A.
//
// Modes:
//   BOOT → IDLE ⇄ CAROUSEL
//   IDLE → SEQUENCE(name)              partial seal sequence in progress
//   IDLE → JUTSU_SHADOW_CLONE          KageBunshin confirmed (naruto)
//   IDLE → RASENGAN_ARMED              left release-sign held (naruto, S15)
//   RASENGAN_ARMED → JUTSU_RASENGAN | IDLE(timeout)
//   SEQUENCE(chidori) done → CHIDORI_READY → JUTSU_CHIDORI (right open palm)   [S16]
//   SEQUENCE(fireball) done → FIREBALL_READY → JUTSU_FIREBALL (mouth open)     [S17]
//   JUTSU_* → RELEASING → IDLE
//
// S11 wires: BOOT→IDLE, IDLE⇄CAROUSEL, IDLE→JUTSU_SHADOW_CLONE, JUTSU_*→RELEASING→IDLE.
// The RASENGAN/CHIDORI/FIREBALL modes exist as enum values now; transitions into
// them land in S15–S17.

export const Mode = Object.freeze({
  BOOT:               'BOOT',
  IDLE:               'IDLE',
  CAROUSEL:           'CAROUSEL',
  SEQUENCE:           'SEQUENCE',
  JUTSU_SHADOW_CLONE: 'JUTSU_SHADOW_CLONE',
  RASENGAN_ARMED:     'RASENGAN_ARMED',
  JUTSU_RASENGAN:     'JUTSU_RASENGAN',
  CHIDORI_READY:      'CHIDORI_READY',
  JUTSU_CHIDORI:      'JUTSU_CHIDORI',
  FIREBALL_READY:     'FIREBALL_READY',
  JUTSU_FIREBALL:     'JUTSU_FIREBALL',
  RELEASING:          'RELEASING',
});

const JUTSU_MODES = new Set([
  Mode.JUTSU_SHADOW_CLONE, Mode.JUTSU_RASENGAN, Mode.JUTSU_CHIDORI, Mode.JUTSU_FIREBALL,
]);
const READY_MODES = new Set([
  Mode.RASENGAN_ARMED, Mode.CHIDORI_READY, Mode.FIREBALL_READY,
]);

export default class AppState {
  constructor() {
    this._mode    = Mode.BOOT;
    this._seqName = null;   // sequence name while in SEQUENCE mode
    this._armedAt = 0;      // timestamp when RASENGAN_ARMED entered (4s expiry)
    this._readyAt = 0;      // timestamp when a *_READY state entered (10s expiry)
  }

  get mode()     { return this._mode; }
  get seqName()  { return this._seqName; }
  is(mode)       { return this._mode === mode; }

  // ─── Guard predicates (queried by app.js at each call site) ──────────────────

  /** Carousel may open only from IDLE (or already open → re-trigger). B6: never mid-sequence/jutsu. */
  canOpenCarousel() { return this._mode === Mode.IDLE || this._mode === Mode.CAROUSEL; }

  /** Seal signs feed the engine only in IDLE or SEQUENCE. Frozen in CAROUSEL; ignored in READY/JUTSU. */
  canRunEngine() { return this._mode === Mode.IDLE || this._mode === Mode.SEQUENCE; }

  isCarouselOpen() { return this._mode === Mode.CAROUSEL; }
  isJutsuActive()  { return JUTSU_MODES.has(this._mode); }
  isReady()        { return READY_MODES.has(this._mode); }

  // ─── Transitions (called by app.js in response to engine / carousel events) ──

  boot() { if (this._mode === Mode.BOOT) this._mode = Mode.IDLE; }

  /** Open carousel from IDLE, or re-trigger while already open. Returns true if now open. */
  openCarousel() {
    if (this.canOpenCarousel()) { this._mode = Mode.CAROUSEL; this._seqName = null; return true; }
    return false;
  }

  /** Close carousel → IDLE. No-op if not in CAROUSEL. */
  closeCarousel() { if (this._mode === Mode.CAROUSEL) this._mode = Mode.IDLE; }

  /** Enter/refresh SEQUENCE mode (a seal sequence is in progress). Only from IDLE/SEQUENCE. */
  enterSequence(name) {
    if (this._mode === Mode.IDLE || this._mode === Mode.SEQUENCE) {
      this._mode = Mode.SEQUENCE; this._seqName = name;
    }
  }

  /** Leave SEQUENCE back to IDLE (buffer cleared/timed out). */
  exitSequence() { if (this._mode === Mode.SEQUENCE) { this._mode = Mode.IDLE; this._seqName = null; } }

  /** Shadow Clone confirmed. Allowed from IDLE (or SEQUENCE that resolved to it). */
  activateShadowClone() {
    if (this._mode === Mode.IDLE || this._mode === Mode.SEQUENCE) {
      this._mode = Mode.JUTSU_SHADOW_CLONE; this._seqName = null;
    }
  }

  /** Arm Rasengan from IDLE (left release-sign held, naruto). Records arm time. */
  armRasengan() {
    if (this._mode === Mode.IDLE) { this._mode = Mode.RASENGAN_ARMED; this._armedAt = performance.now(); }
  }

  /** @returns {number} ms since ARMED (for the 4s expiry check), or 0 if not armed. */
  armedElapsed() { return this._mode === Mode.RASENGAN_ARMED ? performance.now() - (this._armedAt ?? 0) : 0; }

  /** ARMED + right open palm → active Rasengan. */
  activateRasengan() {
    if (this._mode === Mode.RASENGAN_ARMED) this._mode = Mode.JUTSU_RASENGAN;
  }

  /** ARMED expired without activation → back to IDLE. */
  disarm() {
    if (this._mode === Mode.RASENGAN_ARMED) { this._mode = Mode.IDLE; this._seqName = null; }
  }

  /** Chidori sequence completed → READY (from IDLE or the in-progress SEQUENCE). */
  chidoriReady() {
    if (this._mode === Mode.IDLE || this._mode === Mode.SEQUENCE) {
      this._mode = Mode.CHIDORI_READY; this._seqName = null; this._readyAt = performance.now();
    }
  }

  /** @returns {number} ms since a READY state was entered (for the 10s expiry). */
  readyElapsed() { return this.isReady() ? performance.now() - (this._readyAt ?? 0) : 0; }

  /** CHIDORI_READY + right open palm → active Chidori. */
  activateChidori() {
    if (this._mode === Mode.CHIDORI_READY) this._mode = Mode.JUTSU_CHIDORI;
  }

  /** Fireball sequence completed → READY (from IDLE or the in-progress SEQUENCE). S17. */
  fireballReady() {
    if (this._mode === Mode.IDLE || this._mode === Mode.SEQUENCE) {
      this._mode = Mode.FIREBALL_READY; this._seqName = null; this._readyAt = performance.now();
    }
  }

  /** FIREBALL_READY + mouth open → active Fireball. */
  activateFireball() {
    if (this._mode === Mode.FIREBALL_READY) this._mode = Mode.JUTSU_FIREBALL;
  }

  /** READY expired without activation → back to IDLE. */
  expireReady() {
    if (this.isReady()) { this._mode = Mode.IDLE; this._seqName = null; }
  }

  /** Begin release animation of the active jutsu. */
  beginRelease() { if (this.isJutsuActive()) this._mode = Mode.RELEASING; }

  /** Release animation finished (or hard reset) → IDLE. */
  toIdle() { this._mode = Mode.IDLE; this._seqName = null; }

  /**
   * Force a specific mode. Escape hatch for transitions not yet formally wired
   * (S15–S17 jutsu placeholders). Prefer the named transitions above where they exist.
   */
  toMode(mode) { if (Object.values(Mode).includes(mode)) { this._mode = mode; this._seqName = null; } }
}
