// detector.js — Hand sign inference
export default class Detector {
  constructor() {
    this.model = null;
  }

  async load(modelPath) {
    this.model = await tf.loadLayersModel(modelPath);
    console.log('[detector] model loaded');
  }

  /** Normalize 21 MediaPipe 3D landmarks to 63-dim Float32Array. */
  normalize(landmarks) {
    const vec = new Float32Array(63);
    if (!landmarks || landmarks.length < 21) return vec;  // zeros for absent hand
    const wx = landmarks[0].x, wy = landmarks[0].y, wz = landmarks[0].z;
    // Scale by wrist-to-MCP(middle finger) distance for scale invariance
    const dx = landmarks[9].x - wx, dy = landmarks[9].y - wy, dz = landmarks[9].z - wz;
    const scale = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    landmarks.forEach((lm, i) => {
      vec[i*3]   = (lm.x - wx) / scale;
      vec[i*3+1] = (lm.y - wy) / scale;
      vec[i*3+2] = (lm.z - wz) / scale;
    });
    return vec;
  }

  /** Predict from MediaPipe landmark arrays (or null if hand absent).
   *  Returns { classId: number, confidence: number, probabilities: Float32Array } */
  predict(rightLandmarks, leftLandmarks) {
    if (!this.model) return { classId: 13, confidence: 1.0, probabilities: null };
    const right = this.normalize(rightLandmarks);
    const left  = this.normalize(leftLandmarks);
    const input = new Float32Array(126);
    input.set(right, 0);
    input.set(left, 63);
    // tf.tidy auto-disposes input tensor + output tensor; dataSync() result is a plain Float32Array (not a tensor)
    const probs = tf.tidy(() => {
      const tensor = tf.tensor2d([Array.from(input)]);
      return this.model.predict(tensor).dataSync();
    });
    let classId = 0, confidence = 0;
    probs.forEach((p, i) => { if (p > confidence) { confidence = p; classId = i; } });
    return { classId, confidence, probabilities: probs };
  }
}
