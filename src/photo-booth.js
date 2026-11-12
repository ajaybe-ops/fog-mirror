import { averageLuminance, clamp, createCanvas, Emitter, sleep } from "./utils.js";

const FILTERS = {
  natural: {
    css: "saturate(0.88) contrast(1.03) brightness(1)",
    grade: "rgba(214, 232, 233, 0.025)",
  },
  noir: {
    css: "grayscale(1) contrast(1.22) brightness(0.98)",
    grade: "rgba(10, 12, 14, 0.12)",
  },
  vintage: {
    css: "sepia(0.32) saturate(0.84) contrast(1.04) brightness(1.03)",
    grade: "rgba(151, 104, 59, 0.075)",
  },
  neon: {
    css: "saturate(1.35) contrast(1.14) hue-rotate(-9deg) brightness(0.93)",
    grade: "rgba(30, 255, 221, 0.035)",
  },
  dream: {
    css: "saturate(0.86) contrast(0.92) brightness(1.1) blur(0.2px)",
    grade: "rgba(255, 211, 231, 0.05)",
  },
};

/**
 * Magic photo booth. Every photograph is a real composited frame of the live
 * camera plus the current fog, droplets, drawing and particles. Nothing is a
 * placeholder preview.
 */
export class PhotoBooth extends Emitter {
  constructor({
    video,
    camera,
    fogCanvas,
    dropletCanvas,
    drawingCanvas,
    particleCanvas,
    secretCanvas,
    themeCanvas,
    themeManager,
    faceDetection,
    getMirrorSize,
    filter = "natural",
    faceAware = true,
    reducedMotion = false,
  } = {}) {
    super();
    this.video = video;
    this.camera = camera;
    this.fogCanvas = fogCanvas;
    this.dropletCanvas = dropletCanvas;
    this.drawingCanvas = drawingCanvas;
    this.particleCanvas = particleCanvas;
    this.secretCanvas = secretCanvas;
    this.themeCanvas = themeCanvas;
    this.themeManager = themeManager;
    this.faceDetection = faceDetection;
    this.getMirrorSize = getMirrorSize;
    this.filter = FILTERS[filter] ? filter : "natural";
    this.faceAware = faceAware;
    this.reducedMotion = reducedMotion;
    this.busy = false;
    this.mode = "single";
    this.lastCapture = null;
  }

  setFilter(filter) {
    this.filter = FILTERS[filter] ? filter : "natural";
  }

  setFaceAware(value) {
    this.faceAware = Boolean(value);
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
  }

  async prepare() {
    if (!this.faceAware) return;
    try {
      await this.faceDetection?.preload();
    } catch {
      // Face detection is an enhancement, not a hard requirement.
    }
  }

  async startCountdown(mode = "single") {
    if (this.busy) return false;
    if (!this.video || this.video.readyState < 2 || !this.camera?.isReady) {
      this.emit("error", new Error("The camera needs to be on before taking a photograph."));
      return false;
    }

    this.busy = true;
    this.mode = mode;
    this.emit("start", { mode });

    try {
      if (mode === "strip") {
        await this.captureStrip();
      } else {
        await this.runCountdown();
        this.emit("flash");
        const record = await this.capturePhoto({ mode: "single" });
        this.emit("captured", record);
        this.lastCapture = record;
      }
      return true;
    } catch (error) {
      this.emit("error", error);
      return false;
    } finally {
      this.busy = false;
      this.emit("countdown", { value: 0, hidden: true });
      this.emit("end", { mode });
    }
  }

  async runCountdown(caption = "Look into the glass") {
    for (let value = 3; value > 0; value -= 1) {
      this.emit("countdown", { value, caption, hidden: false });
      await sleep(1000);
    }
    this.emit("countdown", { value: 0, caption: "", hidden: true });
  }

  async captureStrip() {
    await this.runCountdown("Four frames · hold your breath");
    const frames = [];
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) {
        this.emit("countdown", {
          value: 4 - index,
          caption: `Frame ${index + 1} of 4`,
          hidden: false,
        });
        await sleep(this.reducedMotion ? 700 : 1050);
      }
      this.emit("flash");
      const frame = await this.capturePhoto({ mode: "strip-frame", includeWatermark: false });
      frames.push(frame);
      this.emit("strip-frame", { index, frame });
      await sleep(160);
    }
    this.emit("countdown", { value: 0, hidden: true });
    const strip = await this.composeStrip(frames);
    this.emit("captured", strip);
    this.lastCapture = strip;
  }

  async capturePhoto({ mode = "single", includeWatermark = true } = {}) {
    const size = this.getMirrorSize();
    const target = this.getTargetSize(size);
    const base = await this.composeBase(target.width, target.height);
    let detections = [];
    if (this.faceAware) {
      detections = (await this.faceDetection?.detect(this.video)) || [];
    }

    const outputWidth = 1600;
    const outputHeight = 1200;
    const output = createCanvas(outputWidth, outputHeight);
    const ctx = output.getContext("2d");

    let crop = { x: 0, y: 0, width: base.width, height: base.height };
    if (this.faceAware && detections.length) {
      const detection = detections.reduce((best, current) =>
        current.box.width * current.box.height > best.box.width * best.box.height ? current : best,
      );
      crop = this.faceCrop(detection.box, base.width, base.height);
    } else {
      crop = this.centerCrop(base.width, base.height, outputWidth / outputHeight);
    }

    this.drawCropped(ctx, base, crop, outputWidth, outputHeight);
    this.applyGrade(ctx, outputWidth, outputHeight);
    this.applyVignette(ctx, outputWidth, outputHeight);
    if (includeWatermark) this.drawWatermark(ctx, outputWidth, outputHeight, mode);

    const blob = await canvasToBlob(output, "image/jpeg", 0.92);
    return {
      blob,
      width: outputWidth,
      height: outputHeight,
      filter: this.filter,
      mode,
      faceAware: Boolean(this.faceAware && detections.length),
      canvas: output,
    };
  }

  getTargetSize(mirrorSize) {
    const ratio = mirrorSize.width / Math.max(1, mirrorSize.height);
    const maxWidth = 1920;
    const scale = Math.min(2, maxWidth / Math.max(1, mirrorSize.width));
    return {
      width: Math.round(mirrorSize.width * scale),
      height: Math.round(mirrorSize.height * scale),
      ratio,
    };
  }

  async composeBase(width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0a0c0d";
    ctx.fillRect(0, 0, width, height);

    const video = this.video;
    if (video?.readyState >= 2 && video.videoWidth > 0) {
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      const scale = Math.max(width / videoWidth, height / videoHeight);
      const drawWidth = videoWidth * scale;
      const drawHeight = videoHeight * scale;
      const offsetX = (width - drawWidth) / 2;
      const offsetY = (height - drawHeight) / 2;
      const luminance = averageLuminance(video, videoWidth, videoHeight);
      const brightness = luminance < 0.32 ? 1.14 : luminance > 0.72 ? 0.94 : 1;
      const filter = FILTERS[this.filter].css.replace(/brightness\([^)]+\)/, `brightness(${brightness})`);

      ctx.save();
      ctx.filter = filter;
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
      ctx.restore();
      ctx.filter = "none";
    }

    const layers = [
      this.secretCanvas,
      this.fogCanvas,
      this.themeCanvas,
      this.dropletCanvas,
      this.drawingCanvas,
      this.particleCanvas,
    ];
    for (const layer of layers) {
      if (!layer || !layer.width) continue;
      ctx.drawImage(layer, 0, 0, width, height);
    }

    const tint = this.themeManager?.current?.mirrorTint;
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, width, height);
    }

    return canvas;
  }

  faceCrop(box, baseWidth, baseHeight) {
    const size = this.getMirrorSize();
    const videoWidth = this.video.videoWidth || 1;
    const videoHeight = this.video.videoHeight || 1;
    const scale = Math.max(baseWidth / videoWidth, baseHeight / videoHeight);
    const drawWidth = videoWidth * scale;
    const drawHeight = videoHeight * scale;
    const offsetX = (baseWidth - drawWidth) / 2;
    const offsetY = (baseHeight - drawHeight) / 2;

    const faceX = offsetX + (1 - (box.x + box.width) / videoWidth) * drawWidth;
    const faceY = offsetY + (box.y / videoHeight) * drawHeight;
    const faceWidth = box.width * scale;
    const faceHeight = box.height * scale;
    const aspect = 4 / 3;
    let cropHeight = Math.min(baseHeight, Math.max(faceHeight * 3.8, baseHeight * 0.58));
    let cropWidth = cropHeight * aspect;
    if (cropWidth > baseWidth) {
      cropWidth = baseWidth;
      cropHeight = cropWidth / aspect;
    }

    let x = faceX + faceWidth / 2 - cropWidth / 2;
    let y = faceY + faceHeight * 0.44 - cropHeight * 0.48;
    x = clamp(x, 0, baseWidth - cropWidth);
    y = clamp(y, 0, baseHeight - cropHeight);
    return { x, y, width: cropWidth, height: cropHeight };
  }

  centerCrop(baseWidth, baseHeight, targetAspect) {
    const baseAspect = baseWidth / baseHeight;
    if (baseAspect > targetAspect) {
      const width = baseHeight * targetAspect;
      return { x: (baseWidth - width) / 2, y: 0, width, height: baseHeight };
    }
    const height = baseWidth / targetAspect;
    return { x: 0, y: (baseHeight - height) / 2, width: baseWidth, height };
  }

  drawCropped(ctx, source, crop, outputWidth, outputHeight) {
    ctx.drawImage(
      source,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      outputWidth,
      outputHeight,
    );
  }

  applyGrade(ctx, width, height) {
    const grade = FILTERS[this.filter].grade;
    ctx.fillStyle = grade;
    ctx.fillRect(0, 0, width, height);

    const theme = this.themeManager?.current;
    if (theme?.id === "love") {
      ctx.fillStyle = "rgba(255, 127, 158, 0.035)";
      ctx.fillRect(0, 0, width, height);
    } else if (theme?.id === "neon") {
      const gradient = ctx.createLinearGradient(0, height, width, 0);
      gradient.addColorStop(0, "rgba(0, 255, 217, 0.04)");
      gradient.addColorStop(1, "rgba(136, 61, 255, 0.055)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    } else if (theme?.id === "winter") {
      ctx.fillStyle = "rgba(153, 210, 255, 0.045)";
      ctx.fillRect(0, 0, width, height);
    } else if (theme?.id === "rain") {
      ctx.fillStyle = "rgba(40, 76, 104, 0.045)";
      ctx.fillRect(0, 0, width, height);
    }
  }

  applyVignette(ctx, width, height) {
    const gradient = ctx.createRadialGradient(
      width * 0.5,
      height * 0.46,
      Math.min(width, height) * 0.26,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.72,
    );
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.76, "rgba(0,0,0,0.06)");
    gradient.addColorStop(1, "rgba(0,0,0,0.34)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  drawWatermark(ctx, width, height, mode) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, width - 40, height - 40);

    ctx.font = "600 15px Manrope, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.66)";
    ctx.letterSpacing = "4px";
    ctx.fillText("FOG MIRROR", 44, height - 50);
    ctx.font = "italic 17px 'Instrument Serif', Georgia, serif";
    ctx.fillStyle = "rgba(255,255,255,0.48)";
    ctx.fillText(mode === "single" ? "a breath held in silver" : "four frames of breath", 44, height - 28);

    const date = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date());
    ctx.textAlign = "right";
    ctx.font = "500 13px Manrope, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.42)";
    ctx.fillText(`${date}  ·  ${this.filter.toUpperCase()}`, width - 44, height - 38);
    ctx.restore();
  }

  async composeStrip(frames) {
    const frameWidth = 760;
    const frameHeight = Math.round((frameWidth * 3) / 4);
    const gap = 16;
    const padding = 28;
    const footer = 88;
    const stripWidth = frameWidth + padding * 2;
    const stripHeight = padding * 2 + frameHeight * 4 + gap * 3 + footer;
    const canvas = createCanvas(stripWidth, stripHeight);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0b0d0f";
    ctx.fillRect(0, 0, stripWidth, stripHeight);

    const gradient = ctx.createLinearGradient(0, 0, stripWidth, stripHeight);
    gradient.addColorStop(0, "rgba(255,255,255,0.045)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0)");
    gradient.addColorStop(1, "rgba(0,0,0,0.3)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, stripWidth, stripHeight);

    frames.forEach((frame, index) => {
      const y = padding + index * (frameHeight + gap);
      ctx.drawImage(frame.canvas, padding, y, frameWidth, frameHeight);
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1;
      ctx.strokeRect(padding + 0.5, y + 0.5, frameWidth - 1, frameHeight - 1);

      ctx.font = "600 12px Manrope, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText(`0${index + 1}`, padding + 12, y + 22);
    });

    ctx.font = "600 16px Manrope, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.letterSpacing = "4px";
    ctx.fillText("FOG MIRROR", padding, stripHeight - 48);
    ctx.font = "italic 19px 'Instrument Serif', Georgia, serif";
    ctx.fillStyle = "rgba(255,255,255,0.44)";
    ctx.letterSpacing = "0px";
    ctx.fillText("four frames of breath", padding, stripHeight - 26);

    const date = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date());
    ctx.textAlign = "right";
    ctx.font = "500 12px Manrope, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillText(date, stripWidth - padding, stripHeight - 34);

    const blob = await canvasToBlob(canvas, "image/jpeg", 0.93);
    return {
      blob,
      width: stripWidth,
      height: stripHeight,
      filter: this.filter,
      mode: "strip",
      faceAware: this.faceAware,
      canvas,
    };
  }

  async exportArtwork() {
    const size = this.getMirrorSize();
    const target = this.getTargetSize(size);
    const base = await this.composeBase(target.width, target.height);
    const outputWidth = 1800;
    const outputHeight = Math.round(outputWidth / (4 / 3));
    const output = createCanvas(outputWidth, outputHeight);
    const ctx = output.getContext("2d");
    const crop = this.centerCrop(base.width, base.height, 4 / 3);
    this.drawCropped(ctx, base, crop, outputWidth, outputHeight);
    this.applyGrade(ctx, outputWidth, outputHeight);
    this.applyVignette(ctx, outputWidth, outputHeight);
    const blob = await canvasToBlob(output, "image/png");
    return { blob, width: outputWidth, height: outputHeight, canvas: output };
  }
}

function canvasToBlob(canvas, type = "image/jpeg", quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The image could not be encoded."));
      },
      type,
      quality,
    );
  });
}
