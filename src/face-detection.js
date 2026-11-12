import { FACE_MODEL } from "./config.js";
import { Emitter } from "./utils.js";
import { getFileset, loadVision } from "./vision.js";

/**
 * Lazy MediaPipe face detection used only for selfie framing and the
 * face-aware crop. It is never used to identify anyone.
 */
export class FaceDetection extends Emitter {
  constructor() {
    super();
    this.detector = null;
    this.loading = null;
    this.ready = false;
    this.error = null;
    this.lastDetections = [];
    this.lastDetect = 0;
  }

  async preload() {
    if (this.ready) return true;
    if (this.loading) return this.loading;
    this.loading = this.load();
    return this.loading;
  }

  async load() {
    try {
      const [{ FaceDetector }, fileset] = await Promise.all([loadVision(), getFileset()]);
      const options = {
        baseOptions: {
          modelAssetPath: FACE_MODEL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.5,
      };
      try {
        this.detector = await FaceDetector.createFromOptions(fileset, options);
      } catch {
        options.baseOptions.delegate = "CPU";
        this.detector = await FaceDetector.createFromOptions(fileset, options);
      }
      this.ready = true;
      this.loading = null;
      this.emit("ready");
      return true;
    } catch (error) {
      this.loading = null;
      this.error = error;
      this.emit("error", error);
      return false;
    }
  }

  async detect(video) {
    if (!video || video.readyState < 2) return [];
    if (!this.ready) {
      const loaded = await this.preload();
      if (!loaded) return [];
    }
    if (performance.now() - this.lastDetect < 250) return this.lastDetections;
    this.lastDetect = performance.now();
    try {
      const result = this.detector.detectForVideo(video, performance.now());
      this.lastDetections = (result?.detections || []).map((detection) => {
        const box = detection.boundingBox || { originX: 0, originY: 0, width: 0, height: 0 };
        return {
          box: {
            x: box.originX || 0,
            y: box.originY || 0,
            width: box.width || 0,
            height: box.height || 0,
          },
          confidence: detection.categories?.[0]?.score ?? 0.7,
        };
      });
      this.emit("detections", this.lastDetections);
      return this.lastDetections;
    } catch (error) {
      this.emit("detect-error", error);
      return [];
    }
  }

  dispose() {
    try {
      this.detector?.close();
    } catch {
      // Ignore.
    }
    this.detector = null;
    this.ready = false;
  }
}
