// dataset.js — pure training-data helpers for the trainer (no DOM, no tf; unit-tested in
// app/tests/test-trainer-dataset.html).
//
// Why a hold-out split instead of a random one: consecutive webcam frames (33 ms apart) are
// near-identical. A random split puts frame t in train and t+1 in validation, so the
// "accuracy" only measures memorisation of one take. Samples are stored per sign in
// recording order, so holding out the LAST part of each sign's recordings keeps the
// validation frames away from the training frames (one boundary aside). Augmented copies
// are made from TRAIN rows only, never before the split.

export const NUM_CLASSES = 14;
export const VEC_LEN = 126;   // 2 hands × 21 landmarks × xyz

/**
 * @param {Record<string|number, number[][]>} samplesByClass  classId → vectors in recording order
 * @param {number} frac  fraction of each class held out (taken from the end)
 * @returns {{train: {x:number[], y:number}[], val: {x:number[], y:number}[]}}
 */
export function splitHoldout(samplesByClass, frac = 0.15) {
  const train = [], val = [];
  for (let c = 0; c < NUM_CLASSES; c++) {
    const arr = samplesByClass[c] ?? [];
    const nVal = arr.length >= 2 ? Math.max(1, Math.round(arr.length * frac)) : 0;
    const cut = arr.length - nVal;
    arr.forEach((x, i) => (i < cut ? train : val).push({ x, y: c }));
  }
  return { train, val };
}

/**
 * Add `copies` jittered copies of every row (uniform ±jitter per coordinate).
 * @param {{x:number[], y:number}[]} rows
 * @param {() => number} rng  Math.random-compatible (injectable for tests)
 */
export function augment(rows, copies = 3, jitter = 0.02, rng = Math.random) {
  const out = [];
  for (const r of rows) {
    out.push(r);
    for (let k = 0; k < copies; k++) {
      out.push({ x: r.x.map(v => v + (rng() * 2 - 1) * jitter), y: r.y });
    }
  }
  return out;
}

/**
 * Validate an imported samples file ({ "0": [[126 numbers], …], …, "13": […] }).
 * Bad vectors are dropped and counted, unknown class keys are reported, nothing throws.
 * @returns {{ok:boolean, cleaned:Record<number, number[][]>, added:number, dropped:number, errors:string[]}}
 */
export function validateImport(obj) {
  const errors = [];
  const cleaned = {};
  let added = 0, dropped = 0;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, cleaned, added, dropped, errors: ['File is not a samples object ({"0": [...], …})'] };
  }
  for (const [key, arr] of Object.entries(obj)) {
    const c = Number(key);
    if (!Number.isInteger(c) || c < 0 || c >= NUM_CLASSES) { errors.push(`unknown class "${key}"`); continue; }
    if (!Array.isArray(arr)) { errors.push(`class ${c} is not a list`); continue; }
    cleaned[c] = [];
    for (const v of arr) {
      if (Array.isArray(v) && v.length === VEC_LEN && v.every(Number.isFinite)) { cleaned[c].push(v); added++; }
      else dropped++;
    }
  }
  if (!added) errors.push('no valid 126-value samples found');
  return { ok: added > 0, cleaned, added, dropped, errors };
}
