// hud.js — HUD overlay (layer 7)
// All px metrics are authored against a 720p backing store and scaled by
// S = canvas.height / 720 so the HUD keeps the SAME relative size at any camera
// resolution (S12/§E, fixes B16). Positions are S-scaled or fraction-of-frame.
import { log } from './log.js';
import { HUD as HUD_CFG, CHAKRA_DEFAULT } from './config.js';

const REF_H = HUD_CFG.REF_HEIGHT;  // reference height the raw px metrics were tuned against
const SIGN_HYSTERESIS = HUD_CFG.SIGN_HYSTERESIS_FRAMES;  // frames before the pill switches sign

// Consistent activation splash content per jutsu (kanji + romaji). Keyed by the
// name passed to showActivation(). Unknown names fall back to the raw string.
const JUTSU_META = {
  'Shadow Clone Jutsu': { kanji: '影分身', romaji: 'KAGE BUNSHIN' },
  'Rasengan':           { kanji: '螺旋丸', romaji: 'RASENGAN' },
  'Chidori':            { kanji: '千鳥',   romaji: 'CHIDORI' },
  'Fireball':           { kanji: '火遁',   romaji: 'GOKAKYU NO JUTSU' },
};

const SIGN_NAMES = [
  'Ne (Rat)', 'Ushi (Ox)', 'Tora (Tiger)', 'U (Hare)',
  'Tatsu (Dragon)', 'Mi (Snake)', 'Uma (Horse)', 'Hitsuji (Ram)',
  'Saru (Monkey)', 'Tori (Bird)', 'Inu (Dog)', 'I (Boar)',
  'Kage Bunshin', 'None', 'Release'
];

// Image filenames for each class (index = classId; null = no image)
const SIGN_IMAGES = [
  'rat.png', 'ox.png', 'tiger.png', 'hare.png',
  'dragon.png', 'serpent.png', 'horse.png', 'ram.png',
  'monkey.png', 'bird.png', 'dog.png', 'boar.png',
  'shadow_clone.png', null, 'release.png'
];

export default class HUD {
  constructor() {
    this._chakraColor = CHAKRA_DEFAULT;
    this._bottomInset = 0;     // canvas px covered by the DOM controls bar (0 in demo mode)
    this._splash      = null;  // { text, startTime }
    this._signImgs    = {};    // classId → HTMLImageElement (loaded lazily)
    this._imgBase     = '../assets/signs';  // B3: was '/assets/signs' (absolute → 404 off-root)
    this._charHint    = false; // B8/§H: show "make fists to choose character" hint
    this._debug       = log.debugEnabled; // ?debug=1 or 'L' toggle
    this._debugMode   = '';    // current AppState mode name for the debug strip
    // Sign-display hysteresis (S13 Task 4): the pill only switches class after
    // SIGN_HYSTERESIS consecutive frames of a new class → kills single-frame flicker.
    this._dispClass   = 13;
    this._dispConf    = 0;
    this._pendClass   = 13;
    this._pendCount   = 0;
    this._rasenganArmed  = false;  // S15 banner state
    this._rasenganActive = false;
    this._chidoriReady   = false;  // S16 banner state
    this._chidoriActive  = false;
    this._fireballReady  = false;  // S17 banner state
    this._fireballActive = false;
    this._preloadSignImages();
  }

  /** Rasengan HUD banner state (S15). */
  setRasenganState(armed, active) { this._rasenganArmed = !!armed; this._rasenganActive = !!active; }
  /** Chidori HUD banner state (S16). */
  setChidoriState(ready, active) { this._chidoriReady = !!ready; this._chidoriActive = !!active; }
  /** Fireball HUD banner state (S17). */
  setFireballState(ready, active) { this._fireballReady = !!ready; this._fireballActive = !!active; }

  /** Debounce the raw per-frame class into a stable displayed class. */
  _stabilizeSign(classId, confidence) {
    if (classId === this._dispClass) {
      this._dispConf  = confidence;   // same class → just refresh confidence
      this._pendClass = classId;
      this._pendCount = 0;
      return;
    }
    if (classId === this._pendClass) this._pendCount++;
    else { this._pendClass = classId; this._pendCount = 1; }
    if (this._pendCount >= SIGN_HYSTERESIS) {
      this._dispClass = classId;
      this._dispConf  = confidence;
      this._pendCount = 0;
    }
  }

  /** Toggle the "no character selected" hint (B8). White text — never purple on dark. */
  setCharacterHint(show) { this._charHint = !!show; }

  /** Enable/refresh the debug overlay and current mode label (§F). */
  setDebugMode(enabled, modeName) { this._debug = !!enabled; if (modeName != null) this._debugMode = modeName; }

  /** Kick off background image loading for all sign thumbnails. */
  _preloadSignImages() {
    SIGN_IMAGES.forEach((file, id) => {
      if (!file) return;
      const img = new Image();
      img.src = `${this._imgBase}/${file}`;
      this._signImgs[id] = img;
    });
  }

  update(hudCanvas, classId, confidence, seqState, fps) {
    const ctx = hudCanvas.getContext('2d');
    const w = hudCanvas.width, h = hudCanvas.height;
    const S = h / REF_H;   // resolution-independent scale for every px metric
    ctx.clearRect(0, 0, w, h);

    // Activation splash — top-right corner
    this._drawActivationSplash(ctx, w, S);

    // Sign display (top-left) — debounced through hysteresis to kill flicker
    this._stabilizeSign(Number.isInteger(classId) ? classId : 13, confidence);
    const dc = this._dispClass, dcf = this._dispConf;
    if (dc >= 0 && dc <= 14 && dc !== 13 && dcf >= 0.5) {
      this._drawSignDisplay(ctx, dc, dcf, S);
    }

    // Sequence panel (bottom)
    this._drawSequencePanel(ctx, w, h, seqState, S);

    // FPS counter (bottom-right)
    if (fps > 0 && !this._demo) this._drawFPS(ctx, w, h, fps, S);   // no fps counter in demo recordings

    // Character-selection hint (bottom-center) when nothing is confirmed
    if (this._charHint) this._drawCharHint(ctx, w, h, S);

    // Jutsu banner (armed/ready prompt or active label) — Rasengan or Chidori
    if (this._rasenganArmed || this._rasenganActive) {
      this._drawJutsuBanner(ctx, w, h, S,
        this._rasenganActive ? 'RASENGAN' : 'RASENGAN ARMED — open right palm',
        this._rasenganActive, this._rasenganArmed);
    } else if (this._chidoriReady || this._chidoriActive) {
      this._drawJutsuBanner(ctx, w, h, S,
        this._chidoriActive ? 'CHIDORI' : 'CHIDORI READY — open right palm',
        this._chidoriActive, this._chidoriReady);
    } else if (this._fireballReady || this._fireballActive) {
      this._drawJutsuBanner(ctx, w, h, S,
        this._fireballActive ? 'FIREBALL' : 'FIREBALL READY — open your mouth',
        this._fireballActive, this._fireballReady);
    }

    // Debug strip (top-center): state name + last errors (§F)
    if (this._debug) this._drawDebugStrip(ctx, w, fps, S);
  }

  _drawJutsuBanner(ctx, w, h, S, msg, active, pulseCond) {
    ctx.save();
    ctx.font         = `bold ${15 * S}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(msg).width;
    const px = w / 2, py = h * 0.14;
    const padX = 16 * S, boxH = 30 * S;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(ctx, px - tw / 2 - padX, py - boxH / 2, tw + padX * 2, boxH, 8 * S);
    ctx.fill();
    // Chakra border/glow. Pulses gently while armed/ready (not active) to draw the eye.
    const pulse = pulseCond && !active ? 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 350)) : 1;
    ctx.strokeStyle = this._chakraColor;
    ctx.shadowColor = this._chakraColor;
    ctx.shadowBlur  = 10 * S * pulse;
    ctx.lineWidth   = 2 * S;
    roundRect(ctx, px - tw / 2 - padX, py - boxH / 2, tw + padX * 2, boxH, 8 * S);
    ctx.stroke();
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#ffffff';   // white text (hard rule)
    ctx.fillText(msg, px, py + S);
    ctx.restore();
  }

  _drawDebugStrip(ctx, w, fps, S) {
    const errs  = log.getRecentErrors();
    const lines = [`STATE: ${this._debugMode || '—'}   FPS: ${fps || 0}`,
      ...errs.map(e => `⚠ ${e.tag}: ${e.msg}`)];
    ctx.save();
    ctx.font         = `${12 * S}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    const lineH = 16 * S;
    const boxW  = Math.min(w - 20 * S, 520 * S);
    const boxH  = lines.length * lineH + 10 * S;
    const x = w / 2, y = 4 * S;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(ctx, x - boxW / 2, y, boxW, boxH, 6 * S);
    ctx.fill();
    lines.forEach((ln, i) => {
      ctx.fillStyle = i === 0 ? '#8fd3ff' : '#ff9b9b';   // status blue / error red (never purple)
      ctx.fillText(ln, x, y + 5 * S + i * lineH);
    });
    ctx.restore();
  }

  _drawCharHint(ctx, w, h, S) {
    const msg = 'Make fists with both hands to choose a character';
    ctx.save();
    ctx.font         = `bold ${15 * S}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(msg).width;
    const px = w / 2, py = h - this._bottomInset - 24 * S;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, px - tw / 2 - 14 * S, py - 22 * S, tw + 28 * S, 32 * S, 8 * S);
    ctx.fill();
    ctx.fillStyle = '#ffffff';   // white — never purple text on dark bg
    ctx.fillText(msg, px, py);
    ctx.restore();
  }

  _drawFPS(ctx, w, h, fps, S) {
    const color = fps >= 25 ? '#4ade80' : fps >= 15 ? '#facc15' : '#f87171';
    ctx.save();
    ctx.font         = `${11 * S}px monospace`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle    = 'rgba(0,0,0,0.45)';
    ctx.fillText(`${fps} fps`, w - 10 * S, h - this._bottomInset - 12 * S);
    ctx.fillStyle    = color;
    ctx.globalAlpha  = 0.7;
    ctx.fillText(`${fps} fps`, w - 10 * S, h - this._bottomInset - 12 * S);
    ctx.restore();
  }

  _drawSignDisplay(ctx, classId, confidence, S) {
    const name = SIGN_NAMES[classId];
    const pct  = Math.round(confidence * 100);
    const img  = this._signImgs[classId];
    const hasImg = img && img.complete && img.naturalWidth > 0;

    ctx.save();
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';

    // Background pill — wider when image is present
    const pillW = (hasImg ? 390 : 320) * S;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    roundRect(ctx, 10 * S, 6 * S, pillW, 90 * S, 10 * S);
    ctx.fill();

    if (hasImg) {
      // Sign thumbnail (72×72, clipped to pill interior)
      ctx.save();
      roundRect(ctx, 14 * S, 12 * S, 72 * S, 72 * S, 6 * S);
      ctx.clip();
      ctx.drawImage(img, 14 * S, 12 * S, 72 * S, 72 * S);
      ctx.restore();

      // Thin chakra-colored border around thumbnail
      ctx.strokeStyle = this._chakraColor;
      ctx.lineWidth   = 2 * S;
      roundRect(ctx, 14 * S, 12 * S, 72 * S, 72 * S, 6 * S);
      ctx.stroke();

      // Sign name — offset right of image
      ctx.font      = `bold ${20 * S}px monospace`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(name, 96 * S, 40 * S);

      // Confidence bar background
      ctx.fillStyle = '#333';
      roundRect(ctx, 96 * S, 54 * S, 258 * S, 12 * S, 5 * S);
      ctx.fill();

      // Confidence bar fill
      ctx.fillStyle = `hsl(${confidence * 40}, 100%, 55%)`;
      roundRect(ctx, 96 * S, 54 * S, Math.round(258 * S * confidence), 12 * S, 5 * S);
      ctx.fill();

      // Percentage
      ctx.font      = `${14 * S}px monospace`;
      ctx.fillStyle = '#ccc';
      ctx.fillText(`${pct}%`, 362 * S, 70 * S);
    } else {
      // No image — text-only layout
      ctx.font      = `bold ${22 * S}px monospace`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(name, 20 * S, 42 * S);

      ctx.fillStyle = '#333';
      roundRect(ctx, 20 * S, 56 * S, 262 * S, 12 * S, 5 * S);
      ctx.fill();

      ctx.fillStyle = `hsl(${confidence * 40}, 100%, 55%)`;
      roundRect(ctx, 20 * S, 56 * S, Math.round(262 * S * confidence), 12 * S, 5 * S);
      ctx.fill();

      ctx.font      = `${14 * S}px monospace`;
      ctx.fillStyle = '#ccc';
      ctx.fillText(`${pct}%`, 290 * S, 72 * S);
    }

    ctx.restore();
  }

  _drawActivationSplash(ctx, w, S) {
    if (!this._splash) return;
    const elapsed = performance.now() - this._splash.startTime;
    let alpha;
    if      (elapsed < 100)  alpha = elapsed / 100;
    else if (elapsed < 1100) alpha = 1.0;
    else if (elapsed < 1600) alpha = 1.0 - (elapsed - 1100) / 500;
    else { this._splash = null; return; }

    const meta   = JUTSU_META[this._splash.text] ??
                   { kanji: '', romaji: this._splash.text.toUpperCase() };

    const pillW = 260 * S, pillH = 78 * S;
    const x = w - pillW - 10 * S;
    const y = 8 * S;

    ctx.save();
    ctx.globalAlpha  = alpha;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';

    // Background pill
    ctx.fillStyle = 'rgba(0,0,0,0.66)';
    roundRect(ctx, x, y, pillW, pillH, 10 * S);
    ctx.fill();

    // Glow border — uses current chakra color (matches character theme)
    ctx.strokeStyle = this._chakraColor;
    ctx.lineWidth   = 1.6 * S;
    ctx.shadowColor = this._chakraColor;
    ctx.shadowBlur  = 10 * S;
    roundRect(ctx, x, y, pillW, pillH, 10 * S);
    ctx.stroke();
    ctx.shadowBlur  = 0;

    const tx = x + 14 * S;
    // Big kanji (chakra-glow, white fill) — the visual anchor
    if (meta.kanji) {
      ctx.font        = `bold ${34 * S}px 'Yu Gothic', 'Noto Sans JP', sans-serif`;
      ctx.fillStyle   = '#ffffff';
      ctx.shadowColor = this._chakraColor;
      ctx.shadowBlur  = 12 * S;
      ctx.fillText(meta.kanji, tx, y + 48 * S);
      ctx.shadowBlur  = 0;
    }
    // Romaji jutsu name — right-aligned block, white
    ctx.textAlign = 'right';
    ctx.font      = `bold ${15 * S}px monospace`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(meta.romaji, x + pillW - 14 * S, y + 34 * S);
    // "JUTSU" label under the romaji
    ctx.font      = `${10 * S}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('JUTSU ACTIVATED', x + pillW - 14 * S, y + 52 * S);

    ctx.restore();
  }

  _drawSequencePanel(ctx, w, h, seqState, S) {
    if (!seqState || !seqState.jutsuName) return;
    const cards  = [...(seqState.completed ?? []), ...(seqState.pending ?? [])];
    if (cards.length === 0) return;
    const cardW  = 64 * S, cardH = 80 * S, gap = 8 * S;
    const totalW = cards.length * (cardW + gap) - gap + 40 * S;
    const panelX = (w - totalW) / 2;
    const panelY = h - this._bottomInset - cardH - 30 * S;

    ctx.save();
    // Panel background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    roundRect(ctx, panelX - 10 * S, panelY - 32 * S, totalW + 20 * S, cardH + 44 * S, 10 * S);
    ctx.fill();
    ctx.font      = `bold ${12 * S}px monospace`;
    ctx.fillStyle = '#ffffff';   // D-03: text stays white; chakra colour only on borders/glow
    ctx.textAlign = 'center';
    ctx.fillText(seqState.jutsuName.toUpperCase(), w / 2, panelY - 12 * S);

    cards.forEach((card, i) => {
      const cx     = panelX + 20 * S + i * (cardW + gap);
      const isDone = i < seqState.completed.length;
      const signImg = this._signImgs[card];
      const hasSignImg = signImg && signImg.complete && signImg.naturalWidth > 0;

      // Card background
      ctx.fillStyle = isDone ? _hexA(this._chakraColor, 0.3) : 'rgba(20,20,40,0.8)';
      roundRect(ctx, cx, panelY, cardW, cardH, 6 * S);
      ctx.fill();

      // Card border
      ctx.strokeStyle = isDone ? this._chakraColor : '#333';
      ctx.lineWidth   = isDone ? 2 * S : 1 * S;
      roundRect(ctx, cx, panelY, cardW, cardH, 6 * S);
      ctx.stroke();

      // Sign image inside card
      if (hasSignImg) {
        const imgPad = 6 * S;
        const imgSize = cardW - imgPad * 2;
        ctx.save();
        ctx.globalAlpha = isDone ? 1.0 : 0.35;
        roundRect(ctx, cx + imgPad, panelY + imgPad, imgSize, imgSize, 4 * S);
        ctx.clip();
        ctx.drawImage(signImg, cx + imgPad, panelY + imgPad, imgSize, imgSize);
        ctx.restore();
      }

      // Label below image
      const labelY = panelY + cardH - 10 * S;
      ctx.font        = isDone ? `bold ${10 * S}px monospace` : `${10 * S}px monospace`;
      ctx.fillStyle   = isDone ? '#ffffff' : '#888';   // D-03: white text, chakra glow
      ctx.shadowColor = isDone ? this._chakraColor : 'transparent';
      ctx.shadowBlur  = isDone ? 6 * S : 0;
      ctx.textAlign   = 'center';
      const label = (SIGN_NAMES[card] ?? '???').split(' ')[0];
      ctx.fillText(label, cx + cardW / 2, labelY);
      ctx.shadowBlur = 0;
    });

    ctx.restore();
  }

  showActivation(jutsuName) {
    this._splash = { text: jutsuName, startTime: performance.now() };
    console.log(`[hud] activation splash: ${jutsuName}`);
  }

  setChakraColor(hex) { this._chakraColor = hex; }

  /** Keep bottom-anchored HUD elements above the DOM controls bar. @param {number} px canvas px */
  setBottomInset(px) { this._bottomInset = Math.max(0, px || 0); }

  /** Demo mode: hide developer readouts (fps) so recordings stay clean. */
  setDemoMode(on) { this._demo = !!on; }
}

function roundRect(ctx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** '#RRGGBB' + alpha → 'rgba(r,g,b,a)'. Falls back to the hex if it isn't 6-digit. */
function _hexA(hex, alpha) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}
