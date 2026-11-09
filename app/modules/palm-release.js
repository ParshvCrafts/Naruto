// palm-release.js — decides when a hand-anchored jutsu (Rasengan, Chidori) should release.
//
// Two different signals end the jutsu:
//   - the user CLOSES the palm: a present hand that is not open for PALM_CLOSE_FRAMES frames;
//   - the hand is GONE: tracking lost for LOST_FRAMES frames (arm dropped, walked away).
// MediaPipe drops hands for a few frames during fast motion. Those dropout frames must not
// count as "closed", otherwise a jutsu dies ~270ms into a dropout. Pure logic, no DOM.

export default class PalmReleaseTracker {
  /** @param {{PALM_CLOSE_FRAMES:number, LOST_FRAMES:number}} cfg */
  constructor(cfg) {
    this._cfg = cfg;
    this.reset();
  }

  reset() { this._closed = 0; this._lost = 0; }

  /**
   * Advance one frame.
   * @param {boolean} present  right hand tracked this frame (or keyboard sim in use)
   * @param {boolean} open     right palm open this frame
   * @returns {boolean} true on the frame the jutsu should release (tracker then resets)
   */
  step(present, open) {
    if (open) { this.reset(); return false; }
    if (!present) {
      this._closed = 0;
      if (++this._lost >= this._cfg.LOST_FRAMES) { this.reset(); return true; }
      return false;
    }
    this._lost = 0;
    if (++this._closed >= this._cfg.PALM_CLOSE_FRAMES) { this.reset(); return true; }
    return false;
  }
}
