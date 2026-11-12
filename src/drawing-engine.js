import { clamp, distance, Emitter, uid } from "./utils.js";

/**
 * Finger writing studio. A stroke both clears the fog field and leaves a
 * subtle wet-edge or themed pigment trace on the drawing canvas. Undo/redo
 * restores matching fog snapshots so the glass itself rewinds, not just ink.
 */
export class DrawingEngine extends Emitter {
  constructor({ canvas, fog, particles, themeManager, maxHistory = 14 } = {}) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.fog = fog;
    this.particles = particles;
    this.themeManager = themeManager;
    this.theme = themeManager?.current || null;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.tool = "write";
    this.brushSize = 26;
    this.active = new Map();
    this.commands = [];
    this.redoStack = [];
    this.maxHistory = maxHistory;
    this.lastPointer = null;
    this.lastWipe = 0;
    this.lastHaptic = 0;
  }

  resize(width, height, dpr = 1) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = clamp(dpr, 1, 1.5);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Snapshots are resolution-dependent. Keep the art, reset the undo stacks.
    this.commands.forEach((command) => {
      command.before = null;
      command.after = null;
    });
    this.redoStack = [];
    this.active.clear();
    this.redraw();
    this.emit("change", this.getState());
  }

  setTheme(theme) {
    this.theme = theme;
  }

  setTool(tool) {
    if (!["write", "erase", "wipe"].includes(tool)) return;
    this.tool = tool;
    this.endAllStrokes();
    this.emit("tool", tool);
  }

  setBrushSize(size) {
    this.brushSize = clamp(size, 4, 120);
    this.emit("brush", this.brushSize);
  }

  beginStroke(point, { source = "pointer", id = "pointer", tool = this.tool } = {}) {
    if (this.active.has(id)) return this.active.get(id);
    if (!point) return null;

    const brush = tool === "wipe" ? this.brushSize * 1.7 : this.brushSize;
    const command = {
      id: uid(),
      tool,
      width: brush,
      color: this.theme?.ink || "rgba(240,248,248,0.18)",
      glow: this.theme?.glow || 0,
      inkSolid: this.theme?.inkSolid || "#eef8f8",
      themeId: this.theme?.id || "fog",
      points: [{ x: point.x, y: point.y }],
      before: this.fog?.snapshot() || null,
      after: null,
      source,
      startedAt: performance.now(),
    };

    this.active.set(id, command);
    this.applySegment(command, point, point, true);
    this.emit("stroke-start", { command, source });
    return command;
  }

  moveStroke(point, { id = "pointer", source = "pointer" } = {}) {
    const command = this.active.get(id);
    if (!command || !point) return;
    const previous = command.points[command.points.length - 1];
    const moved = distance(previous.x, previous.y, point.x, point.y);
    if (moved < 0.65) return;

    const smoothed = {
      x: previous.x + (point.x - previous.x) * 0.82,
      y: previous.y + (point.y - previous.y) * 0.82,
    };
    command.points.push(smoothed);
    this.applySegment(command, previous, smoothed, false);
    this.emit("stroke-move", { command, source, point: smoothed });
  }

  endStroke({ id = "pointer", source = "pointer" } = {}) {
    const command = this.active.get(id);
    if (!command) return null;
    this.active.delete(id);
    command.after = this.fog?.snapshot() || null;
    command.endedAt = performance.now();
    this.commands.push(command);
    this.redoStack = [];
    this.trimHistory();
    this.emit("stroke-end", { command, source });
    this.emit("change", this.getState());
    return command;
  }

  endAllStrokes() {
    for (const id of [...this.active.keys()]) {
      this.endStroke({ id });
    }
  }

  applySegment(command, from, to, initial = false) {
    const tool = command.tool;
    const radius = command.width / 2;
    if (this.fog) {
      if (tool === "write" || tool === "wipe") {
        const strength = tool === "wipe" ? 0.82 : 1;
        this.fog.clearPath(initial ? [to] : [from, to], radius * (tool === "wipe" ? 1.8 : 1.04), strength, {
          wetEdge: true,
          irregular: true,
        });
      } else if (tool === "erase") {
        this.fog.addPath(initial ? [to] : [from, to], radius * 1.2, 0.5);
      }
    }

    if (tool === "write") this.drawSegment(command, from, to, initial);

    if (this.particles && (tool === "write" || tool === "wipe")) {
      const now = performance.now();
      if (now - this.lastHaptic > 38) {
        this.lastHaptic = now;
        this.particles.emitTrail(to.x, to.y, {
          color: this.theme?.trail,
          speed: 40,
          intensity: tool === "wipe" ? 0.5 : 1,
          theme: this.theme?.id,
        });
      }
    }
  }

  drawSegment(command, from, to, initial) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = command.color;
    ctx.lineWidth = Math.max(1, command.width * 0.38);
    ctx.shadowColor = command.inkSolid;
    ctx.shadowBlur = command.glow;
    ctx.globalAlpha = command.themeId === "fog" || command.themeId === "reflection" ? 0.9 : 1;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    if (initial) {
      ctx.lineTo(to.x + 0.01, to.y + 0.01);
    } else {
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      ctx.quadraticCurveTo(from.x, from.y, midX, midY);
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  redraw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    for (const command of this.commands) {
      if (command.tool !== "write") continue;
      this.drawFullPath(command);
    }
  }

  drawFullPath(command) {
    if (!command.points.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = command.color;
    ctx.lineWidth = Math.max(1, command.width * 0.38);
    ctx.shadowColor = command.inkSolid;
    ctx.shadowBlur = command.glow;
    ctx.globalAlpha = command.themeId === "fog" || command.themeId === "reflection" ? 0.9 : 1;
    ctx.beginPath();
    const points = command.points;
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 1) {
      ctx.lineTo(points[0].x + 0.01, points[0].y + 0.01);
    } else if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
    } else {
      for (let i = 1; i < points.length - 1; i += 1) {
        const midX = (points[i].x + points[i + 1].x) / 2;
        const midY = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  wipeAt(x, y, radius) {
    const now = performance.now();
    if (!this.active.has("palm")) {
      this.beginStroke({ x, y }, { source: "hand", id: "palm", tool: "wipe" });
    } else {
      this.moveStroke({ x, y }, { source: "hand", id: "palm" });
    }
    this.lastWipe = now;
    if (this.fog) this.fog.clearBrush(x, y, radius, 0.58, { wetEdge: true, irregular: true });
  }

  endWipeIfIdle(timeout = 220) {
    if (!this.active.has("palm")) return;
    if (performance.now() - this.lastWipe > timeout) {
      this.endStroke({ id: "palm", source: "hand" });
    }
  }

  undo() {
    this.endAllStrokes();
    const command = this.commands.pop();
    if (!command) return false;
    if (command.before && this.fog) {
      const restored = this.fog.restore(command.before);
      if (!restored) this.fog.addFog(0.18);
    } else if (this.fog) {
      this.fog.addFog(0.16);
    }
    this.redoStack.push(command);
    this.redraw();
    this.emit("undo", command);
    this.emit("change", this.getState());
    return true;
  }

  redo() {
    this.endAllStrokes();
    const command = this.redoStack.pop();
    if (!command) return false;
    if (command.after && this.fog) {
      const restored = this.fog.restore(command.after);
      if (!restored) this.reapplyFog(command);
    } else {
      this.reapplyFog(command);
    }
    this.commands.push(command);
    this.redraw();
    this.emit("redo", command);
    this.emit("change", this.getState());
    return true;
  }

  reapplyFog(command) {
    if (!this.fog) return;
    if (command.tool === "erase") {
      this.fog.addPath(command.points, command.width * 0.6, 0.5);
    } else {
      this.fog.clearPath(command.points, command.width * 0.55, command.tool === "wipe" ? 0.82 : 1, {
        wetEdge: true,
        irregular: true,
      });
    }
  }

  clear({ clearFog = true } = {}) {
    this.active.clear();
    this.commands = [];
    this.redoStack = [];
    this.ctx.clearRect(0, 0, this.width, this.height);
    if (clearFog) this.fog?.clearAll();
    this.emit("clear");
    this.emit("change", this.getState());
  }

  trimHistory() {
    while (this.commands.length > this.maxHistory) {
      const removed = this.commands.shift();
      removed.before = null;
      removed.after = null;
    }
  }

  getState() {
    return {
      canUndo: this.commands.length > 0,
      canRedo: this.redoStack.length > 0,
      strokes: this.commands.length,
      active: this.active.size,
    };
  }

  serialize() {
    return {
      version: 1,
      savedAt: Date.now(),
      brushSize: this.brushSize,
      commands: this.commands.map((command) => ({
        tool: command.tool,
        width: command.width,
        color: command.color,
        glow: command.glow,
        inkSolid: command.inkSolid,
        themeId: command.themeId,
        points: command.points.map((point) => ({
          x: Math.round(point.x * 10) / 10,
          y: Math.round(point.y * 10) / 10,
        })),
      })),
    };
  }

  loadSerialized(payload, { applyFog = true } = {}) {
    if (!payload?.commands?.length) return false;
    this.endAllStrokes();
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.commands = payload.commands
      .filter((command) => Array.isArray(command.points) && command.points.length)
      .map((command) => ({
        ...command,
        id: uid(),
        before: null,
        after: null,
        source: "restore",
      }));
    this.redoStack = [];
    if (applyFog && this.fog) {
      for (const command of this.commands) this.reapplyFog(command);
    }
    this.redraw();
    this.emit("change", this.getState());
    return true;
  }

  hasArtwork() {
    return this.commands.some((command) => command.tool === "write" && command.points.length > 1);
  }
}
