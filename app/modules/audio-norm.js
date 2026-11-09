// audio-norm.js — loudness normalisation for short SFX (pure, unit-tested).
// Each clip is scaled so its RMS loudness of the non-silent part matches TARGET_RMS:
// the clips come from different sources (one was ~4× louder than another), so a single
// volume number per call site can't balance them. Measured once at decode time.

/**
 * @param {Float32Array|number[]} samples  one channel of PCM in [-1, 1]
 * @param {{TARGET_RMS:number, MIN_NORM:number, MAX_NORM:number, SILENCE:number}} cfg
 * @returns {number} gain to apply (clamped to [MIN_NORM, MAX_NORM]; 1 for silence/empty)
 */
export function normGain(samples, cfg) {
  let sum = 0, n = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (Math.abs(v) < cfg.SILENCE) continue;   // ignore leading/trailing silence
    sum += v * v; n++;
  }
  if (!n) return 1;
  const rms = Math.sqrt(sum / n);
  return Math.min(cfg.MAX_NORM, Math.max(cfg.MIN_NORM, cfg.TARGET_RMS / rms));
}
