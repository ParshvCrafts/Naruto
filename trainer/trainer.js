// trainer.js — Naruto Jutsu Trainer
// CDN globals available: Holistic, Camera, tf

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
    if (el)   el.textContent = samples[s.id].length;
    if (card) card.classList.toggle('ready', samples[s.id].length >= 60);
  });
  checkTrainable();
}

function checkTrainable() {
  const allReady = SIGNS.every(s => samples[s.id].length >= 60);
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

// --- Recording state ---
let selectedSign = null;
let isRecording  = false;
let lastResults  = null;

const COUNTDOWN_MS = 3000;
const RECORD_MS    = 4000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startRecording() {
  if (selectedSign === null) { alert('Select a sign first'); return; }
  if (isRecording) return;
  isRecording = true;  // set immediately — prevents re-entrant countdown

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
  await sleep(RECORD_MS);
  isRecording = false;
  badge.classList.add('hidden');

  if (db) await dbSave(db, selectedSign, samples[selectedSign]);
  updateAllCounts();
  console.log(`[trainer] recorded ${samples[selectedSign].length} samples for sign ${selectedSign}`);
}

// --- Camera + MediaPipe bootstrap ---
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
camera.start().then(() => console.log('[trainer] camera started'));

function onResults(results) {
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  lastResults = results;

  if (isRecording && selectedSign !== null &&
      (results.rightHandLandmarks || results.leftHandLandmarks)) {
    const vec = extract(results.rightHandLandmarks, results.leftHandLandmarks);
    samples[selectedSign].push(vec);
    // Update count every 10 frames to avoid layout thrashing
    if (samples[selectedSign].length % 10 === 0) updateAllCounts();
  }
}

// --- Sign grid ---
const grid = document.getElementById('sign-grid');
SIGNS.forEach(sign => {
  const card = document.createElement('div');
  card.className  = 'sign-card';
  card.dataset.id = sign.id;
  const imgSrc = sign.img ? `/assets/signs/${sign.img}` : '';
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
    refImg.src   = `/assets/signs/${sign.img}`;
    refImg.alt   = sign.label;
    refName.textContent  = `${sign.name} — ${sign.label}`;
    refLabel.textContent = `Class ID ${sign.id}  ·  Form this sign with both hands`;
    refPlaceholder.classList.add('hidden');
    refContent.classList.remove('hidden');
  } else {
    // Neutral — no reference image
    refImg.src  = '';
    refName.textContent  = `${sign.name} — ${sign.label}`;
    refLabel.textContent = `Class ID ${sign.id}  ·  Rest your hands naturally at your sides`;
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
  m.add(tf.layers.dropout({ rate: 0.3 }));
  m.add(tf.layers.dense({ units: 64, activation: 'relu' }));
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

  statusEl.textContent = 'Preparing data…';
  document.getElementById('btn-train').disabled = true;

  // Build feature matrix (xs) and one-hot labels (ys)
  const allX = [], allY = [];
  SIGNS.forEach(s => {
    samples[s.id].forEach(vec => {
      allX.push(vec);
      const label = new Array(14).fill(0);
      label[s.id] = 1;
      allY.push(label);
    });
  });

  // Shuffle before splitting
  const idx   = tf.util.createShuffledIndices(allX.length);
  const xShuf = Array.from(idx).map(i => allX[i]);
  const yShuf = Array.from(idx).map(i => allY[i]);

  const xs = tf.tensor2d(xShuf);
  const ys = tf.tensor2d(yShuf);

  model = buildModel();
  statusEl.textContent = 'Training…';

  try {
    await model.fit(xs, ys, {
      epochs: 100,
      batchSize: 16,
      validationSplit: 0.1,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          const acc = Math.round((logs.val_acc ?? logs.acc) * 100);
          fillEl.style.width  = `${acc}%`;
          labelEl.textContent = `${acc}%`;
          statusEl.textContent = `Epoch ${epoch + 1}/100 — accuracy: ${acc}%`;
        }
      }
    });
  } finally {
    xs.dispose();
    ys.dispose();
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

function exportData() {
  const blob = new Blob([JSON.stringify(samples)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `naruto-samples-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    const imported = JSON.parse(e.target.result);
    Object.entries(imported).forEach(([id, arr]) => {
      samples[id] = [...(samples[id] || []), ...arr];
    });
    for (const s of SIGNS) {
      if (db) await dbSave(db, s.id, samples[s.id]);
    }
    updateAllCounts();
    console.log('[trainer] data imported');
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
});
document.getElementById('btn-clear').addEventListener('click', clearAll);

// --- Keyboard shortcut + Record button ---
document.addEventListener('keydown', e => {
  if (e.key === 'r' || e.key === 'R') startRecording();
});
document.getElementById('btn-rec').addEventListener('click', startRecording);

console.log('[trainer] loaded — camera starting...');

initDB().catch(err => console.error('[trainer] DB init failed, running without persistence:', err));
