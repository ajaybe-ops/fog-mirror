import { clamp, distance, Emitter } from "./utils.js";

/**
 * Condensation beads with simple mass physics. Beads grow while the glass is
 * fogged, merge with neighbours, then run down the mirror leaving a clear
 * trail through the fog field.
 */
export class DropletEngine extends Emitter {
  constructor(canvas, fog, { theme = null, reducedMotion = false } = {}) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.fog = fog;
    this.theme = theme;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.droplets = [];
    this.maxDroplets = 90;
    this.spawnAccumulator = 0;
    this.reducedMotion = reducedMotion;
    this.time = 0;
  }

  resize(width, height, dpr = 1) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = clamp(dpr, 1, 1.5);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.droplets.length = 0;
  }

  setTheme(theme) {
    this.theme = theme;
    this.maxDroplets = theme?.id === "rain" ? 110 : theme?.id === "winter" ? 72 : 82;
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
  }

  update(dt, time) {
    this.time = time;
    const theme = this.theme?.id || "fog";
    const coverage = this.fog?.coverage || 0;

    if (!this.reducedMotion) {
      const baseRate = theme === "rain" ? 26 : theme === "winter" ? 9 : theme === "reflection" ? 2 : 11;
      const rate = baseRate * clamp(coverage * 1.8, 0, 1.4);
      this.spawnAccumulator += dt * rate;
      const spawnCount = Math.floor(this.spawnAccumulator);
      if (spawnCount > 0) {
        this.spawnAccumulator -= spawnCount;
        for (let i = 0; i < spawnCount && this.droplets.length < this.maxDroplets; i += 1) {
          this.spawnDroplet(theme);
        }
      }
    }

    const gravity = theme === "rain" ? 680 : 420;
    for (const drop of this.droplets) {
      if (drop.falling) {
        drop.vy += gravity * dt;
        drop.vy = Math.min(drop.vy, theme === "rain" ? 520 : 300);
        drop.x += Math.sin(time * 0.003 + drop.phase) * 12 * dt + drop.drift * dt;
        drop.y += drop.vy * dt;
        drop.wobble += dt * 3;

        if (this.fog && !this.fog.frozen) {
          this.fog.clearBrush(drop.x, drop.y, drop.r * 2.4, 0.34, { wetEdge: true, irregular: true });
        }

        if (Math.random() < dt * 8) {
          this.emit("trail", { x: drop.x, y: drop.y, radius: drop.r });
        }

        if (drop.y > this.height + drop.r * 2) {
          drop.dead = true;
        }
      } else {
        drop.wobble += dt * (1.2 + drop.phase * 0.2);
        const density = this.fog?.sampleDensity(drop.x, drop.y) || 0;
        if (density < 0.03) {
          drop.life -= dt * 3.2;
        } else {
          drop.life = Math.min(1, drop.life + dt * 0.3);
          drop.r = Math.min(drop.maxR, drop.r + dt * (theme === "rain" ? 2.8 : 1.1) * (0.35 + density));
        }

        drop.x += Math.sin(drop.wobble) * 0.12;
        drop.y += Math.cos(drop.wobble * 0.8) * 0.08;

        const trigger = drop.r > drop.maxR * 0.88 || (drop.age > drop.holdTime && drop.r > 4.2);
        if (trigger || drop.life <= 0) {
          if (drop.life <= 0) {
            drop.dead = true;
          } else {
            drop.falling = true;
            drop.vy = 8 + Math.random() * 18;
            drop.drift = (Math.random() - 0.5) * 10;
          }
        }
      }
      drop.age += dt;
    }

    this.mergeDroplets();
    this.droplets = this.droplets.filter((drop) => !drop.dead);
  }

  spawnDroplet(theme) {
    let x = 0;
    let y = 0;
    let density = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      x = 8 + Math.random() * (this.width - 16);
      y = 8 + Math.random() * (this.height - 16);
      density = this.fog?.sampleDensity(x, y) || 0;
      if (density > 0.25) break;
    }
    if (density < 0.18) return;

    const maxR = theme === "rain" ? 4 + Math.random() * 8 : 2.5 + Math.random() * 7.5;
    this.droplets.push({
      x,
      y,
      r: 0.7 + Math.random() * 1.8,
      maxR,
      vy: 0,
      drift: (Math.random() - 0.5) * 8,
      phase: Math.random() * Math.PI * 2,
      wobble: Math.random() * Math.PI * 2,
      falling: false,
      life: 1,
      age: 0,
      holdTime: theme === "rain" ? 0.8 + Math.random() * 3 : 3 + Math.random() * 12,
      dead: false,
      hue: theme === "rain" ? 205 : theme === "love" ? 340 : 190,
    });
  }

  mergeDroplets() {
    const drops = this.droplets;
    for (let i = 0; i < drops.length; i += 1) {
      const a = drops[i];
      if (a.dead || a.falling) continue;
      for (let j = i + 1; j < drops.length; j += 1) {
        const b = drops[j];
        if (b.dead || b.falling) continue;
        if (distance(a.x, a.y, b.x, b.y) < (a.r + b.r) * 0.72) {
          const area = a.r * a.r + b.r * b.r;
          const mergedRadius = Math.sqrt(area);
          a.x = (a.x * a.r + b.x * b.r) / (a.r + b.r);
          a.y = (a.y * a.r + b.y * b.r) / (a.r + b.r);
          a.r = mergedRadius;
          a.maxR = Math.max(a.maxR, mergedRadius * 1.35);
          a.vy += 6;
          b.dead = true;
          if (a.r > 6.2) {
            a.falling = true;
            a.vy = 12;
          }
        }
      }
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.droplets.length) return;

    for (const drop of this.droplets) {
      const alpha = drop.falling ? 0.82 : drop.life * 0.86;
      if (alpha <= 0.02) continue;
      ctx.save();
      ctx.globalAlpha = clamp(alpha);

      if (drop.falling) {
        const trailLength = Math.min(70, 18 + drop.vy * 0.12);
        const trail = ctx.createLinearGradient(drop.x, drop.y - trailLength, drop.x, drop.y);
        trail.addColorStop(0, "rgba(220, 240, 245, 0)");
        trail.addColorStop(1, "rgba(220, 240, 245, 0.12)");
        ctx.strokeStyle = trail;
        ctx.lineWidth = Math.max(1, drop.r * 0.7);
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y - trailLength);
        ctx.lineTo(drop.x, drop.y);
        ctx.stroke();
      }

      const r = Math.max(1.2, drop.r);
      const gradient = ctx.createRadialGradient(
        drop.x - r * 0.34,
        drop.y - r * 0.42,
        r * 0.08,
        drop.x,
        drop.y,
        r * 1.08,
      );
      gradient.addColorStop(0, "rgba(255,255,255,0.62)");
      gradient.addColorStop(0.18, "rgba(232,247,250,0.22)");
      gradient.addColorStop(0.56, "rgba(142,175,182,0.14)");
      gradient.addColorStop(0.88, "rgba(24,38,42,0.16)");
      gradient.addColorStop(1, "rgba(0,0,0,0.03)");

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(drop.x, drop.y, r, r * (drop.falling ? 1.16 : 1.04), 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.ellipse(drop.x, drop.y, r * 0.92, r * 0.92, 0, Math.PI * 0.2, Math.PI * 1.15);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.beginPath();
      ctx.arc(drop.x - r * 0.3, drop.y - r * 0.36, Math.max(0.45, r * 0.15), 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }
}
