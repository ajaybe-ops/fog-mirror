import { GESTURE_CONFIG } from "./config.js";
import { clamp, distance, Emitter } from "./utils.js";

const FINGERS = {
  index: { tip: 8, pip: 6, mcp: 5 },
  middle: { tip: 12, pip: 10, mcp: 9 },
  ring: { tip: 16, pip: 14, mcp: 13 },
  pinky: { tip: 20, pip: 18, mcp: 17 },
};

/**
 * Temporal gesture recognition built on top of stable hand landmarks.
 *
 * Static poses are only accepted after several consecutive frames and every
 * discrete action has a cooldown. Continuous gestures (pinch writing, palm
 * wiping, fist freeze) have their own debounced on/off states.
 */
export class GestureRecognition extends Emitter {
  constructor({ config = GESTURE_CONFIG } = {}) {
    super();
    this.config = config;
    this.handStates = new Map();
    this.cooldowns = new Map();
    this.history = new Map();
    this.twoHandHistory = [];
    this.lastTwoHandGesture = 0;
    this.lastGesture = "No hands";
    this.lastGestureEmit = 0;
    this.activeHandCount = 0;
    this.lastProcess = 0;
    this.freezeActive = false;
    this.lastPointerEmit = 0;
  }

  process(hands, time = performance.now()) {
    const validHands = (hands || []).filter(
      (hand) => hand.confidence >= this.config.minHandConfidence && hand.screenLandmarks?.length >= 21,
    );
    this.activeHandCount = validHands.length;
    this.lastProcess = time;

    if (!validHands.length) {
      this.handleLost();
      return;
    }

    const seen = new Set();
    let label = "Tracking";
    let anyPinch = false;
    let anyOpenPalm = false;
    let anyFist = false;

    for (const hand of validHands) {
      seen.add(hand.id);
      const state = this.ensureHandState(hand.id);
      const features = this.analyzeHand(hand);
      state.features = features;
      state.hand = hand;

      this.processPinch(hand, features, state, time);
      if (state.pinch) anyPinch = true;
      if (features.openPalm) anyOpenPalm = true;
      if (features.fist) anyFist = true;

      this.processStaticPoses(hand, features, state, time);
      this.processSwipe(hand, state, time);
      this.processCircle(hand, state, time);

      if (state.pinch) label = "Pinch · drawing";
      else if (features.openPalm) label = "Open palm · wipe";
      else if (features.fist) label = "Fist · freeze";
      else if (features.peace) label = "Peace · selfie";
      else if (features.thumbsUp) label = "Thumbs up · confirm";
      else if (features.indexExtended) label = "Pointing";
      else label = `${hand.label} hand`;
    }

    if (anyOpenPalm && !anyPinch) {
      const hand = validHands.find((candidate) => this.handStates.get(candidate.id)?.features?.openPalm);
      if (hand) {
        this.emit("wipe", {
          x: hand.palm.x,
          y: hand.palm.y,
          radius: Math.max(34, hand.handScale * 1.65),
          handId: hand.id,
        });
      }
    }

    if (anyFist && !this.freezeActive) {
      this.freezeActive = true;
      this.emit("freeze", { active: true });
      this.emit("gesture", { type: "fist", label: "Fist · fog frozen" });
    } else if (!anyFist && this.freezeActive) {
      this.freezeActive = false;
      this.emit("freeze", { active: false });
      this.emit("gesture", { type: "unfist", label: "Fog released" });
    }

    if (validHands.length >= 2) {
      this.processTwoHands(validHands, time);
    } else {
      this.twoHandHistory = [];
    }

    if (label !== this.lastGesture || time - this.lastGestureEmit > 400) {
      this.lastGesture = label;
      this.lastGestureEmit = time;
      this.emit("state", { label, hands: validHands.length, pinch: anyPinch });
    }

    // End pinch states for hands that disappeared, but wait one frame so a
    // single dropped inference result does not break a stroke.
    for (const [id, state] of this.handStates) {
      if (seen.has(id)) continue;
      if (state.pinch) {
        state.missing += 1;
        if (state.missing > 2) {
          state.pinch = false;
          state.missing = 0;
          this.emit("pinchend", { handId: id });
        }
      } else {
        state.missing += 1;
        if (state.missing > 8) this.handStates.delete(id);
      }
    }
  }

  ensureHandState(id) {
    if (!this.handStates.has(id)) {
      this.handStates.set(id, {
        pinch: false,
        pinchFrames: 0,
        missing: 0,
        counters: {},
        lastPose: "",
        lastPoseTime: 0,
        pinchStart: 0,
        swipeHistory: [],
        circleHistory: [],
        lastCircle: 0,
      });
    }
    return this.handStates.get(id);
  }

  analyzeHand(hand) {
    const points = hand.landmarks;
    const wrist = points[0];
    const palm = points[9];
    const palmSize = Math.max(0.001, distance(wrist.x, wrist.y, palm.x, palm.y));
    const pinchRatio = distance(points[4].x, points[4].y, points[8].x, points[8].y) / palmSize;

    const extended = {};
    for (const [name, finger] of Object.entries(FINGERS)) {
      const tip = points[finger.tip];
      const pip = points[finger.pip];
      const tipDistance = distance(tip.x, tip.y, wrist.x, wrist.y);
      const pipDistance = distance(pip.x, pip.y, wrist.x, wrist.y);
      const sideways = distance(tip.x, tip.y, palm.x, palm.y) > palmSize * 0.5;
      extended[name] = tipDistance > pipDistance * 1.11 && sideways;
    }

    const thumbTip = points[4];
    const thumbMcp = points[2];
    const thumbExtended =
      distance(thumbTip.x, thumbTip.y, palm.x, palm.y) > palmSize * 0.72 &&
      distance(thumbTip.x, thumbTip.y, thumbMcp.x, thumbMcp.y) > palmSize * 0.42;

    const extendedCount = Object.values(extended).filter(Boolean).length;
    const foldedCount = Object.values(extended).filter((value) => !value).length;
    const tipsCloseToPalm = ["index", "middle", "ring", "pinky"].every((name) => {
      const tip = points[FINGERS[name].tip];
      return distance(tip.x, tip.y, palm.x, palm.y) < palmSize * 1.55;
    });

    const pinch = pinchRatio < this.config.pinchOn;
    const openPalm = extendedCount >= 4 && pinchRatio > this.config.pinchOff * 1.05;
    const fist = extendedCount === 0 && foldedCount === 4 && tipsCloseToPalm && pinchRatio > 0.42;
    const peace =
      extended.index &&
      extended.middle &&
      !extended.ring &&
      !extended.pinky &&
      pinchRatio > this.config.pinchOff * 1.15;
    const thumbsUp =
      thumbExtended &&
      extendedCount === 0 &&
      thumbTip.y < wrist.y - palmSize * 0.18 &&
      distance(thumbTip.x, thumbTip.y, wrist.x, wrist.y) > palmSize * 0.95;

    return {
      pinchRatio,
      pinch,
      extended,
      extendedCount,
      thumbExtended,
      openPalm,
      fist,
      peace,
      thumbsUp,
      indexExtended: extended.index,
      palmSize,
      displayX: 1 - palm.x,
      displayY: palm.y,
      pointerX: 1 - points[8].x,
      pointerY: points[8].y,
    };
  }

  processPinch(hand, features, state, time) {
    if (features.pinchRatio < this.config.pinchOn) {
      state.pinchFrames = Math.min(this.config.pinchFramesOn + 2, state.pinchFrames + 1);
    } else if (features.pinchRatio > this.config.pinchOff) {
      state.pinchFrames = Math.max(-(this.config.pinchFramesOff + 2), state.pinchFrames - 1);
    }

    if (!state.pinch && state.pinchFrames >= this.config.pinchFramesOn) {
      state.pinch = true;
      state.pinchStart = time;
      this.emit("pinchstart", {
        x: hand.indexTip.x,
        y: hand.indexTip.y,
        handId: hand.id,
        hand,
      });
      this.emit("gesture", { type: "pinch", label: "Pinch · writing" });
    } else if (state.pinch && state.pinchFrames <= -this.config.pinchFramesOff) {
      state.pinch = false;
      this.emit("pinchend", { handId: hand.id, hand });
      this.emit("gesture", { type: "unpinch", label: "Fog released" });
    }

    if (state.pinch) {
      this.emit("pinchmove", {
        x: hand.indexTip.x,
        y: hand.indexTip.y,
        handId: hand.id,
        hand,
      });
    }
  }

  processStaticPoses(hand, features, state, time) {
    const poses = {
      peace: features.peace,
      thumbsup: features.thumbsUp,
    };

    for (const [pose, active] of Object.entries(poses)) {
      if (!active) {
        state.counters[pose] = 0;
        continue;
      }
      state.counters[pose] = (state.counters[pose] || 0) + 1;
      const key = `pose:${pose}`;
      if (
        state.counters[pose] >= this.config.staticFrames &&
        this.canTrigger(key, this.config.gestureCooldownMs, time)
      ) {
        this.markTriggered(key, time);
        state.counters[pose] = 0;
        this.emit(pose, { x: hand.palm.x, y: hand.palm.y, handId: hand.id });
        this.emit("gesture", {
          type: pose,
          label: pose === "peace" ? "Peace · selfie mode" : "Thumbs up · confirmed",
        });
      }
    }
  }

  processSwipe(hand, state, time) {
    if (state.pinch) {
      state.swipeHistory = [];
      return;
    }
    const point = { x: 1 - hand.landmarks[9].x, y: hand.landmarks[9].y, time };
    state.swipeHistory.push(point);
    while (state.swipeHistory.length > 2 && time - state.swipeHistory[0].time > 420) {
      state.swipeHistory.shift();
    }
    if (state.swipeHistory.length < 3) return;

    const first = state.swipeHistory[0];
    const last = state.swipeHistory[state.swipeHistory.length - 1];
    const dt = Math.max(0.001, (last.time - first.time) / 1000);
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const speed = Math.abs(dx) / dt;
    if (
      Math.abs(dx) < this.config.swipeMinDistance ||
      speed < this.config.swipeMinSpeed ||
      Math.abs(dx) < Math.abs(dy) * 1.35
    ) {
      return;
    }
    if (!this.canTrigger("swipe", this.config.swipeCooldownMs, time)) return;
    this.markTriggered("swipe", time);
    state.swipeHistory = [];
    const direction = dx > 0 ? "right" : "left";
    this.emit("swipe", { direction, handId: hand.id });
    this.emit("gesture", {
      type: `swipe${direction}`,
      label: direction === "right" ? "Swipe right · next world" : "Swipe left · previous world",
    });
  }

  processCircle(hand, state, time) {
    if (state.pinch) {
      state.circleHistory = [];
      return;
    }
    if (!hand.landmarks?.[8]) return;
    const point = {
      x: 1 - hand.landmarks[8].x,
      y: hand.landmarks[8].y,
      time,
    };
    state.circleHistory.push(point);
    while (state.circleHistory.length > 2 && time - state.circleHistory[0].time > 1300) {
      state.circleHistory.shift();
    }
    if (state.circleHistory.length < 18) return;
    if (time - (state.lastCircle || 0) < this.config.circleCooldownMs) return;

    let cx = 0;
    let cy = 0;
    for (const p of state.circleHistory) {
      cx += p.x;
      cy += p.y;
    }
    cx /= state.circleHistory.length;
    cy /= state.circleHistory.length;

    let totalAngle = 0;
    let previousAngle = null;
    let radiusSum = 0;
    let minX = 1;
    let maxX = 0;
    let minY = 1;
    let maxY = 0;
    for (const p of state.circleHistory) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const radius = Math.hypot(dx, dy);
      radiusSum += radius;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      const angle = Math.atan2(dy, dx);
      if (previousAngle !== null) {
        let delta = angle - previousAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        totalAngle += delta;
      }
      previousAngle = angle;
    }

    const averageRadius = radiusSum / state.circleHistory.length;
    const closure = distance(
      state.circleHistory[0].x,
      state.circleHistory[0].y,
      state.circleHistory[state.circleHistory.length - 1].x,
      state.circleHistory[state.circleHistory.length - 1].y,
    );
    const aspect = (maxX - minX) / Math.max(0.001, maxY - minY);
    if (
      Math.abs(totalAngle) > Math.PI * 1.45 &&
      averageRadius > 0.045 &&
      averageRadius < 0.34 &&
      closure < 0.16 &&
      aspect > 0.45 &&
      aspect < 2.2
    ) {
      state.lastCircle = time;
      state.circleHistory = [];
      this.markTriggered("circle", time);
      this.emit("circle", { x: cx, y: cy, radius: clamp(averageRadius * 2.8, 0.1, 0.6) });
      this.emit("gesture", { type: "circle", label: "Circle · clearing glass" });
    }
  }

  processTwoHands(hands, time) {
    if (time - this.lastTwoHandGesture < this.config.twoHandCooldownMs) return;
    const a = hands[0].landmarks[9];
    const b = hands[1].landmarks[9];
    const displayAX = 1 - a.x;
    const displayBX = 1 - b.x;
    const current = {
      time,
      distance: Math.hypot(displayAX - displayBX, a.y - b.y),
    };
    this.twoHandHistory.push(current);
    while (this.twoHandHistory.length > 2 && time - this.twoHandHistory[0].time > 360) {
      this.twoHandHistory.shift();
    }
    if (this.twoHandHistory.length < 4) return;

    const first = this.twoHandHistory[0];
    const change = current.distance - first.distance;
    if (Math.abs(change) < 0.11) return;
    this.lastTwoHandGesture = time;
    this.twoHandHistory = [];
    if (change > 0) {
      this.emit("twohandspread", { amount: clamp(change * 2.5, 0.2, 1) });
      this.emit("gesture", { type: "spread", label: "Two hands · clearing wider" });
    } else {
      this.emit("twohandpinch", { amount: clamp(-change * 2.5, 0.2, 1) });
      this.emit("gesture", { type: "twohandpinch", label: "Two hands · clearing tighter" });
    }
  }

  canTrigger(key, cooldown, time) {
    const last = this.cooldowns.get(key) || 0;
    return time - last >= cooldown;
  }

  markTriggered(key, time) {
    this.cooldowns.set(key, time);
  }

  handleLost() {
    for (const [id, state] of this.handStates) {
      if (state.pinch) {
        state.pinch = false;
        this.emit("pinchend", { handId: id });
      }
    }
    if (this.freezeActive) {
      this.freezeActive = false;
      this.emit("freeze", { active: false });
    }
    this.handStates.clear();
    this.twoHandHistory = [];
    if (this.lastGesture !== "No hands") {
      this.lastGesture = "No hands";
      this.emit("state", { label: "No hands", hands: 0, pinch: false });
    }
  }

  reset() {
    this.handleLost();
    this.cooldowns.clear();
    this.lastGesture = "No hands";
  }
}
