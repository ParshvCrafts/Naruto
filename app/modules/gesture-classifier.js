// gesture-classifier.js — Rule-based fist / open-palm detection from raw MediaPipe landmarks.
// Completely independent of the TF.js MLP — pure landmark geometry, runs every frame.
// Used to trigger character selection carousel (dual fist) and navigate it (two fingers / open palm).

// Geometry margins centralized in config.js — GESTURE.
import { GESTURE } from './config.js';
const CURL_MARGIN     = GESTURE.CURL_MARGIN;     // tip.y > mcp.y + margin → finger curled (y↓)
const EXTEND_MARGIN   = GESTURE.EXTEND_MARGIN;   // tip.y < mcp.y - margin → finger extended
const THUMB_UP_MARGIN = GESTURE.THUMB_UP_MARGIN; // thumb tip (4) above thumb MCP (2) → thumb up

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
   *   isDualFist:        boolean,   both hands closed fist
   *   isLeftFist:        boolean,   left hand closed fist
   *   isLeftTwoFingers:  boolean,   left index+middle extended, ring+pinky curled (scroll gesture)
   *   isLeftOpenPalm:    boolean,   left hand fully open (all 4 fingers extended)
   *   isRightThumbUp:    boolean,   right hand thumb up with other fingers curled
   *   isLeftThumbUp:     boolean,   left hand thumb up with other fingers curled
   *   leftHandX:         number     left wrist x (normalized 0→1), 0.5 if absent
   *   leftHandY:         number     left wrist y (normalized 0→1, y↓), 0.5 if absent
   *   rightHandY:        number     right wrist y (normalized 0→1, y↓), 0.5 if absent
   * }}
   */
  detect(rightLmks, leftLmks) {
    const rightFist       = rightLmks && rightLmks.length >= 21 ? _isFist(rightLmks)         : false;
    const leftFist        = leftLmks  && leftLmks.length  >= 21 ? _isFist(leftLmks)          : false;
    const leftTwoFingers  = leftLmks  && leftLmks.length  >= 21 ? _isTwoFingers(leftLmks)    : false;
    const leftIndexPoint  = leftLmks  && leftLmks.length  >= 21 ? _isIndexPoint(leftLmks)    : false;
    const leftOpen        = leftLmks  && leftLmks.length  >= 21 ? _isOpenPalm(leftLmks)      : false;
    const rightThumbUp    = rightLmks && rightLmks.length >= 21 ? _isThumbUp(rightLmks)      : false;
    const leftThumbUp     = leftLmks  && leftLmks.length  >= 21 ? _isThumbUp(leftLmks)       : false;
    // Right open/closed palm via ar-engine distance test (orientation-robust) — used by
    // Rasengan/Chidori activation. Open = ≥3 fingertips farther from wrist than their PIP.
    const rightExtCount   = rightLmks && rightLmks.length >= 21 ? _openCountDist(rightLmks)  : 0;
    const rightPresent    = !!(rightLmks && rightLmks.length >= 21);
    const leftX           = leftLmks  && leftLmks.length  >= 21 ? leftLmks[0].x              : 0.5;
    const leftY           = leftLmks  && leftLmks.length  >= 21 ? leftLmks[0].y              : 0.5;
    const rightY          = rightLmks && rightLmks.length >= 21 ? rightLmks[0].y             : 0.5;

    return {
      isDualFist:       rightFist && leftFist,
      isLeftFist:       leftFist,
      isLeftTwoFingers: leftTwoFingers,
      isLeftIndexPoint: leftIndexPoint,   // index extended, other 3 fingers curled (carousel swipe)
      isLeftOpenPalm:   leftOpen,
      isRightThumbUp:   rightThumbUp,
      isLeftThumbUp:    leftThumbUp,
      // Right palm state for jutsu activation (Rasengan/Chidori):
      isRightOpenPalm:   rightExtCount >= 3,   // ≥3 fingers extended (distance test)
      isRightClosedPalm: rightPresent && rightExtCount < 2,  // present + curled
      rightHandPresent:  rightPresent,
      leftHandX:        leftX,
      leftHandY:        leftY,
      rightHandY:       rightY,
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

function _isIndexPoint(lmks) {
  // Index (8) extended above its MCP; middle/ring/pinky curled below theirs.
  const indexUp   = lmks[8].y  < lmks[5].y  - EXTEND_MARGIN;
  const middleDn  = lmks[12].y > lmks[9].y  + CURL_MARGIN;
  const ringDn    = lmks[16].y > lmks[13].y + CURL_MARGIN;
  const pinkyDn   = lmks[20].y > lmks[17].y + CURL_MARGIN;
  return indexUp && middleDn && ringDn && pinkyDn;
}

function _isTwoFingers(lmks) {
  // Index (8) and middle (12) must be extended: tips above their MCPs
  const indexUp  = lmks[8].y  < lmks[5].y  - EXTEND_MARGIN;
  const middleUp = lmks[12].y < lmks[9].y  - EXTEND_MARGIN;
  // Ring (16) and pinky (20) must be curled: tips below their MCPs
  const ringDown  = lmks[16].y > lmks[13].y + CURL_MARGIN;
  const pinkyDown = lmks[20].y > lmks[17].y + CURL_MARGIN;
  return indexUp && middleUp && ringDown && pinkyDown;
}

// ar-engine checkOpen: a fingertip is "extended" if it is farther from the wrist(0)
// than its PIP joint (Euclidean). Orientation-robust (works with a rotated hand),
// unlike the y-only tests above. Thumb ignored. @returns count of extended fingers 0..4.
function _openCountDist(lmks) {
  const TIPS = [8, 12, 16, 20], PIPS = [6, 10, 14, 18];
  const w = lmks[0];
  let count = 0;
  for (let i = 0; i < 4; i++) {
    const tip = lmks[TIPS[i]], pip = lmks[PIPS[i]];
    const dTip = Math.hypot(tip.x - w.x, tip.y - w.y);
    const dPip = Math.hypot(pip.x - w.x, pip.y - w.y);
    if (dTip > dPip) count++;
  }
  return count;
}

function _isThumbUp(lmks) {
  // Thumb tip (4) must be well above thumb MCP (2) — indicates thumb pointing up
  const thumbExtended = lmks[4].y < lmks[2].y - THUMB_UP_MARGIN;
  // All 4 fingers (index→pinky) must be curled — rest of hand is a fist
  const fingersCurled = TIP_IDX.every((t, i) => lmks[t].y > lmks[MCP_IDX[i]].y + CURL_MARGIN);
  return thumbExtended && fingersCurled;
}

// ─── Mouth-open (Fireball, S17) ───────────────────────────────────────────────
// MediaPipe FaceMesh indices: 13 = upper inner lip, 14 = lower inner lip,
// 78 / 308 = mouth corners. MAR = vertical lip gap / horizontal mouth width, so it
// is scale-invariant (independent of distance to camera).
const MOUTH_TOP = 13, MOUTH_BOT = 14, MOUTH_L = 78, MOUTH_R = 308;

/**
 * Mouth Aspect Ratio from Holistic faceLandmarks (468-point mesh).
 * @param {Array<{x,y,z}>|null|undefined} face
 * @returns {number} MAR, or -1 when face landmarks are unavailable.
 */
export function mouthAspectRatio(face) {
  if (!face || face.length <= MOUTH_R) return -1;
  const top = face[MOUTH_TOP], bot = face[MOUTH_BOT];
  const l = face[MOUTH_L], r = face[MOUTH_R];
  const gap   = Math.hypot(top.x - bot.x, top.y - bot.y);
  const width = Math.hypot(l.x - r.x, l.y - r.y) || 1e-6;
  return gap / width;
}
