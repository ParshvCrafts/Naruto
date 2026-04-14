// hud.js — HUD overlay (layer 7)
const SIGN_NAMES = [
  'Ne (Rat)', 'Ushi (Ox)', 'Tora (Tiger)', 'U (Hare)',
  'Tatsu (Dragon)', 'Mi (Snake)', 'Uma (Horse)', 'Hitsuji (Ram)',
  'Saru (Monkey)', 'Tori (Bird)', 'Inu (Dog)', 'I (Boar)',
  'Kage Bunshin', 'None'
];

// Image filenames for each class (index = classId; null = no image)
const SIGN_IMAGES = [
  'rat.png', 'ox.png', 'tiger.png', 'hare.png',
  'dragon.png', 'serpent.png', 'horse.png', 'ram.png',
  'monkey.png', 'bird.png', 'dog.png', 'boar.png',
  'shadow_clone.png', null
];

export default class HUD {
  constructor() {
    this._chakraColor = '#00BFFF';
    this._splash      = null;  // { text, startTime }
    this._signImgs    = {};    // classId → HTMLImageElement (loaded lazily)
    this._imgBase     = '/assets/signs';
    this._preloadSignImages();
  }

  /** Kick off background image loading for all sign thumbnails. */
  _preloadSignImages() {
    SIGN_IMAGES.forEach((file, id) => {
      if (!file) return;
      const img = new Image();
      img.src = `${this._imgBase}/${file}`;
      this._signImgs[id] = img;
    });
  }

  update(hudCanvas, classId, confidence, seqState) {
    const ctx = hudCanvas.getContext('2d');
    ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);

    // Activation splash — centered, drawn first so it appears behind sign display
    if (this._splash) {
      const elapsed = performance.now() - this._splash.startTime;
      let alpha;
      if      (elapsed < 100)  alpha = elapsed / 100;
      else if (elapsed < 1100) alpha = 1.0;
      else if (elapsed < 1600) alpha = 1.0 - (elapsed - 1100) / 500;
      else { this._splash = null; alpha = 0; }

      if (alpha > 0) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font        = 'bold 48px serif';
        ctx.fillStyle   = '#ff6b00';
        ctx.shadowColor = '#ff6b00';
        ctx.shadowBlur  = 20;
        ctx.textAlign   = 'center';
        ctx.fillText(this._splash.text.toUpperCase(), hudCanvas.width / 2, hudCanvas.height / 2);
        ctx.font       = '20px monospace';
        ctx.fillStyle  = '#fff';
        ctx.shadowBlur = 0;
        ctx.fillText('JUTSU ACTIVATED', hudCanvas.width / 2, hudCanvas.height / 2 + 36);
        ctx.restore();
      }
    }

    // Sign display (top-left)
    if (classId !== 13 && classId >= 0 && classId <= 12 && Number.isInteger(classId) && confidence >= 0.5) {
      this._drawSignDisplay(ctx, classId, confidence);
    }

    // Sequence panel (bottom) — shows progress through a multi-sign jutsu sequence
    this._drawSequencePanel(ctx, hudCanvas.width, hudCanvas.height, seqState);
  }

  _drawSignDisplay(ctx, classId, confidence) {
    const name = SIGN_NAMES[classId];
    const pct  = Math.round(confidence * 100);
    const img  = this._signImgs[classId];
    const hasImg = img && img.complete && img.naturalWidth > 0;

    ctx.save();
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';

    // Background pill — wider when image is present
    const pillW = hasImg ? 268 : 220;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    roundRect(ctx, 10, 8, pillW, 56, 8);
    ctx.fill();

    if (hasImg) {
      // Sign thumbnail (44×44, clipped to pill interior)
      ctx.save();
      roundRect(ctx, 14, 12, 44, 44, 5);
      ctx.clip();
      ctx.drawImage(img, 14, 12, 44, 44);
      ctx.restore();

      // Thin orange border around thumbnail
      ctx.strokeStyle = this._chakraColor;
      ctx.lineWidth   = 1.5;
      roundRect(ctx, 14, 12, 44, 44, 5);
      ctx.stroke();

      // Sign name — offset right of image
      ctx.font      = 'bold 14px monospace';
      ctx.fillStyle = this._chakraColor;
      ctx.fillText(name, 64, 28);

      // Confidence bar background
      ctx.fillStyle = '#333';
      roundRect(ctx, 64, 36, 178, 8, 4);
      ctx.fill();

      // Confidence bar fill
      ctx.fillStyle = `hsl(${confidence * 40}, 100%, 55%)`;
      roundRect(ctx, 64, 36, Math.round(178 * confidence), 8, 4);
      ctx.fill();

      // Percentage
      ctx.font      = '11px monospace';
      ctx.fillStyle = '#ccc';
      ctx.fillText(`${pct}%`, 248, 44);
    } else {
      // No image — original text-only layout
      ctx.font      = 'bold 16px monospace';
      ctx.fillStyle = this._chakraColor;
      ctx.fillText(name, 20, 32);

      ctx.fillStyle = '#333';
      roundRect(ctx, 20, 38, 180, 8, 4);
      ctx.fill();

      ctx.fillStyle = `hsl(${confidence * 40}, 100%, 55%)`;
      roundRect(ctx, 20, 38, Math.round(180 * confidence), 8, 4);
      ctx.fill();

      ctx.font      = '12px monospace';
      ctx.fillStyle = '#ccc';
      ctx.fillText(`${pct}%`, 206, 46);
    }

    ctx.restore();
  }

  _drawSequencePanel(ctx, w, h, seqState) {
    if (!seqState || !seqState.jutsuName) return;
    const cards  = [...(seqState.completed ?? []), ...(seqState.pending ?? [])];
    if (cards.length === 0) return;
    const cardW  = 64, cardH = 80, gap = 8;
    const totalW = cards.length * (cardW + gap) - gap + 40;
    const panelX = (w - totalW) / 2;
    const panelY = h - cardH - 30;

    ctx.save();
    // Panel background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    roundRect(ctx, panelX - 10, panelY - 32, totalW + 20, cardH + 44, 10);
    ctx.fill();
    ctx.font      = 'bold 12px monospace';
    ctx.fillStyle = '#ff6b00';
    ctx.textAlign = 'center';
    ctx.fillText(seqState.jutsuName.toUpperCase(), w / 2, panelY - 12);

    cards.forEach((card, i) => {
      const cx     = panelX + 20 + i * (cardW + gap);
      const isDone = i < seqState.completed.length;
      const signImg = this._signImgs[card];
      const hasSignImg = signImg && signImg.complete && signImg.naturalWidth > 0;

      // Card background
      ctx.fillStyle = isDone ? 'rgba(255,107,0,0.3)' : 'rgba(20,20,40,0.8)';
      roundRect(ctx, cx, panelY, cardW, cardH, 6);
      ctx.fill();

      // Card border
      ctx.strokeStyle = isDone ? '#ff6b00' : '#333';
      ctx.lineWidth   = isDone ? 2 : 1;
      roundRect(ctx, cx, panelY, cardW, cardH, 6);
      ctx.stroke();

      // Sign image inside card
      if (hasSignImg) {
        const imgPad = 6;
        const imgSize = cardW - imgPad * 2;
        ctx.save();
        ctx.globalAlpha = isDone ? 1.0 : 0.35;
        roundRect(ctx, cx + imgPad, panelY + imgPad, imgSize, imgSize, 4);
        ctx.clip();
        ctx.drawImage(signImg, cx + imgPad, panelY + imgPad, imgSize, imgSize);
        ctx.restore();
      }

      // Label below image
      const labelY = panelY + cardH - 10;
      ctx.font        = isDone ? 'bold 10px monospace' : '10px monospace';
      ctx.fillStyle   = isDone ? '#ff6b00' : '#555';
      ctx.shadowColor = isDone ? '#ff6b00' : 'transparent';
      ctx.shadowBlur  = isDone ? 6 : 0;
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
