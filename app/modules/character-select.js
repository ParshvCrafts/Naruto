// character-select.js — Naruto/Sasuke character carousel.
//
// Open gesture:   Rising edge of both-fists (same frame both hands first form a fist)
// Re-open:        Rising edge of both-fists while menu is open → restarts slide-in animation
// Scroll:         config CAROUSEL.SCROLL_MODE — 'index' (default: left index point + move),
//                 'palm' or 'twofinger' (legacy)
// Confirm:        Left open palm held for CONFIRM_MS → character locked in
// Exit:           Left thumb up (only after character is locked in)
//
// State machine:
//   IDLE → [dualFistRising] → OPEN → [left thumb up after locked] → CLOSING → IDLE
//
// Animation is fully time-based (easeOutCubic) — no lerp, no floating-point loop risk.

import { CAROUSEL, CHAKRA } from './config.js';

const SLIDE_IN_MS      = CAROUSEL.SLIDE_IN_MS;
const SLIDE_OUT_MS     = CAROUSEL.SLIDE_OUT_MS;
const CONFIRM_MS       = CAROUSEL.CONFIRM_MS;
const GESTURE_DELAY_MS = CAROUSEL.GESTURE_DELAY_MS;
const REOPEN_COOLDOWN  = CAROUSEL.REOPEN_COOLDOWN;
const LERP_FACTOR        = CAROUSEL.LERP_FACTOR;
const SCROLL_SENSITIVITY = CAROUSEL.SCROLL_SENSITIVITY;
const CARD_W           = CAROUSEL.CARD_W;
const CARD_H           = CAROUSEL.CARD_H;
const INACTIVE_SCALE   = CAROUSEL.INACTIVE_SCALE;
const CARD_GAP         = CAROUSEL.CARD_GAP;
const OPEN_FRAMES      = CAROUSEL.OPEN_FRAMES;
const RETRIGGER_LOCK_MS = CAROUSEL.RETRIGGER_LOCK_MS;
const SCROLL_MODE      = CAROUSEL.SCROLL_MODE;
const EMA_ALPHA        = CAROUSEL.EMA_ALPHA;
const PAGE_DX          = CAROUSEL.PAGE_DX;
const PAGE_COOLDOWN_MS = CAROUSEL.PAGE_COOLDOWN_MS;
const STILL_EPS        = CAROUSEL.STILL_EPS;

const STATE = Object.freeze({ IDLE: 'idle', OPEN: 'open', CLOSING: 'closing' });

const PERSIST_KEY = 'selectedCharacter';   // localStorage key for the confirmed character (B8)

const CHARACTERS = [
  { id: 'naruto', name: 'NARUTO', color: CHAKRA.naruto, imgFile: 'naruto.jpg' },
  { id: 'sasuke', name: 'SASUKE', color: CHAKRA.sasuke, imgFile: 'sasuke.jpg' },
];

const REF_H = 720;   // card px metrics authored at 720p; scaled by S = h/REF_H (S12/§E)

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

export default class CharacterSelect {
  constructor() {
    this._state         = STATE.IDLE;
    // Highlighted card during carousel navigation (NOT the confirmed pick).
    this._selected      = 'naruto';
    // B8: the CONFIRMED character. null until the user explicitly locks one in.
    // A persisted value counts as confirmed (restored below).
    this._confirmedChar = null;
    this._loadPersisted();
    this._imgs          = new Array(CHARACTERS.length).fill(null);

    // Scroll
    this._scrollX       = 0;
    this._targetScrollX = 0;

    // Confirmation sub-state (within OPEN)
    this._confirming    = false;
    this._confirmStart  = 0;
    this._locked        = false;

    // Time-based animation — no lerp, guaranteed to complete
    this._lastH         = 480;        // canvas height from last render(); used in _getAnimY
    this._animating     = false;
    this._animStartTime = 0;
    this._animDuration  = 0;
    this._animFromY     = -480;
    this._animToY       = 0;

    // Scroll delta anchoring
    this._scrollAnchorX   = 0.5;
    this._scrollBaseX     = 0;

    // Track previous frame gestures (rising-edge detection)
    this._lastDualFist    = false;
    this._lastScrollGest  = false;    // NOT updated during gesture delay — see update()
    this._dualFistFrames  = 0;        // consecutive dual-fist frames (open debounce, S14)

    // Palm-swipe paging state (S14)
    this._emaX            = null;     // EMA-smoothed left-hand x
    this._lastEmaX        = null;
    this._pageAnchorX     = 0;        // x where the current page began
    this._pageCooldownUntil = 0;      // earliest time to page again
    this._stillStart      = 0;        // when the palm started holding still (confirm accrual)
    this._lockBurst       = 0;        // timestamp of last lock (expanding-ring flourish)

    // Timestamp when OPEN was entered (or re-animated) — gates scroll/confirm
    this._openedAt      = 0;

    // Cooldown: earliest time a new open is allowed after close
    this._reopenAfter   = 0;
  }

  /** Preload character card images. @param {string} assetsBase path to characters folder */
  loadCards(assetsBase) {
    CHARACTERS.forEach((char, i) => {
      const img = new Image();
      img.src = `${assetsBase}/${char.imgFile}`;
      this._imgs[i] = img;
    });
  }

  /**
   * @returns {'naruto'|'sasuke'|null} The CONFIRMED character, or null until the user
   * explicitly locks one in (B8). Engine with null activates no jutsu.
   */
  getSelectedCharacter() { return this._confirmedChar; }

  /** @returns {boolean} True once a character has been confirmed (this session or persisted). */
  hasConfirmed() { return this._confirmedChar !== null; }

  /** Restore a previously-confirmed character from localStorage. Restoring = confirmed. */
  _loadPersisted() {
    try {
      const saved = localStorage.getItem(PERSIST_KEY);
      if (saved && CHARACTERS.some(c => c.id === saved)) {
        this._confirmedChar = saved;
        this._selected      = saved;   // highlight the restored pick when carousel opens
      }
    } catch { /* localStorage unavailable — start unconfirmed */ }
  }

  /** Persist + mark a character as confirmed. */
  _confirm(id) {
    this._selected      = id;
    this._confirmedChar = id;
    this._locked        = true;
    this._confirming    = false;
    this._lockBurst     = performance.now();  // triggers the expanding-ring flourish (S14)
    try { localStorage.setItem(PERSIST_KEY, id); } catch { /* ignore */ }
    console.log(`[character-select] confirmed: ${id}`);
  }

  /** @returns {boolean} True while carousel overlay is visible — MLP detection should be skipped. */
  isActive() { return this._state !== STATE.IDLE; }

  /**
   * Update state machine. Call every frame before render().
   * @param {{ isDualFist, isLeftTwoFingers, isLeftOpenPalm, isLeftThumbUp, leftHandX }} g
   */
  update(g) {
    const now = performance.now();

    // ── Advance animation, complete state transition ──────────────────────────────
    if (this._animating) {
      const t = (now - this._animStartTime) / this._animDuration;
      if (t >= 1) {
        this._animating = false;
        if (this._state === STATE.CLOSING) {
          this._state     = STATE.IDLE;
          this._reopenAfter = now + REOPEN_COOLDOWN;
        }
      }
    }

    // Open debounce (S14): require OPEN_FRAMES consecutive dual-fist frames so a
    // single flickering fist can't repeatedly re-trigger / restart the slide-in.
    this._dualFistFrames = g.isDualFist ? this._dualFistFrames + 1 : 0;
    const dualFistHeld = this._dualFistFrames === OPEN_FRAMES;  // fire once, on the crossing frame

    // ── State machine ─────────────────────────────────────────────────────────────
    switch (this._state) {
      case STATE.IDLE:
        if (dualFistHeld && now >= this._reopenAfter) {
          this._openMenu(now);
        }
        break;

      case STATE.OPEN: {
        // Exit: left thumb up, but only after character is locked in
        if (g.isLeftThumbUp && this._locked) {
          this._closeMenu(now);
          break;
        }

        // Re-animate: dual-fist held again while open → restart slide-in, but only
        // after RETRIGGER_LOCK_MS so the opening animation isn't stuttered by flicker.
        if (dualFistHeld && now - this._openedAt >= RETRIGGER_LOCK_MS) {
          this._restartOpenAnim(now);
          break;
        }

        // Gesture delay: ignore scroll/confirm while the menu is still opening
        const menuAge = now - this._openedAt;
        if (menuAge >= GESTURE_DELAY_MS && !this._locked) {
          if      (SCROLL_MODE === 'index') this._updateIndexSwipe(g, now);
          else if (SCROLL_MODE === 'palm')  this._updatePalmSwipe(g, now);
          else                              this._updateTwoFingerScroll(g, now);
        } else if (this._locked) {
          this._confirming = false;
        }

        this._scrollX += (this._targetScrollX - this._scrollX) * LERP_FACTOR;
        break;
      }

      case STATE.CLOSING:
        // Waiting for animation completion (handled above). Nothing else to do.
        break;
    }

    this._lastDualFist = g.isDualFist;
  }

  /**
   * Palm-swipe paging + hold-to-confirm (S14 default). A moving open palm pages
   * ±1 (discrete, premium with 2 cards); a palm held still accrues the confirm.
   */
  _updatePalmSwipe(g, now) {
    if (!g.isLeftOpenPalm) {
      // Palm gone → reset smoothing + cancel confirm (B18: never strand)
      this._emaX = this._lastEmaX = null;
      this._confirming = false;
      this._stillStart = 0;
      return;
    }
    // Rising edge of palm → seed EMA + anchors
    if (this._emaX === null) {
      this._emaX = this._lastEmaX = g.leftHandX;
      this._pageAnchorX = g.leftHandX;
      this._stillStart  = now;
      this._confirming  = false;
      return;
    }
    this._lastEmaX = this._emaX;
    this._emaX     = this._emaX + EMA_ALPHA * (g.leftHandX - this._emaX);

    const dxFromAnchor = this._emaX - this._pageAnchorX;
    const frameMove    = Math.abs(this._emaX - this._lastEmaX);

    if (now >= this._pageCooldownUntil && Math.abs(dxFromAnchor) >= PAGE_DX) {
      // Page ±1 in the direction of travel (same mapping as before: +x → +index)
      const dir = dxFromAnchor > 0 ? 1 : -1;
      this._targetScrollX = Math.max(0, Math.min(CHARACTERS.length - 1, Math.round(this._targetScrollX) + dir));
      this._pageAnchorX      = this._emaX;
      this._pageCooldownUntil = now + PAGE_COOLDOWN_MS;
      this._confirming = false;      // movement cancels confirm
      this._stillStart = 0;
      return;
    }

    // Not paging: if the palm is holding still, accrue the confirm hold.
    if (frameMove < STILL_EPS) {
      if (!this._confirming) {
        this._confirming   = true;
        this._confirmStart = now;
        this._targetScrollX = Math.round(this._scrollX);  // snap to nearest card to confirm
      } else if (now - this._confirmStart >= CONFIRM_MS) {
        const idx = Math.max(0, Math.min(CHARACTERS.length - 1, Math.round(this._scrollX)));
        this._confirm(CHARACTERS[idx].id);
      }
    } else {
      // Drifting but not enough to page → restart the still timer, don't confirm yet
      this._confirming = false;
      this._pageAnchorX = this._emaX;  // re-anchor so slow drift accumulates toward a page
    }
  }

  /**
   * Index-point swipe paging + open-palm confirm (default). Distinct gestures so
   * swiping never triggers a select: a moving LEFT INDEX FINGER (point) pages ±1;
   * an OPEN PALM held still confirms. Fixes the palm-mode conflict where opening
   * the palm to swipe would immediately select the current card.
   */
  _updateIndexSwipe(g, now) {
    // Confirm branch — open palm held selects the current card (no movement needed).
    if (g.isLeftOpenPalm) {
      this._emaX = this._lastEmaX = null;    // drop swipe smoothing while confirming
      if (!this._confirming) {
        this._confirming    = true;
        this._confirmStart  = now;
        this._targetScrollX = Math.round(this._scrollX);  // snap to the card being confirmed
      } else if (now - this._confirmStart >= CONFIRM_MS) {
        const idx = Math.max(0, Math.min(CHARACTERS.length - 1, Math.round(this._scrollX)));
        this._confirm(CHARACTERS[idx].id);
      }
      return;
    }
    this._confirming = false;  // not an open palm → never accrue a confirm

    // Swipe branch — a moving pointed index finger pages between characters.
    if (!g.isLeftIndexPoint) {
      this._emaX = this._lastEmaX = null;    // hand relaxed → reset smoothing/anchor
      return;
    }
    if (this._emaX === null) {               // rising edge of point → seed EMA + anchor
      this._emaX = this._lastEmaX = g.leftHandX;
      this._pageAnchorX = g.leftHandX;
      return;
    }
    this._lastEmaX = this._emaX;
    this._emaX     = this._emaX + EMA_ALPHA * (g.leftHandX - this._emaX);

    const dxFromAnchor = this._emaX - this._pageAnchorX;
    if (now >= this._pageCooldownUntil && Math.abs(dxFromAnchor) >= PAGE_DX) {
      const dir = dxFromAnchor > 0 ? 1 : -1;
      this._targetScrollX = Math.max(0, Math.min(CHARACTERS.length - 1, Math.round(this._targetScrollX) + dir));
      this._pageAnchorX       = this._emaX;
      this._pageCooldownUntil = now + PAGE_COOLDOWN_MS;
    }
  }

  /** Legacy two-finger delta scroll (config SCROLL_MODE:'twofinger'). */
  _updateTwoFingerScroll(g, now) {
    if (g.isLeftTwoFingers) {
      if (!this._lastScrollGest) {
        this._scrollAnchorX = g.leftHandX;
        this._scrollBaseX   = this._scrollX;
      }
      const delta = (g.leftHandX - this._scrollAnchorX) * SCROLL_SENSITIVITY * (CHARACTERS.length - 1);
      this._targetScrollX = Math.max(0, Math.min(CHARACTERS.length - 1, this._scrollBaseX + delta));
    }
    if (g.isLeftOpenPalm) {
      this._targetScrollX = Math.round(this._scrollX);
      this._scrollX       = this._targetScrollX;
      if (!this._confirming) { this._confirming = true; this._confirmStart = now; }
      else if (now - this._confirmStart >= CONFIRM_MS) {
        const idx = Math.max(0, Math.min(CHARACTERS.length - 1, Math.round(this._scrollX)));
        this._confirm(CHARACTERS[idx].id);
      }
    } else {
      this._confirming = false;
    }
    this._lastScrollGest = g.isLeftTwoFingers;
  }

  /**
   * Handle keyboard input for testing without camera.
   * 'c' open, ArrowLeft/Right scroll, Enter confirm, 'e' exit.
   */
  handleKey(key) {
    const now = performance.now();
    switch (key) {
      case 'c':
      case 'C':
        if (this._state === STATE.IDLE && now >= this._reopenAfter) this._openMenu(now);
        break;
      case 'ArrowLeft':
        // Page left; let the render-loop LERP spring the visual settle (parity with palm paging).
        if (this._state === STATE.OPEN && !this._locked) {
          this._targetScrollX = Math.max(0, Math.round(this._targetScrollX) - 1);
        }
        break;
      case 'ArrowRight':
        if (this._state === STATE.OPEN && !this._locked) {
          this._targetScrollX = Math.min(CHARACTERS.length - 1, Math.round(this._targetScrollX) + 1);
        }
        break;
      case 'Enter':
        // §G: keyboard confirm is INSTANT (no 600ms hold) and closes the menu,
        // so 'c' then Enter fully selects and returns to IDLE.
        if (this._state === STATE.OPEN && !this._locked) {
          const idx = Math.max(0, Math.min(CHARACTERS.length - 1, Math.round(this._scrollX)));
          this._confirm(CHARACTERS[idx].id);
          this._closeMenu(now);
        }
        break;
      case 'e':
      case 'E':
        if (this._state === STATE.OPEN) this._closeMenu(now);
        break;
    }
  }

  /**
   * Render carousel overlay. No-op when fully hidden.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   */
  render(ctx, w, h) {
    this._lastH = h;
    if (h <= 0 || w <= 0) return;
    if (this._state === STATE.IDLE && !this._animating) return;

    const now   = performance.now();
    const animY = this._getAnimY(now, h);

    ctx.save();
    ctx.translate(0, animY);
    this._drawBackground(ctx, w, h);
    this._drawCards(ctx, w, h);
    this._drawLabels(ctx, w, h);
    this._drawStatusText(ctx, w, h);
    ctx.restore();
  }

  // ─── Private — state transitions ─────────────────────────────────────────────

  _openMenu(now) {
    this._state          = STATE.OPEN;
    this._openedAt       = now;
    this._resetInteraction();
    const initIdx       = Math.max(0, CHARACTERS.findIndex(c => c.id === this._selected));
    this._scrollX       = this._targetScrollX = initIdx;
    this._startAnim(now, -this._lastH, 0, SLIDE_IN_MS);
  }

  _restartOpenAnim(now) {
    // Slide the menu back to the top and animate it down again.
    // Reset scroll and lock state so the user can re-select a character.
    this._openedAt       = now;
    this._resetInteraction();
    const initIdx      = Math.max(0, CHARACTERS.findIndex(c => c.id === this._selected));
    this._scrollX      = this._targetScrollX = initIdx;
    this._startAnim(now, -this._lastH, 0, SLIDE_IN_MS);
  }

  /** Clear all transient interaction state (scroll/confirm/palm smoothing). */
  _resetInteraction() {
    this._confirming     = false;
    this._locked         = false;
    this._lastScrollGest = false;
    this._emaX = this._lastEmaX = null;
    this._pageAnchorX = 0;
    this._pageCooldownUntil = 0;
    this._stillStart = 0;
  }

  _closeMenu(now) {
    this._state = STATE.CLOSING;
    const currentY = this._getAnimY(now, this._lastH);
    this._startAnim(now, currentY, -this._lastH, SLIDE_OUT_MS);
  }

  // ─── Private — animation helpers ─────────────────────────────────────────────

  _startAnim(now, fromY, toY, duration) {
    this._animating     = true;
    this._animStartTime = now;
    this._animFromY     = fromY;
    this._animToY       = toY;
    this._animDuration  = duration;
  }

  _getAnimY(now, h) {
    if (!this._animating) {
      // When fully settled, snap to correct resting position
      return this._state === STATE.IDLE ? -h : 0;
    }
    const t     = Math.min(1, (now - this._animStartTime) / this._animDuration);
    const eased = easeOutCubic(t);
    return this._animFromY + (this._animToY - this._animFromY) * eased;
  }

  // ─── Private — render helpers ─────────────────────────────────────────────────

  _drawBackground(ctx, w, h) {
    const S = h / REF_H;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';   // lighter premium dim — person stays visible (S14)
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    const titleY = h * 0.08;
    ctx.font      = `bold ${22 * S}px monospace`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SELECT CHARACTER', w / 2, titleY);
    ctx.font      = `${13 * S}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const hint = SCROLL_MODE === 'index'
      ? '[Point index] move left/right to browse  •  [Open palm] hold to select  •  [Thumb up] exit'
      : SCROLL_MODE === 'palm'
      ? '[Open palm] swipe left/right  •  [Hold palm still] select  •  [Thumb up] exit'
      : '[Index+Middle] scroll  •  [Open palm] select  •  [Thumb up] confirm & exit';
    ctx.fillText(hint, w / 2, titleY + 24 * S);
    ctx.restore();
  }

  _drawCards(ctx, w, h) {
    const S       = h / REF_H;
    const cardW   = CARD_W * S, cardH = CARD_H * S, cardGap = CARD_GAP * S;
    const centerY = h * 0.50;
    const step    = cardW + cardGap;

    for (let pass = 0; pass < 2; pass++) {
      CHARACTERS.forEach((char, i) => {
        const offset   = (i - this._scrollX) * step;
        const absOff   = Math.abs(offset);
        const t        = Math.max(0, 1 - absOff / step);
        const isActive = t > 0.5;
        if (pass === 0 && isActive)  return;
        if (pass === 1 && !isActive) return;

        const scale = INACTIVE_SCALE + (1 - INACTIVE_SCALE) * t;
        const cw    = cardW * scale;
        const ch    = cardH * scale;
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
          ctx.font      = `bold ${Math.round(16 * S * scale)}px monospace`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(char.name, cx + cw / 2, cy + ch / 2);
        }

        ctx.filter = 'none';

        const now = performance.now();
        const glowIntensity = this._getGlowIntensity(i, now);
        if (glowIntensity > 0 && t > 0.3) {
          ctx.shadowColor = char.color;
          ctx.shadowBlur  = (14 + 26 * glowIntensity) * S;
          ctx.strokeStyle = char.color;
          ctx.lineWidth   = (2.5 + 2.5 * glowIntensity) * S;
          ctx.globalAlpha = 0.80 + 0.20 * glowIntensity;
          ctx.strokeRect(cx, cy, cw, ch);
          ctx.shadowBlur  = 0;
        }

        // Radial confirm-progress ring + lock-burst flourish on the active card (S14)
        if (isActive) {
          const ccx = cx + cw / 2, ccy = cy + ch / 2;
          const baseR = Math.hypot(cw, ch) / 2 + 12 * S;
          if (this._confirming && Math.round(this._scrollX) === i) {
            const prog = Math.min(1, (now - this._confirmStart) / CONFIRM_MS);
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = char.color;
            ctx.shadowColor = char.color;
            ctx.shadowBlur  = 12 * S;
            ctx.lineWidth   = 4 * S;
            ctx.beginPath();
            ctx.arc(ccx, ccy, baseR, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          const burstAge = now - this._lockBurst;
          if (this._lockBurst && burstAge < 400) {
            const p = burstAge / 400;
            ctx.globalAlpha = (1 - p) * 0.9;
            ctx.strokeStyle = char.color;
            ctx.lineWidth   = 3 * S;
            ctx.beginPath();
            ctx.arc(ccx, ccy, baseR + p * 60 * S, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        ctx.restore();
      });
    }
  }

  _getGlowIntensity(cardIndex, now) {
    const activeIdx = Math.round(this._scrollX);
    if (cardIndex !== activeIdx) return 0;
    if (this._locked)     return 1.0;
    if (this._confirming) return Math.min(1, (now - this._confirmStart) / CONFIRM_MS);
    return 0.25;
  }

  _drawLabels(ctx, w, h) {
    const S       = h / REF_H;
    const cardH   = CARD_H * S;
    const centerY = h * 0.50;
    const step    = CARD_W * S + CARD_GAP * S;
    CHARACTERS.forEach((char, i) => {
      const offset = (i - this._scrollX) * step;
      const t      = Math.max(0, 1 - Math.abs(offset) / step);
      const scale  = INACTIVE_SCALE + (1 - INACTIVE_SCALE) * t;
      const cx     = w / 2 + offset;
      const cy     = centerY + (cardH * scale) / 2 + 22 * S;
      ctx.save();
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font         = `bold ${Math.round(16 * S * scale)}px monospace`;
      // Card NAME text stays white (S14 Task 4 / hard rule: no purple text). The
      // chakra color is carried by the glow only.
      ctx.fillStyle    = t > 0.5 ? '#ffffff' : 'rgba(255,255,255,0.35)';
      ctx.globalAlpha  = 0.35 + 0.65 * t;
      if (t > 0.5) { ctx.shadowColor = char.color; ctx.shadowBlur = 8 * S; }
      ctx.fillText(char.name, cx, cy);
      ctx.restore();
    });
  }

  _drawStatusText(ctx, w, h) {
    if (!this._confirming && !this._locked) return;
    const S    = h / REF_H;
    const idx  = Math.max(0, Math.min(CHARACTERS.length - 1, Math.round(this._scrollX)));
    const char = CHARACTERS[idx];
    const cardTop = h * 0.50 - (CARD_H * S) / 2;
    const statusY = cardTop - 14 * S;
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font         = `bold ${15 * S}px monospace`;
    ctx.fillStyle    = '#ffffff';        // white text (hard rule); glow carries chakra color
    ctx.shadowColor  = char.color;
    ctx.shadowBlur   = 12 * S;
    ctx.fillText(this._locked ? '✦  CHARACTER LOCKED IN  ✦' : '⟳  LOCKING IN...', w / 2, statusY);
    ctx.restore();
  }
}
