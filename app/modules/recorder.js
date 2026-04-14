// recorder.js — Screen capture to .webm
export default class Recorder {
  constructor() {
    this.isRecording = false;
    this._recorder   = null;
    this._chunks     = [];
  }

  init(canvas) {
    this._canvas = canvas;
  }

  start() {
    if (!this._canvas) { console.warn('[recorder] call init(canvas) first'); return; }
    const stream = this._canvas.captureStream(30);
    this._recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    this._chunks = [];
    this._recorder.ondataavailable = e => { if (e.data.size > 0) this._chunks.push(e.data); };
    this._recorder.onstop = () => this._download();
    this._recorder.start();
    this.isRecording = true;
    console.log('[recorder] started');
  }

  stop() {
    if (this._recorder) this._recorder.stop();
    this.isRecording = false;
    console.log('[recorder] stopped');
  }

  _download() {
    const blob = new Blob(this._chunks, { type: 'video/webm' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `naruto-jutsu-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
