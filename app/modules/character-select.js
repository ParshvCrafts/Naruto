// character-select.js — Naruto/Sasuke character carousel.
//
// State machine:
//   IDLE → [isDualFist] → SELECTING → [isLeftOpenPalm released from fist] → CONFIRMING (600ms)
//        → SELECTED → [isDualFist] → SELECTING (re-trigger)
//
// Render: draws on hudCanvas (passed as ctx param) so overlay sits on top of all other layers.
// Images: loadCards(assetsBase) loads naruto.jpg + sasuke.jpg from assets/characters/.
// Persistence: getSelectedCharacter() reads localStorage on init; saves on selection.

const STATE = Object.freeze({
  IDLE:       'idle',
  SELECTING:  'selecting',
  CONFIRMING: 'confirming',
  SELECTED:   'selected',
});

const CHARACTERS = [
  { id: 'naruto', name: 'NARUTO', color: '#ff6b00', imgFile: 'naruto.jpg' },
  { id: 'sasuke', name: 'SASUKE', color: '#9C27B0', imgFile: 'sasuke.jpg' },
];

const LERP_FACTOR      = 0.20;   // scroll interpolation speed per frame (higher = snappier)
const SCROLL_SENSITIVITY = 2.2;  // amplify hand-position mapping (2.0 = half frame width covers full range)
const CONFIRM_DURATION = 600;    // ms for pulse glow before locking selection
const CARD_W           = 160;    // active card width (px in canvas space)
const CARD_H           = 284;    // active card height (9:16 of 160px)
const INACTIVE_SCALE   = 0.65;   // scale factor for non-centered cards
const CARD_GAP         = 50;     // extra gap between card centers beyond card width
const STORAGE_KEY      = 'selectedCharacter';

export default class CharacterSelect {
  constructor() {
    this._state         = STATE.IDLE;
    this._scrollX       = 0;           // current floating card index (0=Naruto, 1=Sasuke)
    this._targetScrollX = 0;
    this._imgs          = new Array(CHARACTERS.length).fill(null);
    this._confirmStart  = 0;
    this._selected      = null;        // 'naruto' | 'sasuke' | null
    this._lastLeftFist  = false;       // edge-detect fist→open-palm transition
    // Restore persisted selection immediately so app.js can read on first frame
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) this._selected = saved;
  }

  /**
   * Preload character card images.
   * @param {string} assetsBase  e.g. '../assets/characters'
   */
  loadCards(assetsBase) {
    CHARACTERS.forEach((char, i) => {
      const img = new Image();
      img.src = `${assetsBase}/${char.imgFile}`;
      this._imgs[i] = img;
    });
  }

  /**
   * Update state machine. Call every frame before render().
   * @param {{ isDualFist:boolean, isLeftFist:boolean, isLeftOpenPalm:boolean, leftHandX:number }} g
   */
  update(g) {
    switch (this._state) {
      case STATE.IDLE:
        if (g.isDualFist) {
          this._state = STATE.SELECTING;
          // Init scroll to previously selected card (or default 0)
          const initIdx = Math.max(0, CHARACTERS.findIndex(c => c.id === this._selected));
          this._scrollX = this._targetScrollX = initIdx;
          this._lastLeftFist = true;  // starting in fist state
        }
        break;

      case STATE.SELECTING:
        // Thumb-up on right hand → exit overlay without changing selection
        if (g.isRightThumbUp) {
          this._state        = STATE.IDLE;
          this._lastLeftFist = false;
          break;
        }

        // Map left hand wrist x (0→1) to target card index, with center-biased sensitivity.
        // SCROLL_SENSITIVITY=2.2 means moving hand ±0.23 from center reaches either end.
        if (g.isLeftFist) {
          const amplified = (g.leftHandX - 0.5) * SCROLL_SENSITIVITY + 0.5;
          const clamped   = Math.max(0, Math.min(1, amplified));
          this._targetScrollX = clamped * (CHARACTERS.length - 1);
        }
        // Lerp toward target each frame
        this._scrollX += (this._targetScrollX - this._scrollX) * LERP_FACTOR;

        // Detect fist→open-palm transition (was fist last frame, now open palm)
        if (g.isLeftOpenPalm && this._lastLeftFist) {
          // Snap to nearest card and begin confirmation
          this._targetScrollX = Math.round(this._scrollX);
          this._scrollX       = this._targetScrollX;
          this._confirmStart  = performance.now();
          this._state         = STATE.CONFIRMING;
        }
        this._lastLeftFist = g.isLeftFist;
        break;

      case STATE.CONFIRMING: {
        const elapsed = performance.now() - this._confirmStart;
        if (elapsed >= CONFIRM_DURATION) {
          const idx = Math.max(0, Math.min(CHARACTERS.length - 1, Math.round(this._scrollX)));
          this._selected = CHARACTERS[idx].id;
          localStorage.setItem(STORAGE_KEY, this._selected);
          this._state = STATE.SELECTED;
          console.log(`[character-select] selected: ${this._selected}`);
        }
        break;
      }

      case STATE.SELECTED:
        // Thumb-up on right hand → dismiss overlay, keep selection, return to IDLE
        if (g.isRightThumbUp) {
          this._state = STATE.IDLE;
          break;
        }
        if (g.isDualFist) {
          this._state = STATE.SELECTING;
          this._lastLeftFist = false;
        }
        break;
    }
  }

  /** @returns {'naruto'|'sasuke'|null} Currently locked character, or null. */
  getSelectedCharacter() { return this._selected; }

  /** @returns {boolean} True while carousel overlay should be drawn. */
  isActive() { return this._state !== STATE.IDLE; }

  /**
   * Render carousel overlay. Call every frame after hud.update().
   * @param {CanvasRenderingContext2D} ctx  hudCanvas 2D context
   * @param {number} w  canvas width
   * @param {number} h  canvas height
   */
  render(ctx, w, h) {
    if (this._state === STATE.IDLE) return;
    this._drawBackground(ctx, w, h);
    this._drawCards(ctx, w, h);
    this._drawLabels(ctx, w, h);
    this._drawStatusText(ctx, w, h);
  }

  // ─── Private render helpers ──────────────────────────────────────────────────────

  _drawBackground(ctx, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';

    // Title — anchored above card area with generous room
    const titleY = h * 0.08;
    ctx.font      = 'bold 22px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SELECT CHARACTER', w / 2, titleY);

    // Instructions
    ctx.font      = '13px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.fillText('✊  Move fist to scroll   •   ✋  Open palm to select   •   👍  Confirm & exit', w / 2, titleY + 24);
    ctx.restore();
  }

  _drawCards(ctx, w, h) {
    const centerY = h * 0.50;
    const step    = CARD_W + CARD_GAP;

    // Draw inactive cards first (behind active)
    for (let pass = 0; pass < 2; pass++) {
      CHARACTERS.forEach((char, i) => {
        const offset  = (i - this._scrollX) * step;
        const absOff  = Math.abs(offset);
        const t       = Math.max(0, 1 - absOff / step);  // 1.0 at center, 0 at step away
        const isActive = t > 0.5;

        if (pass === 0 && isActive)  return;  // skip active in first pass
        if (pass === 1 && !isActive) return;  // skip inactive in second pass

        const scale = INACTIVE_SCALE + (1 - INACTIVE_SCALE) * t;
        const cw    = CARD_W * scale;
        const ch    = CARD_H * scale;
        const cx    = w / 2 + offset - cw / 2;
        const cy    = centerY - ch / 2;

        ctx.save();

        // Grayscale + opacity for non-centered cards
        const gray = Math.round((1 - t) * 100);
        ctx.filter      = gray > 0 ? `grayscale(${gray}%)` : 'none';
        ctx.globalAlpha = 0.35 + 0.65 * t;

        // Draw image or colored fallback
        const img = this._imgs[i];
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, cx, cy, cw, ch);
        } else {
          ctx.fillStyle = char.color;
          ctx.fillRect(cx, cy, cw, ch);
          ctx.filter    = 'none';
          ctx.fillStyle = '#ffffff';
          ctx.font      = `bold ${Math.round(16 * scale)}px monospace`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(char.name, cx + cw / 2, cy + ch / 2);
        }

        ctx.filter = 'none';

        // Glow border (only for near-active card)
        const glowIntensity = this._getGlowIntensity(i);
        if (glowIntensity > 0 && t > 0.3) {
          ctx.shadowColor = char.color;
          ctx.shadowBlur  = 14 + 26 * glowIntensity;
          ctx.strokeStyle = char.color;
          ctx.lineWidth   = 2.5 + 2.5 * glowIntensity;
          ctx.globalAlpha = 0.80 + 0.20 * glowIntensity;
          ctx.strokeRect(cx, cy, cw, ch);
          ctx.shadowBlur  = 0;
        }

        ctx.restore();
      });
    }
  }

  _getGlowIntensity(cardIndex) {
    const activeIdx = Math.round(this._scrollX);
    if (cardIndex !== activeIdx) return 0;
    if (this._state === STATE.CONFIRMING) {
      return Math.min(1, (performance.now() - this._confirmStart) / CONFIRM_DURATION);
    }
    if (this._state === STATE.SELECTED) return 1.0;
    if (this._state === STATE.SELECTING) return 0.25;
    return 0;
  }

  _drawLabels(ctx, w, h) {
    const centerY = h * 0.50;
    const step    = CARD_W + CARD_GAP;

    CHARACTERS.forEach((char, i) => {
      const offset = (i - this._scrollX) * step;
      const t      = Math.max(0, 1 - Math.abs(offset) / step);
      const scale  = INACTIVE_SCALE + (1 - INACTIVE_SCALE) * t;
      const cx     = w / 2 + offset;
      const cy     = centerY + (CARD_H * scale) / 2 + 22;

      ctx.save();
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font         = `bold ${Math.round(16 * scale)}px monospace`;
      ctx.fillStyle    = t > 0.5 ? char.color : 'rgba(255,255,255,0.35)';
      ctx.globalAlpha  = 0.35 + 0.65 * t;
      if (t > 0.5) {
        ctx.shadowColor = char.color;
        ctx.shadowBlur  = 6;
      }
      ctx.fillText(char.name, cx, cy);
      ctx.restore();
    });
  }

  _drawStatusText(ctx, w, h) {
    if (this._state === STATE.CONFIRMING || this._state === STATE.SELECTED) {
      const idx  = Math.max(0, Math.min(CHARACTERS.length - 1, Math.round(this._scrollX)));
      const char = CHARACTERS.find(c => c.id === (this._selected ?? CHARACTERS[idx].id));
      if (!char) return;

      // Place status text just above the active card's top edge
      const cardTop   = h * 0.50 - CARD_H / 2;
      const statusY   = cardTop - 14;

      ctx.save();
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font         = 'bold 15px monospace';
      ctx.fillStyle    = char.color;
      ctx.shadowColor  = char.color;
      ctx.shadowBlur   = 12;
      const label = this._state === STATE.SELECTED ? '✦  CHARACTER LOCKED IN  ✦' : '⟳  LOCKING IN...';
      ctx.fillText(label, w / 2, statusY);
      ctx.restore();
    }
  }
}
