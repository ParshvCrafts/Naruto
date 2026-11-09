// recorder.js — record what the viewer sees: camera+effects canvas AND the HUD canvas
// (banners, seal panel, carousel), plus the jutsu sound effects, to a video file.
//
// The two canvases are separate layers on screen, so a captureStream() of one of them
// misses the other. While recording, a rAF loop composites both into a hidden canvas and
// that canvas is what gets encoded. Audio comes from the effects' master bus via a
// MediaStreamAudioDestination. DOM UI (controls bar, REC badge) is never recorded.
//
// Each recording is a self-contained session object: MediaRecorder's onstop fires
// asynchronously, so a stop followed quickly by a new start must not let the old
// session's onstop touch the new one. Chunks live in memory until stop.
import { RECORD } from './config.js';

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

/** First supported container/codec, or '' to let the browser choose. */
export function pickMimeType(isSupported = t => MediaRecorder.isTypeSupported(t)) {
  return MIME_CANDIDATES.find(t => { try { return isSupported(t); } catch { return false; } }) ?? '';
}

/** naruto-jutsu-YYYY-MM-DD_HH-MM-SS.webm|mp4 (local time). */
export function recordingName(date, mime) {
  const p = n => String(n).padStart(2, '0');
  const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
  return `naruto-jutsu-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
         `_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}.${ext}`;
}

export default class Recorder {
  constructor() {
    this._s = null;          // current session, or null
    this.onEnded = null;     // (reason: 'stopped'|'error') => void — lets the UI reset itself
    this._onVis = () => this._handleVisibility();
  }

  get isRecording() { return !!this._s; }

  /** ms recorded so far (0 when idle). */
  elapsedMs() { return this._s ? performance.now() - this._s.startedAt : 0; }

  /**
   * @param {{layers: HTMLCanvasElement[], audio?: {ctx: AudioContext, node: AudioNode}|null}} opts
   *   layers are drawn bottom → top, scaled into a canvas fixed at the first layer's size
   *   when recording starts (a mid-recording camera resize must not change the stream).
   * @returns {boolean} true if recording started
   * @throws if the browser can't record
   */
  start({ layers, audio = null }) {
    if (this._s || !layers?.length) return false;
    if (typeof MediaRecorder === 'undefined') throw new Error('Recording is not supported in this browser');
    const base = layers[0];
    const s = { chunks: [], raf: 0, audioDest: null, audioNode: null, stream: null, rec: null,
                mime: pickMimeType(), startedAt: performance.now() };
    const comp = document.createElement('canvas');
    comp.width = base.width || 1280;
    comp.height = base.height || 720;
    const cctx = comp.getContext('2d');
    const draw = () => {
      for (const c of layers) if (c.width && c.height) cctx.drawImage(c, 0, 0, comp.width, comp.height);
      s.raf = requestAnimationFrame(draw);
    };
    try {
      draw();
      s.stream = comp.captureStream(RECORD.FPS);
      if (audio) {
        try {
          s.audioDest = audio.ctx.createMediaStreamDestination();
          audio.node.connect(s.audioDest);
          s.audioNode = audio.node;
          s.audioDest.stream.getAudioTracks().forEach(t => s.stream.addTrack(t));
        } catch { /* record silent rather than not at all */ }
      }
      const opts = { videoBitsPerSecond: RECORD.VIDEO_BPS };
      if (s.mime) opts.mimeType = s.mime;
      s.rec = new MediaRecorder(s.stream, opts);
      s.rec.ondataavailable = e => { if (e.data.size > 0) s.chunks.push(e.data); };
      s.rec.onstop  = () => this._finish(s, 'stopped');
      s.rec.onerror = () => this._finish(s, 'error');
      s.rec.start(1000);   // periodic chunks keep memory spread out; still in RAM until stop
    } catch (e) {
      this._release(s);
      throw e;
    }
    this._s = s;
    document.addEventListener('visibilitychange', this._onVis);
    return true;
  }

  /** Stop and download. Safe to call when not recording. */
  stop() {
    const s = this._s;
    if (!s) return;
    this._s = null;                      // a new start() may begin right away
    document.removeEventListener('visibilitychange', this._onVis);
    try { if (s.rec.state !== 'inactive') { s.rec.stop(); return; } } catch { /* fall through */ }
    this._finish(s, 'stopped');
  }

  // A hidden tab stops rAF, so the video would show one frozen frame: pause instead.
  _handleVisibility() {
    const rec = this._s?.rec;
    if (!rec) return;
    try {
      if (document.hidden && rec.state === 'recording') rec.pause();
      else if (!document.hidden && rec.state === 'paused') rec.resume();
    } catch { /* ignore */ }
  }

  _finish(s, reason) {
    if (s.done) return;
    s.done = true;
    if (this._s === s) {                 // ended on its own (encoder error)
      this._s = null;
      document.removeEventListener('visibilitychange', this._onVis);
    }
    const chunks = s.chunks;
    const mime = s.mime || s.rec?.mimeType || 'video/webm';
    this._release(s);
    if (chunks.length) {
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = recordingName(new Date(), mime);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);   // revoking at once can cancel the download
    }
    this.onEnded?.(reason);
  }

  _release(s) {
    cancelAnimationFrame(s.raf); s.raf = 0;
    try { if (s.audioDest && s.audioNode) s.audioNode.disconnect(s.audioDest); } catch { /* */ }
    s.stream?.getTracks().forEach(t => t.stop());
    s.stream = null; s.audioDest = null; s.audioNode = null;
  }
}
