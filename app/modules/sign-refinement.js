// sign-refinement.js — Geometric post-processor for signs {2,4,5,7}
// Fires only when MLP confidence < CONF_PASSTHROUGH to preserve high-confidence predictions.
//
// Discriminants (all in normalized MediaPipe space, y↓ = down in image):
//   Serpent (5): fingertips point DOWN — avg tip y > avg MCP y, both hands
//   Dragon  (4): compact hands — all fingertips within DRAGON_SPAN_MAX of palm center (lmk 9)
//   Tiger   (2): symmetric index height — |L[8].y - R[8].y| < TIGER_SYM_THRESHOLD
//   Ram     (7): asymmetric — L[8].y - R[8].y > RAM_ASYM_THRESHOLD (left index lower)
//
// Decision order: Serpent → Dragon → Tiger → Ram → keep MLP result

// ─── Tunable thresholds (adjust if geometric conditions don't match your hands) ──────
const CONF_PASSTHROUGH     = 0.97;  // skip gate above this confidence (trust MLP)
const TIGER_SYM_THRESHOLD  = 0.04;  // |L[8].y - R[8].y| < this → Tiger (symmetric)
const RAM_ASYM_THRESHOLD   = 0.06;  // L[8].y - R[8].y > this → Ram (left lower)
const DRAGON_SPAN_MAX      = 0.18;  // max fingertip-to-palm-center distance → Dragon
// ─────────────────────────────────────────────────────────────────────────────────────

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
   * @param {Array<{x,y,z}>|null} rightLmks  21 MediaPipe hand landmarks, right hand
   * @param {Array<{x,y,z}>|null} leftLmks   21 MediaPipe hand landmarks, left hand
   * @returns {{ classId: number, confidence: number }}
   */
  refine(classId, confidence, rightLmks, leftLmks) {
    if (!CONFUSED.has(classId))            return { classId, confidence };
    if (confidence >= CONF_PASSTHROUGH)    return { classId, confidence };
    if (!rightLmks || !leftLmks || rightLmks.length < 21 || leftLmks.length < 21) return { classId, confidence };

    const refined = _geometricClassify(classId, rightLmks, leftLmks);
    if (refined !== classId) {
      console.log(`[refinement] ${classId}→${refined} (mlp_conf=${confidence.toFixed(2)})`);
    }
    return { classId: refined, confidence };
  }
}

// ─── Internal geometric classifier ───────────────────────────────────────────────────

function _geometricClassify(originalClass, R, L) {
  // Priority 1: Serpent — fingertips point downward on BOTH hands
  if (_isSerpentDir(R) && _isSerpentDir(L)) return 5;

  // Priority 2: Dragon — compact hands on BOTH hands
  if (_isDragonCompact(R) && _isDragonCompact(L)) return 4;

  // Priority 3: Tiger vs Ram — index fingertip height differential
  const indexDiff = L[8].y - R[8].y;    // positive = left index lower (y↓)
  if (Math.abs(indexDiff) < TIGER_SYM_THRESHOLD) return 2;   // Tiger: symmetric
  if (indexDiff > RAM_ASYM_THRESHOLD)            return 7;   // Ram: left lower

  return originalClass;  // boundary case — trust MLP
}

function _isSerpentDir(lmks) {
  // Serpent: fingers interlaced pointing DOWN → avg fingertip y > avg MCP y
  const avgTipY = _avg(TIP_IDX.map(i => lmks[i].y));
  const avgMcpY = _avg(MCP_IDX.map(i => lmks[i].y));
  return avgTipY > avgMcpY;
}

function _isDragonCompact(lmks) {
  // Dragon: knuckles interlaced, thumbs tucked — fingertips close to palm center (lmk 9)
  const palm = lmks[9];
  const maxDist = Math.max(...TIP_IDX.map(i => {
    const dx = lmks[i].x - palm.x;
    const dy = lmks[i].y - palm.y;
    return Math.sqrt(dx * dx + dy * dy);
  }));
  return maxDist < DRAGON_SPAN_MAX;
}

function _avg(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
