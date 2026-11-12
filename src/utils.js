/** Small, dependency-free utilities shared across the experience. */

export class Emitter {
  constructor() {
    this._listeners = new Map();
  }

  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }

  emit(type, detail) {
    const listeners = this._listeners.get(type);
    if (!listeners) return;
    for (const fn of [...listeners]) {
      try {
        fn(detail);
      } catch (error) {
        console.error(`[fog-mirror] listener for "${type}" failed`, error);
      }
    }
  }

  clear() {
    this._listeners.clear();
  }
}

export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const lerp = (a, b, t) => a + (b - a) * t;

export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const invLerp = (a, b, value) => (value - a) / (b - a || 1);

export const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export const distanceSq = (ax, ay, bx, by) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

export const formatTime = (seconds) => {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

export const formatDate = (timestamp) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
};

export const createCanvas = (width = 1, height = 1) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const uid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `f${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

export const makeSeededRandom = (seed = 0x9e3779b9) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Build a tileable, smooth multi-octave value-noise texture. */
export const buildNoiseTexture = (size = 256, seed = 1, octaves = 4) => {
  const random = makeSeededRandom(seed);
  const data = new Uint8Array(size * size);
  const layers = [];

  for (let octave = 0; octave < octaves; octave += 1) {
    const grid = 2 ** (octave + 2);
    const cells = new Float32Array(grid * grid);
    for (let i = 0; i < cells.length; i += 1) cells[i] = random();
    layers.push({ grid, cells });
  }

  const sample = (layer, x, y) => {
    const { grid, cells } = layer;
    const gx = (x / size) * grid;
    const gy = (y / size) * grid;
    const x0 = Math.floor(gx) % grid;
    const y0 = Math.floor(gy) % grid;
    const x1 = (x0 + 1) % grid;
    const y1 = (y0 + 1) % grid;
    const tx = gx - Math.floor(gx);
    const ty = gy - Math.floor(gy);
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = cells[y0 * grid + x0];
    const b = cells[y0 * grid + x1];
    const c = cells[y1 * grid + x0];
    const d = cells[y1 * grid + x1];
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let value = 0;
      let amplitude = 0.55;
      let total = 0;
      for (const layer of layers) {
        value += sample(layer, x, y) * amplitude;
        total += amplitude;
        amplitude *= 0.5;
      }
      data[y * size + x] = clamp(value / total) * 255;
    }
  }

  return data;
};

export const averageLuminance = (source, width, height) => {
  const canvas = createCanvas(32, 32);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  try {
    ctx.drawImage(source, 0, 0, 32, 32);
    const data = ctx.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
    }
    return sum / (data.length / 4) / 255;
  } catch {
    return 0.5;
  }
};

export const throttle = (fn, ms) => {
  let last = 0;
  let timeout = null;
  return (...args) => {
    const now = performance.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      clearTimeout(timeout);
      timeout = null;
      last = now;
      fn(...args);
    } else if (!timeout) {
      timeout = setTimeout(() => {
        last = performance.now();
        timeout = null;
        fn(...args);
      }, remaining);
    }
  };
};

export const debounce = (fn, ms) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
};

export const isMobile = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && window.innerWidth < 900);

export const pointInRect = (x, y, rect) =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
