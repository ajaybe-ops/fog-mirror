import { Emitter } from "./utils.js";

/**
 * Camera lifecycle and the math that maps MediaPipe's normalized video
 * coordinates onto an object-fit: cover, mirrored mirror surface.
 */
export class CameraFeed extends Emitter {
  constructor(video, { width = 1280, height = 720 } = {}) {
    super();
    this.video = video;
    this.stream = null;
    this.state = "off";
    this.error = null;
    this.idealWidth = width;
    this.idealHeight = height;
    this.facingMode = "user";
    this.lastTrackEnded = false;
  }

  get isReady() {
    return this.state === "on" && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  async start() {
    if (this.state === "on" && this.stream) return this.stream;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.state = "error";
      this.error = new Error("This browser does not support camera access.");
      this.emit("error", this.error);
      throw this.error;
    }

    this.setState("requesting");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: this.facingMode,
          width: { ideal: this.idealWidth },
          height: { ideal: this.idealHeight },
          frameRate: { ideal: 30, max: 30 },
        },
      });

      this.video.srcObject = this.stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this.video.play();
      if (this.video.readyState < 2) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Camera took too long to start.")), 8000);
          this.video.addEventListener(
            "loadeddata",
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        });
      }

      this.stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (this.lastTrackEnded) return;
          this.lastTrackEnded = true;
          this.setState("off");
          this.emit("ended");
        });
      });

      this.setState("on");
      this.emit("started", {
        width: this.video.videoWidth,
        height: this.video.videoHeight,
        track: this.stream.getVideoTracks()[0],
      });
      return this.stream;
    } catch (error) {
      this.error = error;
      this.setState("error");
      this.emit("error", this.friendlyError(error));
      throw this.friendlyError(error);
    }
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
    this.lastTrackEnded = false;
    this.setState("off");
    this.emit("stopped");
  }

  setState(state) {
    this.state = state;
    this.emit("state", state);
  }

  friendlyError(error) {
    const wrapped = new Error();
    if (!window.isSecureContext) {
      wrapped.message = "Camera access requires HTTPS or localhost.";
    } else if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
      wrapped.message = "Camera permission was declined. You can still explore the mirror with a mouse or touch.";
    } else if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") {
      wrapped.message = "No camera was found. Connect a camera and try again.";
    } else if (error?.name === "NotReadableError" || error?.name === "AbortError") {
      wrapped.message = "The camera is already in use by another app. Close it and try again.";
    } else {
      wrapped.message = error?.message || "The camera could not be started.";
    }
    wrapped.name = error?.name || "CameraError";
    wrapped.cause = error;
    return wrapped;
  }

  getCoverRect(displayWidth, displayHeight) {
    const videoWidth = this.video.videoWidth || 16;
    const videoHeight = this.video.videoHeight || 9;
    const scale = Math.max(displayWidth / videoWidth, displayHeight / videoHeight);
    const drawWidth = videoWidth * scale;
    const drawHeight = videoHeight * scale;
    return {
      offsetX: (displayWidth - drawWidth) / 2,
      offsetY: (displayHeight - drawHeight) / 2,
      drawWidth,
      drawHeight,
      scale,
      videoWidth,
      videoHeight,
    };
  }

  /** MediaPipe coordinates (already mirrored) → CSS pixels inside the mirror. */
  mapNormalized(nx, ny, displayWidth, displayHeight) {
    const rect = this.getCoverRect(displayWidth, displayHeight);
    return {
      x: rect.offsetX + (1 - nx) * rect.drawWidth,
      y: rect.offsetY + ny * rect.drawHeight,
    };
  }

  /** Face bounding boxes are in video pixels; map them through the mirror. */
  mapVideoBox(box, displayWidth, displayHeight) {
    const rect = this.getCoverRect(displayWidth, displayHeight);
    const x = rect.offsetX + (1 - (box.x + box.width)) * rect.scale;
    const y = rect.offsetY + box.y * rect.scale;
    return {
      x,
      y,
      width: box.width * rect.scale,
      height: box.height * rect.scale,
    };
  }
}
