import { THEMES } from "./config.js";
import { clamp, createCanvas, makeSeededRandom } from "./utils.js";

/**
 * Themes own colour, mood and the painterly overlays that sit above and below
 * the fog. The overlays are deliberately cheap: static layers are cached and
 * only the rain/neon shimmer is redrawn at a throttled rate.
 */
export class ThemeManager {
  constructor({ storage, preferences, onChange } = {}) {
    this.storage = storage;
    this.preferences = preferences || {};
    this.onChange = onChange || (() => {});
    this.themes = THEMES;
    this.current = THEMES[0];
    this.secretCanvas = null;
    this.themeCanvas = null;
    this.secretCtx = null;
    this.themeCtx = null;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.secretLayer = null;
    this.frostLayer = null;
    this.lastRender = 0;
    this.time = 0;
    this.reducedMotion = Boolean(this.preferences.reducedMotion);
  }

  attach({ secretCanvas, themeCanvas }) {
    this.secretCanvas = secretCanvas;
    this.themeCanvas = themeCanvas;
    this.secretCtx = secretCanvas.getContext("2d");
    this.themeCtx = themeCanvas.getContext("2d");
  }

  resize(width, height, dpr = 1) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = Math.min(2, Math.max(1, dpr));

    for (const canvas of [this.secretCanvas, this.themeCanvas]) {
      if (!canvas) continue;
      canvas.width = Math.round(this.width * this.dpr);
      canvas.height = Math.round(this.height * this.dpr);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    this.buildCachedLayers();
    this.paintSecret();
    this.lastRender = 0;
  }

  get all() {
    return this.themes;
  }

  getTheme(id) {
    return this.themes.find((theme) => theme.id === id) || this.themes[0];
  }

  setTheme(id, { silent = false } = {}) {
    const next = this.getTheme(id);
    if (!next) return this.current;
    this.current = next;
    document.documentElement.dataset.theme = next.id;
    document.documentElement.style.setProperty("--accent", next.accent);
    document.documentElement.style.setProperty("--accent-rgb", next.accentRgb);
    document.documentElement.style.setProperty("--accent-deep", next.accentDeep);
    document.documentElement.style.setProperty("--ambient-a", next.ambientA);
    document.documentElement.style.setProperty("--ambient-b", next.ambientB);
    document.documentElement.style.setProperty("--mirror-tint", next.mirrorTint);

    this.preferences.theme = next.id;
    this.storage?.savePreferences(this.preferences);
    this.buildCachedLayers();
    this.paintSecret();
    this.lastRender = 0;
    if (!silent) this.onChange(next, { direction: 0 });
    return next;
  }

  next() {
    const index = this.themes.findIndex((theme) => theme.id === this.current.id);
    const theme = this.themes[(index + 1) % this.themes.length];
    this.applyAndNotify(theme, 1);
    return theme;
  }

  previous() {
    const index = this.themes.findIndex((theme) => theme.id === this.current.id);
    const theme = this.themes[(index - 1 + this.themes.length) % this.themes.length];
    this.applyAndNotify(theme, -1);
    return theme;
  }

  applyAndNotify(theme, direction) {
    this.current = theme;
    document.documentElement.dataset.theme = theme.id;
    document.documentElement.style.setProperty("--accent", theme.accent);
    document.documentElement.style.setProperty("--accent-rgb", theme.accentRgb);
    document.documentElement.style.setProperty("--accent-deep", theme.accentDeep);
    document.documentElement.style.setProperty("--ambient-a", theme.ambientA);
    document.documentElement.style.setProperty("--ambient-b", theme.ambientB);
    document.documentElement.style.setProperty("--mirror-tint", theme.mirrorTint);
    this.preferences.theme = theme.id;
    this.storage?.savePreferences(this.preferences);
    this.buildCachedLayers();
    this.paintSecret();
    this.lastRender = 0;
    this.onChange(theme, { direction });
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
  }

  buildCachedLayers() {
    this.secretLayer = this.buildSecretLayer();
    this.frostLayer = this.buildFrostLayer();
  }

  buildSecretLayer() {
    const width = Math.max(1, this.width);
    const height = Math.max(1, this.height);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const theme = this.current;

    if (theme.secret === "mystery") {
      const random = makeSeededRandom(0x51f15e);
      const cx = width * 0.52;
      const cy = height * 0.47;
      const radius = Math.min(width, height) * 0.36;

      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.5);
      glow.addColorStop(0, "rgba(168, 137, 255, 0.28)");
      glow.addColorStop(0.45, "rgba(105, 79, 176, 0.1)");
      glow.addColorStop(1, "rgba(10, 8, 20, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = "rgba(213, 195, 255, 0.44)";
      ctx.lineWidth = 0.8;
      ctx.shadowColor = "rgba(166, 137, 255, 0.5)";
      ctx.shadowBlur = 14;

      const points = [];
      for (let i = 0; i < 26; i += 1) {
        const angle = random() * Math.PI * 2;
        const distance = radius * (0.35 + random() * 0.72);
        points.push({
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance * 0.84,
          r: 0.7 + random() * 1.8,
        });
      }

      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i * 7 + 3) % points.length];
        if (Math.hypot(a.x - b.x, a.y - b.y) > radius * 0.85) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (const point of points) {
        ctx.beginPath();
        ctx.fillStyle = "rgba(239, 230, 255, 0.75)";
        ctx.arc(point.x, point.y, point.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.17, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(224, 211, 255, 0.36)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.055, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(232, 222, 255, 0.8)";
      ctx.shadowBlur = 26;
      ctx.fill();
      ctx.restore();

      const vignette = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.8);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(5, 3, 12, 0.62)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    } else if (theme.secret === "love") {
      const random = makeSeededRandom(0x10ae);
      const glow = ctx.createRadialGradient(width * 0.55, height * 0.45, 0, width * 0.55, height * 0.45, width * 0.62);
      glow.addColorStop(0, "rgba(255, 137, 169, 0.17)");
      glow.addColorStop(0.6, "rgba(167, 66, 93, 0.05)");
      glow.addColorStop(1, "rgba(20, 5, 10, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < 18; i += 1) {
        const x = random() * width;
        const y = random() * height;
        const size = 5 + random() * 24;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((random() - 0.5) * 0.6);
        ctx.globalAlpha = 0.05 + random() * 0.12;
        ctx.fillStyle = "#ffb6ca";
        ctx.shadowColor = "#ff6d96";
        ctx.shadowBlur = 18;
        drawHeart(ctx, 0, 0, size);
        ctx.restore();
      }
    } else if (theme.secret === "neon") {
      const glow = ctx.createRadialGradient(width * 0.5, height * 0.56, 0, width * 0.5, height * 0.5, width * 0.58);
      glow.addColorStop(0, "rgba(27, 255, 214, 0.12)");
      glow.addColorStop(0.52, "rgba(110, 45, 198, 0.07)");
      glow.addColorStop(1, "rgba(3, 7, 9, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "rgba(91, 255, 221, 0.09)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x < width; x += 38) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 38) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    } else if (theme.secret === "rain") {
      const random = makeSeededRandom(0x7a19);
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "rgba(42, 62, 80, 0.18)");
      gradient.addColorStop(0.55, "rgba(22, 36, 48, 0.1)");
      gradient.addColorStop(1, "rgba(7, 12, 17, 0.3)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < 24; i += 1) {
        const x = random() * width;
        const y = random() * height;
        const r = 8 + random() * 46;
        const bokeh = ctx.createRadialGradient(x, y, 0, x, y, r);
        bokeh.addColorStop(0, `rgba(177, 209, 230, ${0.025 + random() * 0.04})`);
        bokeh.addColorStop(1, "rgba(177, 209, 230, 0)");
        ctx.fillStyle = bokeh;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (theme.secret === "art") {
      const random = makeSeededRandom(0xa77);
      const blobs = [
        ["rgba(255, 174, 94, 0.08)", width * 0.3, height * 0.42, width * 0.5],
        ["rgba(255, 99, 132, 0.06)", width * 0.72, height * 0.35, width * 0.45],
        ["rgba(126, 184, 255, 0.055)", width * 0.5, height * 0.78, width * 0.55],
      ];
      for (const [color, x, y, radius] of blobs) {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
      for (let i = 0; i < 30; i += 1) {
        ctx.fillStyle = `rgba(255, 225, 188, ${0.015 + random() * 0.03})`;
        ctx.beginPath();
        ctx.arc(random() * width, random() * height, 0.5 + random() * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (theme.secret === "frost") {
      const gradient = ctx.createRadialGradient(width * 0.5, height * 0.55, 0, width * 0.5, height * 0.55, width * 0.7);
      gradient.addColorStop(0, "rgba(217, 241, 255, 0.035)");
      gradient.addColorStop(0.65, "rgba(109, 170, 220, 0.05)");
      gradient.addColorStop(1, "rgba(6, 20, 33, 0.3)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    return canvas;
  }

  buildFrostLayer() {
    const width = Math.max(1, this.width);
    const height = Math.max(1, this.height);
    const canvas = createCanvas(width, height);
    if (this.current.secret !== "frost") return canvas;
    const ctx = canvas.getContext("2d");
    const random = makeSeededRandom(0xf057);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(214, 242, 255, 0.55)";
    ctx.shadowBlur = 8;

    const branch = (x, y, angle, length, widthValue, depth) => {
      if (depth <= 0 || length < 2) return;
      const endX = x + Math.cos(angle) * length;
      const endY = y + Math.sin(angle) * length;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = `rgba(222, 245, 255, ${0.055 + depth * 0.022})`;
      ctx.lineWidth = widthValue;
      ctx.stroke();

      const children = depth > 3 ? 3 : 2;
      for (let i = 0; i < children; i += 1) {
        const side = i % 2 === 0 ? 1 : -1;
        const spread = (0.34 + random() * 0.48) * side;
        branch(
          endX,
          endY,
          angle + spread + (random() - 0.5) * 0.16,
          length * (0.48 + random() * 0.22),
          widthValue * 0.62,
          depth - 1,
        );
      }
    };

    const edgePoints = 14;
    for (let i = 0; i < edgePoints; i += 1) {
      const side = i % 4;
      let x;
      let y;
      let angle;
      if (side === 0) {
        x = (i / edgePoints) * width;
        y = -2;
        angle = Math.PI / 2;
      } else if (side === 1) {
        x = width + 2;
        y = (i / edgePoints) * height;
        angle = Math.PI;
      } else if (side === 2) {
        x = (i / edgePoints) * width;
        y = height + 2;
        angle = -Math.PI / 2;
      } else {
        x = -2;
        y = (i / edgePoints) * height;
        angle = 0;
      }
      branch(x, y, angle + (random() - 0.5) * 0.5, 30 + random() * 75, 1.15, 6);
    }

    const cornerGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, width * 0.4);
    cornerGlow.addColorStop(0, "rgba(206, 237, 255, 0.1)");
    cornerGlow.addColorStop(1, "rgba(206, 237, 255, 0)");
    ctx.fillStyle = cornerGlow;
    ctx.fillRect(0, 0, width, height);

    return canvas;
  }

  paintSecret() {
    if (!this.secretCtx) return;
    this.secretCtx.clearRect(0, 0, this.width, this.height);
    if (this.secretLayer) {
      this.secretCtx.globalAlpha = this.current.secret === "mystery" ? 0.9 : 0.8;
      this.secretCtx.drawImage(this.secretLayer, 0, 0, this.width, this.height);
      this.secretCtx.globalAlpha = 1;
    }
  }

  render(time) {
    if (!this.themeCtx) return;
    const interval = this.reducedMotion ? 1000 : 1000 / 20;
    if (time - this.lastRender < interval) return;
    this.lastRender = time;
    this.time = time;

    const ctx = this.themeCtx;
    const width = this.width;
    const height = this.height;
    const theme = this.current;
    ctx.clearRect(0, 0, width, height);

    if (theme.id === "winter" && this.frostLayer) {
      ctx.globalAlpha = 0.88;
      ctx.drawImage(this.frostLayer, 0, 0, width, height);
      ctx.globalAlpha = 1;
      const breath = 0.02 + Math.sin(time * 0.0004) * 0.012;
      ctx.fillStyle = `rgba(206, 238, 255, ${breath})`;
      ctx.fillRect(0, 0, width, height);
    } else if (theme.id === "rain") {
      this.drawRain(ctx, width, height, time);
    } else if (theme.id === "neon") {
      this.drawNeonEdge(ctx, width, height, time);
    } else if (theme.id === "love") {
      const glow = ctx.createRadialGradient(width * 0.5, height * 0.5, height * 0.15, width * 0.5, height * 0.5, width * 0.7);
      glow.addColorStop(0, "rgba(255, 154, 183, 0)");
      glow.addColorStop(1, "rgba(255, 96, 137, 0.045)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    } else if (theme.id === "mystery") {
      const pulse = 0.012 + Math.sin(time * 0.0008) * 0.008;
      ctx.fillStyle = `rgba(191, 168, 255, ${pulse})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  drawRain(ctx, width, height, time) {
    if (this.reducedMotion) return;
    const random = makeSeededRandom(0x1a1a);
    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < 38; i += 1) {
      const baseX = random() * width;
      const speed = 0.03 + random() * 0.08;
      const offset = random() * height;
      const length = 10 + random() * 42;
      const x = baseX + Math.sin(time * 0.00015 + i) * 4;
      const y = ((offset + time * speed) % (height + length)) - length;
      ctx.strokeStyle = `rgba(202, 226, 244, ${0.025 + random() * 0.045})`;
      ctx.lineWidth = 0.7 + random() * 1.1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + length);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawNeonEdge(ctx, width, height, time) {
    const pulse = 0.5 + Math.sin(time * 0.0011) * 0.5;
    const gradient = ctx.createRadialGradient(width * 0.5, height * 0.5, height * 0.25, width * 0.5, height * 0.5, width * 0.66);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.8, `rgba(20, 255, 219, ${0.015 + pulse * 0.02})`);
    gradient.addColorStop(1, `rgba(39, 18, 85, ${0.09 + pulse * 0.04})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
}

function drawHeart(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.28);
  ctx.bezierCurveTo(x - size, y - size * 0.4, x - size * 0.4, y - size, x, y - size * 0.44);
  ctx.bezierCurveTo(x + size * 0.4, y - size, x + size, y - size * 0.4, x, y + size * 0.28);
  ctx.fill();
}

export { drawHeart };
