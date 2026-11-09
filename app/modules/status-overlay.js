// status-overlay.js — one full-screen message card for startup and failure states
// (loading, libraries offline, camera blocked/lost, model missing). One slot: a newer
// message replaces the current one; hide(id) only hides the message it names, so a
// stale "hide loading" can't dismiss a camera error shown in the meantime.

export default class StatusOverlay {
  /** @param {HTMLElement|null} el  #status-overlay (see index.html) */
  constructor(el) {
    this._el = el;
    this._id = null;
    this._onAction = null;
    if (!el) return;
    this._title  = el.querySelector('.so-title');
    this._detail = el.querySelector('.so-detail');
    this._btn    = el.querySelector('.so-action');
    this._btn?.addEventListener('click', () => { this._btn.blur(); this._onAction?.(); });
  }

  /** Id of the message on screen, or null. */
  get current() { return this._id; }

  /**
   * @param {{id:string, title:string, detail?:string, tone?:'info'|'warn'|'error',
   *          busy?:boolean, action?:string|null, onAction?:Function|null}} m
   */
  show({ id, title, detail = '', tone = 'info', busy = false, action = null, onAction = null }) {
    this._id = id;
    if (!this._el) return;
    this._title.textContent  = title;
    this._detail.textContent = detail;
    this._el.dataset.tone = tone;
    this._el.classList.toggle('busy', busy);
    this._onAction = onAction;
    this._btn.hidden = !action;
    this._btn.textContent = action ?? '';
    this._el.hidden = false;
  }

  /** Hide the overlay; with an id, only if that message is the one showing. */
  hide(id) {
    if (id && id !== this._id) return;
    this._id = null;
    this._onAction = null;
    if (this._el) this._el.hidden = true;
  }
}
