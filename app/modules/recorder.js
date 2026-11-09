// recorder.js — record what the viewer sees: camera+effects canvas AND the HUD canvas
// (banners, seal panel, carousel), plus the jutsu sound effects, to a video file.
//
// The two canvases are separate layers on screen, so a captureStream() of one of them
// misses the other. While recording, a rAF loop composites both into a hidden canvas and
// that canvas is what gets encoded. Audio comes from the effects' master bus via a
// MediaStreamAudioDestination. DOM UI (controls bar, REC badge) is never recorded.
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
    this.isRecording = false;
    this._rec = null;
    this._chunks = [];
    this._raf = 0;
    this._comp = null;       // composite canvas
    this._audioDest = null;
    this._stream = null;
    this._startedAt = 0;
    this._onVis = () => this._handleVisibility();
  }

  /**
   * @param {{layers: HTMLCanvasElement[], audio?: {ctx: AudioContext, node: AudioNode}|null}} opts
   *   layers are drawn bottom → top at the size of the first layer.
   * @returns {boolean} true if recording started
   */
  start({ layers, audio = null }) {
    if (this.isRecording || !layers?.length) return false;
    if (typeof MediaRecorder === 'undefined') throw new Error('Recording is not supported in this browser');
    const base = layers[0];
    this._comp = document.createElement('canvas');
    this._comp.width = base.width || 1280;
    this._comp.height = base.height || 720;
    const cctx = this._comp.getContext('2d');
    const draw = () => {
      if (this._comp.width !== base.width || this._comp.height !== base.height) {
        if (base.width && base.height) { this._comp.width = base.width; this._comp.height = base.height; }
      }
      for (const c of layers) if (c.width && c.height) cctx.drawImage(c, 0, 0, this._comp.width, this._comp.height);
      this._raf = requestAnimationFrame(draw);
    };
    draw();

    this._stream = this._comp.captureStream(RECORD.FPS);
    if (audio) {
      try {
        this._audioDest = audio.ctx.createMediaStreamDestination();
        audio.node.connect(this._audioDest);
        this._audioDest.stream.getAudioTracks().forEach(t => this._stream.addTrack(t));
      } catch { this._audioDest = null; /* record silent rather than not at all */ }
    }

    this._mime = pickMimeType();
    const opts = { videoBitsPerSecond: RECORD.VIDEO_BPS };
    if (this._mime) opts.mimeType = this._mime;
    try {
      this._rec = new MediaRecorder(this._stream, opts);
    } catch (e) {
      this._cleanup(null);
      throw e;
    }
    this._chunks = [];
    this._rec.ondataavailable = e => { if (e.data.size > 0) this._chunks.push(e.data); };
    this._rec.onstop = () => this._finish();
    this._rec.start(1000);    // 1s chunks: a crash/tab close loses at most a second
    this._audioNode = audio?.node ?? null;
    this._startedAt = performance.now();
    this.isRecording = true;
    document.addEventListener('visibilitychange', this._onVis);
    return true;
  }

  /** Stop and download. Safe to call when not recording. */
  stop() {
    if (!this.isRecording) return;
    this.isRecording = false;
    document.removeEventListener('visibilitychange', this._onVis);
    try { if (this._rec && this._rec.state !== 'inactive') this._rec.stop(); else this._finish(); }
    catch { this._finish(); }
  }

  /** ms recorded so far (0 when idle). */
  elapsedMs() { return this.isRecording ? performance.now() - this._startedAt : 0; }

  // A hidden tab stops rAF, so the video would show one frozen frame: pause instead.
  _handleVisibility() {
    if (!this._rec) return;
    try {
      if (document.hidden && this._rec.state === 'recording') this._rec.pause();
      else if (!document.hidden && this._rec.state === 'paused') this._rec.resume();
    } catch { /* ignore */ }
  }

  _finish() {
    const chunks = this._chunks; this._chunks = [];
    const mime = this._mime || this._rec?.mimeType || 'video/webm';
    this._cleanup();
    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = recordingName(new Date(), mime);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);   // revoking at once can cancel the download
  }

  _cleanup() {
    cancelAnimationFrame(this._raf); this._raf = 0;
    try { if (this._audioDest && this._audioNode) this._audioNode.disconnect(this._audioDest); } catch { /* */ }
    this._stream?.getTracks().forEach(t => t.stop());
    this._stream = null; this._audioDest = null; this._rec = null; this._comp = null;
  }
}
