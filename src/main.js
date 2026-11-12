import { AudioEngine } from "./audio-engine.js";
import { CameraFeed } from "./camera.js";
import { FOG_CONFIG, THEMES } from "./config.js";
import { DropletEngine } from "./droplet-engine.js";
import { DrawingEngine } from "./drawing-engine.js";
import { FaceDetection } from "./face-detection.js";
import { FogEngine } from "./fog-engine.js";
import { Gallery } from "./gallery.js";
import { GestureRecognition } from "./gesture-recognition.js";
import { HandTracking } from "./hand-tracking.js";
import { ParticleEngine } from "./particle-engine.js";
import { PhotoBooth } from "./photo-booth.js";
import { Storage } from "./storage.js";
import { ThemeManager } from "./theme-manager.js";
import { UIController } from "./ui-controller.js";
import { clamp, downloadBlob, sleep } from "./utils.js";

class FogMirrorApp {
  constructor() {
    this.storage = new Storage();
    this.preferences = this.storage.loadPreferences();
    this.entered = false;
    this.pointerActive = false;
    this.pointerId = null;
    this.photoMode = false;
    this.sessionSeconds = 0;
    this.lastFrame = 0;
    this.lastBreathMist = 0;
    this.lastWipeAt = 0;
    this.renderFps = 0;
    this.frameCount = 0;
    this.fpsWindowStart = 0;
    this.lastUiFps = 0;
    this.lastDropletRipple = 0;
    this.destroyed = false;

    this.dom = {
      app: document.getElementById("app"),
      mirror: document.getElementById("mirror"),
      video: document.getElementById("camera"),
      fogCanvas: document.getElementById("fog-canvas"),
      dropletCanvas: document.getElementById("droplet-canvas"),
      drawingCanvas: document.getElementById("drawing-canvas"),
      particleCanvas: document.getElementById("particle-canvas"),
      handCanvas: document.getElementById("hand-canvas"),
      secretCanvas: document.getElementById("secret-canvas"),
      themeCanvas: document.getElementById("theme-canvas"),
      galleryGrid: document.getElementById("gallery-grid"),
      galleryEmpty: document.getElementById("gallery-empty"),
      galleryCount: document.getElementById("gallery-count"),
      galleryBadge: document.getElementById("gallery-badge"),
    };
  }

  async init() {
    this.themeManager = new ThemeManager({
      storage: this.storage,
      preferences: this.preferences,
      onChange: (theme, meta) => this.handleThemeChange(theme, meta),
    });
    this.themeManager.attach({
      secretCanvas: this.dom.secretCanvas,
      themeCanvas: this.dom.themeCanvas,
    });
    this.themeManager.setTheme(this.preferences.theme || "fog", { silent: true });

    this.fog = new FogEngine(this.dom.fogCanvas, {
      intensity: this.preferences.fog,
      autoRefog: this.preferences.autoRefog,
      reducedMotion: this.preferences.reducedMotion,
    });
    this.particles = new ParticleEngine(this.dom.particleCanvas, {
      reducedMotion: this.preferences.reducedMotion,
    });
    this.droplets = new DropletEngine(this.dom.dropletCanvas, this.fog, {
      theme: this.themeManager.current,
      reducedMotion: this.preferences.reducedMotion,
    });
    this.drawing = new DrawingEngine({
      canvas: this.dom.drawingCanvas,
      fog: this.fog,
      particles: this.particles,
      themeManager: this.themeManager,
    });
    this.camera = new CameraFeed(this.dom.video);
    this.audio = new AudioEngine({ sensitivity: this.preferences.sensitivity });
    this.faceDetection = new FaceDetection();
    this.handTracking = new HandTracking({
      video: this.dom.video,
      mapPoint: (x, y, width, height) => this.camera.mapNormalized(x, y, width, height),
      getMirrorSize: () => this.getMirrorSize(),
    });
    this.gesture = new GestureRecognition();
    this.photoBooth = new PhotoBooth({
      video: this.dom.video,
      camera: this.camera,
      fogCanvas: this.dom.fogCanvas,
      dropletCanvas: this.dom.dropletCanvas,
      drawingCanvas: this.dom.drawingCanvas,
      particleCanvas: this.dom.particleCanvas,
      secretCanvas: this.dom.secretCanvas,
      themeCanvas: this.dom.themeCanvas,
      themeManager: this.themeManager,
      faceDetection: this.faceDetection,
      getMirrorSize: () => this.getMirrorSize(),
      filter: this.preferences.photoFilter,
      faceAware: this.preferences.faceAware,
      reducedMotion: this.preferences.reducedMotion,
    });

    this.ui = new UIController({
      preferences: this.preferences,
      themes: THEMES,
    });
    this.ui.setTheme(this.themeManager.current);

    this.gallery = new Gallery({
      storage: this.storage,
      grid: this.dom.galleryGrid,
      empty: this.dom.galleryEmpty,
      count: this.dom.galleryCount,
      badge: this.dom.galleryBadge,
      onToast: (message) => this.ui.showToast(message),
      onShoot: () => {
        this.ui.closePanels();
        this.startPhoto("single");
      },
    });

    this.applyTheme(this.themeManager.current);
    this.bindEngineEvents();
    this.bindUIEvents();
    this.bindPointer();
    this.bindResize();
    this.bindWindow();

    this.handCtx = this.dom.handCanvas.getContext("2d");
    this.drawing.setTool("write");
    this.drawing.setBrushSize(this.preferences.brush);
    this.audio.setSensitivity(this.preferences.sensitivity);
    this.fog.setAutoRefog(this.preferences.autoRefog);
    this.fog.setReducedMotion(this.preferences.reducedMotion);
    this.particles.setReducedMotion(this.preferences.reducedMotion);
    this.droplets.setReducedMotion(this.preferences.reducedMotion);
    this.photoBooth.setReducedMotion(this.preferences.reducedMotion);
    this.handTracking.showOverlay = Boolean(this.preferences.showHands);

    this.ui.setCameraState("off");
    this.ui.setMicState("off");
    this.ui.setTrackingState("idle");
    this.ui.setUndoRedo(this.drawing.getState());
    this.ui.setPhotoFilter(this.preferences.photoFilter);
    this.ui.setSessionTime(0);

    this.resize();
    this.fog.addFog(0.62);
    await this.gallery.init();
    this.ui.setGalleryCount(await this.gallery.getCount());
    this.startSessionTimer();
    this.startRenderLoop();

    // If the app is reloaded after permission was already granted, do not
    // silently open the camera. The entry screen always asks for consent.
    if (this.preferences.onboardingSeen) {
      // Keep the entry screen. It is the consent gate for this session.
    }
  }

  applyTheme(theme) {
    if (!theme) return;
    this.fog?.setTheme(theme);
    this.drawing?.setTheme(theme);
    this.particles?.setTheme(theme);
    this.droplets?.setTheme(theme);
    if (this.handTracking) this.handTracking.accent = theme.accent;
    this.ui?.setTheme(theme);
    this.preferences.theme = theme.id;
    this.storage.savePreferences(this.preferences);
  }

  handleThemeChange(theme, { direction } = {}) {
    this.applyTheme(theme);
    if (direction) {
      this.ui.showToast(`${theme.name} — ${theme.subtitle}`, { glyph: "✦" });
      const size = this.getMirrorSize();
      this.particles.emitBurst(size.width / 2, size.height * 0.42, theme.accent, 16);
    }
  }

  bindEngineEvents() {
    this.camera.on("started", () => {
      this.dom.video.classList.add("is-live");
      this.ui.setCameraState("on");
      this.ui.setCameraBusy(false);
      this.ui.showToast("Camera live. Your reflection never leaves this device.", { glyph: "◉" });
      this.startHandTracking();
      if (this.preferences.faceAware) {
        setTimeout(() => this.faceDetection.preload(), 900);
      }
    });
    this.camera.on("error", (error) => {
      this.dom.video.classList.remove("is-live");
      this.ui.setCameraState("error", error.message);
      this.ui.setCameraBusy(false);
      this.ui.showToast(error.message, { glyph: "!", duration: 6000 });
    });
    this.camera.on("ended", () => {
      this.dom.video.classList.remove("is-live");
      this.ui.setCameraState("off");
      this.ui.setTrackingState("idle");
      this.handTracking.stop();
      this.ui.showToast("Camera disconnected. Enable it again from the status pill.", { glyph: "!" });
    });

    this.audio.on("state", (state) => {
      if (state === "calibrating") {
        this.ui.setMicState("calibrating");
        this.ui.setMicBusy(false);
      } else if (state === "on") {
        this.ui.setMicState("on");
        this.ui.setMicBusy(false);
      } else if (state === "off") {
        this.ui.setMicState("off");
      }
    });
    this.audio.on("error", (error) => {
      this.ui.setMicState("error", error.message);
      this.ui.setMicBusy(false);
    });
    this.audio.on("calibrated", ({ threshold }) => {
      this.ui.setMicState("on");
      this.ui.showToast("Breath calibrated. Exhale softly toward the microphone.", { glyph: "≈" });
      this.audio.threshold = threshold;
    });
    this.audio.on("ambient", (on) => {
      this.preferences.ambient = on;
      this.storage.savePreferences(this.preferences);
      this.ui.setAmbient(on);
    });

    this.handTracking.on("loading", () => {
      this.ui.setTrackingState("loading");
    });
    this.handTracking.on("ready", () => {
      this.ui.setTrackingState("ready");
      this.ui.showToast("Hand tracking ready. Pinch to write.", { glyph: "✦" });
    });
    this.handTracking.on("error", (error) => {
      console.warn("Hand tracking unavailable", error);
      this.ui.setTrackingState("error");
      this.ui.showToast("Hand tracking could not load. Mouse and touch still work.", { glyph: "!" });
    });
    this.handTracking.on("hands", ({ hands, lost, timestamp }) => {
      if (lost) {
        this.gesture.handleLost();
        this.ui.setGesture("No hands", false);
        return;
      }
      this.gesture.process(hands, timestamp);
    });

    this.gesture.on("state", ({ label, hands }) => {
      this.ui.setGesture(label, hands > 0);
    });
    this.gesture.on("pinchstart", ({ x, y, handId }) => {
      if (this.pointerActive) return;
      this.drawing.beginStroke({ x, y }, { source: "hand", id: handId });
      this.particles.emitRipple(x, y, this.themeManager.current.trail, 18);
      this.ui.showGestureCallout("Pinch", "writing on the glass", "✦", 1100);
      this.ui.noteGestureActivity();
    });
    this.gesture.on("pinchmove", ({ x, y, handId }) => {
      if (this.pointerActive) return;
      this.drawing.moveStroke({ x, y }, { source: "hand", id: handId });
    });
    this.gesture.on("pinchend", ({ handId }) => {
      this.drawing.endStroke({ id: handId, source: "hand" });
    });
    this.gesture.on("wipe", ({ x, y, radius }) => {
      this.drawing.wipeAt(x, y, radius);
      this.lastWipeAt = performance.now();
      this.ui.noteGestureActivity();
    });
    this.gesture.on("freeze", ({ active }) => {
      this.fog.setFrozen(active);
      this.ui.setFreeze(active);
    });
    this.gesture.on("peace", () => {
      this.photoMode = !this.photoMode;
      this.ui.setPhotoMode(this.photoMode);
      if (this.photoMode) this.photoBooth.prepare();
      this.ui.showGestureCallout(
        this.photoMode ? "Peace" : "Released",
        this.photoMode ? "selfie mode activated" : "selfie mode off",
        "◉",
        1400,
      );
    });
    this.gesture.on("thumbsup", () => {
      this.ui.showGestureCallout("Thumbs up", "confirmed — starting countdown", "✓", 1300);
      this.startPhoto("single");
    });
    this.gesture.on("swipe", ({ direction }) => {
      if (direction === "right") this.themeManager.next();
      else this.themeManager.previous();
      this.ui.noteGestureActivity();
    });
    this.gesture.on("circle", ({ x, y, radius }) => {
      const size = this.getMirrorSize();
      const point = this.camera.mapNormalized(1 - x, y, size.width, size.height);
      const screenRadius = clamp(radius * Math.min(size.width, size.height), 45, size.height * 0.55);
      this.fog.clearCircle(point.x, point.y, screenRadius);
      this.particles.emitRipple(point.x, point.y, this.themeManager.current.trail, screenRadius * 0.7);
      this.ui.showGestureCallout("Circle", "glass cleared", "○", 1400);
    });
    this.gesture.on("twohandspread", ({ amount }) => {
      const next = clamp(this.preferences.brush * (1 + amount * 0.55), 8, 72);
      this.setBrush(next);
      this.ui.showGestureCallout("Two hands", "clearing wider", "↔", 1100);
    });
    this.gesture.on("twohandpinch", ({ amount }) => {
      const next = clamp(this.preferences.brush * (1 - amount * 0.45), 8, 72);
      this.setBrush(next);
      this.ui.showGestureCallout("Two hands", "clearing tighter", "↔", 1100);
    });

    this.droplets.on("trail", ({ x, y, radius }) => {
      const now = performance.now();
      if (now - this.lastDropletRipple < 70) return;
      this.lastDropletRipple = now;
      this.particles.emitRipple(x, y, "rgba(196, 224, 235, 0.18)", Math.max(3, radius * 2));
    });

    this.drawing.on("change", (state) => {
      this.ui.setUndoRedo(state);
    });

    this.photoBooth.on("countdown", ({ value, caption, hidden }) => {
      if (hidden || !value) this.ui.showCountdown(0);
      else this.ui.showCountdown(value, caption || "Look into the glass");
    });
    this.photoBooth.on("flash", () => this.ui.flash());
    this.photoBooth.on("captured", async (record) => {
      this.ui.flash();
      await this.gallery.add(record);
      this.ui.setGalleryCount(await this.gallery.getCount());
      const size = this.getMirrorSize();
      this.particles.emitBurst(size.width / 2, size.height * 0.38, this.themeManager.current.accent, 22);
    });
    this.photoBooth.on("error", (error) => {
      this.ui.showToast(error.message || "The photograph could not be taken.", { glyph: "!" });
    });
  }

  bindUIEvents() {
    this.ui.on("camera-request", () => this.requestCamera());
    this.ui.on("mic-request", () => this.requestMicrophone());
    this.ui.on("enter", () => {
      this.entered = true;
      this.sessionSeconds = 0;
      this.ui.setSessionTime(0);
      if (this.fog.coverage < 0.06) this.fog.addFog(0.55);
      if (!this.camera.isReady) {
        this.ui.showToast("Camera off — use touch or enable it from the status pill.", { glyph: "○", duration: 5000 });
      }
      if (!this.audio.isOn) {
        setTimeout(() => {
          if (!this.audio.isOn) {
            this.ui.showToast("Tap the Mic pill or the microphone icon to enable breath.", { glyph: "≈", duration: 5000 });
          }
        }, 2400);
      }
    });
    this.ui.on("fog-change", (value) => {
      this.preferences.fog = value;
      this.fog.setIntensity(value);
      this.storage.savePreferences(this.preferences);
    });
    this.ui.on("sensitivity-change", (value) => {
      this.preferences.sensitivity = value;
      this.audio.setSensitivity(value);
      this.storage.savePreferences(this.preferences);
    });
    this.ui.on("brush-change", (value) => this.setBrush(value));
    this.ui.on("tool-change", (tool) => {
      this.drawing.setTool(tool);
      this.ui.setTool(tool);
    });
    this.ui.on("undo", () => {
      if (this.drawing.undo()) this.ui.showToast("Last mark undone.", { glyph: "↶" });
    });
    this.ui.on("redo", () => {
      if (this.drawing.redo()) this.ui.showToast("Mark restored.", { glyph: "↷" });
    });
    this.ui.on("clear", () => this.clearMirror());
    this.ui.on("mist", () => {
      this.fog.addFog(0.42);
      this.particles.emitBreathMist();
      this.ui.showToast("A breath of fog added.", { glyph: "≈" });
    });
    this.ui.on("freeze-toggle", () => {
      const next = !this.fog.frozen;
      this.fog.setFrozen(next);
      this.ui.setFreeze(next);
    });
    this.ui.on("hands-toggle", () => {
      if (!this.camera.isReady) {
        this.ui.showToast("Enable the camera to use hand tracking.", { glyph: "!" });
        return;
      }
      const next = !this.preferences.showHands;
      this.preferences.showHands = next;
      this.handTracking.showOverlay = next;
      this.ui.setHandsEnabled(next);
      this.storage.savePreferences(this.preferences);
    });
    this.ui.on("photo", () => this.startPhoto("single"));
    this.ui.on("strip", () => this.startPhoto("strip"));
    this.ui.on("photo-mode-close", () => {
      this.photoMode = false;
      this.ui.setPhotoMode(false);
    });
    this.ui.on("save-drawing", () => this.saveDrawing());
    this.ui.on("restore-drawing", () => this.restoreDrawing());
    this.ui.on("export-artwork", () => this.exportArtwork());
    this.ui.on("ambient-toggle", () => this.toggleAmbient());
    this.ui.on("theme-change", (id) => this.themeManager.setTheme(id));
    this.ui.on("filter-change", (filter) => {
      this.preferences.photoFilter = filter;
      this.photoBooth.setFilter(filter);
      this.storage.savePreferences(this.preferences);
    });
    this.ui.on("setting-change", ({ key, value }) => this.handleSettingChange(key, value));
    this.ui.on("gallery-open", () => this.gallery.refresh());
    this.ui.on("gallery-download-all", () => this.gallery.downloadAll());
    this.ui.on("gallery-clear", () => this.gallery.clearAll());
    this.ui.on("clear-data", () => this.clearLocalData());
  }

  bindPointer() {
    const mirror = this.dom.mirror;
    const getPoint = (event) => {
      const rect = mirror.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    mirror.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0 && event.pointerType === "mouse") return;
      if (event.target.closest("button, input, .no-draw")) return;
      event.preventDefault();
      this.pointerActive = true;
      this.pointerId = event.pointerId;
      mirror.setPointerCapture?.(event.pointerId);
      const point = getPoint(event);
      this.drawing.beginStroke(point, { source: "pointer", id: "pointer" });
      this.particles.emitRipple(point.x, point.y, this.themeManager.current.trail, 16);
      this.ui.noteGestureActivity();
    });

    mirror.addEventListener("pointermove", (event) => {
      if (!this.pointerActive || event.pointerId !== this.pointerId) return;
      event.preventDefault();
      this.drawing.moveStroke(getPoint(event), { source: "pointer", id: "pointer" });
    });

    const endPointer = (event) => {
      if (!this.pointerActive) return;
      if (event && event.pointerId !== this.pointerId) return;
      this.pointerActive = false;
      this.pointerId = null;
      this.drawing.endStroke({ source: "pointer", id: "pointer" });
    };

    mirror.addEventListener("pointerup", endPointer);
    mirror.addEventListener("pointercancel", endPointer);
    mirror.addEventListener("lostpointercapture", endPointer);
  }

  bindResize() {
    this.resize = this.resize.bind(this);
    if ("ResizeObserver" in window) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
        this.resizeFrame = requestAnimationFrame(() => this.resize());
      });
      this.resizeObserver.observe(this.dom.mirror);
    }
    window.addEventListener("resize", this.resize, { passive: true });
    window.addEventListener("orientationchange", () => setTimeout(this.resize, 250));
  }

  bindWindow() {
    window.addEventListener("beforeunload", () => this.dispose());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.drawing.endAllStrokes();
        this.gesture.handleLost();
      }
    });
  }

  resize() {
    if (!this.dom.mirror) return;
    const rect = this.dom.mirror.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.fog.resize(rect.width, rect.height, dpr);
    this.droplets.resize(rect.width, rect.height, dpr);
    this.particles.resize(rect.width, rect.height, dpr);
    this.drawing.resize(rect.width, rect.height, dpr);
    this.themeManager.resize(rect.width, rect.height, dpr);
    this.dom.handCanvas.width = Math.round(rect.width * dpr);
    this.dom.handCanvas.height = Math.round(rect.height * dpr);
    this.handCtx = this.dom.handCanvas.getContext("2d");
    this.handCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ui.setUndoRedo(this.drawing.getState());
  }

  getMirrorSize() {
    const rect = this.dom.mirror?.getBoundingClientRect();
    return {
      width: Math.max(1, rect?.width || 1280),
      height: Math.max(1, rect?.height || 720),
    };
  }

  async requestCamera() {
    if (this.camera.state === "requesting") return;
    if (this.camera.isReady) {
      this.ui.showToast("Camera is already live.", { glyph: "◉" });
      return;
    }
    this.ui.setCameraBusy(true);
    this.ui.setCameraState("requesting");
    try {
      await this.camera.start();
    } catch {
      // The camera emits a friendly error; the UI already reflects it.
    } finally {
      this.ui.setCameraBusy(false);
    }
  }

  async requestMicrophone() {
    if (this.audio.state === "requesting" || this.audio.state === "calibrating") return;
    if (this.audio.isOn) {
      this.ui.showToast("Microphone is already listening.", { glyph: "≈" });
      return;
    }
    this.ui.setMicBusy(true);
    this.ui.setMicState("requesting");
    const ok = await this.audio.enable();
    this.ui.setMicBusy(false);
    if (!ok) this.ui.setMicState("error", this.audio.error?.message || "Microphone unavailable.");
  }

  async startHandTracking() {
    if (this.handTracking.ready || this.handTracking.loading) return;
    await this.handTracking.start();
  }

  setBrush(value) {
    const clamped = clamp(Math.round(value), 8, 72);
    this.preferences.brush = clamped;
    this.drawing.setBrushSize(clamped);
    this.ui.setBrush(clamped);
    this.storage.savePreferences(this.preferences);
  }

  handleSettingChange(key, value) {
    if (key === "autoRefog") {
      this.preferences.autoRefog = value;
      this.fog.setAutoRefog(value);
    } else if (key === "showHands") {
      if (value && !this.camera.isReady) {
        this.ui.showToast("Enable the camera to show hand landmarks.", { glyph: "!" });
        this.ui.setHandsEnabled(false);
        return;
      }
      this.preferences.showHands = value;
      this.handTracking.showOverlay = value;
      this.ui.setHandsEnabled(value);
    } else if (key === "faceAware") {
      this.preferences.faceAware = value;
      this.photoBooth.setFaceAware(value);
      this.ui.setFaceAware(value);
      if (value) this.photoBooth.prepare();
    } else if (key === "ambient") {
      this.toggleAmbient(value);
      return;
    } else if (key === "reducedMotion") {
      this.preferences.reducedMotion = value;
      this.fog.setReducedMotion(value);
      this.particles.setReducedMotion(value);
      this.droplets.setReducedMotion(value);
      this.photoBooth.setReducedMotion(value);
      this.themeManager.setReducedMotion(value);
      this.ui.setReducedMotion(value);
    }
    this.storage.savePreferences(this.preferences);
  }

  async toggleAmbient(force) {
    try {
      let on;
      if (typeof force === "boolean") {
        if (force && !this.audio.ambient.on) {
          await this.audio.startAmbient();
          on = true;
        } else if (!force && this.audio.ambient.on) {
          this.audio.stopAmbient();
          on = false;
        } else {
          on = this.audio.ambient.on;
        }
      } else {
        on = await this.audio.toggleAmbient();
      }
      this.preferences.ambient = on;
      this.ui.setAmbient(on);
      this.storage.savePreferences(this.preferences);
    } catch (error) {
      this.ui.showToast(error.message || "Ambient sound could not start.", { glyph: "!" });
    }
  }

  async startPhoto(mode = "single") {
    if (this.photoBooth.busy) {
      this.ui.showToast("The shutter is already open.", { glyph: "◉" });
      return;
    }
    if (!this.camera.isReady) {
      this.ui.showToast("Enable the camera before taking a photograph.", { glyph: "!" });
      return;
    }
    this.photoMode = true;
    this.ui.setPhotoMode(true);
    await this.photoBooth.prepare();
    await this.photoBooth.startCountdown(mode);
  }

  clearMirror() {
    if (this.drawing.hasArtwork() && !window.confirm("Clear the fog and erase your current drawing?")) return;
    this.drawing.clear({ clearFog: true });
    this.particles.clear();
    this.fog.clearAll();
    this.ui.setUndoRedo(this.drawing.getState());
    this.ui.showToast("The mirror is clear again.", { glyph: "○" });
  }

  async saveDrawing() {
    if (!this.drawing.hasArtwork()) {
      this.ui.showToast("There is no drawing to save yet.", { glyph: "○" });
      return;
    }
    try {
      await this.storage.saveDrawing(this.drawing.serialize());
      this.ui.showToast("Drawing saved locally. Use Restore to bring it back.", { glyph: "✓" });
    } catch (error) {
      this.ui.showToast(error.message || "The drawing could not be saved.", { glyph: "!" });
    }
  }

  async restoreDrawing() {
    try {
      const payload = await this.storage.loadDrawing();
      if (!payload) {
        this.ui.showToast("No saved drawing was found on this device.", { glyph: "○" });
        return;
      }
      if (this.fog.coverage < 0.1) this.fog.addFog(0.22);
      this.drawing.loadSerialized(payload, { applyFog: true });
      this.ui.setUndoRedo(this.drawing.getState());
      this.ui.showToast("Last drawing restored.", { glyph: "↺" });
    } catch (error) {
      this.ui.showToast(error.message || "The drawing could not be restored.", { glyph: "!" });
    }
  }

  async exportArtwork() {
    try {
      const result = await this.photoBooth.exportArtwork();
      downloadBlob(result.blob, `fog-mirror-artwork-${Date.now()}.png`);
      this.ui.showToast("Artwork exported as a PNG.", { glyph: "↓" });
    } catch (error) {
      this.ui.showToast(error.message || "The artwork could not be exported.", { glyph: "!" });
    }
  }

  async clearLocalData() {
    if (!window.confirm("Delete all locally stored photographs and drawings? This cannot be undone.")) return;
    try {
      await this.storage.clearAllLocalData();
      await this.gallery.refresh();
      this.ui.setGalleryCount(await this.gallery.getCount());
      this.drawing.clear({ clearFog: false });
      this.ui.showToast("All local photographs and drawings were deleted.", { glyph: "✓" });
    } catch (error) {
      this.ui.showToast(error.message || "Local data could not be cleared.", { glyph: "!" });
    }
  }

  startSessionTimer() {
    this.sessionInterval = setInterval(() => {
      if (document.hidden) return;
      this.sessionSeconds += 1;
      this.ui.setSessionTime(this.sessionSeconds);
    }, 1000);
  }

  startRenderLoop() {
    this.lastFrame = performance.now();
    this.fpsWindowStart = this.lastFrame;
    const frame = (now) => {
      if (this.destroyed) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
      this.lastFrame = now;

      if (!document.hidden) {
        this.update(dt, now);
        this.render(now);
        this.updateFps(now);
      }
      this.animationFrame = requestAnimationFrame(frame);
    };
    this.animationFrame = requestAnimationFrame(frame);
  }

  update(dt, now) {
    this.audio.update(dt);
    const levels = this.audio.getLevel();
    if (levels.breath > 0.055 && levels.calibrated) {
      this.fog.addBreath(levels.breath, dt);
      if (now - this.lastBreathMist > 90) {
        this.lastBreathMist = now;
        this.particles.emitBreathMist();
      }
    }

    this.fog.update(dt, now);
    this.droplets.update(dt, now);
    this.particles.update(dt, now);
    this.drawing.endWipeIfIdle();

    if (this.photoMode && this.photoBooth.busy) this.ui.noteGestureActivity();
    this.ui.setBreath(levels, this.audio.getWaveform());
  }

  render(now) {
    this.fog.render(now);
    this.droplets.render();
    this.particles.render();
    this.themeManager.render(now);
    this.renderHandOverlay(now);
  }

  renderHandOverlay(now) {
    if (!this.handCtx) return;
    if (this.handTracking.showOverlay && this.handTracking.ready) {
      this.handTracking.renderOverlay(this.handCtx, this.getMirrorSize().width, this.getMirrorSize().height, now);
    } else {
      const size = this.getMirrorSize();
      this.handCtx.clearRect(0, 0, size.width, size.height);
    }
  }

  updateFps(now) {
    this.frameCount += 1;
    if (now - this.fpsWindowStart >= 600) {
      this.renderFps = (this.frameCount * 1000) / (now - this.fpsWindowStart);
      this.frameCount = 0;
      this.fpsWindowStart = now;
      this.ui.setFps(this.renderFps);
    }
  }

  dispose() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.animationFrame);
    clearInterval(this.sessionInterval);
    this.resizeObserver?.disconnect();
    this.camera.stop();
    this.handTracking.dispose();
    this.faceDetection.dispose();
    this.audio.dispose();
    this.gallery.dispose();
    this.ui.closePanels();
  }
}

const app = new FogMirrorApp();
app.init().catch((error) => {
  console.error("Fog Mirror failed to initialize", error);
  const toast = document.getElementById("toast-stack");
  if (toast) {
    const item = document.createElement("div");
    item.className = "toast";
    item.innerHTML = `<span class="toast-glyph">!</span><span>Fog Mirror could not start. ${escapeHtml(error.message || "")}</span>`;
    toast.appendChild(item);
  }
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
