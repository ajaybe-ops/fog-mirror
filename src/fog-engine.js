import { FOG_CONFIG } from "./config.js";
import { buildNoiseTexture, clamp, createCanvas, lerp, smoothstep } from "./utils.js";

const NOISE_SIZE = 256;

/**
 * The condensation simulation.
 *
 * Density lives in a low-resolution Float32 field. The field is cheap to
 * simulate, blur and clear; a high-resolution canvas only samples it with
 * animated fractal noise at draw time. This keeps the glass feeling alive on
 * ordinary laptops while leaving plenty of frame budget for hand inference.
 */
export class FogEngine {
  constructor(canvas, { intensity = 72, autoRefog = true, reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.densityCanvas = createCanvas(1, 1);
    this.densityCtx = this.densityCanvas.getContext("2d", { willReadFrequently: false });
    this.imageData = this.densityCtx.createImageData(1, 1);

    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.cols = 1;
    this.rows = 1;
    this.scaleX = 1;
    this.scaleY = 1;
    this.density = new Float32Array(1);
    this.temp = new Float32Array(1);
    this.snapshotData = null;

    this.intensity = clamp(intensity / 100);
    this.opacity = 0.48 + this.intensity * 0.48;
    this.autoRefog = autoRefog;
    this.reducedMotion = reducedMotion;
    this.frozen = false;
    this.hasBreathed = false;
    this.time = 0;
    this.lastDiffuse = 0;
    this.coverage = 0;
    this.coverageTick = 0;
    this.evaporation = FOG_CONFIG.evaporation;
    this.fogColor = [223, 232, 233];
    this.fogAlpha = 0.9;

    this.noiseA = buildNoiseTexture(NOISE_SIZE, 0x1f06, 4);
    this.noiseB = buildNoiseTexture(NOISE_SIZE, 0xa11ce, 3);
    this.resize(1, 1, 1);
  }

  resize(width, height, dpr = 1) {
    const newWidth = Math.max(1, Math.round(width));
    const newHeight = Math.max(1, Math.round(height));
    if (newWidth === this.width && newHeight === this.height && this.density.length > 1) return;

    const oldDensity = this.density;
    const oldCols = this.cols;
    const oldRows = this.rows;

    this.width = newWidth;
    this.height = newHeight;
    this.dpr = clamp(dpr, 1, 1.5);

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";

    const targetCols = clamp(Math.round(this.width / 3.5), 64, 560);
    const targetRows = Math.max(36, Math.round((targetCols * this.height) / this.width));
    this.cols = targetCols;
    this.rows = targetRows;
    this.scaleX = this.width / this.cols;
    this.scaleY = this.height / this.rows;

    this.density = new Float32Array(this.cols * this.rows);
    this.temp = new Float32Array(this.cols * this.rows);
    this.densityCanvas.width = this.cols;
    this.densityCanvas.height = this.rows;
    this.densityCtx = this.densityCanvas.getContext("2d", { willReadFrequently: false });
    this.imageData = this.densityCtx.createImageData(this.cols, this.rows);

    if (oldDensity.length > 1 && oldCols > 1 && oldRows > 1) {
      for (let y = 0; y < this.rows; y += 1) {
        const sy = Math.min(oldRows - 1, Math.floor((y / this.rows) * oldRows));
        for (let x = 0; x < this.cols; x += 1) {
          const sx = Math.min(oldCols - 1, Math.floor((x / this.cols) * oldCols));
          this.density[y * this.cols + x] = oldDensity[sy * oldCols + sx];
        }
      }
    }
  }

  setTheme(theme) {
    if (!theme) return;
    this.fogColor = theme.fogColor || this.fogColor;
    this.fogAlpha = theme.fogAlpha ?? this.fogAlpha;
  }

  setIntensity(value) {
    this.intensity = clamp(value / 100);
    this.opacity = 0.4 + this.intensity * 0.6;
  }

  setFrozen(frozen) {
    this.frozen = Boolean(frozen);
  }

  setAutoRefog(value) {
    this.autoRefog = Boolean(value);
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
  }

  addBreath(intensity, dt) {
    if (this.frozen || this.cols < 2) return;
    const strength = clamp(intensity);
    if (strength <= 0.01) return;
    this.hasBreathed = true;

    const amount = strength * dt * FOG_CONFIG.breathRate * (0.55 + this.intensity * 1.05);
    const offsetA = this.reducedMotion ? 0 : Math.floor(this.time * 5);
    const offsetB = this.reducedMotion ? 0 : Math.floor(-this.time * 3);
    const invCols = 1 / this.cols;
    const invRows = 1 / this.rows;

    for (let y = 0; y < this.rows; y += 1) {
      const ny = y * invRows;
      const dy = (ny - 1.08) / 0.72;
      for (let x = 0; x < this.cols; x += 1) {
        const nx = x * invCols;
        const dx = (nx - 0.5) / 0.7;
        const source = Math.exp(-(dx * dx + dy * dy) * 1.35);
        const n1 = this.noiseA[((y + offsetA) & 255) * NOISE_SIZE + ((x + offsetA) & 255)] / 255;
        const n2 = this.noiseB[((y + offsetB) & 255) * NOISE_SIZE + ((x * 2 + offsetB) & 255)] / 255;
        const texture = 0.4 + n1 * 0.85 + n2 * 0.2;
        const gain = (0.12 + source * 1.55) * texture * amount;
        const index = y * this.cols + x;
        this.density[index] = Math.min(1, this.density[index] + gain);
      }
    }
  }

  addFog(amount = 0.42) {
    if (this.frozen) return;
    this.hasBreathed = true;
    const offset = Math.floor(this.time * 2);
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        const index = y * this.cols + x;
        const n = this.noiseA[((y + offset) & 255) * NOISE_SIZE + ((x + offset) & 255)] / 255;
        const radial = 0.35 + 0.65 * Math.sin((x / this.cols) * Math.PI) * Math.sin((y / this.rows) * Math.PI);
        this.density[index] = Math.min(1, this.density[index] + amount * (0.35 + n * 0.9) * radial);
      }
    }
  }

  update(dt, time) {
    this.time = time / 1000;
    if (this.frozen) return;

    const evaporation = this.evaporation * (0.55 + this.intensity * 0.85);
    const density = this.density;
    for (let i = 0; i < density.length; i += 1) {
      const value = density[i];
      if (value <= 0.002) {
        if (value !== 0) density[i] = 0;
        continue;
      }
      density[i] = Math.max(0, value - evaporation * dt * (0.38 + value * 0.9));
    }

    if (this.autoRefog && this.hasBreathed) {
      const refog = FOG_CONFIG.autoRefog * dt * (0.35 + this.intensity * 0.9);
      for (let i = 0; i < density.length; i += 1) {
        if (density[i] < 0.92) density[i] = Math.min(0.92, density[i] + refog);
      }
    }

    if (time - this.lastDiffuse > 1000 / FOG_CONFIG.diffusionHz) {
      this.lastDiffuse = time;
      this.diffuse(FOG_CONFIG.diffusionAmount);
    }

    this.coverageTick += 1;
    if (this.coverageTick % 20 === 0) this.computeCoverage();
  }

  diffuse(amount) {
    const { cols, rows, density, temp } = this;
    if (cols < 3 || rows < 3) return;
    temp.set(density);
    const blend = clamp(amount);
    for (let y = 1; y < rows - 1; y += 1) {
      const row = y * cols;
      for (let x = 1; x < cols - 1; x += 1) {
        const i = row + x;
        const average = (temp[i - 1] + temp[i + 1] + temp[i - cols] + temp[i + cols]) * 0.25;
        density[i] = temp[i] + (average - temp[i]) * blend;
      }
    }
  }

  computeCoverage() {
    const density = this.density;
    let sum = 0;
    for (let i = 0; i < density.length; i += 1) sum += density[i];
    this.coverage = density.length ? sum / density.length : 0;
  }

  render(time) {
    if (this.cols < 2) return;
    const data = this.imageData.data;
    const density = this.density;
    const [baseR, baseG, baseB] = this.fogColor;
    const opacity = this.opacity * this.fogAlpha;
    const offsetX = this.reducedMotion ? 0 : Math.floor(time * 0.004) & 255;
    const offsetY = this.reducedMotion ? 0 : Math.floor(-time * 0.0025) & 255;
    const offsetX2 = this.reducedMotion ? 0 : Math.floor(-time * 0.006) & 255;
    const offsetY2 = this.reducedMotion ? 0 : Math.floor(time * 0.0035) & 255;

    for (let y = 0; y < this.rows; y += 1) {
      const noiseRow = ((y + offsetY) & 255) * NOISE_SIZE;
      const noiseRow2 = ((y + offsetY2) & 255) * NOISE_SIZE;
      for (let x = 0; x < this.cols; x += 1) {
        const index = y * this.cols + x;
        const d = density[index];
        const p = index * 4;
        if (d <= 0.003) {
          data[p + 3] = 0;
          continue;
        }

        const n1 = this.noiseA[noiseRow + ((x + offsetX) & 255)] / 255;
        const n2 = this.noiseB[noiseRow2 + ((x * 2 + offsetX2) & 255)] / 255;
        const cloud = 0.72 + n1 * 0.3 + n2 * 0.14;
        const edgeSoftness = smoothstep(0.01, 0.18, d);
        let alpha = Math.pow(d, 0.82) * cloud * opacity * edgeSoftness;
        alpha = clamp(alpha);

        const warmth = (n1 - 0.5) * 9 + (n2 - 0.5) * 4;
        data[p] = clamp(baseR + warmth, 0, 255);
        data[p + 1] = clamp(baseG + warmth * 0.72, 0, 255);
        data[p + 2] = clamp(baseB + warmth * 0.52, 0, 255);
        data[p + 3] = Math.round(alpha * 255);
      }
    }

    this.densityCtx.putImageData(this.imageData, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(this.densityCanvas, 0, 0, this.width, this.height);

    if (this.coverage > 0.025) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = "screen";
      const sheen = this.ctx.createLinearGradient(0, 0, this.width, this.height);
      sheen.addColorStop(0, "rgba(255,255,255,0.012)");
      sheen.addColorStop(0.42, "rgba(255,255,255,0.035)");
      sheen.addColorStop(0.62, "rgba(255,255,255,0.005)");
      sheen.addColorStop(1, "rgba(255,255,255,0.02)");
      this.ctx.fillStyle = sheen;
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.ctx.restore();
    }
  }

  sampleDensity(x, y) {
    if (this.cols < 2) return 0;
    const gx = clamp(Math.floor(x / this.scaleX), 0, this.cols - 1);
    const gy = clamp(Math.floor(y / this.scaleY), 0, this.rows - 1);
    return this.density[gy * this.cols + gx] || 0;
  }

  clearBrush(x, y, radius, strength = 1, { wetEdge = true, irregular = true } = {}) {
    if (this.frozen || this.cols < 2) return;
    const cx = x / this.scaleX;
    const cy = y / this.scaleY;
    const rx = Math.max(1, radius / this.scaleX);
    const ry = Math.max(1, radius / this.scaleY);
    const minX = Math.max(0, Math.floor(cx - rx * 1.35));
    const maxX = Math.min(this.cols - 1, Math.ceil(cx + rx * 1.35));
    const minY = Math.max(0, Math.floor(cy - ry * 1.35));
    const maxY = Math.min(this.rows - 1, Math.ceil(cy + ry * 1.35));
    const offset = Math.floor(this.time * 11);

    for (let gy = minY; gy <= maxY; gy += 1) {
      for (let gx = minX; gx <= maxX; gx += 1) {
        const dx = (gx - cx) / rx;
        const dy = (gy - cy) / ry;
        let distance = Math.sqrt(dx * dx + dy * dy);
        if (irregular) {
          const n = this.noiseB[((gy + offset) & 255) * NOISE_SIZE + ((gx - offset) & 255)] / 255;
          distance += (n - 0.5) * 0.22;
        }
        if (distance > 1.22) continue;
        const falloff = 1 - smoothstep(0.26, 1.04, distance);
        if (falloff <= 0) continue;
        const index = gy * this.cols + gx;
        const removed = this.density[index] * falloff * strength;
        this.density[index] = Math.max(0, this.density[index] - removed);
        if (wetEdge && distance > 0.72 && distance < 1.15) {
          this.density[index] = Math.min(1, this.density[index] + removed * 0.08);
        }
      }
    }
    this.coverageTick = 0;
  }

  clearPath(points, radius, strength = 1, options = {}) {
    if (!points?.length) return;
    if (points.length === 1) {
      this.clearBrush(points[0].x, points[0].y, radius, strength, options);
      return;
    }
    const spacing = Math.max(1.4, radius * 0.19);
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const steps = Math.max(1, Math.ceil(distance / spacing));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        this.clearBrush(lerp(from.x, to.x, t), lerp(from.y, to.y, t), radius, strength, options);
      }
    }
  }

  addPath(points, radius, strength = 1) {
    if (!points?.length || this.frozen) return;
    const spacing = Math.max(1.5, radius * 0.25);
    const stamp = (x, y) => {
      const cx = x / this.scaleX;
      const cy = y / this.scaleY;
      const rx = Math.max(1, radius / this.scaleX);
      const ry = Math.max(1, radius / this.scaleY);
      const minX = Math.max(0, Math.floor(cx - rx));
      const maxX = Math.min(this.cols - 1, Math.ceil(cx + rx));
      const minY = Math.max(0, Math.floor(cy - ry));
      const maxY = Math.min(this.rows - 1, Math.ceil(cy + ry));
      for (let gy = minY; gy <= maxY; gy += 1) {
        for (let gx = minX; gx <= maxX; gx += 1) {
          const dx = (gx - cx) / rx;
          const dy = (gy - cy) / ry;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > 1) continue;
          const falloff = 1 - smoothstep(0.1, 1, distance);
          const index = gy * this.cols + gx;
          this.density[index] = Math.min(1, this.density[index] + falloff * strength * 0.16);
        }
      }
    };
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const steps = Math.max(1, Math.ceil(distance / spacing));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        stamp(lerp(from.x, to.x, t), lerp(from.y, to.y, t));
      }
    }
  }

  clearCircle(x, y, radius) {
    this.clearBrush(x, y, radius, 1, { wetEdge: true, irregular: false });
  }

  clearAll() {
    this.density.fill(0);
    this.coverage = 0;
    this.hasBreathed = false;
  }

  snapshot() {
    return {
      data: this.density.slice(),
      cols: this.cols,
      rows: this.rows,
    };
  }

  restore(snapshot) {
    if (!snapshot?.data) return false;
    if (snapshot.cols !== this.cols || snapshot.rows !== this.rows) return false;
    this.density.set(snapshot.data);
    this.computeCoverage();
    return true;
  }
}
