// sign-refinement.js — Geometric post-processor for signs {2,4,5,7}
// Fires only when MLP confidence < CONF_PASSTHROUGH to preserve high-confidence predictions.
//
// Decision tree (order is critical):
//   1. Serpent (5): all 4-finger avg tip-y > avg mcp-y on both hands + left pinky NOT deeply curled
//   2. Dragon  (4): left pinky deeply curled (L[20].y > L[17].y + DRAGON_PINKY_DEEP)
//   3. Tiger   (2): index symmetric (|L[8].y - R[8].y| < TIGER_SYM_THRESHOLD) + both indexes extended
//   4. Ram     (7): left hand physically higher (L[8].y - R[8].y < -RAM_ASYM_THRESHOLD)
//
// Data basis: 20 samples (5 per sign) collected via /landmark-collector/ on 2026-04-18.
// Key insight: l_pinky height_above_mcp uniquely separates Dragon (-0.155) from all others (> -0.05).
// Ram fix: direction was inverted. Left hand higher → L[8].y < R[8].y → L[8].y - R[8].y is NEGATIVE.

// ─── Tunable thresholds (centralized in config.js — REFINE) ────────────────────────────────────────
import { REFINE } from './config.js';
import { log } from './log.js';
const CONF_PASSTHROUGH    = REFINE.CONF_PASSTHROUGH;
const TIGER_SYM_THRESHOLD = REFINE.TIGER_SYM_THRESHOLD;
const RAM_ASYM_THRESHOLD  = REFINE.RAM_ASYM_THRESHOLD;
const DRAGON_PINKY_DEEP   = REFINE.DRAGON_PINKY_DEEP;
const SERPENT_PINKY_MAX   = REFINE.SERPENT_PINKY_MAX;
const TIGER_EXTEND_MIN    = REFINE.TIGER_EXTEND_MIN;
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const CONFUSED  = new Set([2, 4, 5, 7]);
const TIP_IDX   = [8, 12, 16, 20];   // index, middle, ring, pinky fingertips
const MCP_IDX   = [5,  9, 13, 17];   // corresponding MCP knuckles

export default class SignRefinement {
  /**
   * Geometric gate for confused classes {2,4,5,7}.
   * All other classIds, or predictions with confidence ≥ CONF_PASSTHROUGH, pass through unchanged.
   *
   * @param {number} classId          MLP-predicted class (0–13)
   * @param {number} confidence       MLP confidence (0–1)
   * @param {Array<{x,y,z}>|null} rightLmks  21 MediaPipe right-hand landmarks
   * @param {Array<{x,y,z}>|null} leftLmks   21 MediaPipe left-hand landmarks
   * @returns {{ classId: number, confidence: number }}
   */
  refine(classId, confidence, rightLmks, leftLmks) {
    if (!CONFUSED.has(classId))         return { classId, confidence };
    if (confidence >= CONF_PASSTHROUGH) return { classId, confidence };
    if (!rightLmks || !leftLmks || rightLmks.length < 21 || leftLmks.length < 21) return { classId, confidence };

    const refined = _geometricClassify(classId, rightLmks, leftLmks);
    if (refined !== classId) {
      // B13: was an unthrottled per-frame console.log → throttle to 1/sec.
      log.throttled('refine', 1000, `${classId}→${refined} (mlp_conf=${confidence.toFixed(2)})`);
    }
    return { classId: refined, confidence };
  }
}

// ─── Internal geometric classifier ───────────────────────────────────────────────────────────────

function _geometricClassify(originalClass, R, L) {
  // Priority 1: Serpent — all 4 fingers pointing DOWN on both hands, left pinky not deeply curled
  if (_isSerpentDir(R) && _isSerpentDir(L) && _hasSerpentPinky(L)) return 5;

  // Priority 2: Dragon — left pinky deeply curled below MCP (unique Dragon signature, zero overlap)
  if (_isDragonPinky(L)) return 4;

  // Priority 3: Tiger — index fingers at symmetric height + right index clearly extended upward
  const indexDiff = L[8].y - R[8].y;   // positive = left lower (right higher); negative = left higher
  if (Math.abs(indexDiff) < TIGER_SYM_THRESHOLD && R[8].y < R[5].y - TIGER_EXTEND_MIN) return 2;

  // Priority 4: Ram — left hand physically higher than right (FIXED: was > +0.07, correct is < -0.07)
  if (indexDiff < -RAM_ASYM_THRESHOLD) return 7;

  return originalClass;  // boundary case — trust MLP
}

function _isSerpentDir(lmks) {
  // Serpent: fingers interlaced pointing DOWN → avg fingertip y > avg MCP y (y↓ = down)
  const avgTipY = _avg(TIP_IDX.map(i => lmks[i].y));
  const avgMcpY = _avg(MCP_IDX.map(i => lmks[i].y));
  return avgTipY > avgMcpY;
}

function _hasSerpentPinky(L) {
  // Serpent left pinky is NOT deeply curled (height_above_mcp = +0.011 to +0.023 → tip near/above MCP).
  // Dragon left pinky IS deeply curled (height = -0.155 → L[20].y = L[17].y + 0.155 > threshold).
  // Converts: height_above_mcp = L[17].y - L[20].y > -SERPENT_PINKY_MAX
  //         = L[20].y < L[17].y + SERPENT_PINKY_MAX
  return L[20].y < L[17].y + SERPENT_PINKY_MAX;
}

function _isDragonPinky(L) {
  // Dragon left pinky deeply below MCP: height_above_mcp = -0.149 to -0.160
  // → L[20].y = L[17].y + 0.149..0.160 > DRAGON_PINKY_DEEP (0.10)
  // All others: max curl = -0.051 → L[20].y < L[17].y + 0.06 < 0.10
  return L[20].y > L[17].y + DRAGON_PINKY_DEEP;
}

function _avg(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
