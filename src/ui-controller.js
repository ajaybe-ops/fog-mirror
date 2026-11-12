import { clamp, Emitter, formatTime } from "./utils.js";

const TUTORIAL_STEPS = [
  {
    eyebrow: "01 · THE BREATH",
    title: "Fog the glass.",
    copy: "Bring your face close to the microphone and exhale softly. The mirror responds to the texture of your breath, not to noise.",
    visual: `<div class="tutorial-breath"><i></i><i></i><i></i><i></i></div>`,
  },
  {
    eyebrow: "02 · THE PINCH",
    title: "Pinch to write.",
    copy: "Touch your thumb and index finger together. Move your hand through the condensation. Your fingertip clears the glass and leaves a wet line.",
    visual: `<div class="tutorial-pose pinch"><span class="pose-finger"></span><span class="pose-thumb"></span><span class="pose-spark"></span></div>`,
  },
  {
    eyebrow: "03 · THE PALM",
    title: "Wipe a window.",
    copy: "Open your palm flat and sweep it across the mirror for a wide clearing. Or draw a circle in the air to dissolve a round porthole.",
    visual: `<div class="tutorial-pose palm"><span></span><span></span><span></span><span></span><span></span></div>`,
  },
  {
    eyebrow: "04 · THE CAMERA",
    title: "Make a memory.",
    copy: "A peace sign enters selfie mode. A thumbs up starts a three-second countdown. Face detection frames you softly; the photograph is real and stays on this device.",
    visual: `<div class="tutorial-pose peace"><span></span><span></span><span></span><span></span></div>`,
  },
  {
    eyebrow: "05 · THE WORLD",
    title: "Change the air.",
    copy: "Swipe left or right in the air to move between worlds: love notes, winter frost, neon dreams, rain, mystery and pure reflection.",
    visual: `<div class="tutorial-swipe"><span class="swipe-line"></span><span class="swipe-dot"></span><span class="swipe-arrow">→</span></div>`,
  },
];

const HINTS = [
  "Blow softly toward your microphone to fog the glass.",
  "Pinch thumb and index to write. Open your palm to wipe a window.",
  "A peace sign enters selfie mode. A thumbs up starts the countdown.",
  "Swipe left or right in the air to change the atmosphere.",
];

/**
 * The UI owns DOM and input intent; it never talks to the engines directly.
 * Main wires the emitted actions to camera, audio, fog, drawing and photos.
 */
export class UIController extends Emitter {
  constructor({ preferences, themes } = {}) {
    super();
    this.preferences = preferences || {};
    this.themes = themes || [];
    this.theme = this.themes[0] || null;
    this.entryVisible = true;
    this.cameraReady = false;
    this.allowExplore = false;
    this.entryLeaving = false;
    this.panel = null;
    this.tutorialIndex = 0;
    this.hintIndex = 0;
    this.lastBreathPaint = 0;
    this.breathTime = 0;
    this.idleTimer = null;
    this.touchTimer = null;
    this._countdownHideTimer = null;

    this.dom = this.queryDom();
    this.bindStaticEvents();
    this.bindPointerActivity();
    this.bindKeyboard();
    this.populateThemes();
    this.applyPreferences(preferences || {});
    this.renderTutorial();
    this.syncEntryButtons();
  }

  queryDom() {
    const id = (value) => document.getElementById(value);
    return {
      app: id("app"),
      topbar: id("topbar"),
      entryScreen: id("entry-screen"),
      entryError: id("entry-error"),
      btnCameraEntry: id("btn-camera"),
      btnMicEntry: id("btn-mic-entry"),
      cameraPermissionState: id("camera-permission-state"),
      micPermissionState: id("mic-permission-state"),
      cameraPermissionNote: id("camera-permission-note"),
      micPermissionNote: id("mic-permission-note"),
      btnEnter: id("btn-enter"),
      btnSkip: id("btn-skip"),
      statusCamera: id("status-camera"),
      statusMic: id("status-mic"),
      statusGesture: id("status-gesture"),
      gestureLabel: id("gesture-label"),
      breathWidget: id("breath-widget"),
      breathCanvas: id("breath-canvas"),
      breathState: id("breath-state"),
      breathLabel: id("breath-label"),
      sessionTime: id("session-time"),
      fpsIndicator: id("fps-indicator"),
      fogSlider: id("fog-slider"),
      fogValue: id("fog-value"),
      settingsFog: id("settings-fog"),
      settingsFogValue: id("settings-fog-value"),
      sensitivity: id("settings-sensitivity"),
      sensitivityValue: id("settings-sensitivity-value"),
      brushSlider: id("brush-slider"),
      brushValue: id("brush-value"),
      settingsBrush: id("settings-brush"),
      settingsBrushValue: id("settings-brush-value"),
      themeChip: id("theme-chip"),
      themeName: id("theme-name"),
      themeSwatch: id("theme-swatch"),
      themePanel: id("theme-panel"),
      themeList: id("theme-list"),
      settingsPanel: id("settings-panel"),
      galleryPanel: id("gallery-panel"),
      galleryGrid: id("gallery-grid"),
      galleryEmpty: id("gallery-empty"),
      galleryCount: id("gallery-count"),
      galleryBadge: id("gallery-badge"),
      tutorialModal: id("tutorial-modal"),
      tutorialStep: id("tutorial-step"),
      tutorialEyebrow: id("tutorial-eyebrow"),
      tutorialTitle: id("tutorial-title"),
      tutorialCopy: id("tutorial-copy"),
      tutorialVisual: id("tutorial-visual"),
      tutorialProgress: id("tutorial-progress-bar"),
      tutorialDots: id("tutorial-dots"),
      tutorialPrev: id("btn-tutorial-prev"),
      tutorialNext: id("btn-tutorial-next"),
      countdown: id("countdown"),
      countdownNumber: id("countdown-number"),
      countdownCaption: id("countdown-caption"),
      flash: id("flash"),
      toastStack: id("toast-stack"),
      photoBanner: id("photo-banner"),
      gestureCallout: id("gesture-callout"),
      calloutTitle: id("callout-title"),
      calloutSub: id("callout-sub"),
      calloutIcon: id("callout-icon"),
      onboardingHint: id("onboarding-hint"),
      onboardingHintText: id("onboarding-hint-text"),
      onboardingHintNext: id("onboarding-hint-next"),
      onboardingHintClose: id("onboarding-hint-close"),
      fogDial: id("fog-dial"),
      btnMist: id("btn-mist"),
      btnUndo: id("btn-undo"),
      btnRedo: id("btn-redo"),
      btnClear: id("btn-clear"),
      btnPhoto: id("btn-photo"),
      btnStrip: id("btn-strip"),
      btnSaveDrawing: id("btn-save-drawing"),
      btnRestore: id("btn-restore"),
      btnExport: id("btn-export"),
      btnSound: id("btn-sound"),
      btnFullscreen: id("btn-fullscreen"),
      btnHands: id("btn-hands"),
      btnFreeze: id("btn-freeze"),
      btnPhotoClose: id("btn-photo-close"),
      btnGalleryShoot: id("btn-gallery-shoot"),
      btnGalleryClear: id("btn-gallery-clear"),
      btnDownloadAll: id("btn-download-all"),
      btnClearData: id("btn-clear-data"),
      settingRefog: id("setting-refog"),
      settingHands: id("setting-hands"),
      settingFace: id("setting-face"),
      settingAmbient: id("setting-ambient"),
      settingMotion: id("setting-motion"),
      filterRow: id("filter-row"),
      liveRegion: id("live-region"),
      toolButtons: [...document.querySelectorAll("[data-tool]")],
      closePanelButtons: [...document.querySelectorAll("[data-close-panel]")],
      filterChips: [...document.querySelectorAll("[data-filter]")],
    };
  }

  bindStaticEvents() {
    const emit = (type, detail) => this.emit(type, detail);

    this.dom.btnCameraEntry?.addEventListener("click", () => emit("camera-request"));
    this.dom.btnMicEntry?.addEventListener("click", () => emit("mic-request"));
    this.dom.btnEnter?.addEventListener("click", () => {
      if (this.dom.btnEnter.disabled) return;
      this.enterExperience();
    });
    this.dom.btnSkip?.addEventListener("click", () => {
      this.allowExplore = true;
      this.enterExperience();
    });
    this.dom.statusCamera?.addEventListener("click", () => {
      if (!this.cameraReady) emit("camera-request");
    });
    this.dom.statusMic?.addEventListener("click", () => emit("mic-request"));
    document.getElementById("btn-mic-quick")?.addEventListener("click", () => emit("mic-request"));
    document.getElementById("btn-camera-quick")?.addEventListener("click", () => emit("camera-request"));

    this.dom.fogSlider?.addEventListener("input", (event) => this.emitFog(Number(event.target.value)));
    this.dom.settingsFog?.addEventListener("input", (event) => this.emitFog(Number(event.target.value)));
    this.dom.sensitivity?.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      this.dom.sensitivityValue.textContent = `${value}%`;
      emit("sensitivity-change", value);
    });
    this.dom.brushSlider?.addEventListener("input", (event) => this.emitBrush(Number(event.target.value)));
    this.dom.settingsBrush?.addEventListener("input", (event) => this.emitBrush(Number(event.target.value)));
    this.dom.btnMist?.addEventListener("click", () => emit("mist"));
    document.getElementById("btn-fog-quick")?.addEventListener("click", () => emit("mist"));

    for (const button of this.dom.toolButtons) {
      button.addEventListener("click", () => emit("tool-change", button.dataset.tool));
    }
    this.dom.btnUndo?.addEventListener("click", () => emit("undo"));
    this.dom.btnRedo?.addEventListener("click", () => emit("redo"));
    this.dom.btnClear?.addEventListener("click", () => emit("clear"));
    this.dom.btnPhoto?.addEventListener("click", () => emit("photo"));
    this.dom.btnStrip?.addEventListener("click", () => emit("strip"));
    this.dom.btnSaveDrawing?.addEventListener("click", () => emit("save-drawing"));
    this.dom.btnRestore?.addEventListener("click", () => emit("restore-drawing"));
    this.dom.btnExport?.addEventListener("click", () => emit("export-artwork"));
    this.dom.btnSound?.addEventListener("click", () => emit("ambient-toggle"));
    this.dom.btnFullscreen?.addEventListener("click", () => this.toggleFullscreen());
    this.dom.btnHands?.addEventListener("click", () => emit("hands-toggle"));
    this.dom.btnFreeze?.addEventListener("click", () => emit("freeze-toggle"));
    this.dom.btnPhotoClose?.addEventListener("click", () => emit("photo-mode-close"));
    this.dom.btnGalleryShoot?.addEventListener("click", () => {
      this.closePanels();
      emit("photo");
    });

    this.dom.themeChip?.addEventListener("click", () => this.togglePanel("theme"));
    document.getElementById("btn-gallery")?.addEventListener("click", () => {
      const opening = this.panel !== "gallery";
      this.togglePanel("gallery");
      if (opening) emit("gallery-open");
    });
    document.getElementById("btn-settings")?.addEventListener("click", () => this.togglePanel("settings"));
    document.getElementById("btn-help")?.addEventListener("click", () => this.openTutorial());
    for (const button of this.dom.closePanelButtons) {
      button.addEventListener("click", () => this.closePanels());
    }

    this.dom.settingRefog?.addEventListener("change", (event) => emit("setting-change", { key: "autoRefog", value: event.target.checked }));
    this.dom.settingHands?.addEventListener("change", (event) => emit("setting-change", { key: "showHands", value: event.target.checked }));
    this.dom.settingFace?.addEventListener("change", (event) => emit("setting-change", { key: "faceAware", value: event.target.checked }));
    this.dom.settingAmbient?.addEventListener("change", (event) => emit("setting-change", { key: "ambient", value: event.target.checked }));
    this.dom.settingMotion?.addEventListener("change", (event) => emit("setting-change", { key: "reducedMotion", value: event.target.checked }));
    this.dom.btnClearData?.addEventListener("click", () => emit("clear-data"));

    for (const chip of this.dom.filterChips) {
      chip.addEventListener("click", () => {
        for (const item of this.dom.filterChips) item.classList.toggle("is-active", item === chip);
        emit("filter-change", chip.dataset.filter);
      });
    }

    this.dom.btnDownloadAll?.addEventListener("click", () => emit("gallery-download-all"));
    this.dom.btnGalleryClear?.addEventListener("click", () => emit("gallery-clear"));

    this.dom.tutorialPrev?.addEventListener("click", () => this.setTutorialStep(this.tutorialIndex - 1));
    this.dom.tutorialNext?.addEventListener("click", () => {
      if (this.tutorialIndex >= TUTORIAL_STEPS.length - 1) this.closeTutorial();
      else this.setTutorialStep(this.tutorialIndex + 1);
    });
    document.getElementById("btn-tutorial-close")?.addEventListener("click", () => this.closeTutorial());
    this.dom.tutorialModal?.addEventListener("click", (event) => {
      if (event.target === this.dom.tutorialModal) this.closeTutorial();
    });

    this.dom.onboardingHintNext?.addEventListener("click", () => this.nextHint());
    this.dom.onboardingHintClose?.addEventListener("click", () => this.hideOnboardingHint());

    document.addEventListener("fullscreenchange", () => {
      const active = Boolean(document.fullscreenElement);
      this.dom.btnFullscreen?.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
      this.dom.btnFullscreen?.setAttribute("title", active ? "Exit fullscreen (Shift+F)" : "Fullscreen (Shift+F)");
    });
  }

  bindPointerActivity() {
    const wake = () => {
      this.dom.app?.classList.remove("is-idle");
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.dom.app?.classList.add("is-idle"), 6500);
    };
    document.addEventListener("pointermove", wake, { passive: true });
    document.addEventListener("pointerdown", () => {
      wake();
      this.dom.app?.classList.add("is-touching");
      clearTimeout(this.touchTimer);
    }, { passive: true });
    document.addEventListener("pointerup", () => {
      clearTimeout(this.touchTimer);
      this.touchTimer = setTimeout(() => this.dom.app?.classList.remove("is-touching"), 1300);
    }, { passive: true });
    document.addEventListener("pointercancel", () => {
      clearTimeout(this.touchTimer);
      this.touchTimer = setTimeout(() => this.dom.app?.classList.remove("is-touching"), 600);
    }, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.closePanels();
    });
    wake();
  }

  bindKeyboard() {
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      const ctrl = event.ctrlKey || event.metaKey;

      if (key === "escape") {
        this.closePanels();
        this.closeTutorial();
        this.hideOnboardingHint();
        return;
      }

      if (ctrl && key === "z") {
        event.preventDefault();
        this.emit(event.shiftKey ? "redo" : "undo");
        return;
      }

      if (ctrl) return;

      if (key === "w") this.emit("tool-change", "write");
      else if (key === "e") this.emit("tool-change", "erase");
      else if (key === "b") this.emit("tool-change", "wipe");
      else if (key === "p") this.emit("photo");
      else if (key === "g") this.togglePanel("gallery");
      else if (key === "t") this.togglePanel("theme");
      else if (key === "h") this.emit("hands-toggle");
      else if (key === "f" && event.shiftKey) this.toggleFullscreen();
      else if (key === "f") this.emit("freeze-toggle");
      else if (key === "m") this.emit("mic-request");
      else if (key === "a") this.emit("ambient-toggle");
      else if (key === "s") this.emit("save-drawing");
      else if (key === "r") this.emit("restore-drawing");
      else if (key === "x") this.emit("export-artwork");
      else if (key === "?" || (key === "/" && event.shiftKey)) this.openTutorial();
      else if (/^[1-8]$/.test(key)) {
        const theme = this.themes[Number(key) - 1];
        if (theme) this.emit("theme-change", theme.id);
      }
    });
  }

  emitFog(value) {
    this.setFog(value);
    this.emit("fog-change", value);
  }

  emitBrush(value) {
    this.setBrush(value);
    this.emit("brush-change", value);
  }

  applyPreferences(preferences) {
    this.preferences = { ...this.preferences, ...preferences };
    this.setFog(preferences.fog ?? 72);
    this.setBrush(preferences.brush ?? 26);
    this.dom.sensitivity.value = String(preferences.sensitivity ?? 58);
    this.dom.sensitivityValue.textContent = `${preferences.sensitivity ?? 58}%`;
    this.dom.settingRefog.checked = preferences.autoRefog ?? true;
    this.dom.settingHands.checked = preferences.showHands ?? false;
    this.dom.settingFace.checked = preferences.faceAware ?? true;
    this.dom.settingAmbient.checked = preferences.ambient ?? false;
    this.dom.settingMotion.checked = preferences.reducedMotion ?? false;
    this.dom.btnHands.setAttribute("aria-pressed", String(Boolean(preferences.showHands)));
    this.dom.btnSound.setAttribute("aria-pressed", String(Boolean(preferences.ambient)));
    for (const chip of this.dom.filterChips) {
      chip.classList.toggle("is-active", chip.dataset.filter === (preferences.photoFilter || "natural"));
    }
    if (preferences.theme) this.setThemeById(preferences.theme);
  }

  populateThemes() {
    if (!this.dom.themeList) return;
    this.dom.themeList.innerHTML = "";
    for (const theme of this.themes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "theme-option";
      button.dataset.themeId = theme.id;
      button.innerHTML = `
        <span class="theme-preview" style="background:${theme.preview}"></span>
        <span class="theme-option-copy">
          <strong>${escapeHtml(theme.name)}</strong>
          <em>${escapeHtml(theme.subtitle)}</em>
        </span>
        <span class="theme-check" aria-hidden="true">✓</span>
      `;
      button.addEventListener("click", () => this.emit("theme-change", theme.id));
      this.dom.themeList.appendChild(button);
    }
  }

  setTheme(theme) {
    if (!theme) return;
    this.theme = theme;
    this.dom.themeName.textContent = theme.name;
    this.dom.themeChip?.setAttribute("aria-label", `Choose atmosphere. Current: ${theme.name}`);
    this.dom.themeSwatch.style.background = `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.75), transparent 35%), ${theme.preview}`;
    this.dom.themeSwatch.style.boxShadow = `0 0 16px ${theme.accent}44, inset 0 0 0 1px rgba(255,255,255,0.18)`;
    for (const option of this.dom.themeList.querySelectorAll(".theme-option")) {
      option.classList.toggle("is-active", option.dataset.themeId === theme.id);
    }
    this.announce(`${theme.name} atmosphere`);
  }

  setThemeById(id) {
    const theme = this.themes.find((candidate) => candidate.id === id);
    if (theme) this.setTheme(theme);
  }

  setFog(value) {
    const clamped = clamp(Math.round(value), 0, 100);
    this.dom.fogSlider.value = String(clamped);
    this.dom.settingsFog.value = String(clamped);
    this.dom.fogValue.textContent = String(clamped);
    this.dom.settingsFogValue.textContent = `${clamped}%`;
  }

  setBrush(value) {
    const clamped = clamp(Math.round(value), 8, 72);
    this.dom.brushSlider.value = String(clamped);
    this.dom.settingsBrush.value = String(clamped);
    this.dom.brushValue.textContent = `${clamped} px`;
    this.dom.settingsBrushValue.textContent = `${clamped} px`;
  }

  setTool(tool) {
    for (const button of this.dom.toolButtons) {
      const active = button.dataset.tool === tool;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  setUndoRedo({ canUndo, canRedo }) {
    this.dom.btnUndo.disabled = !canUndo;
    this.dom.btnRedo.disabled = !canRedo;
  }

  setCameraState(state, message = "") {
    const status = this.dom.statusCamera;
    const text = status?.querySelector(".status-text");
    status.dataset.state = state === "on" ? "on" : state === "requesting" ? "requesting" : state === "error" ? "error" : "off";
    if (text) {
      text.textContent =
        state === "on" ? "Camera live" :
        state === "requesting" ? "Camera…" :
        state === "error" ? "Camera issue" : "Camera off";
    }
    status.setAttribute(
      "aria-label",
      state === "on" ? "Camera live." :
      state === "requesting" ? "Camera opening." :
      state === "error" ? "Camera issue. Retry camera." : "Camera off. Enable camera."
    );
    this.cameraReady = state === "on";
    this.dom.btnCameraEntry.dataset.state = state;
    this.dom.cameraPermissionState.textContent =
      state === "on" ? "Ready" : state === "requesting" ? "Opening" : state === "error" ? "Retry" : "Enable";
    if (state === "on") {
      this.dom.cameraPermissionNote.textContent = "live · mirrored · local only";
      this.dom.app.classList.add("has-camera");
    } else if (state === "error") {
      this.dom.cameraPermissionNote.textContent = "permission unavailable";
    } else {
      this.dom.cameraPermissionNote.textContent = "required · stays on device";
      this.dom.app.classList.remove("has-camera");
    }
    if (state === "error" && message) this.setEntryError(message);
    if (state === "on") this.clearEntryError();
    this.syncEntryButtons();
  }

  setMicState(state, message = "") {
    const status = this.dom.statusMic;
    const text = status?.querySelector(".status-text");
    status.dataset.state = state === "on" ? "on" : state === "requesting" || state === "calibrating" ? "requesting" : state === "error" ? "error" : "off";
    if (text) {
      text.textContent =
        state === "on" ? "Mic live" :
        state === "calibrating" ? "Listening…" :
        state === "requesting" ? "Mic…" :
        state === "error" ? "Mic issue" : "Mic off";
    }
    status.setAttribute(
      "aria-label",
      state === "on" ? "Mic live." :
      state === "calibrating" ? "Mic listening. Calibrating." :
      state === "requesting" ? "Mic opening." :
      state === "error" ? "Mic issue. Retry microphone." : "Mic off. Enable microphone."
    );
    this.dom.btnMicEntry.dataset.state = state;
    this.dom.micPermissionState.textContent =
      state === "on" ? "Ready" : state === "requesting" ? "Opening" : state === "calibrating" ? "Calibrating" : state === "error" ? "Retry" : "Enable";
    if (state === "on") {
      this.dom.micPermissionNote.textContent = "hearing your breath";
      this.dom.breathState.textContent = "listening";
      this.dom.breathWidget.classList.add("is-listening");
    } else if (state === "calibrating") {
      this.dom.micPermissionNote.textContent = "calibrating the room";
      this.dom.breathState.textContent = "calibrating";
    } else if (state === "error") {
      this.dom.micPermissionNote.textContent = "unavailable";
      this.dom.breathState.textContent = "manual fog";
      this.dom.breathWidget.classList.remove("is-listening");
    } else {
      this.dom.micPermissionNote.textContent = "optional · hears your breath";
      this.dom.breathState.textContent = "listening";
    }
    if (state === "error" && message) this.showToast(message, { glyph: "!" });
    this.syncEntryButtons();
  }

  setTrackingState(state, label = "") {
    const status = this.dom.statusGesture;
    if (state === "loading") {
      status.dataset.state = "active";
      this.dom.gestureLabel.textContent = "Loading vision…";
    } else if (state === "ready") {
      status.dataset.state = "idle";
      this.dom.gestureLabel.textContent = label || "Show a hand";
    } else if (state === "error") {
      status.dataset.state = "lost";
      this.dom.gestureLabel.textContent = "Vision unavailable";
    } else {
      status.dataset.state = "idle";
      this.dom.gestureLabel.textContent = "No hands";
    }
  }

  setGesture(label, active = false) {
    const status = this.dom.statusGesture;
    status.dataset.state = active ? "active" : label === "No hands" ? "idle" : "idle";
    this.dom.gestureLabel.textContent = label;
    if (active) this.noteGestureActivity();
  }

  showGestureCallout(title, subtitle, glyph = "✳", duration = 1500) {
    if (!this.dom.gestureCallout) return;
    this.dom.calloutTitle.textContent = title;
    this.dom.calloutSub.textContent = subtitle;
    this.dom.calloutIcon.textContent = glyph;
    this.dom.gestureCallout.hidden = false;
    clearTimeout(this._calloutTimer);
    this._calloutTimer = setTimeout(() => {
      this.dom.gestureCallout.hidden = true;
    }, duration);
  }

  noteGestureActivity() {
    this.dom.app.classList.remove("is-idle");
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.dom.app.classList.add("is-idle"), 6500);
  }

  setBreath(levelData, waveform, force = false) {
    const now = performance.now();
    if (!force && now - this.lastBreathPaint < 45) return;
    this.lastBreathPaint = now;
    this.breathTime += 0.045;
    const breathing = Boolean(levelData?.blowing);
    this.dom.breathWidget.classList.toggle("is-breathing", breathing);
    this.dom.breathState.textContent = breathing
      ? "blowing"
      : levelData?.calibrated === false && this.dom.statusMic.dataset.state === "requesting"
        ? "calibrating"
        : "listening";
    this.drawBreathWave(waveform, levelData, breathing);
  }

  drawBreathWave(waveform, levelData, breathing) {
    const canvas = this.dom.breathCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const accent = this.theme?.accent || "#c8dfe0";
    const level = clamp(levelData?.level || 0);
    const amplitude = breathing ? 0.45 + level * 0.55 : 0.12 + level * 0.2;

    ctx.save();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = breathing ? 0.82 : 0.34;
    ctx.lineWidth = 1.1;
    ctx.shadowColor = accent;
    ctx.shadowBlur = breathing ? 9 : 3;
    ctx.beginPath();
    const points = waveform && waveform.length > 20 ? Math.min(90, waveform.length) : 90;
    for (let i = 0; i < points; i += 1) {
      const x = (i / (points - 1)) * width;
      let sample;
      if (waveform && waveform.length > 20) {
        const index = Math.floor((i / points) * waveform.length);
        sample = waveform[index] || 0;
      } else {
        sample = Math.sin(i * 0.28 + this.breathTime * 1.7) * 0.16;
      }
      const envelope = Math.sin((i / Math.max(1, points - 1)) * Math.PI);
      const y = height / 2 + sample * height * 0.9 * envelope * (0.4 + amplitude);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  setFreeze(active) {
    this.dom.btnFreeze.setAttribute("aria-pressed", String(active));
    this.showToast(active ? "Fog frozen. Make a fist again to release." : "Fog released.", { glyph: active ? "❄" : "≈" });
    this.announce(active ? "Fog frozen" : "Fog released");
  }

  setHandsEnabled(enabled) {
    this.dom.btnHands.setAttribute("aria-pressed", String(enabled));
    this.dom.settingHands.checked = Boolean(enabled);
  }

  setAmbient(on) {
    this.dom.btnSound.setAttribute("aria-pressed", String(on));
    this.dom.settingAmbient.checked = Boolean(on);
    this.showToast(on ? "Ambient glass room tone on." : "Ambient sound muted.", { glyph: on ? "♪" : "×" });
  }

  setReducedMotion(enabled) {
    this.dom.settingMotion.checked = Boolean(enabled);
  }

  setFaceAware(enabled) {
    this.dom.settingFace.checked = Boolean(enabled);
  }

  setPhotoMode(active) {
    this.dom.photoBanner.hidden = !active;
    if (active) this.showToast("Selfie mode. A thumbs up begins the countdown.", { glyph: "◉" });
  }

  showCountdown(value, caption = "") {
    clearTimeout(this._countdownHideTimer);
    if (!value) {
      this.dom.countdown.hidden = true;
      return;
    }
    this.dom.countdown.hidden = false;
    this.dom.countdownNumber.textContent = String(value);
    this.dom.countdownCaption.textContent = caption;
    this.dom.countdownNumber.animate(
      [
        { opacity: 0, transform: "scale(0.8)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }

  hideCountdown() {
    this.dom.countdown.hidden = true;
  }

  flash() {
    const flash = this.dom.flash;
    flash.classList.remove("is-firing");
    // Force a reflow so repeated captures always replay the flash.
    void flash.offsetWidth;
    flash.classList.add("is-firing");
  }

  showToast(message, { glyph = "✓", duration = 3400 } = {}) {
    if (!message) return;
    const stack = this.dom.toastStack;
    while (stack.children.length >= 3) stack.firstElementChild?.remove();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<span class="toast-glyph">${escapeHtml(glyph)}</span><span>${escapeHtml(message)}</span>`;
    stack.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("is-leaving");
      setTimeout(() => toast.remove(), 350);
    }, duration);
  }

  setEntryError(message) {
    if (!message) return;
    this.dom.entryError.hidden = false;
    this.dom.entryError.textContent = message;
  }

  clearEntryError() {
    this.dom.entryError.hidden = true;
    this.dom.entryError.textContent = "";
  }

  syncEntryButtons() {
    const canEnter = this.cameraReady || this.allowExplore;
    this.dom.btnEnter.disabled = !canEnter;
    this.dom.btnSkip.textContent = this.cameraReady ? "Explore without camera" : "Explore without camera";
  }

  setCameraBusy(busy) {
    this.dom.btnCameraEntry.disabled = Boolean(busy);
    this.dom.cameraPermissionState.textContent = busy
      ? "Opening"
      : this.cameraReady
        ? "Ready"
        : this.dom.btnCameraEntry.dataset.state === "error"
          ? "Retry"
          : "Enable";
  }

  setMicBusy(busy) {
    this.dom.btnMicEntry.disabled = Boolean(busy);
    this.dom.micPermissionState.textContent = busy
      ? "Opening"
      : this.dom.statusMic.dataset.state === "on"
        ? "Ready"
        : this.dom.btnMicEntry.dataset.state === "error"
          ? "Retry"
          : this.dom.btnMicEntry.dataset.state === "calibrating"
            ? "Calibrating"
            : "Enable";
  }

  enterExperience() {
    if (this.entryLeaving) return;
    this.entryLeaving = true;
    this.entryVisible = false;
    this.dom.entryScreen.classList.add("is-leaving");
    setTimeout(() => {
      this.dom.entryScreen.hidden = true;
      this.dom.entryScreen.classList.remove("is-leaving");
      this.entryLeaving = false;
    }, 950);
    this.emit("enter");
    this.showOnboardingHint(0);
  }

  showEntry() {
    this.entryVisible = true;
    this.entryLeaving = false;
    this.dom.entryScreen.hidden = false;
    this.dom.entryScreen.classList.remove("is-leaving");
  }

  showOnboardingHint(index = 0) {
    if (!this.dom.onboardingHint) return;
    this.hintIndex = clamp(index, 0, HINTS.length - 1);
    this.dom.onboardingHintText.textContent = HINTS[this.hintIndex];
    this.dom.onboardingHint.hidden = false;
    this.dom.onboardingHintNext.textContent = this.hintIndex >= HINTS.length - 1 ? "Done" : "Next";
  }

  nextHint() {
    if (this.hintIndex >= HINTS.length - 1) {
      this.hideOnboardingHint();
      this.preferences.onboardingSeen = true;
    } else {
      this.showOnboardingHint(this.hintIndex + 1);
    }
  }

  hideOnboardingHint() {
    this.dom.onboardingHint.hidden = true;
    this.preferences.onboardingSeen = true;
  }

  openPanel(name) {
    if (!name) return;
    const panel =
      name === "settings" ? this.dom.settingsPanel :
      name === "theme" ? this.dom.themePanel :
      name === "gallery" ? this.dom.galleryPanel : null;
    if (!panel) return;
    this.closePanels();
    panel.hidden = false;
    this.panel = name;
    this.dom.app.classList.remove("is-touching");
    const trigger =
      name === "settings" ? document.getElementById("btn-settings") :
      name === "theme" ? this.dom.themeChip :
      document.getElementById("btn-gallery");
    trigger?.setAttribute("aria-expanded", "true");
    setTimeout(() => panel.querySelector("button")?.focus({ preventScroll: true }), 60);
  }

  closePanels() {
    for (const panel of [this.dom.settingsPanel, this.dom.themePanel, this.dom.galleryPanel]) {
      if (panel) panel.hidden = true;
    }
    this.panel = null;
    this.dom.themeChip?.setAttribute("aria-expanded", "false");
    document.getElementById("btn-settings")?.setAttribute("aria-expanded", "false");
    document.getElementById("btn-gallery")?.setAttribute("aria-expanded", "false");
  }

  togglePanel(name) {
    if (this.panel === name) this.closePanels();
    else this.openPanel(name);
  }

  openTutorial() {
    this.closePanels();
    this.tutorialIndex = 0;
    this.renderTutorial();
    this.dom.tutorialModal.hidden = false;
    setTimeout(() => this.dom.tutorialNext.focus({ preventScroll: true }), 80);
  }

  closeTutorial() {
    this.dom.tutorialModal.hidden = true;
  }

  setTutorialStep(index) {
    this.tutorialIndex = clamp(index, 0, TUTORIAL_STEPS.length - 1);
    this.renderTutorial();
  }

  renderTutorial() {
    if (!this.dom.tutorialStep) return;
    const step = TUTORIAL_STEPS[this.tutorialIndex];
    this.dom.tutorialEyebrow.textContent = step.eyebrow;
    this.dom.tutorialTitle.textContent = step.title;
    this.dom.tutorialCopy.textContent = step.copy;
    this.dom.tutorialVisual.innerHTML = step.visual;
    this.dom.tutorialProgress.style.width = `${((this.tutorialIndex + 1) / TUTORIAL_STEPS.length) * 100}%`;
    this.dom.tutorialDots.innerHTML = TUTORIAL_STEPS.map(
      (_, index) => `<span class="${index === this.tutorialIndex ? "is-active" : ""}"></span>`,
    ).join("");
    this.dom.tutorialPrev.disabled = this.tutorialIndex === 0;
    this.dom.tutorialNext.textContent =
      this.tutorialIndex >= TUTORIAL_STEPS.length - 1 ? "Return to the mirror" : "Next gesture";
  }

  setSessionTime(seconds) {
    this.dom.sessionTime.textContent = formatTime(seconds);
  }

  setFps(fps) {
    const value = fps > 0 ? Math.round(fps) : 0;
    this.dom.fpsIndicator.textContent = value ? `${value} fps` : "— fps";
  }

  setGalleryCount(count) {
    this.dom.galleryBadge.textContent = count > 99 ? "99+" : String(count);
    this.dom.galleryBadge.hidden = count === 0;
  }

  setPhotoFilter(filter) {
    for (const chip of this.dom.filterChips) {
      chip.classList.toggle("is-active", chip.dataset.filter === filter);
    }
  }

  announce(message) {
    if (!this.dom.liveRegion) return;
    this.dom.liveRegion.textContent = "";
    setTimeout(() => {
      this.dom.liveRegion.textContent = message;
    }, 30);
  }

  async toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        const element = document.documentElement;
        if (element.requestFullscreen) await element.requestFullscreen();
        else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
        else this.showToast("Fullscreen is not available in this browser.", { glyph: "!" });
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      this.showToast("Fullscreen was blocked by the browser.", { glyph: "!" });
    }
  }

  isPanelOpen(name) {
    return this.panel === name;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
