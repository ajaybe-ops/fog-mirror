import { GESTURE_CONFIG, HAND_MODEL } from "./config.js";
import { clamp, distance, Emitter, lerp } from "./utils.js";
import { getFileset, loadVision } from "./vision.js";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/**
 * MediaPipe HandLandmarker wrapper with an inference loop independent of the
 * render loop. Results are smoothed and converted to mirror-space pixels here
 * so every downstream system receives the same stable coordinates.
 */
export class HandTracking extends Emitter {
  constructor({ video, mapPoint, getMirrorSize, fps = GESTURE_CONFIG.inferenceFps } = {}) {
    super();
    this.video = video;
    this.mapPoint = mapPoint || ((x, y) => ({ x, y }));
    this.getMirrorSize = getMirrorSize || (() => ({ width: 1280, height: 720 }));
    this.fps = clamp(fps, 8, 30);
    this.landmarker = null;
    this.running = false;
    this.loading = false;
    this.ready = false;
    this.error = null;
    this.lastDetect = 0;
    this.lastVideoTime = -1;
    this.lastHands = [];
    this.previousHands = [];
    this.lastSeen = 0;
    this.lostEmitted = true;
    this.frameCallback = null;
    this.inferenceFps = 0;
    this._fpsSamples = [];
    this._lastInference = 0;
    this.showOverlay = false;
    this.accent = "#c8dfe0";
  }

  async start() {
    if (this.ready || this.loading) return;
    this.loading = true;
    this.emit("loading");
    try {
      const [{ HandLandmarker }, fileset] = await Promise.all([loadVision(), getFileset()]);
      const options = {
        baseOptions: {
          modelAssetPath: HAND_MODEL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      };

      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
      } catch {
        options.baseOptions.delegate = "CPU";
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
      }

      this.ready = true;
      this.loading = false;
      this.emit("ready");
      this.beginLoop();
    } catch (error) {
      this.loading = false;
      this.error = error;
      this.emit("error", error);
    }
  }

  beginLoop() {
    if (this.running) return;
    this.running = true;
    const interval = 1000 / this.fps;

    const loop = (timestamp) => {
      if (!this.running) return;
      if (document.hidden) {
        this.frameCallback = requestAnimationFrame(loop);
        return;
      }
      if (this.video.readyState >= 2 && timestamp - this.lastDetect >= interval) {
        this.lastDetect = timestamp;
        this.detect(timestamp);
      }
      this.frameCallback = requestAnimationFrame(loop);
    };
    this.frameCallback = requestAnimationFrame(loop);
  }

  detect(timestamp) {
    if (!this.landmarker || !this.video.videoWidth) return;
    const videoTime = this.video.currentTime;
    if (videoTime === this.lastVideoTime) return;
    this.lastVideoTime = videoTime;

    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, timestamp);
    } catch (error) {
      this.emit("inference-error", error);
      return;
    }

    const now = performance.now();
    if (this._lastInference) {
      const delta = now - this._lastInference;
      if (delta > 0) {
        this._fpsSamples.push(1000 / delta);
        if (this._fpsSamples.length > 20) this._fpsSamples.shift();
        this.inferenceFps = this._fpsSamples.reduce((sum, value) => sum + value, 0) / this._fpsSamples.length;
      }
    }
    this._lastInference = now;

    const { width, height } = this.getMirrorSize();
    const rawHands = result?.landmarks || [];
    const handedness = result?.handednesses || result?.handedness || [];
    const worldLandmarks = result?.worldLandmarks || [];

    if (!rawHands.length) {
      if (!this.lostEmitted && now - this.lastSeen > GESTURE_CONFIG.lostHandMs) {
        this.lostEmitted = true;
        this.lastHands = [];
        this.previousHands = [];
        this.emit("hands", { hands: [], lost: true, timestamp: now });
        this.emit("lost");
      }
      return;
    }

    this.lastSeen = now;
    this.lostEmitted = false;

    const hands = rawHands.map((landmarks, index) => {
      const label = handedness?.[index]?.[0]?.categoryName || "Unknown";
      const confidence = handedness?.[index]?.[0]?.score ?? 0.7;
      const rawPoints = landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z || 0 }));
      const previous = this.findPreviousHand(rawPoints, label, index);
      const smoothed = previous
        ? rawPoints.map((point, pointIndex) => ({
            x: lerp(previous.landmarks[pointIndex].x, point.x, 1 - GESTURE_CONFIG.smoothing),
            y: lerp(previous.landmarks[pointIndex].y, point.y, 1 - GESTURE_CONFIG.smoothing),
            z: lerp(previous.landmarks[pointIndex].z || 0, point.z || 0, 1 - GESTURE_CONFIG.smoothing),
          }))
        : rawPoints;

      const screenLandmarks = smoothed.map((point) => {
        const mapped = this.mapPoint(point.x, point.y, width, height);
        return { x: mapped.x, y: mapped.y, z: point.z };
      });

      const indexTip = screenLandmarks[8];
      const thumbTip = screenLandmarks[4];
      const palm = screenLandmarks[9];
      const wrist = screenLandmarks[0];
      const handScale = Math.max(1, distance(wrist.x, wrist.y, palm.x, palm.y));
      const previousPointer = previous?.pointer;
      const dt = Math.max(0.001, (now - (previous?.timestamp || now)) / 1000);
      const vx = previousPointer ? (indexTip.x - previousPointer.x) / dt : 0;
      const vy = previousPointer ? (indexTip.y - previousPointer.y) / dt : 0;
      const speed = Math.hypot(vx, vy);

      return {
        id: `${label}-${index}`,
        index,
        label,
        confidence,
        landmarks: smoothed,
        screenLandmarks,
        worldLandmarks: worldLandmarks?.[index] || null,
        pointer: { x: indexTip.x, y: indexTip.y },
        indexTip,
        thumbTip,
        palm,
        wrist,
        handScale,
        velocity: { x: vx, y: vy, speed },
        timestamp: now,
      };
    });

    this.previousHands = hands;
    this.lastHands = hands;
    this.emit("hands", { hands, lost: false, timestamp: now });
  }

  findPreviousHand(rawPoints, label, index) {
    if (!this.previousHands.length) return null;
    const palm = rawPoints[9] || rawPoints[0];
    let best = null;
    let bestScore = Infinity;
    for (const previous of this.previousHands) {
      const previousPalm = previous.landmarks[9] || previous.landmarks[0];
      const spatial = distance(palm.x, palm.y, previousPalm.x, previousPalm.y);
      const labelPenalty = previous.label === label ? 0 : 0.22;
      const indexPenalty = previous.index === index ? 0 : 0.08;
      const score = spatial + labelPenalty + indexPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = previous;
      }
    }
    return best;
  }

  stop() {
    this.running = false;
    if (this.frameCallback) cancelAnimationFrame(this.frameCallback);
    this.frameCallback = null;
    this.lastHands = [];
    this.previousHands = [];
    this.emit("hands", { hands: [], lost: true, timestamp: performance.now() });
  }

  dispose() {
    this.stop();
    try {
      this.landmarker?.close();
    } catch {
      // Ignore.
    }
    this.landmarker = null;
    this.ready = false;
  }

  renderOverlay(ctx, width, height, time) {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!this.showOverlay || !this.lastHands.length) return;

    ctx.save();
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    ctx.shadowColor = this.accent;
    ctx.shadowBlur = 10;

    for (const hand of this.lastHands) {
      const points = hand.screenLandmarks;
      const isPinching = distance(hand.thumbTip.x, hand.thumbTip.y, hand.indexTip.x, hand.indexTip.y) < hand.handScale * 0.34;
      const alpha = 0.52;
      ctx.strokeStyle = hexToRgba(this.accent, isPinching ? 0.8 : alpha);
      ctx.fillStyle = hexToRgba(this.accent, 0.68);
      for (const [a, b] of HAND_CONNECTIONS) {
        const pa = points[a];
        const pb = points[b];
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const radius = [4, 8, 12, 16, 20].includes(i) ? 2.2 : 1.35;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      const tip = hand.indexTip;
      const pulse = 0.7 + Math.sin(time * 0.006) * 0.3;
      ctx.strokeStyle = hexToRgba(this.accent, 0.65 * pulse);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 15 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.font = "500 9px Manrope, sans-serif";
      ctx.fillStyle = hexToRgba(this.accent, 0.7);
      ctx.fillText(`${hand.label.toUpperCase()} · ${Math.round(hand.confidence * 100)}`, points[0].x + 12, points[0].y - 10);
      ctx.shadowBlur = 10;
    }
    ctx.restore();
  }
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const bigint = parseInt(value.length === 3 ? value.split("").map((c) => c + c).join("") : value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
