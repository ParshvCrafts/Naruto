// effects.js — Canvas rendering (layers 1-7)
export default class Effects {
  constructor() {
    this._chakraColor    = '#00BFFF';
    this._particles      = [];
    this._flashOpacity   = 0;
    this._personCanvas   = null;
    this._canvas         = null;
    this._ctx            = null;
    this._chakraActive   = false;
    this._cloneStartTime = null;

    this._CLONE_DEFS = [
      { x: -260, y:  10, scale: 0.75, delay: 1000 },
      { x:  260, y:  10, scale: 0.75, delay: 1200 },
      { x: -180, y:  20, scale: 0.80, delay: 1400 },
      { x:  180, y:  20, scale: 0.80, delay: 1600 },
      { x: -320, y: -10, scale: 0.70, delay: 1800 },
      { x:  320, y: -10, scale: 0.70, delay: 2000 },
      { x: -100, y:  30, scale: 0.85, delay: 2200 },
      { x:  100, y:  30, scale: 0.85, delay: 2400 },
      { x: -380, y:   0, scale: 0.65, delay: 2600 },
      { x:  380, y:   0, scale: 0.65, delay: 2800 },
      { x: -220, y: -20, scale: 0.78, delay: 3000 },
      { x:  220, y: -20, scale: 0.78, delay: 3000 },
      { x:  -60, y:  15, scale: 0.88, delay: 3100 },
      { x:   60, y:  15, scale: 0.88, delay: 3100 },
      { x: -150, y:  -5, scale: 0.72, delay: 3250 },
      { x:  150, y:  -5, scale: 0.72, delay: 3250 },
    ];

    this._smokeVariants = ['smoke_1', 'smoke_2', 'smoke_3', 'smoke_small_1'];
    this._activeSmokes  = [];
    this._smokeImages   = {};
    this._imagesLoaded  = false;

    this._sounds   = {};
    this._audioCtx = null;
    this._cloneTimeouts = [];
  }

  init(canvas) {
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
  }

  async preload(assetsBase = '../assets') {
    const imgPromises = [];
    this._smokeVariants.forEach(variant => {
      for (let f = 1; f <= 5; f++) {
        const key = `${variant}/${f}`;
        const img = new Image();
        img.src   = `${assetsBase}/smoke/${variant}/${f}.png`;
        imgPromises.push(new Promise(r => { img.onload = r; img.onerror = r; }));
        this._smokeImages[key] = img;
      }
    });
    await Promise.all(imgPromises);
    this._imagesLoaded = true;
    console.log('[effects] smoke images preloaded');

    // Sound preloading — empty .mp3 files silently decode to null buffer (no error)
    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const soundFiles = ['activation', 'clone_pop', 'ambient'];
    await Promise.all(soundFiles.map(async name => {
      try {
        const res = await fetch(`${assetsBase}/sounds/${name}.mp3`);
        const buf = await res.arrayBuffer();
        this._sounds[name] = await this._audioCtx.decodeAudioData(buf).catch(() => null);
      } catch { this._sounds[name] = null; }
    }));
    console.log('[effects] sounds preloaded (empty placeholders produce null buffers — no audio until real mp3s added)');
  }

  render(videoEl, segMask, { canvas, jutsuActive }) {
    if (!this._canvas) this.init(canvas);
    const ctx = this._ctx;
    const w = canvas.width, h = canvas.height;

    // Reset visual state when jutsu ends (engine auto-resets after 8s)
    if (!jutsuActive && this._chakraActive) {
      this._chakraActive   = false;
      this._cloneStartTime = null;
      this._activeSmokes   = [];
      this._particles      = [];
    }

    ctx.clearRect(0, 0, w, h);

    // Layer 1: raw webcam frame
    ctx.drawImage(videoEl, 0, 0, w, h);

    // Extract person once per frame (reused by _drawClones and layer 6)
    const person = segMask ? this._extractPerson(videoEl, segMask, w, h) : null;

    // Layers 2-3: clones + smoke (pass pre-extracted person)
    this._drawClones(person, w, h);

    // Layer 4: chakra aura
    if (this._chakraActive) this._drawAura(segMask, w, h);

    // Layer 5: particles
    this._updateParticles(ctx, w, h);

    // Layer 6: main person on top
    if (person) ctx.drawImage(person, 0, 0);

    // Screen flash (activation)
    if (this._flashOpacity > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this._flashOpacity})`;
      ctx.fillRect(0, 0, w, h);
      this._flashOpacity = Math.max(0, this._flashOpacity - 0.05);
    }
  }

  triggerClones() {
    // Cancel stale clone_pop timeouts from previous trigger
    this._cloneTimeouts.forEach(id => clearTimeout(id));
    this._cloneTimeouts = [];

    // Reset per-clone state so smokes spawn fresh on re-trigger
    this._CLONE_DEFS.forEach(def => { def._smokeDone = false; });
    this._activeSmokes   = [];
    this._cloneStartTime = performance.now();
    this._flashOpacity   = 0.8;
    this._chakraActive   = true;
    this._playSound('activation', 0.8);
    this._CLONE_DEFS.forEach(def => {
      const id = setTimeout(() => this._playSound('clone_pop', 0.3), def.delay);
      this._cloneTimeouts.push(id);
    });
    console.log('[effects] clones triggered');
  }

  _extractPerson(videoEl, segMask, w, h) {
    if (!this._personCanvas) {
      this._personCanvas = document.createElement('canvas');
    }
    this._personCanvas.width  = w;
    this._personCanvas.height = h;
    const pctx = this._personCanvas.getContext('2d');
    pctx.clearRect(0, 0, w, h);
    pctx.drawImage(segMask, 0, 0, w, h);
    pctx.globalCompositeOperation = 'source-in';
    pctx.drawImage(videoEl, 0, 0, w, h);
    pctx.globalCompositeOperation = 'source-over';
    return this._personCanvas;
  }

  _drawClones(person, w, h) {
    if (!this._cloneStartTime) return;
    const now     = performance.now();
    const elapsed = now - this._cloneStartTime;
    const ctx     = this._ctx;

    this._CLONE_DEFS.forEach(def => {
      if (elapsed < def.delay) return;

      const fadeElapsed = elapsed - def.delay;
      const opacity     = Math.min(1, fadeElapsed / 300);  // 300ms fade-in per clone

      // Spawn 2 smoke sprites per clone exactly once
      if (!def._smokeDone) {
        def._smokeDone = true;
        this._spawnSmoke(w / 2 + def.x - 40, h / 2 + def.y, def.scale, now);
        this._spawnSmoke(w / 2 + def.x + 40, h / 2 + def.y, def.scale, now);
      }

      if (!person) return;
      ctx.save();
      ctx.globalAlpha = opacity * 0.85;
      ctx.translate(w / 2 + def.x, h / 2 + def.y);
      ctx.scale(def.scale, def.scale);
      ctx.drawImage(person, -w / 2, -h / 2);
      ctx.restore();
    });

    this._drawSmokes(now, w, h);
  }

  _spawnSmoke(x, y, scale, now) {
    const variant = this._smokeVariants[Math.floor(Math.random() * this._smokeVariants.length)];
    this._activeSmokes.push({ x, y, scale, variant, startTime: now });
  }

  _drawSmokes(now, w, h) {
    const FRAME_MS = 120;
    const ctx = this._ctx;
    this._activeSmokes = this._activeSmokes.filter(smoke => {
      const frame = Math.floor((now - smoke.startTime) / FRAME_MS);
      if (frame >= 5) return false;  // animation complete — remove
      const img = this._smokeImages[`${smoke.variant}/${frame + 1}`];
      if (!img || !img.naturalWidth) return true;  // not loaded yet — keep, skip draw
      ctx.save();
      ctx.globalAlpha = 0.8 * (1 - frame / 5);
      ctx.translate(smoke.x, smoke.y);
      ctx.scale(smoke.scale, smoke.scale);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      return true;
    });
  }

  _drawAura(segMask, w, h) {
    if (!segMask) return;
    const ctx = this._ctx;
    ctx.save();
    ctx.shadowColor = this._chakraColor;
    ctx.shadowBlur  = 20 + 8 * Math.sin(performance.now() / 200);  // pulsing glow
    ctx.globalAlpha = 0.6;
    ctx.drawImage(segMask, 0, 0, w, h);
    ctx.restore();
  }

  burstParticles(cx, cy) {
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      this._particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        radius: 4 + Math.random() * 4
      });
    }
  }

  _updateParticles(ctx, w, h) {
    this._particles = this._particles.filter(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.1;    // gravity
      p.life -= 0.025;
      if (p.life <= 0) return false;
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = this._chakraColor;
      ctx.shadowColor = this._chakraColor;
      ctx.shadowBlur  = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return true;
    });
  }

  _playSound(name, volume = 1.0) {
    const buf = this._sounds[name];
    if (!buf || !this._audioCtx) return;
    if (this._audioCtx.state === 'suspended') this._audioCtx.resume();
    const src  = this._audioCtx.createBufferSource();
    const gain = this._audioCtx.createGain();
    gain.gain.value = volume;
    src.buffer = buf;
    src.connect(gain);
    gain.connect(this._audioCtx.destination);
    src.start();
  }

  setChakraColor(hex) { this._chakraColor = hex; }
}
