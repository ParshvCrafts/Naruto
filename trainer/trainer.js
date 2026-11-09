// trainer.js — Naruto Jutsu Trainer (ES module)
import { splitHoldout, augment, validateImport } from './dataset.js';
// CDN globals available: Holistic, Camera, tf, drawConnectors, drawLandmarks, HAND_CONNECTIONS
// HAND_CONNECTIONS is exported by the @mediapipe/holistic CDN bundle as window.HAND_CONNECTIONS.
// Defensive fallback ensures no crash if the CDN version changes.
const HAND_CONNECTIONS_SAFE = (typeof HAND_CONNECTIONS !== 'undefined') ? HAND_CONNECTIONS : [];

// --- IndexedDB persistence ---
const DB_NAME  = 'naruto-trainer-v1';
const DB_STORE = 'samples';

async function dbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE, { keyPath: 'classId' });
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function dbSave(db, classId, arr) {
  return new Promise((res, rej) => {
    const tx  = db.transaction(DB_STORE, 'readwrite');
    const st  = tx.objectStore(DB_STORE);
    const req = st.put({ classId, samples: arr });
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}

async function dbLoad(db) {
  return new Promise((res, rej) => {
    const tx  = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = e => {
      const map = {};
      e.target.result.forEach(row => { map[String(row.classId)] = row.samples; });
      res(map);
    };
    req.onerror = e => rej(e.target.error);
  });
}

async function dbClear(db) {
  return new Promise((res, rej) => {
    const tx  = db.transaction(DB_STORE, 'readwrite');
    const req = tx.objectStore(DB_STORE).clear();
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}

// --- Sign definitions ---
const SIGNS = [
  { id: 0,  name: 'Ne',      label: 'Rat',          img: 'rat.png'          },
  { id: 1,  name: 'Ushi',    label: 'Ox',           img: 'ox.png'           },
  { id: 2,  name: 'Tora',    label: 'Tiger',        img: 'tiger.png'        },
  { id: 3,  name: 'U',       label: 'Hare',         img: 'hare.png'         },
  { id: 4,  name: 'Tatsu',   label: 'Dragon',       img: 'dragon.png'       },
  { id: 5,  name: 'Mi',      label: 'Serpent',      img: 'serpent.png'      },
  { id: 6,  name: 'Uma',     label: 'Horse',        img: 'horse.png'        },
  { id: 7,  name: 'Hitsuji', label: 'Ram',          img: 'ram.png'          },
  { id: 8,  name: 'Saru',    label: 'Monkey',       img: 'monkey.png'       },
  { id: 9,  name: 'Tori',    label: 'Bird',         img: 'bird.png'         },
  { id: 10, name: 'Inu',     label: 'Dog',          img: 'dog.png'          },
  { id: 11, name: 'I',       label: 'Boar',         img: 'boar.png'         },
  { id: 12, name: 'Kage',    label: 'Shadow Clone', img: 'shadow_clone.png' },
  { id: 13, name: 'None',    label: 'Neutral',      img: null               },
];

const MIN_SAMPLES      = 150;  // minimum samples per sign class before training unlocks
const MIN_SAMPLES_NONE = 300;  // None/Neutral needs more variety (see the recording tips)
const minFor = id => (id === 13 ? MIN_SAMPLES_NONE : MIN_SAMPLES);

const video  = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

// --- Training data ---
let db      = null;
let samples = Object.fromEntries(SIGNS.map(s => [s.id, []]));

async function initDB() {
  db = await dbOpen();
  const stored = await dbLoad(db);
  Object.entries(stored).forEach(([id, arr]) => { samples[id] = arr; });
  updateAllCounts();
  console.log('[trainer] DB loaded, counts:', SIGNS.map(s => `${s.id}:${samples[s.id].length}`).join(' '));
}

function updateAllCounts() {
  SIGNS.forEach(s => {
    const el   = document.getElementById(`count-${s.id}`);
    const card = document.querySelector(`.sign-card[data-id="${s.id}"]`);
    if (el)   el.textContent = `${samples[s.id].length}/${minFor(s.id)}`;
    if (card) card.classList.toggle('ready', samples[s.id].length >= minFor(s.id));
  });
  checkTrainable();
}

function checkTrainable() {
  const allReady = SIGNS.every(s => samples[s.id].length >= minFor(s.id));
  document.getElementById('btn-train').disabled = !allReady;
}

// --- Landmark normalization ---
/** Normalize 21 MediaPipe landmarks → Float32Array(63). Returns zeros if null/missing. */
function normalize(landmarks) {
  const vec = new Float32Array(63);
  if (!landmarks || landmarks.length < 21) return vec;
  const wx = landmarks[0].x, wy = landmarks[0].y, wz = landmarks[0].z;
  const dx = landmarks[9].x - wx, dy = landmarks[9].y - wy, dz = landmarks[9].z - wz;
  const scale = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
  landmarks.forEach((lm, i) => {
    vec[i*3]   = (lm.x - wx) / scale;
    vec[i*3+1] = (lm.y - wy) / scale;
    vec[i*3+2] = (lm.z - wz) / scale;
  });
  return vec;
}

function extract(right, left) {
  const vec = new Float32Array(126);
  vec.set(normalize(right),  0);
  vec.set(normalize(left),  63);
  return Array.from(vec);
}

/** Returns true if this frame is suitable for collection.
 *  Signs 0-12 require both hands detected.
 *  None (13) accepts any frame � user may have hands off-screen intentionally. */
function shouldCollect(classId, results) {
  if (classId === 13) return true;
  return !!(results.rightHandLandmarks && results.leftHandLandmarks);
}

// --- Recording state ---
let selectedSign = null;
let isRecording  = false;  // a take is in progress (countdown OR capture) — blocks re-entry
let collecting   = false;  // capture window only: countdown frames are NOT samples
let recSign      = null;   // sign locked at take start (clicking another card mid-take can't relabel)
let lastResults  = null;

const COUNTDOWN_MS = 3000;
const RECORD_MS    = 4000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startRecording() {
  if (selectedSign === null) { alert('Select a sign first'); return; }
  if (isRecording) return;
  isRecording = true;  // set immediately — prevents re-entrant countdown
  recSign = selectedSign;
  const before = samples[recSign].length;

  // 3-second countdown
  const cdEl = document.getElementById('countdown');
  cdEl.classList.remove('hidden');
  for (let i = 3; i >= 1; i--) {
    cdEl.textContent = i;
    await sleep(1000);
  }
  cdEl.classList.add('hidden');

  // 4-second recording window
  const badge = document.getElementById('rec-badge');
  badge.classList.remove('hidden');
  collecting = true;
  await sleep(RECORD_MS);
  collecting = false;
  isRecording = false;
  badge.classList.add('hidden');

  try {
    if (db) await dbSave(db, recSign, samples[recSign]);
  } catch (e) {
    console.error('[trainer] could not save samples:', e);
  }
  updateAllCounts();
  const got = samples[recSign].length - before;
  setStatus(got ? `Recorded ${got} frames for ${SIGNS[recSign].label}.`
                : `No frames captured for ${SIGNS[recSign].label} — are both hands in view?`);
  console.log(`[trainer] take: +${got} samples for sign ${recSign}`);
}

// --- Camera + MediaPipe bootstrap ---
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

const camera = new Camera(video, {
  onFrame: async () => { await holistic.send({ image: video }); },
  width: 640, height: 480
});
camera.start()
  .then(() => console.log('[trainer] camera started'))
  .catch(err => {
    console.error('[trainer] camera failed:', err);
    setStatus(`Camera unavailable (${err?.name || err}). Allow camera access in the address bar and reload.`);
  });

function onResults(results) {
  const vw = video.videoWidth, vh = video.videoHeight;
  canvas.width  = vw;
  canvas.height = vh;
  lastResults = results;

  // Draw mirrored video frame (selfie orientation — matches app display)
  // Sample collection below uses raw landmark coords — canvas draw is cosmetic only
  ctx.save();
  ctx.translate(vw, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, vw, vh);

  // Draw landmarks on top (also mirrored via the active transform)
  if (results.rightHandLandmarks) {
    drawConnectors(ctx, results.rightHandLandmarks, HAND_CONNECTIONS_SAFE,
      { color: '#00ff88', lineWidth: 2 });
    drawLandmarks(ctx, results.rightHandLandmarks,
      { color: '#00ff88', fillColor: '#00ff8866', radius: 3 });
  }
  if (results.leftHandLandmarks) {
    drawConnectors(ctx, results.leftHandLandmarks, HAND_CONNECTIONS_SAFE,
      { color: '#ff8800', lineWidth: 2 });  // B15: was raw HAND_CONNECTIONS → throws if CDN global missing
    drawLandmarks(ctx, results.leftHandLandmarks,
      { color: '#ff8800', fillColor: '#ff880066', radius: 3 });
  }
  ctx.restore();

  // Sample collection — uses raw landmark coords (not flipped)
  // NOTE: using the original OR condition here; Task 8.2 replaces it with shouldCollect()
  if (collecting && recSign !== null) {
    if (shouldCollect(recSign, results)) {
      const vec = extract(results.rightHandLandmarks, results.leftHandLandmarks);
      samples[recSign].push(vec);
      if (samples[recSign].length % 10 === 0) updateAllCounts();
    }
  }
}

// --- Sign grid ---
const grid = document.getElementById('sign-grid');
SIGNS.forEach(sign => {
  const card = document.createElement('div');
  card.className  = 'sign-card';
  card.dataset.id = sign.id;
  const imgSrc = sign.img ? `../assets/signs/${sign.img}` : '';
  card.innerHTML  = `
    <img src="${imgSrc}" alt="${sign.label}" onerror="this.style.visibility='hidden'">
    <div class="sign-name">${sign.name} (${sign.label})</div>
    <div class="sign-count" id="count-${sign.id}">0</div>
  `;
  card.addEventListener('click', () => selectSign(sign.id));
  grid.appendChild(card);
});

// Reference panel elements
const refPlaceholder = document.querySelector('.sign-ref-placeholder');
const refContent     = document.querySelector('.sign-ref-content');
const refImg         = document.getElementById('sign-ref-img');
const refName        = document.getElementById('sign-ref-name');
const refLabel       = document.getElementById('sign-ref-label');

function selectSign(id) {
  selectedSign = id;
  document.querySelectorAll('.sign-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`.sign-card[data-id="${id}"]`).classList.add('selected');

  // Update reference panel
  const sign = SIGNS[id];
  if (sign.img) {
    refImg.src   = `../assets/signs/${sign.img}`;
    refImg.alt   = sign.label;
    refName.textContent  = `${sign.name} — ${sign.label}`;
    refLabel.textContent = `Class ID ${sign.id}  ·  Form this sign with both hands`;
    refPlaceholder.classList.add('hidden');
    refContent.classList.remove('hidden');
  } else {
    // Neutral — no reference image
    refImg.src  = '';
    refName.textContent  = `${sign.name} — ${sign.label}`;
    refLabel.textContent = `Class ID ${sign.id}  ·  Target: 300+ samples. Record 4 takes: hands at sides, one hand only, casual gestures, hands partially off-screen.`;
    refPlaceholder.classList.add('hidden');
    refContent.classList.remove('hidden');
  }

  console.log(`[trainer] selected sign ${id}: ${sign.name}`);
}

// --- TF.js model ---
let model = null;

function buildModel() {
  const m = tf.sequential();
  m.add(tf.layers.dense({ inputShape: [126], units: 128, activation: 'relu' }));
  m.add(tf.layers.batchNormalization());
  m.add(tf.layers.dropout({ rate: 0.3 }));
  m.add(tf.layers.dense({ units: 64, activation: 'relu' }));
  m.add(tf.layers.batchNormalization());
  m.add(tf.layers.dropout({ rate: 0.2 }));
  m.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  m.add(tf.layers.dense({ units: 14, activation: 'softmax' }));
  m.compile({
    optimizer: 'adam',
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy']
  });
  return m;
}

async function trainModel() {
  const statusEl = document.getElementById('train-status');
  const fillEl   = document.getElementById('conf-fill');
  const labelEl  = document.getElementById('conf-label');

  document.getElementById('btn-train').disabled = true;
  const isFineTune = document.querySelector('input[name="train-mode"]:checked').value === 'finetune';
  if (isFineTune) {
    // Fine-tune = train new BatchNorm model on ALL currently loaded samples (old + new combined).
    // Old samples should be imported via "Import Data" before clicking Train.
    // Note: new architecture (BatchNorm) is incompatible with old model weights — data union only.
    statusEl.textContent = 'Fine-tune mode: training on all combined samples…';
  } else {
    statusEl.textContent = 'Train new model: preparing data (3× augmentation)…';
  }

  // Hold out the LAST 15% of each sign's recordings, then augment the TRAIN rows only
  // (see dataset.js for why a random frame split overstates accuracy).
  const { train, val } = splitHoldout(samples, 0.15);
  const trainRows = augment(train, 3, 0.02);
  const shuffled  = Array.from(tf.util.createShuffledIndices(trainRows.length)).map(i => trainRows[i]);
  const oneHot = rows => tf.oneHot(tf.tensor1d(rows.map(r => r.y), 'int32'), 14).toFloat();
  const xs  = tf.tensor2d(shuffled.map(r => r.x));
  const ys  = oneHot(shuffled);
  const xvs = tf.tensor2d(val.map(r => r.x));
  const yvs = oneHot(val);

  if (model) model.dispose();  // free GPU memory before building a new model
  model = buildModel();
  statusEl.textContent = 'Training…';

  try {
    await model.fit(xs, ys, {
      epochs: 100,
      batchSize: 16,
      validationData: [xvs, yvs],
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          const acc = Math.round((logs.val_acc ?? logs.acc) * 100);
          fillEl.style.width  = `${acc}%`;
          labelEl.textContent = `${acc}%`;
          statusEl.textContent = `Epoch ${epoch + 1}/100 — held-out accuracy (last 15% of each sign's takes): ${acc}%`;
        }
      }
    });
  } catch (e) {
    console.error('[trainer] training failed:', e);
    statusEl.textContent = `Training failed: ${e?.message ?? e}`;
    checkTrainable();
    return;
  } finally {
    [xs, ys, xvs, yvs].forEach(t => t.dispose());
  }

  statusEl.textContent = 'Training complete! Save the model.';
  document.getElementById('btn-save-model').disabled = false;
  console.log('[trainer] training complete');
}

async function saveModel() {
  if (!model) { alert('Train the model first'); return; }
  await model.save('downloads://gesture-model');
  console.log('[trainer] model saved');
}

function setStatus(msg) {
  const el = document.getElementById('train-status');
  if (el) el.textContent = msg;
}

function exportData() {
  const blob = new Blob([JSON.stringify(samples)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `naruto-samples-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);   // revoking immediately can cancel the download
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    let parsed;
    try { parsed = JSON.parse(e.target.result); }
    catch { setStatus(`Import failed: ${file.name} is not valid JSON.`); return; }
    const r = validateImport(parsed);
    if (!r.ok) { setStatus(`Import failed: ${r.errors.join('; ')}`); return; }
    Object.entries(r.cleaned).forEach(([id, arr]) => { samples[id] = [...(samples[id] || []), ...arr]; });
    try {
      for (const s of SIGNS) if (db) await dbSave(db, s.id, samples[s.id]);
    } catch (err) { console.error('[trainer] could not persist import:', err); }
    updateAllCounts();
    setStatus(`Imported ${r.added} samples from ${file.name}` +
      (r.dropped ? ` (${r.dropped} malformed skipped)` : '') +
      (r.errors.length ? ` — ${r.errors.join('; ')}` : '') +
      '. Note: importing the same file twice adds its samples twice.');
  };
  reader.readAsText(file);
}

function clearAll() {
  if (!confirm('Clear ALL training data?')) return;
  samples = Object.fromEntries(SIGNS.map(s => [s.id, []]));
  if (db) dbClear(db).then(() => updateAllCounts());
  else updateAllCounts();
}

// --- Button wiring ---
document.getElementById('btn-train').addEventListener('click', trainModel);
document.getElementById('btn-save-model').addEventListener('click', saveModel);
document.getElementById('btn-export-data').addEventListener('click', exportData);
document.getElementById('btn-import-data').addEventListener('click', () =>
  document.getElementById('import-input').click());
document.getElementById('import-input').addEventListener('change', e => {
  if (e.target.files[0]) importData(e.target.files[0]);
  e.target.value = '';   // allow re-importing the same file name
});
document.getElementById('btn-clear').addEventListener('click', clearAll);

// --- Keyboard shortcut + Record button ---
document.addEventListener('keydown', e => {
  if (e.key === 'r' || e.key === 'R') startRecording();
});
document.getElementById('btn-rec').addEventListener('click', startRecording);

console.log('[trainer] loaded — camera starting...');

initDB().catch(err => console.error('[trainer] DB init failed, running without persistence:', err));
