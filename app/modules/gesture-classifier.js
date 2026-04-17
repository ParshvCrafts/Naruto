// gesture-classifier.js — Rule-based fist / open-palm detection from raw MediaPipe landmarks.
// Completely independent of the TF.js MLP — pure landmark geometry, runs every frame.
// Used to trigger character selection carousel (dual fist) and navigate it (left fist / open palm).

// How far (normalized 0–1 units) a fingertip must be BELOW its MCP to count as curled.
const CURL_MARGIN   = 0.03;   // tip.y > mcp.y + margin → finger curled (in image space, y↓)

// How far a fingertip must be ABOVE its MCP to count as extended (open palm).
const EXTEND_MARGIN = 0.03;   // tip.y < mcp.y - margin → finger extended

// MediaPipe hand model landmark indices (same for left and right hands)
const TIP_IDX = [8, 12, 16, 20];  // index, middle, ring, pinky fingertips
const MCP_IDX = [5,  9, 13, 17];  // corresponding MCP (knuckle) joints

export default class GestureClassifier {
  /**
   * Classify gesture state from both hand landmark arrays each frame.
   *
   * @param {Array<{x,y,z}>|null} rightLmks  21 MediaPipe right-hand landmarks, or null if absent
   * @param {Array<{x,y,z}>|null} leftLmks   21 MediaPipe left-hand landmarks, or null if absent
   * @returns {{
   *   isDualFist:     boolean,   both hands closed fist
   *   isLeftFist:     boolean,   left hand closed fist
   *   isLeftOpenPalm: boolean,   left hand fully open (all 4 fingers extended)
   *   leftHandX:      number     left wrist x (normalized 0→1), 0.5 if absent
   * }}
   */
  detect(rightLmks, leftLmks) {
    const rightFist = rightLmks && rightLmks.length >= 21 ? _isFist(rightLmks) : false;
    const leftFist  = leftLmks  && leftLmks.length  >= 21 ? _isFist(leftLmks)  : false;
    const leftOpen  = leftLmks  && leftLmks.length  >= 21 ? _isOpenPalm(leftLmks) : false;
    const leftX     = leftLmks  && leftLmks.length  >= 21 ? leftLmks[0].x : 0.5;

    return {
      isDualFist:     rightFist && leftFist,
      isLeftFist:     leftFist,
      isLeftOpenPalm: leftOpen,
      leftHandX:      leftX,
    };
  }
}

// ─── Helpers (module-private) ─────────────────────────────────────────────────────

function _isFist(lmks) {
  // All 4 fingers (index → pinky) must be curled: tip.y > mcp.y + CURL_MARGIN
  return TIP_IDX.every((tipIdx, i) => lmks[tipIdx].y > lmks[MCP_IDX[i]].y + CURL_MARGIN);
}

function _isOpenPalm(lmks) {
  // All 4 fingers must be extended: tip.y < mcp.y - EXTEND_MARGIN
  return TIP_IDX.every((tipIdx, i) => lmks[tipIdx].y < lmks[MCP_IDX[i]].y - EXTEND_MARGIN);
}
