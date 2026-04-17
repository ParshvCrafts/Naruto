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

const video       = document.getElementById('video');
const canvas      = document.getElementById('canvas');
const hudCanvas   = document.getElementById('hud-canvas');
const modelStatus = document.getElementById('model-status');

const detector = new Detector();
const engine   = new JutsuEngine();
const fx       = new Effects();
const hud      = new HUD();
const recorder   = new Recorder();
const refinement = new SignRefinement();
const gc         = new GestureClassifier();
const cs         = new CharacterSelect();
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
  fx.setChakraColor(chakraSelect.value);
  hud.setChakraColor(chakraSelect.value);
  chakraSelect.addEventListener('change', () => {
    if (selectedCharacter) return;  // character theme takes precedence over manual picker
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
      if (newChar) {
        const color = newChar === 'sasuke' ? '#9C27B0' : '#ff6b00';
        fx.setChakraColor(color);
        hud.setChakraColor(color);
        localStorage.setItem('chakraColor', color);
      }
    }

    // ── MLP detection (skipped while carousel is open) ────────────────────────────
    let classId = 13, confidence = 0;
    if (!cs.isActive()) {
      ({ classId, confidence } = detector.predict(
        results.rightHandLandmarks, results.leftHandLandmarks
      ));
      ({ classId, confidence } = refinement.refine(
        classId, confidence,
        results.rightHandLandmarks, results.leftHandLandmarks
      ));
    }
    engine.update(classId, confidence);

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
}

init().catch(console.error);
