// anim.js — frame-rate independence for animations authored "per frame at 30 fps".
// Effect tunables (orb growth per frame, tomoe spin per frame, particle decay …) were tuned
// at ~30 fps. Multiplying each step by k = dt / 33.3 ms keeps the same speed at 15 or 60 fps.

export const REF_FRAME_MS = 1000 / 30;

/**
 * Step multiplier for an elapsed time. A long gap (tab hidden, stall) is clamped so an
 * animation never jumps, and the first frame (no previous time) counts as one step.
 * @param {number} dtMs  ms since the previous step (≤0 or NaN → 1)
 */
export function frameK(dtMs, maxK = 3) {
  if (!(dtMs > 0)) return 1;
  return Math.min(maxK, dtMs / REF_FRAME_MS);
}

/** Per-frame lerp factor `alpha` (tuned at 30 fps) converted for a step of k frames. */
export function lerpK(alpha, k) {
  return 1 - Math.pow(1 - alpha, k);
}
