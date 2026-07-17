// config.js — Single source of truth for all tunable constants.
// Every module imports from here; no local magic numbers (bug B9).
// Frozen at export so nothing mutates config at runtime.

// ─── Chakra colors (hard product rule) ───────────────────────────────────────
// Naruto = orange. Sasuke = LIGHT purple #B388FF (NEVER dark #9C27B0 for effects).
// Purple only for chakra glows/particles/borders — never purple TEXT on dark bg.
export const CHAKRA = Object.freeze({
  naruto: '#ff6b00',
  sasuke: '#B388FF',
});

// Fallback chakra when no character confirmed (picker default).
export const CHAKRA_DEFAULT = '#00BFFF';

// ─── Jutsu engine ─────────────────────────────────────────────────────────────
export const ENGINE = Object.freeze({
  WINDOW_SIZE:        45,     // sliding confirmation window (frames)
  CONFIRM_THRESHOLD:  0.70,   // fraction of window that must agree to confirm a sign
  CONF_MIN:           0.90,   // minimum per-frame confidence to accept a prediction
  SEQ_TIMEOUT_MS:     5000,   // ms before an incomplete sequence resets
  SEQ_COOLDOWN_MS:    1200,   // anti-cross-seed: no NEW sequence may start within this of a reset
  AUTO_RESET_MS:      8000,   // non-shadowClone jutsu auto-reset safety net
  SHADOW_CLONE_CLASS: 12,
  NONE_CLASS:         13,
  RELEASE_CLASS:      14,     // pseudo-class, forced in app.js — never a model output
});

// Seal sequences (classId lists). Sasuke jutsus.
export const SEQUENCES = Object.freeze({
  fireball: Object.freeze([5, 7, 8, 11, 6, 2]),  // Serpent→Ram→Monkey→Boar→Horse→Tiger
  chidori:  Object.freeze([1, 3, 8]),            // Ox→Hare→Monkey
});

// ─── Sign refinement (geometric disambiguation, {2,4,5,7}) ────────────────────
export const REFINE = Object.freeze({
  CONF_PASSTHROUGH:    0.97,  // skip gate above this confidence (trust MLP)
  TIGER_SYM_THRESHOLD: 0.025, // |L[8].y - R[8].y| < this → Tiger
  RAM_ASYM_THRESHOLD:  0.07,  // L[8].y - R[8].y < -this → Ram
  DRAGON_PINKY_DEEP:   0.10,  // L[20].y > L[17].y + this → Dragon
  SERPENT_PINKY_MAX:   0.05,  // L[20].y < L[17].y + this → Serpent pinky guard
  TIGER_EXTEND_MIN:    0.12,  // R[8].y must be this far above R[5].y to confirm Tiger
});

// ─── Character carousel ────────────────────────────────────────────────────────
export const CAROUSEL = Object.freeze({
  SLIDE_IN_MS:        400,
  SLIDE_OUT_MS:       350,
  CONFIRM_MS:         600,   // palm-hold-still to lock character
  GESTURE_DELAY_MS:   500,   // after open before scroll/confirm fire
  REOPEN_COOLDOWN:    1200,
  LERP_FACTOR:        0.28,  // visual settle toward target page
  SCROLL_SENSITIVITY: 5.0,   // (legacy twofinger continuous mapping)
  CARD_W:             160,
  CARD_H:             284,   // 9:16 of 160
  INACTIVE_SCALE:     0.65,
  CARD_GAP:           50,
  // ── S14 open-debounce + paging ─────────────────────────────────────────────
  OPEN_FRAMES:        4,      // consecutive dual-fist frames required to open (kills flicker re-trigger)
  RETRIGGER_LOCK_MS:  800,    // ignore re-open/restart for this long after opening
  SCROLL_MODE:        'fist', // 'fist' (fist-move swipe, open-palm select — distinct gestures) | 'palm' (open-palm does both) | 'twofinger' (legacy delta)
  EMA_ALPHA:          0.35,   // smoothing on hand x
  PAGE_DX:            0.08,   // smoothed-x displacement from anchor to page ±1
  PAGE_COOLDOWN_MS:   300,    // min gap between pages
  STILL_EPS:          0.006,  // per-frame movement below this = "holding still" (confirm accrues)
});

// ─── Gesture classifier (raw-landmark geometry margins) ───────────────────────
export const GESTURE = Object.freeze({
  CURL_MARGIN:     0.03,  // tip below MCP by this → curled
  EXTEND_MARGIN:   0.03,  // tip above MCP by this → extended
  THUMB_UP_MARGIN: 0.06,  // thumb tip above thumb MCP by this → thumb up
});

// ─── Mouth-open detection (Fireball breath trigger, S17) ──────────────────────
// MAR = dist(faceLandmark 13,14) / dist(faceLandmark 78,308) (inner-lip gap / mouth width).
// Hysteresis prevents talking/flicker from firing: open must exceed OPEN_MAR, close
// must drop below CLOSE_MAR. Frame holds debounce further.
export const MOUTH = Object.freeze({
  OPEN_MAR:          0.40,  // MAR above this = mouth open
  CLOSE_MAR:         0.25,  // MAR below this = mouth closed (gap = hysteresis band)
  OPEN_FRAMES:       5,     // consecutive open frames in FIREBALL_READY → activate (~167ms)
  CLOSE_FRAMES:      15,    // consecutive closed frames while active → release (~500ms)
  MAX_MS:            6000,  // hard cap on a single breath (safety auto-release)
  READY_TIMEOUT_MS:  10000, // FIREBALL_READY expires to IDLE if the mouth never opens
});

// ─── Release sign detector ─────────────────────────────────────────────────────
export const RELEASE = Object.freeze({
  EXTEND_MARGIN:  0.05,  // index+middle above MCP
  CURL_MARGIN:    0.02,  // ring+pinky below MCP
  HOLD_THRESHOLD: 10,    // consecutive frames of sign to release shadow clone (~333ms @30fps)
  // B5: Release is a one-handed pose. If the RIGHT hand is present AND its wrist is
  // within this normalized distance of the LEFT wrist, the hands are "joined" — that's
  // a forming two-handed seal (Tiger/Ram), NOT Release. 20-sample data: Tiger inter-wrist
  // mean ≈ 0.155, so 0.12 stays below the joined cluster while release (one-handed) is
  // unaffected (right hand usually absent). Re-tune against landmarks_v2.json (S13 data).
  MAX_WRIST_JOIN: 0.12,
});

// ─── Rasengan (Naruto) ────────────────────────────────────────────────────────
// Generic VideoFX tunables live here too (Chidori reuses the class in S16).
export const RASENGAN = Object.freeze({
  ARM_HOLD_FRAMES:  15,    // left release-sign frames held to ARM (IDLE + naruto)
  ARMED_TIMEOUT_MS: 4000,  // ARMED expires to IDLE without a right open palm
  PALM_OPEN_FRAMES: 5,     // consecutive right-open-palm frames to activate (hysteresis)
  PALM_CLOSE_FRAMES: 8,    // consecutive right-closed frames to release
  LOST_FRAMES:      45,    // right hand tracking lost this long while active → auto-release
  LOOP_POINT:       3.4,   // s — 0–3.4 spin-up intro, then seamless 3.4→end loop
  BASE_FRAC:        0.55,  // orb size = BASE_FRAC * canvas.height * scale
  SCALE_START:      0.8,
  SCALE_MAX:        2.5,
  SCALE_RAMP:       0.015, // per-frame growth
  ANCHOR_EMA:       0.4,   // smoothing on the hand anchor (removes jitter)
  RELEASE_MS:       500,   // shrink+fade duration on release
});

// ─── Chidori (Sasuke) ─────────────────────────────────────────────────────────
// Sequence-gated (Ox→Hare→Monkey → READY → right palm). Reuses the VideoFX class.
export const CHIDORI = Object.freeze({
  READY_TIMEOUT_MS: 10000, // READY expires to IDLE if no right palm
  PALM_OPEN_FRAMES: 5,
  PALM_CLOSE_FRAMES: 8,
  LOOP_POINT:       0,     // whole clip loops
  BASE_FRAC:        0.60,
  SCALE_START:      0.8,
  SCALE_MAX:        2.5,
  SCALE_RAMP:       0.015,
  ANCHOR_EMA:       0.4,
  RELEASE_MS:       400,
  ARC_COUNT:        3,     // procedural lightning arcs from the palm
  ARC_REGEN_FRAMES: 3,     // regenerate arc geometry every N frames
});

// ─── Fireball VideoFX (Sasuke, S17) ───────────────────────────────────────────
// Directional flame breathed from the mouth. Unlike the round orbs, the sprite is
// anchored by its origin edge at the mouth and extends horizontally outward.
export const FIREBALL = Object.freeze({
  LOOP_POINT:   0,     // whole clip loops while the mouth stays open
  BASE_FRAC:    1.15,  // flame WIDTH = BASE_FRAC * canvas.height * scale (wide jet)
  SCALE_START:  0.45,
  SCALE_MAX:    1.6,
  SCALE_RAMP:   0.045, // fast scale-in (~300ms to full)
  ANCHOR_EMA:   0.4,   // smoothing on the mouth anchor
  RELEASE_MS:   400,   // fade-out on mouth close / cap
  BURST_MS:     420,   // ignition front-burst full-frame flash duration
  BURST_ALPHA:  0.35,  // peak alpha of the ignition flash
});

// ─── Sharingan procedural eyes (Sasuke, S18) ─────────────────────────────────
// Drawn on eye-contour landmarks (Holistic has no iris refinement by default), so
// the iris center/size is approximated from the eye corners + lids. Flag-gated:
// flip ENABLED false if it ever looks uncanny (user-mandated quality gate).
export const SHARINGAN = Object.freeze({
  ENABLED:     true,
  IRIS_FRAC:   0.58,   // iris radius = IRIS_FRAC * half eye-width
  ALPHA:       0.92,
  SPIN:        0.035,  // tomoe rotation rad/frame
  BLINK_RATIO: 0.14,   // eye-open (height/width) below this = blinking → skip that eye
  EMA:         0.5,    // center smoothing
  IRIS_COLOR:  '#C1121C', // sharingan red
  RING_COLOR:  '#6d0d0d', // dark outer ring
  SCALE_IN_MS: 300,    // grow-in when Sasuke is confirmed
});

// ─── Camera ─────────────────────────────────────────────────────────────────────
// PREF picks the requested capture resolution. Drop to '720' if 1080p can't hold
// FPS ≥ 20 on the target machine (HUD FPS counter is the gauge). Backing-store
// scaling is resolution-independent (S = canvas.height/720), so either is safe.
export const CAMERA = Object.freeze({
  PREF:   '1080',   // '1080' | '720'
  WIDTH:  1280,     // 720p fallback
  HEIGHT: 720,
  HD_WIDTH:  1920,  // 1080p preferred
  HD_HEIGHT: 1080,
});

/** Requested capture dimensions per CAMERA.PREF. */
export function cameraDims() {
  return CAMERA.PREF === '720'
    ? { width: CAMERA.WIDTH,    height: CAMERA.HEIGHT }
    : { width: CAMERA.HD_WIDTH, height: CAMERA.HD_HEIGHT };
}

// ─── HUD reference metrics (px, at 720p; scale by S = canvas.height/720 in S12) ─
export const HUD = Object.freeze({
  REF_HEIGHT: 720,          // reference height the raw px metrics were authored against
  SIGN_HYSTERESIS_FRAMES: 3, // displayed sign changes only after N consecutive new-class frames
});

// Frozen aggregate for convenient default import.
const config = Object.freeze({
  CHAKRA, CHAKRA_DEFAULT, ENGINE, SEQUENCES, REFINE, CAROUSEL, GESTURE, RELEASE, CAMERA, HUD,
});
export default config;
