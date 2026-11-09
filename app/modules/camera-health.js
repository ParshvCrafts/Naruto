// camera-health.js — pure decision helpers for camera robustness (no DOM, unit-tested).
//   FrameWatchdog        — "camera lost": no processed frame for LOST_MS while the tab is visible
//   FpsFallback          — "too slow": fps below MIN_FPS for SUSTAIN_MS → drop 1080p → 720p (once)
//   describeCameraError  — getUserMedia error → message a user can act on

export class FrameWatchdog {
  /** @param {number} lostMs */
  constructor(lostMs) { this._lostMs = lostMs; this._last = 0; }
  /** Call on every processed frame. */
  frame(now) { this._last = now; }
  /** @returns {boolean} true when frames stopped (never before the first frame, never while hidden). */
  isLost(now, hidden) {
    return !hidden && this._last > 0 && now - this._last > this._lostMs;
  }
  /** ms since the last processed frame (0 before the first frame). */
  sinceLastFrame(now) { return this._last > 0 ? now - this._last : 0; }
}

export class FpsFallback {
  /**
   * @param {{MIN_FPS:number, SUSTAIN_MS:number, GRACE_MS:number}} cfg
   * @param {number} startedAt  camera start time (fps is unreliable while models warm up)
   */
  constructor(cfg, startedAt) {
    this._cfg = cfg; this._start = startedAt; this._lowSince = 0; this._fired = false;
  }
  /** @returns {boolean} true exactly once, when fps has stayed low for SUSTAIN_MS. */
  step(now, fps) {
    if (this._fired || !(fps > 0) || now - this._start < this._cfg.GRACE_MS) return false;
    if (fps >= this._cfg.MIN_FPS) { this._lowSince = 0; return false; }
    if (!this._lowSince) this._lowSince = now;
    if (now - this._lowSince >= this._cfg.SUSTAIN_MS) { this._fired = true; return true; }
    return false;
  }
}

/** @returns {{kind:'denied'|'missing'|'busy'|'unknown', title:string, detail:string}} */
export function describeCameraError(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return {
    kind: 'denied', title: 'Camera access is blocked',
    detail: 'Click the camera icon in the address bar, choose "Allow", then press Retry.',
  };
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return {
    kind: 'missing', title: 'No camera found',
    detail: 'Plug in a webcam (or enable it in system settings), then press Retry.',
  };
  if (name === 'NotReadableError' || name === 'AbortError') return {
    kind: 'busy', title: 'Camera is busy',
    detail: 'Another app (Zoom, Teams, OBS…) is using it. Close that app, then press Retry.',
  };
  return {
    kind: 'unknown', title: 'Camera could not start',
    detail: `${err?.message || name || 'Unknown error'}. Press Retry.`,
  };
}
