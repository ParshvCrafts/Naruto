// app.js — Main loop (ES6 module)
// CDN globals: Holistic, SelfieSegmentation, Camera, tf

import Detector      from './modules/detector.js';
import JutsuEngine   from './modules/jutsu-engine.js';
import Effects       from './modules/effects.js';
import HUD           from './modules/hud.js';
import Recorder          from './modules/recorder.js';
import SignRefinement    from './modules/sign-refinement.js';
import GestureClassifier, { mouthAspectRatio } from './modules/gesture-classifier.js';
import CharacterSelect   from './modules/character-select.js';
import { isReleaseSign, SpeechListener } from './modules/release-detector.js';
import { CHAKRA, RELEASE, SEQUENCES, RASENGAN, CHIDORI, MOUTH, PERF, CAMERA, cameraDims } from './modules/config.js';
import { log } from './modules/log.js';
import AppState, { Mode } from './modules/app-state.js';
import DebugInput, { SEAL_KEYMAP } from './modules/debug-input.js';
import PalmReleaseTracker from './modules/palm-release.js';
import StatusOverlay from './modules/status-overlay.js';
import { FrameWatchdog, FpsFallback, describeCameraError } from './modules/camera-health.js';

const video       = document.getElementById('video');
const canvas      = document.getElementById('canvas');
const hudCanvas   = document.getElementById('hud-canvas');
const canvasWrap  = document.querySelector('.canvas-wrap');
const modelStatus = document.getElementById('model-status');
const overlay     = new StatusOverlay(document.getElementById('status-overlay'));

// Match the letterbox wrapper's aspect ratio to the REAL camera aspect (S12/§E),
// so canvas px ↔ CSS px is a pure uniform scale — no object-fit crop or stretch.
let _lastAspect = 0;
function updateAspect(vw, vh) {
  if (!vw || !vh) return;
  const ar = vw / vh;
  if (Math.abs(ar - _lastAspect) < 1e-4) return;
  _lastAspect = ar;
  canvasWrap?.style.setProperty('--ar', String(ar));
}
video.addEventListener('loadedmetadata', () => updateAspect(video.videoWidth, video.videoHeight));

// Bottom-anchored HUD elements (seal panel, hint, fps) must sit above the DOM controls
// bar, which overlays the canvas except in demo mode. Converted CSS px → canvas px.
const controlsEl = document.querySelector('.controls');
function updateHudInset() {
  const cssH = canvas.getBoundingClientRect().height;
  if (!cssH || !canvas.height || !controlsEl) return;
  const barCss = document.body.classList.contains('demo-mode') ? 0 : controlsEl.getBoundingClientRect().height;
  hud.setBottomInset(barCss * canvas.height / cssH);
}
if (window.ResizeObserver) new ResizeObserver(() => updateHudInset()).observe(canvasWrap);

const detector = new Detector();
const engine   = new JutsuEngine();
const fx       = new Effects();
const hud      = new HUD();
const recorder       = new Recorder();
const refinement     = new SignRefinement();
const gc             = new GestureClassifier();
const cs             = new CharacterSelect();
const speechListener = new SpeechListener();
const state          = new AppState();   // central mode gate (B6/B14)
const debug          = new DebugInput(); // keyboard-simulated detector inputs (§G)
let selectedCharacter = null;

// localStorage throws in some locked-down/private browsers; preferences are optional.
const store = {
  get(k)    { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// B1: voice-triggered release is a FUTURE feature, not wired by default. The
// SpeechListener class stays, but only starts when the page URL has ?speech=1.
const SPEECH_ENABLED = (() => {
  try { return new URLSearchParams(window.location.search).get('speech') === '1'; }
  catch { return false; }
})();

async function init() {
  overlay.show({ id: 'loading', title: 'Loading ninja tools…', busy: true,
    detail: 'Downloading hand-tracking models (the first load can take ~10 s).' });

  // The vision libraries come from a CDN (index.html). Offline or blocked → say so.
  const missing = ['tf', 'Holistic', 'SelfieSegmentation', 'Camera'].filter(g => typeof window[g] === 'undefined');
  if (missing.length) {
    log.error('app', `CDN libraries missing: ${missing.join(', ')}`);
    overlay.show({ id: 'libs', tone: 'error', title: 'Could not load the vision libraries',
      detail: 'They download from cdn.jsdelivr.net. Check your internet connection, then Retry.',
      action: 'Retry', onAction: () => location.reload() });
    return;
  }

  // Load trained model. Without it seal jutsu can't fire, but gestures still work.
  let modelMissing = false;
  try {
    await detector.load('../models/gesture-model.json');
    modelStatus.textContent = 'Model loaded ✓';
  } catch (e) {
    modelMissing = true;
    modelStatus.textContent = 'No seal model — run the trainer';
    log.warn('app', `model not loaded: ${e?.message ?? e}`);
  }

  // Preload smoke images + sounds + video sprites. A failed asset degrades one effect;
  // it must never stop the app from booting.
  try {
    await fx.preload('../assets');
  } catch (e) {
    log.error('app', `asset preload failed: ${e?.message ?? e}`);
  }
  cs.loadCards('../assets/characters');
  state.boot();   // BOOT → IDLE once assets are ready

  // Browsers keep audio suspended until a user gesture; resume on the first key/click.
  const resumeAudio = () => fx.resumeAudio();
  document.addEventListener('keydown', resumeAudio);
  document.addEventListener('pointerdown', resumeAudio);

  // Chakra colour picker: free choice only while no character is selected. A character's
  // theme (D-03) wins, so the picker is disabled then instead of silently ignoring input.
  const chakraSelect = document.getElementById('chakra-select');
  const savedColor = store.get('chakraColor');
  if (savedColor && [...chakraSelect.options].some(o => o.value === savedColor)) {
    chakraSelect.value = savedColor;
  }
  chakraSelect.addEventListener('change', () => {
    chakraSelect.blur();   // keep keyboard shortcuts working after a mouse pick
    if (selectedCharacter) return;
    fx.setChakraColor(chakraSelect.value);
    hud.setChakraColor(chakraSelect.value);
    store.set('chakraColor', chakraSelect.value);
  });

  /** Gate the engine to the character and apply its theme (or the picker colour if none). */
  function applyCharacter(char) {
    selectedCharacter = char;
    engine.setCharacter(char);
    const color = char === 'sasuke' ? CHAKRA.sasuke : char === 'naruto' ? CHAKRA.naruto : chakraSelect.value;
    fx.setChakraColor(color);
    hud.setChakraColor(color);
    chakraSelect.disabled = !!char;
    // The character's theme owns the colour; showing a stale picker value would mislead.
    const label = chakraSelect.closest('label');
    if (label) label.style.display = char ? 'none' : '';
  }
  applyCharacter(cs.getSelectedCharacter());   // persisted character (or none) on page load

  // Register jutsu activation handlers
  engine.onActivation('shadowClone', () => {
    fx.resumeAudio();  // best-effort; only succeeds if user has interacted first
    fx.triggerClones();
    fx.burstParticles(canvas.width / 2, canvas.height * 0.6);
    hud.showActivation('Shadow Clone Jutsu');
    state.activateShadowClone();
    // B1: voice release is a future feature (gated behind ?speech=1) — do not auto-start here.
    if (SPEECH_ENABLED) speechListener.start();
    log.info('app', 'Shadow Clone active — hold release sign to dismiss');
  });

  // Fireball — Serpent→Ram→Monkey→Boar→Horse→Tiger → READY (mouth open breathes it). S17.
  // Ready-mode like Chidori; B4 placeholder (triggerClones) removed.
  engine.registerSequence('fireball', SEQUENCES.fireball, { mode: 'ready' });

  // Chidori — Ox→Hare→Monkey → READY (right open palm activates). Sasuke-only (engine-gated).
  engine.registerSequence('chidori', SEQUENCES.chidori, { mode: 'ready' });

  // Selfie segmentation — runs independently from Holistic for cleaner API
  const segmentation = new SelfieSegmentation({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/${f}`
  });
  segmentation.setOptions({ modelSelection: 1 });
  let latestMask = null;
  let segPending = false;
  let segErrored = false;
  segmentation.onResults(r => {
    latestMask = r.segmentationMask;
    segPending = false;
  });

  // Release sign hold counter — require sign for N consecutive frames to prevent false positives
  let releaseHoldFrames = 0;
  const RELEASE_HOLD_THRESHOLD = RELEASE.HOLD_THRESHOLD;  // config (~333ms at 30fps)

  // Rasengan flow counters (S15)
  let armHoldFrames   = 0;  // left release-sign frames while IDLE+naruto → arm
  let palmOpenFrames  = 0;  // right open-palm frames while ARMED → activate
  const rasenganRelease = new PalmReleaseTracker(RASENGAN);  // closed palm / hand lost → release
  // Chidori flow counters (S16)
  let chidoriOpenFrames  = 0;  // right open-palm frames while CHIDORI_READY → activate
  const chidoriRelease = new PalmReleaseTracker(CHIDORI);
  let rightHandSeenThisJutsu = false;  // a real right hand was tracked since activation
  // Fireball flow counters (S17)
  let fireballOpenFrames  = 0;  // mouth-open frames while FIREBALL_READY → activate
  let fireballCloseFrames = 0;  // mouth-closed frames while fireball active → release
  let fireballStartedAt   = 0;  // activation timestamp (for the MAX_MS breath cap)

  // B7: single release path for ANY active jutsu — always the reverse-fade animation
  // (never the hard-cut abortRelease). Used by both the release-sign hold and the 'r' key.
  function releaseActiveJutsu() {
    if (state.is(Mode.RELEASING)) return;
    // Rasengan/Chidori are engine-independent — release their VideoFX (shrink+fade).
    if (fx.isRasenganActive()) {
      state.beginRelease();
      fx.rasenganRelease();
      log.info('app', 'rasengan released');
      return;
    }
    if (fx.isChidoriActive()) {
      state.beginRelease();
      fx.chidoriRelease();
      log.info('app', 'chidori released');
      return;
    }
    if (fx.isFireballActive()) {
      state.beginRelease();
      fx.fireballRelease();
      log.info('app', 'fireball released');
      return;
    }
    if (!engine.isActive()) return;
    if (SPEECH_ENABLED) speechListener.stop();
    state.beginRelease();
    const done = () => {
      engine.reset();
      log.info('app', 'jutsu released (fade complete)');
    };
    // triggerRelease returns false when there is no clone animation to fade —
    // in that case reset immediately so the engine never stays wedged active.
    if (!fx.triggerRelease(done)) done();
  }

  // FPS tracking
  let _lastFrameTs = 0;
  const watchdog = new FrameWatchdog(CAMERA.LOST_MS);
  let fpsFallback = null;       // set per camera start (only when running above 720p)
  let fallbackPending = false;  // fps too low → switch at the next IDLE frame
  let sendErrors = 0;           // consecutive Holistic failures
  let modelWarned = false;
  let _fpsAvg = 0;   // EMA-smoothed fps (the instantaneous 1000/dt jumps every frame)
  let _fps = 0;      // rounded value shown in the HUD

  // Per-frame pipeline
  function onResults(results) {
    const _now = performance.now();
    watchdog.frame(_now);
    sendErrors = 0;
    if (overlay.current === 'loading' || overlay.current === 'camera-lost' || overlay.current === 'tracking') {
      overlay.hide();
      if (modelMissing && !modelWarned) {
        modelWarned = true;
        overlay.show({ id: 'model', tone: 'warn', title: 'Hand-sign model not found',
          detail: 'Seal jutsu need models/gesture-model.json (train one at /trainer/). ' +
                  'The carousel, Rasengan and keyboard controls still work.',
          action: 'Continue', onAction: () => overlay.hide('model') });
      }
    }
    const _dt = _now - _lastFrameTs;
    // A long gap (tab hidden, camera stall) is not a frame-rate sample: skip it.
    if (_lastFrameTs > 0 && _dt > 0 && _dt < 1000) {
      const inst = 1000 / _dt;
      _fpsAvg = _fpsAvg ? _fpsAvg + PERF.FPS_EMA * (inst - _fpsAvg) : inst;
      _fps = Math.round(_fpsAvg);
    }
    // 1080p too slow on this machine → drop to 720p, but only at a calm moment (IDLE),
    // never mid-jutsu (a camera restart freezes the picture for ~1 s).
    if (fpsFallback?.step(_now, _fps)) fallbackPending = true;
    if (fallbackPending && state.is(Mode.IDLE)) {
      fallbackPending = false;
      setTimeout(() => fallbackTo720(), 0);   // not from inside Holistic's own callback
    }
    _lastFrameTs = _now;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw; canvas.height = vh;
      updateAspect(vw, vh);   // keep letterbox aspect locked to actual backing store
      updateHudInset();
    }
    if (hudCanvas.width !== vw || hudCanvas.height !== vh) {
      hudCanvas.width = vw; hudCanvas.height = vh;
    }

    // Fire-and-forget selfie segmentation (1-frame lag acceptable).
    // S18 perf: only run it when the person cutout is actually needed (Shadow Clone
    // composites effects behind the person). Otherwise Layer 1 (raw webcam) already
    // shows the person and orbs draw in front — so skip the expensive per-frame pass.
    // B11: guard against send() rejection so a segmentation failure doesn't wedge
    // segPending=true forever (which would freeze the person cutout silently).
    if (fx.needsSegmentation()) {
      if (!segPending && !segErrored) {
        segPending = true;
        Promise.resolve(segmentation.send({ image: video })).catch(err => {
          segPending = false;
          segErrored = true;  // stop hammering a broken segmenter; render falls back to no-mask
          log.error('seg', `selfie segmentation failed: ${err?.message ?? err}`);
        });
      }
    } else {
      latestMask = null;  // no cutout needed → raw webcam shows through, no stale mask
    }

    // ── Gesture classification (runs every frame, independent of MLP) ──────────────
    const gesture = gc.detect(results.rightHandLandmarks, results.leftHandLandmarks);

    // Release sign — real detector OR keyboard sim ('g'). Computed once/frame so the
    // debug pulse decrements exactly once (used by both the seal bypass and release check).
    const releaseSignActive =
      isReleaseSign(results.leftHandLandmarks, results.rightHandLandmarks) || debug.consumeReleaseSign();

    // ── Carousel gating (B6): only feed the carousel when it may open, or while
    //    it is already open. Blocks opening mid-sequence / mid-jutsu. ─────────────
    if (state.canOpenCarousel() || cs.isActive()) cs.update(gesture);

    // Sync carousel open/close edges → state + freeze/unfreeze the engine's
    // sequence-timeout clock so partial sequences survive the carousel (B6/§A).
    const csActive = cs.isActive();
    if (csActive && !state.isCarouselOpen() && state.canOpenCarousel()) {
      state.openCarousel();
      engine.freezeTimeout();
      debug.clear();   // a seal injected just before opening must not fire after closing
    } else if (!csActive && state.isCarouselOpen()) {
      state.closeCarousel();
      engine.unfreezeTimeout();
    }

    // ── Character sync (engine + theme) ───────────────────────────────────────────
    const newChar = cs.getSelectedCharacter();
    if (newChar !== selectedCharacter) applyCharacter(newChar);

    // ── MLP detection + engine update — gated by state (B14) ──────────────────────
    // Seal signs only feed the engine in IDLE/SEQUENCE (canRunEngine). While the
    // carousel is open the engine is FROZEN (not fed 13,0 — that was B6). While a
    // jutsu/READY state is active, seals are ignored at the call site.
    let classId = 13, confidence = 0;
    if (state.canRunEngine()) {
      const inject = debug.consumeSignOverride();  // keyboard seal injection (§G)
      if (inject) {
        // Debug-injected seal goes through the SAME engine path as a real prediction.
        ({ classId, confidence } = inject);
      } else if (releaseSignActive) {
        // Release sign priority: bypass MLP entirely to prevent mis-classification as Tiger.
        // isReleaseSign = left index+middle up, ring+pinky curled — geometrically identical to half-Tiger.
        classId = 14;
        confidence = 1.0;
      } else {
        ({ classId, confidence } = detector.predict(
          results.rightHandLandmarks, results.leftHandLandmarks
        ));
        ({ classId, confidence } = refinement.refine(
          classId, confidence,
          results.rightHandLandmarks, results.leftHandLandmarks
        ));
      }
      engine.update(classId, confidence);

      // A mode:'ready' sequence completed → transition to its READY state (S16).
      const ready = engine.getReady();
      const seq = engine.getSequenceState();
      if (ready === 'chidori') {
        state.chidoriReady();
        engine.clearReady();
        log.info('app', 'CHIDORI READY — open right palm');
      } else if (ready === 'fireball') {
        state.fireballReady();
        engine.clearReady();
        log.info('app', 'FIREBALL READY — open mouth to breathe fire');
      } else if (seq.jutsuName && state.is(Mode.IDLE)) {
        state.enterSequence(seq.jutsuName);
      } else if (!seq.jutsuName && state.is(Mode.SEQUENCE)) {
        state.exitSequence();
      }
    }

    // ── Shadow Clone Release check ─────────────────────────────────────────────────
    // Triggered only when Shadow Clone is the active jutsu.
    // Requires release sign held for RELEASE_HOLD_THRESHOLD consecutive frames (~333ms).
    // No voice required — sign hold is sufficient to prevent accidental dismissal.
    if (engine.getActiveJutsu() === 'shadowClone') {
      if (releaseSignActive) {
        releaseHoldFrames++;
        if (releaseHoldFrames >= RELEASE_HOLD_THRESHOLD) {
          releaseHoldFrames = 0;
          releaseActiveJutsu();  // same fade path as the 'r' key (B7)
        }
      } else {
        releaseHoldFrames = 0;
      }
    } else {
      releaseHoldFrames = 0;
      // Clean up speech listener if jutsu ended by other means
      if (!engine.isActive() && SPEECH_ENABLED && speechListener.isSupported) {
        speechListener.stop();
      }
    }

    // ── Rasengan flow (Naruto, S15) — engine-independent ──────────────────────────
    // Right open palm = real detector OR the 'p' debug toggle (same downstream path).
    const rightPalmOpen = gesture.isRightOpenPalm || debug.isRightPalmSim();
    // Keyboard-only users have no tracked hand: if 'p' has been used and no real right
    // hand was seen during this jutsu, toggling 'p' off counts as a present, closed palm
    // (quick release) instead of a lost hand. Once a real hand is seen, real tracking
    // rules apply, so a camera user's dropout is still tolerated.
    if (gesture.rightHandPresent) rightHandSeenThisJutsu = true;
    const rightPresent = gesture.rightHandPresent ||
      (debug.isRightPalmSimUsed() && !rightHandSeenThisJutsu);

    // Arm: IDLE + Naruto + left release sign held (no clone active). State machine
    // guarantees carousel/sequence/jutsu modes can't arm (armRasengan only from IDLE).
    if (state.is(Mode.IDLE) && selectedCharacter === 'naruto' &&
        releaseSignActive && engine.getActiveJutsu() !== 'shadowClone') {
      if (++armHoldFrames >= RASENGAN.ARM_HOLD_FRAMES) { state.armRasengan(); armHoldFrames = 0; log.info('app', 'RASENGAN ARMED'); }
    } else {
      armHoldFrames = 0;
    }

    // Armed → activate on a sustained right open palm, or expire after the timeout.
    if (state.is(Mode.RASENGAN_ARMED)) {
      if (state.armedElapsed() > RASENGAN.ARMED_TIMEOUT_MS) {
        state.disarm(); palmOpenFrames = 0; log.info('app', 'rasengan disarmed (timeout)');
      } else if (rightPalmOpen) {
        if (++palmOpenFrames >= RASENGAN.PALM_OPEN_FRAMES) {
          palmOpenFrames = 0;
          if (fx.rasenganActivate()) {
            state.activateRasengan();
            rasenganRelease.reset(); rightHandSeenThisJutsu = false;
            hud.showActivation('Rasengan');
            log.info('app', 'RASENGAN active');
          } else {
            state.disarm(); log.warn('app', 'rasengan effect unavailable');
          }
        }
      } else {
        palmOpenFrames = 0;
      }
    } else {
      palmOpenFrames = 0;
    }

    // Active → follow the right palm; release when the fist closes or the hand is gone
    // for LOST_FRAMES (a brief tracking dropout keeps the orb alive at its last anchor).
    if (state.is(Mode.JUTSU_RASENGAN)) {
      const rl = results.rightHandLandmarks;
      if (rl && rl.length >= 21) {
        fx.setRasenganAnchor((rl[0].x + rl[9].x) / 2, (rl[0].y + rl[9].y) / 2);  // mid(0,9)
      } else if (debug.isRightPalmSim()) {
        fx.setRasenganAnchor(0.5, 0.5);   // keyboard-only demo: orb at frame center
      }
      if (rasenganRelease.step(rightPresent, rightPalmOpen)) {
        releaseActiveJutsu();   // → RELEASING + fx.rasenganRelease() shrink-fade
      }
    } else {
      rasenganRelease.reset();
    }

    // ── Chidori flow (Sasuke, S16) — READY after the seal sequence, then right palm ──
    if (state.is(Mode.CHIDORI_READY)) {
      if (state.readyElapsed() > CHIDORI.READY_TIMEOUT_MS) {
        state.expireReady(); chidoriOpenFrames = 0; log.info('app', 'chidori READY expired');
      } else if (rightPalmOpen) {
        if (++chidoriOpenFrames >= CHIDORI.PALM_OPEN_FRAMES) {
          chidoriOpenFrames = 0;
          if (fx.chidoriActivate()) {
            state.activateChidori();
            chidoriRelease.reset(); rightHandSeenThisJutsu = false;
            hud.showActivation('Chidori');
            log.info('app', 'CHIDORI active');
          } else {
            state.expireReady(); log.warn('app', 'chidori effect unavailable');
          }
        }
      } else {
        chidoriOpenFrames = 0;
      }
    } else {
      chidoriOpenFrames = 0;
    }

    if (state.is(Mode.JUTSU_CHIDORI)) {
      const rl = results.rightHandLandmarks;
      if (rl && rl.length >= 21) {
        fx.setChidoriAnchor((rl[0].x + rl[9].x) / 2, (rl[0].y + rl[9].y) / 2);
      } else if (debug.isRightPalmSim()) {
        fx.setChidoriAnchor(0.5, 0.5);
      }
      if (chidoriRelease.step(rightPresent, rightPalmOpen)) releaseActiveJutsu();
    } else {
      chidoriRelease.reset();
    }

    // ── Fireball flow (Sasuke, S17) — READY after the seal sequence, then MOUTH OPEN ─
    // MAR from Holistic faceLandmarks; the 'm' key sim forces it wide open. Hysteresis
    // (OPEN_MAR vs CLOSE_MAR) stops ordinary talking from firing/dropping the flame.
    const mar = debug.isMouthOpenSim() ? 1 : mouthAspectRatio(results.faceLandmarks);
    const mouthOpen   = mar > MOUTH.OPEN_MAR;
    const mouthClosed = mar >= 0 ? mar < MOUTH.CLOSE_MAR : true;  // face lost → treat as closed

    if (state.is(Mode.FIREBALL_READY)) {
      if (state.readyElapsed() > MOUTH.READY_TIMEOUT_MS) {
        state.expireReady(); fireballOpenFrames = 0; log.info('app', 'fireball READY expired');
      } else if (mouthOpen) {
        if (++fireballOpenFrames >= MOUTH.OPEN_FRAMES) {
          fireballOpenFrames = 0;
          if (fx.fireballActivate()) {
            state.activateFireball();
            fireballCloseFrames = 0; fireballStartedAt = _now;
            hud.showActivation('Fireball');
            log.info('app', 'FIREBALL active');
          } else {
            state.expireReady(); log.warn('app', 'fireball effect unavailable');
          }
        }
      } else {
        fireballOpenFrames = 0;
      }
    } else {
      fireballOpenFrames = 0;
    }

    if (state.is(Mode.JUTSU_FIREBALL)) {
      const face = results.faceLandmarks;
      if (face && face.length > 14) {
        fx.setFireballAnchor((face[13].x + face[14].x) / 2, (face[13].y + face[14].y) / 2);  // mouth center
      } else if (debug.isMouthOpenSim()) {
        fx.setFireballAnchor(0.5, 0.4);   // keyboard-only demo: flame at upper-center
      }
      const capped = _now - fireballStartedAt > MOUTH.MAX_MS;
      if (!capped && !mouthClosed) {
        fireballCloseFrames = 0;
      } else if (capped || ++fireballCloseFrames >= MOUTH.CLOSE_FRAMES) {
        fireballCloseFrames = 0;
        releaseActiveJutsu();          // → RELEASING + fx.fireballRelease() fade
      }
    } else {
      fireballCloseFrames = 0;
    }

    // ── Jutsu-active state sync ───────────────────────────────────────────────────
    // Shadow Clone is engine-driven → returns to IDLE when the engine resets.
    // Rasengan/Chidori/Fireball are NOT engine-driven (managed above / by their
    // VideoFX); RELEASING clears to IDLE only once every jutsu fade has stopped.
    if (state.is(Mode.JUTSU_SHADOW_CLONE)) {
      if (!engine.isActive()) state.toIdle();
    } else if ((state.is(Mode.JUTSU_RASENGAN) && !fx.isRasenganActive()) ||
               (state.is(Mode.JUTSU_CHIDORI)  && !fx.isChidoriActive())  ||
               (state.is(Mode.JUTSU_FIREBALL) && !fx.isFireballActive())) {
      // The effect stopped on its own (e.g. its clip failed mid-play): never leave the
      // app wedged in a jutsu mode that nothing can release.
      log.warn('app', `${state.mode}: effect stopped unexpectedly → IDLE`);
      state.toIdle();
    } else if (state.is(Mode.RELEASING) && !engine.isActive() &&
               !fx.isRasenganActive() && !fx.isChidoriActive() && !fx.isFireballActive()) {
      state.toIdle();
    }

    // ── Rendering ─────────────────────────────────────────────────────────────────
    // B8: prompt the user to pick a character when none is confirmed (and carousel closed).
    hud.setCharacterHint(!cs.hasConfirmed() && !cs.isActive());
    hud.setDebugMode(log.debugEnabled, state.mode);
    hud.setRasenganState(state.is(Mode.RASENGAN_ARMED), fx.isRasenganActive());
    hud.setChidoriState(state.is(Mode.CHIDORI_READY), fx.isChidoriActive());
    hud.setFireballState(state.is(Mode.FIREBALL_READY), fx.isFireballActive());
    // Sharingan eyes — Sasuke only, follows face landmarks (S18).
    fx.setFace(results.faceLandmarks);
    fx.setSharingan(selectedCharacter === 'sasuke');
    fx.render(video, latestMask, { canvas, jutsuActive: engine.isActive() });
    hud.update(hudCanvas, classId, confidence, engine.getSequenceState(), _fps);
    cs.render(hudCanvas.getContext('2d'), canvas.width, canvas.height);
  }

  // Start MediaPipe Holistic
  const holistic = new Holistic({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629/${f}`
  });
  holistic.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  holistic.onResults(onResults);

  // Test/debug hook — only under ?debug=1. Lets headless tests read live state.
  if (log.debugEnabled) {
    window.__naruto = { state, engine, cs, fx, gc, hud, debug, Mode,
      char: () => selectedCharacter, seq: () => engine.getSequenceState(),
      perf: () => ({ fps: _fps, dims, fallbackArmed: !!fpsFallback, fallbackPending }) };
  }

  // ── Record button — resume AudioContext (autoplay policy) on first click ────
  const recBtn = document.getElementById('btn-record');
  recBtn.addEventListener('click', () => {
    fx.resumeAudio();
    if (recorder.isRecording) {
      recorder.stop();
      recBtn.textContent      = '⏺ Record';
      recBtn.style.background = '#ff6b00';
    } else {
      recorder.init(canvas);
      recorder.start();
      recBtn.textContent      = '⏹ Stop';
      recBtn.style.background = '#c00';
    }
  });

  // ── Demo mode — hides controls bar for clean screen recording ──────────────
  const btnDemo = document.getElementById('btn-demo');
  function toggleDemoMode() {
    const active = document.body.classList.toggle('demo-mode');
    updateHudInset();
    btnDemo.textContent = active ? '▶ Exit Demo [D]' : '⬜ Demo [D]';
    console.log(`[app] demo mode ${active ? 'ON' : 'OFF'}`);
  }
  btnDemo.addEventListener('click', toggleDemoMode);

  // ── Fullscreen API ──────────────────────────────────────────────────────────
  const btnFS = document.getElementById('btn-fullscreen');
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err =>
        console.warn('[app] fullscreen request failed:', err.message));
    } else {
      document.exitFullscreen();
    }
  }
  btnFS.addEventListener('click', toggleFullscreen);

  // A clicked button keeps focus, so a later Enter/Space would click it AGAIN while also
  // driving the carousel. Drop focus after each click so keys only reach the shortcuts.
  document.querySelector('.controls')?.addEventListener('click', e => {
    e.target.closest?.('button')?.blur();
  });

  // ── Global keyboard shortcuts ───────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    // Browser shortcuts (Ctrl+R reload, Ctrl+F find, Ctrl+D bookmark) are not ours.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Typing/arrowing inside the chakra <select> belongs to the select.
    if (e.target instanceof Element && e.target.closest('select, input, textarea')) return;
    const isArrow = e.key.startsWith('Arrow');
    if (isArrow) e.preventDefault();   // arrows drive the carousel, never scroll the page
    // Held keys auto-repeat: that would flicker every toggle (p, m, d, f, l). Arrows may
    // repeat (carousel paging has its own cooldown).
    if (e.repeat && !isArrow) return;
    // 'r' key: release the ACTIVE jutsu via the same reverse-fade path as the gesture (B7)
    if (e.key === 'r' || e.key === 'R') releaseActiveJutsu();
    // 'f' key: toggle fullscreen
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    // 'd' key: toggle demo mode
    if (e.key === 'd' || e.key === 'D') toggleDemoMode();

    // ── Debug input keys (§G) — all go through the SAME engine path as real detection ──
    if (Object.prototype.hasOwnProperty.call(SEAL_KEYMAP, e.key)) {
      debug.injectSign(SEAL_KEYMAP[e.key]);
      log.debug('debug', `inject seal ${SEAL_KEYMAP[e.key]}`);
    }
    if (e.key === 'k' || e.key === 'K') { debug.injectSign(12); log.debug('debug', 'inject KageBunshin(12)'); }
    if (e.key === 'g' || e.key === 'G') { debug.pulseReleaseSign(); log.debug('debug', 'sim release sign'); }
    if (e.key === 'p' || e.key === 'P') log.debug('debug', `sim right palm=${debug.toggleRightPalm()}`);
    if (e.key === 'm' || e.key === 'M') log.debug('debug', `sim mouth=${debug.toggleMouthOpen()}`);
    if (e.key === 'l' || e.key === 'L') hud.setDebugMode(log.toggleDebug(), state.mode);
    // Carousel keyboard control, gated by state (§G):
    //  - 'c' (open) forwarded only when the carousel MAY open (never mid-jutsu — B6)
    //  - arrows/Enter/e forwarded only while the carousel is already open
    const isOpenKey = e.key === 'c' || e.key === 'C';
    if (isOpenKey) {
      if (state.canOpenCarousel()) cs.handleKey(e.key);
    } else if (cs.isActive()) {
      cs.handleKey(e.key);
    }
  });

  // ── Camera session (after all handlers registered so UI works even on failure) ─
  // start / retry on error / reconnect when frames stop / one-time 720p fallback.
  let camera = null;
  let dims = cameraDims();
  let starting = false;

  async function startCamera() {
    if (starting) return false;
    starting = true;
    try { camera?.stop(); } catch { /* already stopped */ }
    camera = new Camera(video, {
      onFrame: async () => {
        try {
          await holistic.send({ image: video });
        } catch (err) {
          // A failing frame must not kill the loop; persistent failure gets an overlay.
          log.throttled('holistic', 2000, `tracking failed: ${err?.message ?? err}`);
          if (++sendErrors === CAMERA.SEND_ERRORS_MAX) {
            overlay.show({ id: 'tracking', tone: 'error', title: 'Hand tracking stopped working',
              detail: 'Reload the page. If it keeps happening, try Chrome or Edge with hardware acceleration on.',
              action: 'Reload', onAction: () => location.reload() });
          }
        }
      },
      width: dims.width, height: dims.height,
    });
    try {
      await camera.start();
      // Log ACTUAL negotiated resolution vs requested — cameras often ignore the hint,
      // and HUD/effects scaling (S12) depends on the real backing-store size.
      log.info('app', `camera requested ${dims.width}×${dims.height}, ` +
        `actual ${video.videoWidth || '?'}×${video.videoHeight || '?'}`);
      updateAspect(video.videoWidth, video.videoHeight);
      fpsFallback = (CAMERA.AUTO_FALLBACK && dims.height > CAMERA.HEIGHT)
        ? new FpsFallback(CAMERA.FALLBACK, performance.now()) : null;
      return true;
    } catch (err) {
      const d = describeCameraError(err);
      modelStatus.textContent = d.title;
      log.error('app', `camera failed to start: ${err?.name ?? ''} ${err?.message ?? err}`);
      overlay.show({ id: 'camera', tone: 'error', title: d.title, detail: d.detail,
        action: 'Retry', onAction: () => {
          overlay.show({ id: 'loading', title: 'Starting camera…', busy: true });
          startCamera();
        } });
      return false;
    } finally {
      starting = false;
    }
  }

  async function fallbackTo720() {
    dims = { width: CAMERA.WIDTH, height: CAMERA.HEIGHT };
    log.warn('app', `fps below ${CAMERA.FALLBACK.MIN_FPS} at 1080p → switching camera to 720p`);
    await startCamera();
  }

  // Watchdog: frames stopped while the tab is visible (camera unplugged, driver hiccup,
  // another app grabbed it) → show "reconnecting" and retry until frames return.
  let lastRetry = 0;
  setInterval(() => {
    const now = performance.now();
    // Errors that a camera restart can't fix keep their own message.
    if (starting || ['camera', 'tracking', 'fatal'].includes(overlay.current) ||
        !watchdog.isLost(now, document.hidden)) return;
    // A live, unmuted track means the camera itself is fine: frames are only slow (heavy
    // load, model warm-up), so wait much longer before treating the pipeline as stalled.
    const track = video.srcObject?.getVideoTracks?.()[0];
    const cameraAlive = !!track && track.readyState === 'live' && !track.muted;
    if (cameraAlive && overlay.current !== 'camera-lost' &&
        watchdog.sinceLastFrame(now) < CAMERA.STALL_MS) return;
    if (overlay.current !== 'camera-lost') {
      log.warn('app', cameraAlive ? 'tracking stalled → restarting camera'
                                  : 'camera frames stopped → reconnecting');
      overlay.show({ id: 'camera-lost', tone: 'warn', busy: true,
        title: cameraAlive ? 'Restarting the camera…' : 'Camera disconnected',
        detail: cameraAlive ? 'Tracking stopped responding; it should be back in a moment.'
                            : 'Reconnecting… check the cable or close other apps using the camera.' });
    }
    if (now - lastRetry >= CAMERA.RETRY_MS) { lastRetry = now; startCamera(); }
  }, 500);

  await startCamera();
}

init().catch(err => {
  log.error('app', `startup failed: ${err?.message ?? err}`);
  overlay.show({ id: 'fatal', tone: 'error', title: 'Something went wrong while starting',
    detail: String(err?.message ?? err), action: 'Reload', onAction: () => location.reload() });
});
