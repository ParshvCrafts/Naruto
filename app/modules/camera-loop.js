// camera-loop.js — webcam stream + per-frame callback, replacing MediaPipe's camera_utils.
//
// Why own this (~50 lines): camera_utils' stop() only stops the tracks — its
// requestAnimationFrame loop can't be cancelled and keeps polling the same <video>, so
// every restart (reconnect, Retry, 720p fallback) stacked another loop and multiplied
// the tracking work. It also shows a blocking alert() when the camera is denied.
// This loop: one generation at a time, stop() really stops, errors propagate to the caller.

export default class CameraLoop {
  /**
   * @param {HTMLVideoElement} video
   * @param {{onFrame: () => Promise<void>|void, width?: number, height?: number,
   *          getUserMedia?: Function, scheduler?: {request: Function, cancel: Function}}} opts
   *   getUserMedia / scheduler are injectable for tests (default: browser APIs, rAF).
   */
  constructor(video, { onFrame, width = 1280, height = 720, getUserMedia, scheduler } = {}) {
    this._video = video;
    this._onFrame = onFrame;
    this._w = width; this._h = height;
    this._gum = getUserMedia ?? (c => navigator.mediaDevices.getUserMedia(c));
    this._sched = scheduler ?? { request: cb => requestAnimationFrame(cb), cancel: id => cancelAnimationFrame(id) };
    this._stream = null;
    this._gen = 0;          // loop generation: a stale loop sees a newer gen and exits
    this._rafId = 0;
    this._lastTime = -1;
  }

  /** Requested capture size for the next start() (cameras treat it as a hint). */
  setResolution(width, height) { this._w = width; this._h = height; }

  /** (Re)start the camera. Rejects with the getUserMedia error (e.g. NotAllowedError). */
  async start() {
    this.stop();
    const gen = this._gen;
    const stream = await this._gum({
      video: { facingMode: 'user', width: { ideal: this._w }, height: { ideal: this._h } },
      audio: false,
    });
    if (gen !== this._gen) { stream.getTracks().forEach(t => t.stop()); return; }  // stopped meanwhile
    this._stream = stream;
    this._video.srcObject = stream;
    try { await this._video.play(); } catch { /* muted autoplay normally succeeds; frames start when it does */ }
    this._lastTime = -1;
    this._schedule(gen);
  }

  /** Stop the stream and the frame loop (safe to call any time). */
  stop() {
    this._gen++;
    if (this._rafId) { this._sched.cancel(this._rafId); this._rafId = 0; }
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
  }

  _schedule(gen) {
    this._rafId = this._sched.request(() => this._tick(gen));
  }

  async _tick(gen) {
    if (gen !== this._gen) return;
    const v = this._video;
    if (!v.paused && v.currentTime !== this._lastTime) {
      this._lastTime = v.currentTime;
      try { await this._onFrame(); } catch { /* caller handles/logs its own errors */ }
    }
    if (gen === this._gen) this._schedule(gen);
  }
}
