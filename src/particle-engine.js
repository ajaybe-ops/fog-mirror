import { clamp } from "./utils.js";

/**
 * A compact additive particle system: fingertip glow, smoke, sparks, ripples,
 * hearts, rain, snow and slow atmospheric dust. Each theme changes both palette
 * and spawning behaviour.
 */
export class ParticleEngine {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.particles = [];
    this.maxParticles = 620;
    this.reducedMotion = reducedMotion;
    this.theme = null;
    this.time = 0;
    this.ambientAccumulator = 0;
    this.trailAccumulator = 0;
    this.random = Math.random;
  }

  resize(width, height, dpr = 1) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = clamp(dpr, 1, 1.5);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.particles.length = 0;
  }

  setTheme(theme) {
    this.theme = theme;
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
  }

  clear() {
    this.particles.length = 0;
  }

  spawn(particle) {
    if (this.particles.length >= this.maxParticles) {
      // Recycle the oldest non-essential particle.
      this.particles.shift();
    }
    this.particles.push({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      gravity: 0,
      drag: 0.98,
      life: 1,
      maxLife: 1,
      size: 2,
      rotation: 0,
      spin: 0,
      color: "rgba(255,255,255,0.8)",
      type: "glow",
      additive: true,
      wobble: 0,
      phase: Math.random() * Math.PI * 2,
      ...particle,
    });
  }

  emitTrail(x, y, { color, speed = 0, intensity = 1, theme = "fog" } = {}) {
    if (this.reducedMotion) {
      this.trailAccumulator += 0.35;
    } else {
      this.trailAccumulator += 1;
    }
    const count = this.reducedMotion ? 1 : 2;
    const palette = color || this.theme?.trail || "rgba(230, 245, 245, 0.8)";
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const drift = 8 + Math.random() * 30;
      this.spawn({
        x: x + (Math.random() - 0.5) * 5,
        y: y + (Math.random() - 0.5) * 5,
        vx: Math.cos(angle) * drift + (Math.random() - 0.5) * speed * 0.01,
        vy: Math.sin(angle) * drift - 8,
        size: 4 + Math.random() * 11,
        life: 0.35 + Math.random() * 0.6,
        maxLife: 0.35 + Math.random() * 0.6,
        color: palette,
        type: theme === "love" ? "heart" : theme === "neon" ? "spark" : "smoke",
        additive: theme === "neon" || theme === "mystery",
        gravity: theme === "love" ? -4 : -1,
        alpha: 0.14 + Math.random() * 0.2 * intensity,
      });
    }

    if (theme === "neon" && Math.random() < 0.5) {
      this.spawn({
        x,
        y,
        vx: (Math.random() - 0.5) * 80,
        vy: (Math.random() - 0.5) * 80,
        size: 1.4 + Math.random() * 2.4,
        life: 0.3 + Math.random() * 0.5,
        maxLife: 0.8,
        color: "#8affea",
        type: "spark",
        additive: true,
        drag: 0.94,
      });
    }
    if (theme === "art" && Math.random() < 0.22) {
      this.spawn({
        x,
        y,
        vx: (Math.random() - 0.5) * 30,
        vy: (Math.random() - 0.5) * 30,
        size: 3 + Math.random() * 7,
        life: 0.7 + Math.random() * 1.2,
        maxLife: 1.9,
        color: "rgba(255, 214, 161, 0.5)",
        type: "pigment",
        additive: false,
      });
    }
  }

  emitRipple(x, y, color = "rgba(220,245,245,0.7)", size = 30) {
    this.spawn({
      x,
      y,
      size,
      life: 0.8,
      maxLife: 0.8,
      color,
      type: "ripple",
      additive: true,
      drag: 1,
    });
  }

  emitBurst(x, y, color = "rgba(255,255,255,0.8)", count = 12) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 120;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1 + Math.random() * 2.6,
        life: 0.4 + Math.random() * 0.6,
        maxLife: 1,
        color,
        type: "spark",
        additive: true,
        drag: 0.94,
        gravity: 25,
      });
    }
  }

  emitHearts(x, y, count = 3) {
    for (let i = 0; i < count; i += 1) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 26,
        y: y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 20,
        vy: -15 - Math.random() * 30,
        size: 4 + Math.random() * 7,
        life: 1.2 + Math.random() * 1.5,
        maxLife: 2.7,
        color: "rgba(255, 153, 182, 0.7)",
        type: "heart",
        additive: false,
        gravity: -4,
        wobble: 0.7,
      });
    }
  }

  emitMist(x, y, color = "rgba(220, 240, 240, 0.22)") {
    this.spawn({
      x,
      y,
      vx: (Math.random() - 0.5) * 18,
      vy: -8 - Math.random() * 16,
      size: 20 + Math.random() * 35,
      life: 0.7 + Math.random() * 0.8,
      maxLife: 1.5,
      color,
      type: "mist",
      additive: false,
    });
  }

  emitBreathMist() {
    const count = this.reducedMotion ? 1 : 3;
    for (let i = 0; i < count; i += 1) {
      this.spawn({
        x: this.width * (0.35 + Math.random() * 0.3),
        y: this.height * (0.88 + Math.random() * 0.12),
        vx: (Math.random() - 0.5) * 35,
        vy: -18 - Math.random() * 32,
        size: 26 + Math.random() * 55,
        life: 0.8 + Math.random() * 0.9,
        maxLife: 1.7,
        color: this.theme?.fogColor
          ? `rgba(${this.theme.fogColor[0]}, ${this.theme.fogColor[1]}, ${this.theme.fogColor[2]}, 0.08)`
          : "rgba(230, 245, 245, 0.1)",
        type: "mist",
        additive: false,
      });
    }
  }

  emitPetal(x, y) {
    this.spawn({
      x,
      y,
      vx: (Math.random() - 0.5) * 20,
      vy: 8 + Math.random() * 20,
      size: 3 + Math.random() * 6,
      life: 1.8 + Math.random() * 1.8,
      maxLife: 3.6,
      color: "rgba(255, 165, 190, 0.55)",
      type: "petal",
      additive: false,
      gravity: 3,
      wobble: 0.8,
      spin: (Math.random() - 0.5) * 1.8,
    });
  }

  update(dt, time) {
    this.time = time;
    const theme = this.theme?.id || "fog";

    this.ambientAccumulator += dt;
    const ambientInterval = this.reducedMotion ? 0.45 : theme === "rain" ? 0.055 : theme === "winter" ? 0.24 : theme === "neon" ? 0.32 : 0.7;
    if (this.ambientAccumulator > ambientInterval) {
      this.ambientAccumulator = 0;
      this.spawnAmbient(theme);
    }

    const particles = this.particles;
    let write = 0;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;

      p.phase += dt * (1.2 + p.wobble);
      if (p.wobble) {
        p.vx += Math.cos(p.phase) * p.wobble * 14 * dt;
      }
      p.vy += p.gravity * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;

      if (p.type === "spark" || p.type === "rain") {
        p.vx *= 0.985;
      }

      if (
        p.x < -80 ||
        p.x > this.width + 80 ||
        p.y < -100 ||
        p.y > this.height + 100
      ) {
        if (p.type !== "snow" && p.type !== "rain") continue;
        if (p.y > this.height + 100) continue;
      }

      particles[write] = p;
      write += 1;
    }
    particles.length = write;
  }

  spawnAmbient(theme) {
    if (this.reducedMotion && Math.random() < 0.55) return;
    if (theme === "winter") {
      this.spawn({
        x: Math.random() * this.width,
        y: -8,
        vx: (Math.random() - 0.5) * 18,
        vy: 14 + Math.random() * 28,
        size: 1 + Math.random() * 2.5,
        life: 5 + Math.random() * 5,
        maxLife: 10,
        color: "rgba(222, 245, 255, 0.5)",
        type: "snow",
        additive: false,
        wobble: 0.35,
      });
    } else if (theme === "rain") {
      const x = Math.random() * this.width;
      this.spawn({
        x,
        y: -20,
        vx: -8 - Math.random() * 12,
        vy: 260 + Math.random() * 260,
        size: 12 + Math.random() * 28,
        life: 0.8 + Math.random() * 0.6,
        maxLife: 1.5,
        color: "rgba(189, 218, 238, 0.23)",
        type: "rain",
        additive: true,
        drag: 1,
      });
      if (Math.random() < 0.2) this.emitRipple(x, this.height * (0.2 + Math.random() * 0.7), "rgba(180,215,235,0.22)", 6);
    } else if (theme === "neon") {
      this.spawn({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        size: 0.8 + Math.random() * 2,
        life: 1 + Math.random() * 2.5,
        maxLife: 3.5,
        color: Math.random() < 0.5 ? "rgba(98,255,222,0.7)" : "rgba(183,120,255,0.55)",
        type: "star",
        additive: true,
      });
    } else if (theme === "love") {
      this.spawn({
        x: Math.random() * this.width,
        y: this.height + 10,
        vx: (Math.random() - 0.5) * 18,
        vy: -10 - Math.random() * 20,
        size: 3 + Math.random() * 6,
        life: 3 + Math.random() * 3,
        maxLife: 6,
        color: "rgba(255, 155, 184, 0.4)",
        type: "heart",
        additive: false,
        gravity: -2,
        wobble: 0.4,
      });
    } else if (theme === "mystery") {
      this.spawn({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        size: 0.7 + Math.random() * 1.6,
        life: 2 + Math.random() * 4,
        maxLife: 6,
        color: "rgba(202,182,255,0.55)",
        type: "star",
        additive: true,
      });
    } else if (theme === "art") {
      this.spawn({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 7,
        vy: -2 - Math.random() * 8,
        size: 1 + Math.random() * 2.6,
        life: 2 + Math.random() * 3,
        maxLife: 5,
        color: "rgba(255, 218, 169, 0.24)",
        type: "star",
        additive: true,
      });
    } else if (theme === "fog" || theme === "reflection") {
      this.spawn({
        x: Math.random() * this.width,
        y: this.height + 12,
        vx: (Math.random() - 0.5) * 10,
        vy: -3 - Math.random() * 9,
        size: 24 + Math.random() * 55,
        life: 4 + Math.random() * 4,
        maxLife: 8,
        color: "rgba(220, 240, 240, 0.018)",
        type: "mist",
        additive: false,
      });
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.particles.length) return;

    // Normal particles first, additive second, so glow remains crisp.
    for (const pass of [false, true]) {
      ctx.save();
      ctx.globalCompositeOperation = pass ? "lighter" : "source-over";
      for (const p of this.particles) {
        if (Boolean(p.additive) !== pass) continue;
        this.drawParticle(ctx, p);
      }
      ctx.restore();
    }
  }

  drawParticle(ctx, p) {
    const progress = clamp(p.life / p.maxLife);
    const alpha = (p.alpha ?? 0.75) * (p.type === "ripple" ? 1 - progress : progress);
    if (alpha <= 0.002) return;
    ctx.globalAlpha = clamp(alpha);

    switch (p.type) {
      case "ripple": {
        const size = p.size * (1 + (1 - progress) * 2.8);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 0.8 + progress * 1.2;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, size, size * 0.72, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "heart": {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        drawHeartPath(ctx, p.size);
        ctx.fill();
        ctx.restore();
        break;
      }
      case "petal": {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case "spark": {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(0.5, p.size * 0.45);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx.stroke();
        break;
      }
      case "rain": {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 0.6 + p.size * 0.025;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - 3, p.y + p.size);
        ctx.stroke();
        break;
      }
      case "star": {
        const twinkle = 0.55 + Math.sin(p.phase * 2) * 0.45;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = clamp(alpha * twinkle);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        if (p.size > 1.8) {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x - p.size * 2, p.y);
          ctx.lineTo(p.x + p.size * 2, p.y);
          ctx.moveTo(p.x, p.y - p.size * 2);
          ctx.lineTo(p.x, p.y + p.size * 2);
          ctx.stroke();
        }
        break;
      }
      case "snow": {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "mist": {
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        gradient.addColorStop(0, p.color);
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "pigment": {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * progress, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "smoke":
      default: {
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        gradient.addColorStop(0, p.color);
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
    ctx.globalAlpha = 1;
  }
}

function drawHeartPath(ctx, size) {
  ctx.beginPath();
  ctx.moveTo(0, size * 0.34);
  ctx.bezierCurveTo(-size, -size * 0.4, -size * 0.42, -size, 0, -size * 0.42);
  ctx.bezierCurveTo(size * 0.42, -size, size, -size * 0.4, 0, size * 0.34);
  ctx.closePath();
}
