// effects.js — Canvas rendering (layers 1-7)
import { log } from './log.js';
import { RASENGAN, CHIDORI, FIREBALL, SHARINGAN, CHAKRA_DEFAULT, AUDIO } from './config.js';
import { normGain } from './audio-norm.js';

/**
 * VideoFX — a looping video sprite composited with `screen` blend at a hand anchor.
 * Generic: Rasengan now, Chidori (S16) reuses it. Drawn INSIDE effects.js's mirrored
 * transform so a raw normalized landmark maps onto the mirrored hand naturally.
 */
export class VideoFX {
  constructor(src, cfg) {
    this._cfg = cfg;
    this._vid = document.createElement('video');
    this._vid.src = src;
    this._vid.muted = true;
    this._vid.playsInline = true;
    this._vid.preload = 'auto';
    // LOOP_POINT 0 = the whole clip loops: native looping is seamless. A clip with a
    // spin-up intro (LOOP_POINT > 0) is looped manually in draw() just before its end;
    // waiting for 'ended' (pause → seek → play) shows a visible hitch.
    this._vid.loop = !(cfg.LOOP_POINT > 0);
    this._active = false;
    this._releasing = false;
    this._failed = false;
    this._scale = cfg.SCALE_START;
    this._releaseStart = 0;
    this._ax = null; this._ay = null;   // EMA-smoothed anchor (normalized 0-1)
    // Fallback if the clip still reaches its end (e.g. a stalled frame skipped the check).
    this._vid.addEventListener('ended', () => {
      if (!this._active) return;
      try { this._vid.currentTime = cfg.LOOP_POINT; this._vid.play().catch(() => {}); } catch {}
    });
    // A clip that fails to load/decode must not leave an invisible "active" jutsu.
    this._vid.addEventListener('error', () => {
      this._failed = true;
      this.forceStop();
      log.warn('effects', `video sprite failed to load: ${src}`);
    });
  }

  /** @returns {boolean} false if the clip failed to load (jutsu cannot show). */
  activate() {
    if (this._failed) return false;
    this._active = true;
    this._releasing = false;
    this._scale = this._cfg.SCALE_START;
    this._ax = this._ay = null;
    try { this._vid.currentTime = 0; } catch {}
    this._vid.play().catch(() => {});
    return true;
  }

  /** Manual loop for clips with an intro: jump back to LOOP_POINT just before the end. */
  _keepLooping() {
    const v = this._vid, lp = this._cfg.LOOP_POINT;
    if (lp > 0 && v.duration && v.currentTime >= v.duration - 0.1) {
      try { v.currentTime = lp; } catch {}
    }
  }

  release() {
    if (this._active && !this._releasing) { this._releasing = true; this._releaseStart = performance.now(); }
  }

  forceStop() { this._active = false; this._releasing = false; try { this._vid.pause(); } catch {} }
  isActive() { return this._active; }
  isReleasing() { return this._releasing; }

  setAnchor(nx, ny) {
    const a = this._cfg.ANCHOR_EMA;
    this._ax = this._ax == null ? nx : this._ax + a * (nx - this._ax);
    this._ay = this._ay == null ? ny : this._ay + a * (ny - this._ay);
  }

  anchorPx(w, h) { return this._ax == null ? null : { x: this._ax * w, y: this._ay * h }; }

  /** Current draw size (width, px) accounting for growth + release shrink. */
  drawSize(h) {
    let shrink = 1;
    if (this._releasing) {
      const p = Math.min(1, (performance.now() - this._releaseStart) / this._cfg.RELEASE_MS);
      shrink = 1 - 0.7 * p;               // 1 → 0.3
    }
    return this._cfg.BASE_FRAC * h * this._scale * shrink;
  }

  /** Draw the orb inside the already-mirrored ctx. Returns false when fully released. */
  draw(ctx, w, h) {
    if (!this._active || this._ax == null) return false;
    let alpha = 1;
    if (this._releasing) {
      const p = (performance.now() - this._releaseStart) / this._cfg.RELEASE_MS;
      if (p >= 1) { this.forceStop(); return false; }
      alpha = 1 - p;
    } else if (this._scale < this._cfg.SCALE_MAX) {
      this._scale += this._cfg.SCALE_RAMP;
    }
    const vid = this._vid;
    if (!vid.videoWidth) return true;      // not decoded yet — keep alive
    this._keepLooping();
    const wpx = this.drawSize(h);
    const hpx = wpx * (vid.videoHeight / vid.videoWidth);  // preserve source aspect (orb stays round)
    const cx = this._ax * w, cy = this._ay * h;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(vid, cx - wpx / 2, cy - hpx / 2, wpx, hpx);
    ctx.restore();
    return true;
  }
}

/**
 * FireballFX — directional flame breathed from the mouth (S17). Extends VideoFX but
 * anchors the flame's ORIGIN edge at the mouth (rather than centering an orb) so the
 * jet extends horizontally outward, and adds a brief full-frame ignition burst.
 */
export class FireballFX extends VideoFX {
  constructor(src, cfg, burstSrc) {
    super(src, cfg);
    this._burst = null;
    this._burstStart = 0;
    if (burstSrc) {
      const b = document.createElement('video');
      b.src = burstSrc; b.muted = true; b.playsInline = true; b.preload = 'auto'; b.loop = false;
      this._burst = b;
    }
  }

  activate() {
    if (!super.activate()) return false;
    if (this._burst) {
      this._burstStart = performance.now();
      try { this._burst.currentTime = 0; this._burst.play().catch(() => {}); } catch {}
    }
    return true;
  }

  forceStop() {
    super.forceStop();
    try { this._burst?.pause(); } catch {}
  }

  /** Directional draw: flame core sits on the mouth anchor, jet extends horizontally. */
  draw(ctx, w, h) {
    if (!this._active || this._ax == null) return false;
    let alpha = 1;
    if (this._releasing) {
      const p = (performance.now() - this._releaseStart) / this._cfg.RELEASE_MS;
      if (p >= 1) { this.forceStop(); return false; }
      alpha = 1 - p;
    } else if (this._scale < this._cfg.SCALE_MAX) {
      this._scale += this._cfg.SCALE_RAMP;
    }
    const vid = this._vid;
    if (!vid.videoWidth) return true;               // not decoded yet — keep alive
    this._keepLooping();
    const wpx = this.drawSize(h);
    const hpx = wpx * (vid.videoHeight / vid.videoWidth);
    const cx = this._ax * w, cy = this._ay * h;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'screen';
    // Pull the left edge back slightly so the intense core overlaps the mouth and
    // the bulk of the jet extends outward from it.
    ctx.drawImage(vid, cx - wpx * 0.15, cy - hpx / 2, wpx, hpx);
    ctx.restore();
    return true;
  }

  /** Full-frame ignition flash for the first BURST_MS after activation. */
  drawBurst(ctx, w, h) {
    if (!this._burst || !this._burst.videoWidth) return;
    const t = performance.now() - this._burstStart;
    if (t < 0 || t > this._cfg.BURST_MS) return;
    const p = t / this._cfg.BURST_MS;                       // 0 → 1
    const env = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85; // quick attack, slow fade
    ctx.save();
    ctx.globalAlpha = Math.max(0, this._cfg.BURST_ALPHA * env);
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(this._burst, 0, 0, w, h);
    ctx.restore();
  }
}

// Set to true to replay activation sounds when clones are dismissed.
// Set to false to release silently.
const PLAY_RELEASE_SOUND = true;

export default class Effects {
  constructor() {
    this._chakraColor    = CHAKRA_DEFAULT;
    this._particles      = [];
    this._flashOpacity   = 0;
    this._personCanvas   = null;
    this._canvas         = null;
    this._ctx            = null;
    this._chakraActive   = false;
    this._cloneStartTime = null;

    // xFrac is a fraction of (w/2) — clone body center lands at (w/2 + xFrac*(w/2)).
    // This scales correctly for any camera resolution (640p, 720p, 1080p, etc.).
    // xFrac 1.0 = body center exactly at the screen edge; >1.0 = partially off-screen.
    this._CLONE_DEFS = [
      // Pair 1 — closest to real person
      { xFrac: -0.125, y:  10, scale: 0.88, delay:  800 },
      { xFrac:  0.125, y:  10, scale: 0.88, delay: 1000 },
      // Pair 2
      { xFrac: -0.250, y:  20, scale: 0.86, delay: 1200 },
      { xFrac:  0.250, y:  20, scale: 0.86, delay: 1400 },
      // Pair 3
      { xFrac: -0.375, y:   5, scale: 0.84, delay: 1600 },
      { xFrac:  0.375, y:   5, scale: 0.84, delay: 1800 },
      // Pair 4
      { xFrac: -0.500, y: -10, scale: 0.82, delay: 2000 },
      { xFrac:  0.500, y: -10, scale: 0.82, delay: 2200 },
      // Pair 5
      { xFrac: -0.625, y:  15, scale: 0.80, delay: 2400 },
      { xFrac:  0.625, y:  15, scale: 0.80, delay: 2600 },
      // Pair 6
      { xFrac: -0.750, y:  -5, scale: 0.79, delay: 2800 },
      { xFrac:  0.750, y:  -5, scale: 0.79, delay: 2800 },
      // Pair 7
      { xFrac: -0.875, y:   0, scale: 0.78, delay: 2950 },
      { xFrac:  0.875, y:   0, scale: 0.78, delay: 2950 },
      // Pair 8 — body center ~40px from screen edge at 1280px
      { xFrac: -0.938, y:  10, scale: 0.77, delay: 3100 },
      { xFrac:  0.938, y:  10, scale: 0.77, delay: 3100 },
      // Pair 9 — body center just past edge; partial silhouette for "army beyond" effect
      { xFrac: -1.031, y:  -5, scale: 0.76, delay: 3250 },
      { xFrac:  1.031, y:  -5, scale: 0.76, delay: 3250 },
    ];

    this._smokeVariants = ['smoke_1', 'smoke_2', 'smoke_3', 'smoke_small_1'];
    this._activeSmokes  = [];
    this._smokeImages   = {};
    this._imagesLoaded  = false;

    this._sounds   = {};
    this._norm     = {};     // name → loudness-normalising gain (measured at decode)
    this._audioCtx = null;
    this._master   = null;   // all SFX → master gain → compressor → speakers (+ recorder tap)
    this._cloneTimeouts = [];

    // Sequential release animation state
    this._releasePending       = false;
    this._releaseStartTime     = 0;
    this._releaseOnComplete    = null;
    this._maxDisappearDelay    = 0;

    // Jutsu video sprites (S15/S16/S17) — created in preload()
    this._rasengan = null;
    this._chidori  = null;
    this._fireball = null;
    this._arcs     = [];   // procedural lightning polylines (chidori)
    this._arcFrame = 0;
    this._shakeStart = 0;  // Fireball ignition shake start (ms), 0 = none

    // Sharingan procedural eyes (S18)
    this._face          = null;   // latest Holistic faceLandmarks
    this._sharinganOn   = false;  // Sasuke selected → draw eyes
    this._sharinganAt   = 0;      // activation time (scale-in)
    this._tomoeAngle    = 0;      // spinning tomoe rotation
    this._eyeC          = { r: null, l: null };  // EMA-smoothed eye centers
  }

  // ── Sharingan (procedural eyes) API (S18) ────────────────────────────────────
  setFace(faceLandmarks) { this._face = faceLandmarks || null; }
  setSharingan(on) {
    on = !!on;
    if (on && !this._sharinganOn) this._sharinganAt = performance.now();
    if (!on) this._eyeC = { r: null, l: null };  // reset smoothing when off
    this._sharinganOn = on;
  }
  isSharinganOn() { return this._sharinganOn; }

  /**
   * Whether the person cutout (selfie-segmentation mask) is needed THIS frame.
   * Only Shadow Clone composites effects BEHIND the person (clones/smoke/aura); every
   * other state shows the raw webcam (Layer 1) with orbs drawn in front, so the mask
   * is unnecessary. Gating segmentation on this (S18 perf) skips an expensive
   * per-frame ML pass in IDLE / carousel / Rasengan / Chidori / Fireball / Sharingan.
   */
  needsSegmentation() {
    return this._chakraActive || this._releasePending ||
           this._cloneStartTime !== null || this._activeSmokes.length > 0;
  }

  // ── Rasengan (VideoFX) API ─────────────────────────────────────────────────
  rasenganActivate()          { return !!this._rasengan?.activate(); }
  rasenganRelease()           { this._rasengan?.release(); }
  rasenganForceStop()         { this._rasengan?.forceStop(); }
  setRasenganAnchor(nx, ny)   { this._rasengan?.setAnchor(nx, ny); }
  isRasenganActive()          { return !!this._rasengan?.isActive(); }

  // ── Chidori (VideoFX + lightning) API ───────────────────────────────────────
  chidoriActivate()           { return !!this._chidori?.activate(); }
  chidoriRelease()            { this._chidori?.release(); }
  chidoriForceStop()          { this._chidori?.forceStop(); }
  setChidoriAnchor(nx, ny)    { this._chidori?.setAnchor(nx, ny); }
  isChidoriActive()           { return !!this._chidori?.isActive(); }

  // ── Fireball (FireballFX) API — mouth-anchored directional flame (S17) ────────
  fireballActivate() {
    const ok = !!this._fireball?.activate();
    if (ok) this._shakeStart = performance.now();   // ignition shake (owner decision 2026-11-08)
    return ok;
  }
  fireballRelease()           { this._fireball?.release(); }
  fireballForceStop()         { this._fireball?.forceStop(); }
  setFireballAnchor(nx, ny)   { this._fireball?.setAnchor(nx, ny); }
  isFireballActive()          { return !!this._fireball?.isActive(); }

  init(canvas) {
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
  }

  async preload(assetsBase = '../assets') {
    // Video sprites first: they are the largest downloads and the first jutsu needs them.
    this._rasengan = new VideoFX(`${assetsBase}/effects/rasengan.mp4`, RASENGAN);
    this._chidori  = new VideoFX(`${assetsBase}/effects/chidori.mp4`,  CHIDORI);
    this._fireball = new FireballFX(`${assetsBase}/effects/fireball.mp4`, FIREBALL,
                                    `${assetsBase}/effects/fireball_burst.mp4`);

    const imgPromises = [];
    this._smokeVariants.forEach(variant => {
      for (let f = 1; f <= 5; f++) {
        const key = `${variant}/${f}`;
        const img = new Image();
        img.src   = `${assetsBase}/smoke/${variant}/${f}.png`;
        // B12: surface broken assets instead of silently resolving as success.
        imgPromises.push(new Promise(r => {
          img.onload  = r;
          img.onerror = () => { log.warn('effects', `smoke asset failed: ${key}`); r(); };
        }));
        this._smokeImages[key] = img;
      }
    });
    await Promise.all(imgPromises);
    this._imagesLoaded = true;
    console.log('[effects] smoke images preloaded');

    // Sound preloading. Audio is optional: if the AudioContext can't be created the app
    // runs silent rather than failing to boot.
    try {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this._audioCtx = null;
      log.warn('effects', `audio unavailable: ${e?.message ?? e}`);
    }
    if (this._audioCtx) {
      // Master bus: a compressor keeps stacked SFX (18 clone pops) from clipping.
      const comp = this._audioCtx.createDynamicsCompressor();
      comp.threshold.value = AUDIO.COMP_THRESHOLD_DB;
      comp.ratio.value     = AUDIO.COMP_RATIO;
      this._master = this._audioCtx.createGain();
      this._master.gain.value = AUDIO.MASTER_GAIN;
      this._master.connect(comp);
      comp.connect(this._audioCtx.destination);
    }
    // B10: 'ambient' dropped — it was loaded but never played.
    const soundFiles = ['activation', 'clone_pop', 'kage_bunshin_no_jutsu', 'sharingan'];
    if (this._audioCtx) await Promise.all(soundFiles.map(async name => {
      try {
        const res = await fetch(`${assetsBase}/sounds/${name}.mp3`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        this._sounds[name] = await this._audioCtx.decodeAudioData(buf);
        this._norm[name] = normGain(this._sounds[name].getChannelData(0), AUDIO);
      } catch (e) {
        this._sounds[name] = null;
        log.warn('effects', `sound failed: ${name} (${e?.message ?? e})`);
      }
    }));
    log.info('effects', 'assets preloaded');
  }

  /** Audio graph for the recorder: { ctx, node } (node = master bus), or null without audio. */
  audioOutput() { return this._audioCtx && this._master ? { ctx: this._audioCtx, node: this._master } : null; }

  /** Sharingan activation sound (Sasuke confirmed). */
  playSharingan() { this._playSound('sharingan', AUDIO.SHARINGAN_VOL); }

  /** Resume audio after a user gesture (browser autoplay policy). Safe to call often. */
  resumeAudio() {
    if (this._audioCtx?.state === 'suspended') this._audioCtx.resume().catch(() => {});
  }

  /** Cancel scheduled clone-pop sounds (spawn or release). */
  _clearCloneTimers() {
    this._cloneTimeouts.forEach(id => clearTimeout(id));
    this._cloneTimeouts = [];
  }

  render(videoEl, segMask, { canvas, jutsuActive }) {
    if (!this._canvas) this.init(canvas);
    const ctx = this._ctx;
    const w = canvas.width, h = canvas.height;
    // Camera not delivering frames yet (or lost): a 0×0 canvas makes drawImage throw.
    if (!w || !h || videoEl.readyState < 2) return;

    // Reset visual state when jutsu ends (engine reset / release complete)
    if (!jutsuActive && this._chakraActive) {
      this._clearCloneTimers();
      this._releasePending    = false;
      this._releaseOnComplete = null;
      this._chakraActive   = false;
      this._cloneStartTime = null;
      this._activeSmokes   = [];
      this._particles      = [];
    }

    ctx.clearRect(0, 0, w, h);

    // Mirror all layers so the canvas shows selfie orientation.
    // MediaPipe receives the raw video DOM element — CSS/canvas transforms
    // are invisible to it. Landmark coords and detection logic are unaffected.
    ctx.save();
    // Fireball ignition shake: whole frame jitters, zoomed just enough to hide the edges.
    const shake = this._shakeStart ? shakeAt(performance.now() - this._shakeStart, FIREBALL, h / 720, Math.random, w, h) : null;
    if (shake) {
      ctx.translate(w / 2 + shake.x, h / 2 + shake.y);
      ctx.scale(shake.k, shake.k);
      ctx.translate(-w / 2, -h / 2);
    } else {
      this._shakeStart = 0;
    }
    ctx.translate(w, 0);
    ctx.scale(-1, 1);

    // Layer 1: raw webcam frame
    ctx.drawImage(videoEl, 0, 0, w, h);

    // Extract person once per frame (reused by _drawClones and layer 6)
    const person = segMask ? this._extractPerson(videoEl, segMask, w, h) : null;

    // Layers 2-3: clones + smoke (pass pre-extracted person)
    this._drawClones(person, w, h);
    if (this._releasePending) this._checkReleaseComplete();

    // Layer 4: chakra aura
    if (this._chakraActive) this._drawAura(segMask, w, h);

    // Layer 5: particles
    this._updateParticles(ctx, w, h);

    // Layer 6: main person on top
    if (person) ctx.drawImage(person, 0, 0);

    // Layer 6.5: jutsu orb at the right palm — drawn in front of the person
    if (this._rasengan?.isActive()) this._drawRasengan(ctx, w, h);
    if (this._chidori?.isActive())  this._drawChidori(ctx, w, h);
    if (this._fireball?.isActive()) this._drawFireball(ctx, w, h);

    // Sharingan eyes — on top of the person's face, follows head via landmarks.
    if (SHARINGAN.ENABLED && this._sharinganOn && this._face) this._drawSharingan(ctx, w, h);

    // Screen flash (activation)
    if (this._flashOpacity > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this._flashOpacity})`;
      ctx.fillRect(0, 0, w, h);
      this._flashOpacity = Math.max(0, this._flashOpacity - 0.05);
    }

    ctx.restore();  // remove mirror transform
  }

  triggerClones() {
    // Cancel stale clone_pop timeouts from previous trigger
    this._cloneTimeouts.forEach(id => clearTimeout(id));
    this._cloneTimeouts = [];
    // Abort any in-flight release animation
    this._releasePending    = false;
    this._releaseOnComplete = null;

    // Reset per-clone state so smokes spawn fresh on re-trigger
    this._CLONE_DEFS.forEach(def => { def._smokeDone = false; def._notYetSpawned = false; });
    this._activeSmokes   = [];
    this._cloneStartTime = performance.now();
    this._flashOpacity   = 0.8;
    this._chakraActive   = true;
    this._playSoundChained('activation', 'kage_bunshin_no_jutsu', 0.8, 0.9);
    this._CLONE_DEFS.forEach(def => {
      const id = setTimeout(() => this._playSound('clone_pop', 0.3), def.delay);
      this._cloneTimeouts.push(id);
    });
    console.log('[effects] clones triggered');
  }

  /**
   * Begin sequential clone disappearance in reverse spawn order.
   * Clones with the highest spawn delay (last to appear) vanish first.
   * Calls onComplete() after all clones have faded (~2450ms).
   * @param {function} onComplete  Called when animation ends — caller should call engine.reset() here
   */
  /** @returns {boolean} true if a release animation started; false if nothing to release. */
  triggerRelease(onComplete) {
    if (!this._chakraActive || this._releasePending) return false;  // nothing to release, or already releasing

    // Cancel pending clone-pop sounds from initial spawn
    this._cloneTimeouts.forEach(id => clearTimeout(id));
    this._cloneTimeouts = [];

    const maxDelay = Math.max(...this._CLONE_DEFS.map(d => d.delay));
    const minDelay = Math.min(...this._CLONE_DEFS.map(d => d.delay));
    const elapsedAtRelease = this._cloneStartTime ? performance.now() - this._cloneStartTime : 0;
    this._CLONE_DEFS.forEach(def => {
      def._disappearDelay   = maxDelay - def.delay;   // 0 = vanish immediately
      def._releaseSmokeDone = false;
      def._notYetSpawned    = def.delay > elapsedAtRelease;  // skip clones not yet visible
    });
    this._maxDisappearDelay  = maxDelay - minDelay;   // = 2250
    this._releaseStartTime   = performance.now();
    this._releasePending     = true;
    this._releaseOnComplete  = onComplete;
    if (PLAY_RELEASE_SOUND) {
      // Play clone_pop for each visible clone at the moment it starts disappearing.
      // This reuses _cloneTimeouts so they can be cancelled on re-trigger.
      this._CLONE_DEFS.forEach(def => {
        if (!def._notYetSpawned) {
          const id = setTimeout(() => this._playSound('clone_pop', 0.4), def._disappearDelay);
          this._cloneTimeouts.push(id);
        }
      });
    }
    console.log('[effects] release triggered — clones fading in reverse order');
    return true;
  }

  _checkReleaseComplete() {
    const releaseElapsed = performance.now() - this._releaseStartTime;
    if (releaseElapsed < this._maxDisappearDelay + 200) return;

    // All clones faded — clean up and notify caller
    this._releasePending   = false;
    this._chakraActive     = false;
    this._cloneStartTime   = null;
    this._activeSmokes     = [];
    this._particles        = [];
    if (this._releaseOnComplete) {
      this._releaseOnComplete();
      this._releaseOnComplete = null;
    }
    console.log('[effects] release animation complete');
  }

  /** Cancel any in-flight release animation without calling onComplete. */
  abortRelease() {
    this._clearCloneTimers();
    this._releasePending    = false;
    this._releaseOnComplete = null;
  }

  _extractPerson(videoEl, segMask, w, h) {
    // NOTE on coordinate space: _personCanvas is drawn in raw (unmirrored) space.
    // In render(), ctx.drawImage(person, 0, 0) is called inside the ctx.save()/scale(-1,1) block,
    // which mirrors it a second time — resulting in a correctly-mirrored person layer.
    // If you ever add a mirror transform to pctx here, the person layer in render() will break.
    if (!this._personCanvas) {
      this._personCanvas = document.createElement('canvas');
    }
    // Resizing a canvas reallocates its backing store — only do it when the size changes.
    if (this._personCanvas.width !== w || this._personCanvas.height !== h) {
      this._personCanvas.width  = w;
      this._personCanvas.height = h;
    }
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
    const S       = h / 720;              // vertical px offsets authored at 720p
    const smokeDX = 40 * S;               // smoke L/R offset from clone center

    const releaseElapsed = this._releasePending ? now - this._releaseStartTime : -1;

    this._CLONE_DEFS.forEach(def => {
      if (elapsed < def.delay) return;

      const cx = w / 2 + def.xFrac * (w / 2);  // screen x of this clone's body center
      const cy = h / 2 + def.y * S;            // body center y (def.y scaled)

      const fadeElapsed = elapsed - def.delay;
      let   opacity     = Math.min(1, fadeElapsed / 300);   // 300ms fade-in per clone

      if (this._releasePending) {
        if (def._notYetSpawned) return;   // skip clones that hadn't appeared when release triggered
        // Fade out in reverse order: each clone starts fading at its _disappearDelay
        const fadeOutElapsed = releaseElapsed - def._disappearDelay;
        const fadeOut        = Math.max(0, Math.min(1, fadeOutElapsed / 200));
        opacity              = opacity * (1 - fadeOut);

        // Spawn dismissal smoke once when this clone's fade-out begins
        if (!def._releaseSmokeDone && releaseElapsed >= def._disappearDelay) {
          def._releaseSmokeDone = true;
          this._spawnSmoke(cx - smokeDX, cy, def.scale, now);
          this._spawnSmoke(cx + smokeDX, cy, def.scale, now);
        }
      } else {
        // Normal spawn: spawn smoke once when clone first appears
        if (!def._smokeDone) {
          def._smokeDone = true;
          this._spawnSmoke(cx - smokeDX, cy, def.scale, now);
          this._spawnSmoke(cx + smokeDX, cy, def.scale, now);
        }
      }

      if (opacity <= 0 || !person) return;
      ctx.save();
      ctx.globalAlpha = opacity * 0.85;
      ctx.translate(cx, cy);
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
    const S   = h / 720;   // keep smoke size proportional across resolutions
    this._activeSmokes = this._activeSmokes.filter(smoke => {
      const frame = Math.floor((now - smoke.startTime) / FRAME_MS);
      if (frame >= 5) return false;  // animation complete — remove
      const img = this._smokeImages[`${smoke.variant}/${frame + 1}`];
      if (!img || !img.naturalWidth) return true;  // not loaded yet — keep, skip draw
      ctx.save();
      ctx.globalAlpha = 0.8 * (1 - frame / 5);
      ctx.translate(smoke.x, smoke.y);
      ctx.scale(smoke.scale * S, smoke.scale * S);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      return true;
    });
  }

  _drawRasengan(ctx, w, h) {
    const fx = this._rasengan;
    const a = fx.anchorPx(w, h);
    if (!a) return;
    // Chakra radial glow behind the orb (orange for Naruto, light-purple for Sasuke's Chidori)
    const r = fx.drawSize(h) * 0.6;
    if (r > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = fx.isReleasing() ? 0.3 : 0.6;
      const grad = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, r);
      grad.addColorStop(0, _hexA(this._chakraColor, 0.55));
      grad.addColorStop(1, _hexA(this._chakraColor, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    fx.draw(ctx, w, h);
  }

  _drawChidori(ctx, w, h) {
    const fx = this._chidori;
    const a = fx.anchorPx(w, h);
    if (!a) return;
    const size = fx.drawSize(h);
    const dim  = fx.isReleasing() ? 0.4 : 1;

    // Light-purple electric glow behind
    if (size > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.55 * dim;
      const grad = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, size * 0.6);
      grad.addColorStop(0, _hexA(this._chakraColor, 0.6));
      grad.addColorStop(1, _hexA(this._chakraColor, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(a.x, a.y, size * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Procedural lightning arcs — regenerate geometry every few frames for a crackle.
    this._arcFrame++;
    if (this._arcs.length === 0 || this._arcFrame % CHIDORI.ARC_REGEN_FRAMES === 0) {
      this._arcs = _genArcs(a.x, a.y, size * 0.7, CHIDORI.ARC_COUNT);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';   // additive — arcs glow over the orb
    ctx.strokeStyle = this._chakraColor;
    ctx.shadowColor = this._chakraColor;
    ctx.shadowBlur  = 8;
    ctx.lineWidth   = Math.max(1, size * 0.012);
    ctx.globalAlpha = 0.9 * dim;
    for (const arc of this._arcs) {
      ctx.beginPath();
      ctx.moveTo(arc[0].x, arc[0].y);
      for (let i = 1; i < arc.length; i++) ctx.lineTo(arc[i].x, arc[i].y);
      ctx.stroke();
    }
    ctx.restore();

    // Video orb on top
    fx.draw(ctx, w, h);
  }

  _drawFireball(ctx, w, h) {
    const fx = this._fireball;
    const a = fx.anchorPx(w, h);
    if (!a) return;
    // Ignition burst full-frame flash (behind the jet).
    fx.drawBurst(ctx, w, h);
    // Warm glow at the mouth. Fire is intrinsically orange — do NOT tint by chakra
    // color (Sasuke's chakra is purple; the flame itself stays fire-colored).
    const size = fx.drawSize(h);
    if (size > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = fx.isReleasing() ? 0.3 : 0.5;
      const r = size * 0.35;
      const grad = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, r);
      grad.addColorStop(0, _hexA(FIREBALL.GLOW_COLOR, 0.6));
      grad.addColorStop(1, _hexA(FIREBALL.GLOW_COLOR, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    fx.draw(ctx, w, h);
  }

  // ── Sharingan procedural eyes (S18) ──────────────────────────────────────────
  // Eye-contour landmark sets (MediaPipe FaceMesh 468). Center/size approximated
  // from corners + lids since Holistic exposes no iris refinement by default.
  _drawSharingan(ctx, w, h) {
    const f = this._face;
    // [outerCorner, innerCorner, upperLid, lowerLid]
    const R_EYE = [33, 133, 159, 145];
    const L_EYE = [362, 263, 386, 374];
    if (f.length <= 386) return;

    const scaleIn = Math.min(1, (performance.now() - this._sharinganAt) / SHARINGAN.SCALE_IN_MS);
    this._tomoeAngle += SHARINGAN.SPIN;

    for (const [key, idx] of [['r', R_EYE], ['l', L_EYE]]) {
      const [c1, c2, up, lo] = idx.map(i => f[i]);
      if (!c1 || !c2 || !up || !lo) continue;
      const cx = (c1.x + c2.x) / 2, cy = (c1.y + c2.y) / 2;
      const eyeW = Math.hypot(c1.x - c2.x, c1.y - c2.y);
      const eyeH = Math.hypot(up.x - lo.x, up.y - lo.y);
      if (eyeW <= 0 || eyeH / eyeW < SHARINGAN.BLINK_RATIO) continue;  // blinking → skip

      // EMA-smooth the center (normalized space) to kill landmark jitter.
      const prev = this._eyeC[key];
      const sx = prev ? prev.x + SHARINGAN.EMA * (cx - prev.x) : cx;
      const sy = prev ? prev.y + SHARINGAN.EMA * (cy - prev.y) : cy;
      this._eyeC[key] = { x: sx, y: sy };

      const px = sx * w, py = sy * h;
      const irisR = SHARINGAN.IRIS_FRAC * (eyeW * 0.5) * w * scaleIn;
      const rx = eyeW * 0.5 * w, ry = Math.max(eyeH * 0.5 * h, irisR * 0.35);
      if (irisR < 1) continue;

      ctx.save();
      ctx.globalAlpha = SHARINGAN.ALPHA;
      // Clip to the eye opening so the iris stays within the lids (blink-natural).
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();

      // Iris disc (red radial gradient)
      const grad = ctx.createRadialGradient(px, py, irisR * 0.2, px, py, irisR);
      grad.addColorStop(0, '#e0402e');
      grad.addColorStop(0.7, SHARINGAN.IRIS_COLOR);
      grad.addColorStop(1, SHARINGAN.RING_COLOR);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(px, py, irisR, 0, Math.PI * 2); ctx.fill();

      // Pupil (small, so the tomoe read as separate commas around it)
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath(); ctx.arc(px, py, irisR * 0.2, 0, Math.PI * 2); ctx.fill();

      // Spinning tomoe (3, evenly spaced, orbiting well outside the pupil)
      ctx.fillStyle = '#0a0a0a';
      for (let i = 0; i < 3; i++) {
        const a = this._tomoeAngle + i * (Math.PI * 2 / 3);
        const ox = px + Math.cos(a) * irisR * 0.6;
        const oy = py + Math.sin(a) * irisR * 0.6;
        _tomoe(ctx, ox, oy, irisR * 0.14, a + Math.PI / 2);
      }

      // Dark outer ring at the iris edge — clipped, so it never bleeds onto skin.
      ctx.strokeStyle = SHARINGAN.RING_COLOR;
      ctx.lineWidth = Math.max(1, irisR * 0.09);
      ctx.beginPath(); ctx.arc(px, py, irisR * 0.97, 0, Math.PI * 2); ctx.stroke();

      ctx.restore();
    }
  }

  _drawAura(segMask, w, h) {
    if (!segMask) return;
    const ctx = this._ctx;
    const S   = h / 720;
    ctx.save();
    ctx.shadowColor = this._chakraColor;
    ctx.shadowBlur  = (20 + 8 * Math.sin(performance.now() / 200)) * S;  // pulsing glow
    ctx.globalAlpha = 0.6;
    ctx.drawImage(segMask, 0, 0, w, h);
    ctx.restore();
  }

  burstParticles(cx, cy) {
    const S = (this._canvas?.height ?? 720) / 720;   // scale burst to resolution
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const speed = (2 + Math.random() * 3) * S;
      this._particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 0.1 * S,
        life: 1.0,
        radius: (4 + Math.random() * 4) * S
      });
    }
  }

  _updateParticles(ctx, w, h) {
    const S = h / 720;
    this._particles = this._particles.filter(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += (p.gravity ?? 0.1 * S);    // gravity
      p.life -= 0.025;
      if (p.life <= 0) return false;
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = this._chakraColor;
      ctx.shadowColor = this._chakraColor;
      ctx.shadowBlur  = 8 * S;
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
    gain.gain.value = volume * (this._norm[name] ?? 1);
    src.buffer = buf;
    src.connect(gain);
    gain.connect(this._master ?? this._audioCtx.destination);
    src.start();
  }

  /** Play name1 immediately, then schedule name2 to start exactly when name1 ends.
   *  If name2 failed to load (null buffer), falls back to playing name1 alone. */
  _playSoundChained(name1, name2, vol1, vol2) {
    const buf1 = this._sounds[name1];
    const buf2 = this._sounds[name2];
    if (!buf1 || !this._audioCtx) return;
    if (this._audioCtx.state === 'suspended') this._audioCtx.resume();

    // If name2 is unavailable, play name1 alone and exit
    if (!buf2) { this._playSound(name1, vol1); return; }

    const now = this._audioCtx.currentTime;

    const src1  = this._audioCtx.createBufferSource();
    const gain1 = this._audioCtx.createGain();
    gain1.gain.value = vol1 * (this._norm[name1] ?? 1);
    src1.buffer = buf1;
    src1.connect(gain1);
    gain1.connect(this._master ?? this._audioCtx.destination);
    src1.start(now);

    const src2  = this._audioCtx.createBufferSource();
    const gain2 = this._audioCtx.createGain();
    gain2.gain.value = vol2 * (this._norm[name2] ?? 1);
    src2.buffer = buf2;
    src2.connect(gain2);
    gain2.connect(this._master ?? this._audioCtx.destination);
    src2.start(now + buf1.duration);  // sample-accurate scheduling
  }

  setChakraColor(hex) { this._chakraColor = hex; }
}

/**
 * Screen-shake offset at `t` ms after ignition: uniform ±SHAKE_PX·S on each axis, decaying
 * linearly to 0 over SHAKE_MS, plus the zoom `k` that keeps the frame edges covered.
 * @returns {{x:number, y:number, k:number}|null} null when no shake applies
 */
export function shakeAt(t, cfg, S = 1, rng = Math.random, w = 1280, h = 720) {
  if (!cfg.SHAKE || t < 0 || t >= cfg.SHAKE_MS) return null;
  const amp = cfg.SHAKE_PX * S * (1 - t / cfg.SHAKE_MS);
  const k = 1 + (2 * cfg.SHAKE_PX * S) / Math.min(w, h);
  return { x: (rng() * 2 - 1) * amp, y: (rng() * 2 - 1) * amp, k };
}

/** Generate `n` jagged lightning polylines radiating from (cx,cy) out to ~len px. */
function _genArcs(cx, cy, len, n) {
  const arcs = [];
  for (let k = 0; k < n; k++) {
    const baseAngle = Math.random() * Math.PI * 2;
    const segs = 5;
    const pts = [{ x: cx, y: cy }];
    let x = cx, y = cy;
    for (let i = 1; i <= segs; i++) {
      const r = (len / segs) * i;
      const jitter = (Math.random() - 0.5) * 0.6;   // rad wobble
      const ang = baseAngle + jitter;
      x = cx + Math.cos(ang) * r + (Math.random() - 0.5) * len * 0.12;
      y = cy + Math.sin(ang) * r + (Math.random() - 0.5) * len * 0.12;
      pts.push({ x, y });
    }
    arcs.push(pts);
  }
  return arcs;
}

/** '#RRGGBB' + alpha → 'rgba(r,g,b,a)'. Falls back to the hex if it isn't 6-digit. */
function _hexA(hex, alpha) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// A single Sharingan tomoe (comma): round head + curved tapering tail.
// Drawn at (cx,cy), head radius r, rotated by `rot`. Uses current fillStyle.
function _tomoe(ctx, cx, cy, r, rot) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);                 // head
  ctx.fill();
  ctx.beginPath();                                   // tail curling off the head
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(r * 2.6, r * 0.1, r * 0.15, r * 2.2);
  ctx.quadraticCurveTo(r * 0.5, r * 0.4, 0, r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
