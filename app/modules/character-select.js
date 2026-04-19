// character-select.js — Naruto/Sasuke character carousel.
//
// State machine:
//   IDLE → [rising-edge isDualFist, only when fully closed] → SELECTING
//   SELECTING → [isLeftOpenPalm] → CONFIRMING (600ms) → SELECTED
//   SELECTING/SELECTED → [isLeftThumbUp] → IDLE
//
// NOTE: dual fist does NOT re-trigger while carousel is open or closing (animation lock).
//       Left thumb up is the only gesture to exit once open.
// Animation: overlay slides down from top on open, slides back up on close.
// Scroll: delta-based anchored to hand position at fist-engage moment (prevents reset on reposition).
// Keyboard: 'c' open, ArrowLeft/Right scroll, Enter confirm, 'e' exit.

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

const LERP_FACTOR        = 0.20;   // scroll interpolation speed (higher = snappier)
const SCROLL_SENSITIVITY = 2.0;    // amplify hand delta movement for scrolling
const CONFIRM_DURATION   = 600;    // ms for pulse glow before locking selection
const CARD_W             = 160;    // active card width (px)
const CARD_H             = 284;    // active card height (px, 9:16 of 160px)
const INACTIVE_SCALE     = 0.65;   // scale for non-centered cards
const CARD_GAP           = 50;     // gap between card centers beyond card width
const ANIM_SPEED         = 0.12;   // lerp factor per frame for slide animation
const STORAGE_KEY        = 'selectedCharacter';

export default class CharacterSelect {
  constructor() {
    this._state          = STATE.IDLE;
    this._scrollX        = 0;           // current floating card index (0=Naruto, 1=Sasuke)
    this._targetScrollX  = 0;
    this._imgs           = new Array(CHARACTERS.length).fill(null);
    this._confirmStart   = 0;
    this._selected       = 'naruto';  // always default to Naruto on startup (ignore localStorage)

    // Animation
    this._animY          = 0;           // Y-translate offset: 0=visible, -h=off-screen
    this._animState      = 'idle';      // 'idle' | 'opening' | 'open' | 'closing'

    // Scroll anchoring (delta-based, preserves position when hand is repositioned)
    this._fistAnchorX    = 0.5;         // leftHandX at moment fist was engaged
    this._fistBaseScrollX = 0;          // _scrollX at moment fist was engaged

    // Rising-edge tracking
    this._lastDualFist   = false;
    this._lastLeftFist   = false;

    // Cooldown: don't allow re-open until this timestamp (prevents detection-gap false trigger on close)
    this._reopenAfter = 0;
  }

  /** Preload character card images. @param {string} assetsBase e.g. '../assets/characters' */
  loadCards(assetsBase) {
    CHARACTERS.forEach((char, i) => {
      const img = new Image();
      img.src = `${assetsBase}/${char.imgFile}`;
      this._imgs[i] = img;
    });
  }

  /** @returns {'naruto'|'sasuke'} Currently locked character (always set, defaults to 'naruto'). */
  getSelectedCharacter() { return this._selected; }

  /** @returns {boolean} True while carousel overlay should have MLP detection skipped. */
  isActive() { return this._state !== STATE.IDLE; }

  /**
   * Update state machine. Call every frame before render().
   * @param {{ isDualFist, isLeftFist, isLeftOpenPalm, isLeftThumbUp, leftHandX }} g
   */
  update(g) {
    const dualFistRising = g.isDualFist && !this._lastDualFist;

    switch (this._state) {
      case STATE.IDLE:
        // Guard: only open when animation is fully settled AND cooldown has expired.
        // Cooldown prevents detection-gap false rising-edge on the frame after close animation ends.
        // (render()._tickAnimation() sets _animState='idle' AFTER update() runs each frame —
        //  so the next update() sees 'idle' with a potentially stale _lastDualFist=false.)
        if (dualFistRising && this._animState === 'idle' && performance.now() >= this._reopenAfter) {
          this._enterSelecting(g);
        }
        break;

      case STATE.SELECTING:
        if (g.isLeftThumbUp) { this._exitToIdle(); break; }

        // Delta-based scroll: anchor to hand position when fist first engages
        if (g.isLeftFist) {
          if (!this._lastLeftFist) {
            // Rising edge: fist just engaged — set new anchor at current hand + scroll position
            this._fistAnchorX     = g.leftHandX;
            this._fistBaseScrollX = this._scrollX;
          }
          const delta = (g.leftHandX - this._fistAnchorX) * SCROLL_SENSITIVITY * (CHARACTERS.length - 1);
          this._targetScrollX = Math.max(0, Math.min(CHARACTERS.length - 1, this._fistBaseScrollX + delta));
        }
        this._scrollX += (this._targetScrollX - this._scrollX) * LERP_FACTOR;

        // Open palm (no prior-fist requirement) → snap to nearest card and confirm
        if (g.isLeftOpenPalm) {
          this._targetScrollX = Math.round(this._scrollX);
          this._scrollX       = this._targetScrollX;
          this._confirmStart  = performance.now();
          this._state         = STATE.CONFIRMING;
        }

        this._lastLeftFist = g.isLeftFist;
        break;

      case STATE.CONFIRMING: {
        if (g.isLeftThumbUp) { this._exitToIdle(); break; }
        const elapsed = performance.now() - this._confirmStart;
        if (elapsed >= CONFIRM_DURATION) {
          const idx = Math.max(0, Math.min(CHARACTERS.length - 1, Math.round(this._scrollX)));
          this._selected = CHARACTERS[idx].id;
          this._state = STATE.SELECTED;
          console.log(`[character-select] selected: ${this._selected}`);
        }
        break;
      }

      case STATE.SELECTED:
        // Only left thumb up exits — dual fist does nothing while carousel is active.
        if (g.isLeftThumbUp) { this._exitToIdle(); break; }
        break;
    }

    this._lastDualFist = g.isDualFist;
  }

  /**
   * Handle keyboard input. Call from app.js keydown listener.
   * 'c' → open, ArrowLeft/Right → scroll, Enter → confirm, 'e' → exit.
   * @param {string} key  e.key value from KeyboardEvent
   */
  handleKey(key) {
    switch (key) {
      case 'c':
      case 'C':
        if (this._state === STATE.IDLE && this._animState === 'idle' && performance.now() >= this._reopenAfter) {
          this._enterSelecting(null);
        }
        break;

      case 'ArrowLeft':
        if (this._state === STATE.SELECTED) this._state = STATE.SELECTING;
        if (this._state === STATE.SELECTING) {
          this._targetScrollX = Math.max(0, Math.round(this._scrollX) - 1);
          this._scrollX = this._targetScrollX;
        }
        break;

      case 'ArrowRight':
        if (this._state === STATE.SELECTED) this._state = STATE.SELECTING;
        if (this._state === STATE.SELECTING) {
          this._targetScrollX = Math.min(CHARACTERS.length - 1, Math.round(this._scrollX) + 1);
          this._scrollX = this._targetScrollX;
        }
        break;

      case 'Enter':
        if (this._state === STATE.SELECTING) {
          this._targetScrollX = Math.round(this._scrollX);
          this._scrollX       = this._targetScrollX;
          this._confirmStart  = performance.now();
          this._state         = STATE.CONFIRMING;
        }
        break;

      case 'e':
      case 'E':
        if (this._state !== STATE.IDLE) this._exitToIdle();
        break;
    }
  }

  /**
   * Render carousel overlay. Call every frame (no-op when fully closed).
   * @param {CanvasRenderingContext2D} ctx  hudCanvas 2D context
   * @param {number} w  canvas width
   * @param {number} h  canvas height
   */
  render(ctx, w, h) {
    if (h <= 0 || w <= 0) return;
    const isAnimating = this._animState === 'opening' || this._animState === 'closing';
    if (this._state === STATE.IDLE && !isAnimating) return;

    // First frame of opening: initialise _animY off-screen.
    // Check >= -5 handles both first-ever open (_animY=0) and re-open after full close (_animY≈-h).
    if (this._animState === 'opening' && this._animY >= -5) {
      this._animY = -h;
    }

    this._tickAnimation(h);

    ctx.save();
    ctx.translate(0, this._animY);
    this._drawBackground(ctx, w, h);
    this._drawCards(ctx, w, h);
    this._drawLabels(ctx, w, h);
    this._drawStatusText(ctx, w, h);
    ctx.restore();
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────────────────────

  _enterSelecting(g) {
    this._state      = STATE.SELECTING;
    this._animState  = 'opening';
    const initIdx    = Math.max(0, CHARACTERS.findIndex(c => c.id === this._selected));
    this._scrollX    = this._targetScrollX = initIdx;
    this._lastLeftFist    = false;
    this._fistAnchorX     = g ? g.leftHandX : 0.5;
    this._fistBaseScrollX = initIdx;
  }

  _exitToIdle() {
    this._state       = STATE.IDLE;
    this._animState   = 'closing';
    this._reopenAfter = performance.now() + 1600;  // covers full close animation (~43 frames) + buffer
  }

  _tickAnimation(h) {
    if (this._animState === 'opening') {
      this._animY += (0 - this._animY) * ANIM_SPEED;
      if (this._animY > -2) { this._animY = 0; this._animState = 'open'; }
    } else if (this._animState === 'closing') {
      this._animY += (-h - this._animY) * ANIM_SPEED;
      if (this._animY < -h + 2) { this._animY = -h; this._animState = 'idle'; }
    }
  }

  // ─── Private render helpers ──────────────────────────────────────────────────────────────────

  _drawBackground(ctx, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.80)';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';

    const titleY = h * 0.08;
    ctx.font      = 'bold 22px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SELECT CHARACTER', w / 2, titleY);

    ctx.font      = '13px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.fillText('[Fist] scroll  •  [Open palm] select  •  [Thumb up] confirm & exit', w / 2, titleY + 24);
    ctx.restore();
  }

  _drawCards(ctx, w, h) {
    const centerY = h * 0.50;
    const step    = CARD_W + CARD_GAP;

    for (let pass = 0; pass < 2; pass++) {
      CHARACTERS.forEach((char, i) => {
        const offset  = (i - this._scrollX) * step;
        const absOff  = Math.abs(offset);
        const t       = Math.max(0, 1 - absOff / step);
        const isActive = t > 0.5;

        if (pass === 0 && isActive)  return;
        if (pass === 1 && !isActive) return;

        const scale = INACTIVE_SCALE + (1 - INACTIVE_SCALE) * t;
        const cw    = CARD_W * scale;
        const ch    = CARD_H * scale;
        const cx    = w / 2 + offset - cw / 2;
        const cy    = centerY - ch / 2;

        ctx.save();
        const gray = Math.round((1 - t) * 100);
        ctx.filter      = gray > 0 ? `grayscale(${gray}%)` : 'none';
        ctx.globalAlpha = 0.35 + 0.65 * t;

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
    if (this._state === STATE.SELECTED)  return 1.0;
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
      if (t > 0.5) { ctx.shadowColor = char.color; ctx.shadowBlur = 6; }
      ctx.fillText(char.name, cx, cy);
      ctx.restore();
    });
  }

  _drawStatusText(ctx, w, h) {
    if (this._state === STATE.CONFIRMING || this._state === STATE.SELECTED) {
      const idx  = Math.max(0, Math.min(CHARACTERS.length - 1, Math.round(this._scrollX)));
      const char = CHARACTERS.find(c => c.id === this._selected);
      if (!char) return;

      const cardTop = h * 0.50 - CARD_H / 2;
      const statusY = cardTop - 14;

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
