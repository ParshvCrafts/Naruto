// app.js — Main loop (ES6 module)
// CDN globals: Holistic, SelfieSegmentation, Camera, tf

import Detector      from './modules/detector.js';
import JutsuEngine   from './modules/jutsu-engine.js';
import Effects       from './modules/effects.js';
import HUD           from './modules/hud.js';
import Recorder          from './modules/recorder.js';
import SignRefinement    from './modules/sign-refinement.js';
import GestureClassifier from './modules/gesture-classifier.js';
import CharacterSelect   from './modules/character-select.js';
import { isReleaseSign, SpeechListener } from './modules/release-detector.js';

const video       = document.getElementById('video');
const canvas      = document.getElementById('canvas');
const hudCanvas   = document.getElementById('hud-canvas');
const modelStatus = document.getElementById('model-status');

const detector = new Detector();
const engine   = new JutsuEngine();
const fx       = new Effects();
const hud      = new HUD();
const recorder       = new Recorder();
const refinement     = new SignRefinement();
const gc             = new GestureClassifier();
const cs             = new CharacterSelect();
const speechListener = new SpeechListener();
let selectedCharacter = null;

async function init() {
  // Load trained model
  try {
    await detector.load('../models/gesture-model.json');
    modelStatus.textContent = 'Model loaded ✓';
  } catch (e) {
    modelStatus.textContent = 'No model found — run trainer first';
    console.warn('[app] model not loaded:', e.message);
  }

  // Preload smoke images + sounds
  await fx.preload('../assets');
  cs.loadCards('../assets/characters');

  // Sync persisted character to engine + theme on page load
  const saved = cs.getSelectedCharacter();
  if (saved) {
    selectedCharacter = saved;
    engine.setCharacter(saved);
    const initColor = saved === 'sasuke' ? '#9C27B0' : '#ff6b00';
    fx.setChakraColor(initColor);
    hud.setChakraColor(initColor);
    const chakraSelectEl = document.getElementById('chakra-select');
    if (chakraSelectEl) chakraSelectEl.value = initColor;
  }

  // Chakra color picker — restore saved preference, update fx+hud on change
  const chakraSelect = document.getElementById('chakra-select');
  const savedColor = localStorage.getItem('chakraColor');
  if (savedColor) chakraSelect.value = savedColor;

  // Only apply picker color if no character is selected (character theme takes priority)
  if (!selectedCharacter) {
    fx.setChakraColor(chakraSelect.value);
    hud.setChakraColor(chakraSelect.value);
  }

  chakraSelect.addEventListener('change', () => {
    if (selectedCharacter) return;  // character theme takes precedence
    const color = chakraSelect.value;
    fx.setChakraColor(color);
    hud.setChakraColor(color);
    localStorage.setItem('chakraColor', color);
  });

  // Register jutsu activation handlers
  engine.onActivation('shadowClone', () => {
    fx._audioCtx?.resume();  // best-effort; only succeeds if user has interacted first
    fx.triggerClones();
    fx.burstParticles(canvas.width / 2, canvas.height * 0.6);
    hud.showActivation('Shadow Clone Jutsu');
    // Shadow Clone persists until Release gesture + spoken "release".
    // Start listening for voice command immediately on activation.
    speechListener.start();
    console.log('[app] Shadow Clone active — show release sign + say "release" to dismiss');
  });

  // Fireball Jutsu — Snake→Ram→Monkey→Boar→Horse→Tiger
  engine.registerSequence('fireball', [5, 7, 8, 11, 6, 2]);
  engine.onActivation('fireball', () => {
    fx._audioCtx?.resume();
    fx.triggerClones();  // placeholder effect until full fireball is implemented
    fx.burstParticles(canvas.width / 2, canvas.height * 0.6);
    hud.showActivation('Fireball Jutsu');
    console.log('[app] FIREBALL JUTSU — placeholder effect');
  });

  // Selfie segmentation — runs independently from Holistic for cleaner API
  const segmentation = new SelfieSegmentation({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`
  });
  segmentation.setOptions({ modelSelection: 1 });
  let latestMask = null;
  let segPending = false;
  segmentation.onResults(r => {
    latestMask = r.segmentationMask;
    segPending = false;
  });

  // Release sign hold counter — require sign for N consecutive frames to prevent false positives
  let releaseHoldFrames = 0;
  const RELEASE_HOLD_THRESHOLD = 10;  // ~333ms at 30fps

  // Per-frame pipeline
  function onResults(results) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw; canvas.height = vh;
    }
    if (hudCanvas.width !== vw || hudCanvas.height !== vh) {
      hudCanvas.width = vw; hudCanvas.height = vh;
    }

    // Fire-and-forget selfie segmentation (1-frame lag acceptable)
    if (!segPending) {
      segPending = true;
      segmentation.send({ image: video });
    }

    // ── Gesture classification (runs every frame, independent of MLP) ──────────────
    const gesture = gc.detect(results.rightHandLandmarks, results.leftHandLandmarks);
    cs.update(gesture);

    // ── Character sync (engine + theme) ───────────────────────────────────────────
    const newChar = cs.getSelectedCharacter();
    if (newChar !== selectedCharacter) {
      selectedCharacter = newChar;
      engine.setCharacter(newChar);
      const color = newChar === 'sasuke' ? '#9C27B0' : '#ff6b00';
      fx.setChakraColor(color);
      hud.setChakraColor(color);
      localStorage.setItem('chakraColor', color);
    }

    // ── MLP detection (skipped while carousel is open) ────────────────────────────
    let classId = 13, confidence = 0;
    if (!cs.isActive()) {
      // Release sign priority: bypass MLP entirely to prevent mis-classification as Tiger.
      // isReleaseSign = left index+middle up, ring+pinky curled — geometrically identical to half-Tiger.
      if (isReleaseSign(results.leftHandLandmarks)) {
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
    }
    engine.update(classId, confidence);

    // ── Shadow Clone Release check ─────────────────────────────────────────────────
    // Triggered only when Shadow Clone is the active jutsu.
    // Requires release sign held for RELEASE_HOLD_THRESHOLD consecutive frames (~333ms).
    // No voice required — sign hold is sufficient to prevent accidental dismissal.
    if (engine.getActiveJutsu() === 'shadowClone') {
      const signShown = isReleaseSign(results.leftHandLandmarks);
      if (signShown) {
        releaseHoldFrames++;
        if (releaseHoldFrames >= RELEASE_HOLD_THRESHOLD) {
          releaseHoldFrames = 0;
          speechListener.stop();
          fx.triggerRelease(() => {
            engine.reset();
            console.log('[app] RELEASE JUTSU — Shadow Clone dismissed (animation complete)');
          });
        }
      } else {
        releaseHoldFrames = 0;
      }
    } else {
      releaseHoldFrames = 0;
      // Clean up speech listener if jutsu ended by other means
      if (!engine.isActive() && speechListener.isSupported) {
        speechListener.stop();
      }
    }

    // ── Rendering ─────────────────────────────────────────────────────────────────
    fx.render(video, latestMask, { canvas, jutsuActive: engine.isActive() });
    hud.update(hudCanvas, classId, confidence, engine.getSequenceState());
    cs.render(hudCanvas.getContext('2d'), canvas.width, canvas.height);
  }

  // Start MediaPipe Holistic
  const holistic = new Holistic({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${f}`
  });
  holistic.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  holistic.onResults(onResults);

  const camera = new Camera(video, {
    onFrame: async () => { await holistic.send({ image: video }); },
    width: 640, height: 480
  });
  await camera.start();
  console.log('[app] camera started');

  // Record button — resume AudioContext (autoplay policy) on first click
  const recBtn = document.getElementById('btn-record');
  recBtn.addEventListener('click', () => {
    fx._audioCtx?.resume();
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

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    // 'r' key: release Shadow Clone Jutsu (backup release when voice/gesture fails)
    if ((e.key === 'r' || e.key === 'R') && engine.getActiveJutsu() === 'shadowClone') {
      engine.reset();
      speechListener.stop();
      console.log('[app] Shadow Clone released via R key');
    }
    // Prevent arrow keys from scrolling the page (handled by carousel instead)
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
    }
    // Pass to character select for carousel keyboard control
    cs.handleKey(e.key);
  });
}

init().catch(console.error);
