import { clamp, Emitter, lerp, smoothstep } from "./utils.js";

/**
 * Breath recognition from microphone input.
 *
 * The detector deliberately does not treat "loud" as "breath". It combines
 * broadband energy, spectral flatness, high-frequency ratio and zero-crossing
 * rate, calibrated against the room's noise floor. A short attack / slow release
 * envelope turns noisy microphone data into a smooth, usable fog signal.
 */
export class AudioEngine extends Emitter {
  constructor({ sensitivity = 58 } = {}) {
    super();
    this.sensitivity = clamp(sensitivity / 100);
    this.stream = null;
    this.context = null;
    this.analyser = null;
    this.source = null;
    this.timeData = null;
    this.freqData = null;
    this.state = "off";
    this.error = null;

    this.rms = 0;
    this.level = 0;
    this.breath = 0;
    this.score = 0;
    this.noiseFloor = 0.006;
    this.threshold = 0.03;
    this.calibrated = false;
    this.calibrationStart = 0;
    this.calibrationDuration = 1800;
    this.calibrationSamples = [];
    this.highRatio = 0;
    this.flatness = 0;
    this.zcr = 0;
    this.isBlowing = false;

    this.ambient = {
      on: false,
      nodes: [],
      gain: null,
      context: null,
    };
  }

  get isOn() {
    return this.state === "on";
  }

  get calibrationProgress() {
    if (this.calibrated) return 1;
    if (!this.calibrationStart) return 0;
    return clamp((performance.now() - this.calibrationStart) / this.calibrationDuration);
  }

  setSensitivity(value) {
    this.sensitivity = clamp(value / 100);
    this.recomputeThreshold();
  }

  recomputeThreshold() {
    const multiplier = lerp(4.2, 2.0, this.sensitivity);
    const minimum = lerp(0.034, 0.011, this.sensitivity);
    this.threshold = Math.max(minimum, this.noiseFloor * multiplier);
  }

  async enable() {
    if (this.state === "on") return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail(new Error("This browser does not support microphone access."));
      return false;
    }

    this.state = "requesting";
    this.emit("state", this.state);

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser.");
      this.context = new AudioContextClass();
      await this.context.resume();

      this.source = this.context.createMediaStreamSource(this.stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.68;
      this.analyser.minDecibels = -95;
      this.analyser.maxDecibels = -18;
      this.source.connect(this.analyser);

      this.timeData = new Float32Array(this.analyser.fftSize);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.calibrationSamples = [];
      this.calibrationStart = performance.now();
      this.calibrated = false;
      this.state = "calibrating";
      this.emit("state", this.state);

      this.stream.getAudioTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          this.state = "off";
          this.emit("state", this.state);
          this.emit("ended");
        });
      });

      this.emit("enabled");
      return true;
    } catch (error) {
      this.fail(this.friendlyError(error));
      return false;
    }
  }

  fail(error) {
    this.error = error;
    this.state = "error";
    this.emit("state", this.state);
    this.emit("error", error);
  }

  friendlyError(error) {
    const wrapped = new Error();
    if (!window.isSecureContext) {
      wrapped.message = "Microphone access requires HTTPS or localhost.";
    } else if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
      wrapped.message = "Microphone permission was declined. You can still add fog manually.";
    } else if (error?.name === "NotFoundError") {
      wrapped.message = "No microphone was found. Connect one and try again.";
    } else if (error?.name === "NotReadableError") {
      wrapped.message = "The microphone is in use by another app.";
    } else {
      wrapped.message = error?.message || "The microphone could not be started.";
    }
    wrapped.name = error?.name || "MicrophoneError";
    wrapped.cause = error;
    return wrapped;
  }

  disable() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.context && this.context.state === "running") {
      this.context.suspend().catch(() => {});
    }
    this.source = null;
    this.analyser = null;
    this.state = "off";
    this.breath = 0;
    this.level = 0;
    this.isBlowing = false;
    this.emit("state", this.state);
  }

  update(dt) {
    if (!this.analyser || !this.timeData || !this.freqData) {
      this.breath = Math.max(0, this.breath - dt * 2.4);
      this.level = Math.max(0, this.level - dt * 2.5);
      this.isBlowing = false;
      return;
    }

    const timeData = this.timeData;
    const freqData = this.freqData;
    this.analyser.getFloatTimeDomainData(timeData);
    this.analyser.getByteFrequencyData(freqData);

    let sumSquares = 0;
    let zeroCrossings = 0;
    for (let i = 0; i < timeData.length; i += 1) {
      const sample = timeData[i];
      sumSquares += sample * sample;
      if (i > 0 && ((sample >= 0 && timeData[i - 1] < 0) || (sample < 0 && timeData[i - 1] >= 0))) {
        zeroCrossings += 1;
      }
    }
    this.rms = Math.sqrt(sumSquares / timeData.length);
    this.zcr = zeroCrossings / timeData.length;

    const nyquist = (this.context?.sampleRate || 48000) / 2;
    const binHz = nyquist / freqData.length;
    let totalEnergy = 0;
    let highEnergy = 0;
    let logEnergy = 0;
    let peak = 0;
    let bins = 0;
    for (let i = 2; i < freqData.length; i += 1) {
      const value = freqData[i] / 255;
      const energy = value * value;
      totalEnergy += energy;
      if (i * binHz > 1600) highEnergy += energy;
      logEnergy += Math.log(energy + 1e-7);
      peak = Math.max(peak, energy);
      bins += 1;
    }
    const meanEnergy = totalEnergy / Math.max(1, bins);
    this.highRatio = totalEnergy > 0 ? highEnergy / totalEnergy : 0;
    this.flatness = meanEnergy > 0 ? Math.exp(logEnergy / Math.max(1, bins)) / meanEnergy : 0;

    if (!this.calibrated) {
      this.calibrationSamples.push(this.rms);
      const progress = this.calibrationProgress;
      if (progress >= 1) {
        this.finishCalibration();
      }
      this.level = clamp(this.rms * 5.5);
      this.breath = 0;
      this.isBlowing = false;
      return;
    }

    // Adapt slowly to a changing room, but never while a breath is in progress.
    if (this.rms < this.threshold * 0.75 && this.breath < 0.08) {
      this.noiseFloor = lerp(this.noiseFloor, this.rms, 0.0025);
      this.recomputeThreshold();
    }

    const levelScore = smoothstep(this.threshold * 0.82, this.threshold * 1.9, this.rms);
    const highScore = smoothstep(0.06, 0.24, this.highRatio);
    const flatScore = smoothstep(0.16, 0.42, this.flatness);
    const zcrScore = smoothstep(0.025, 0.12, this.zcr);
    const peakPenalty = peak > 0.55 ? 0.55 : 1;

    let score = levelScore * (0.4 + highScore * 0.22 + flatScore * 0.22 + zcrScore * 0.16) * peakPenalty;
    if (this.flatness < 0.14 && this.zcr < 0.045) score *= 0.28;
    this.score = clamp(score);

    const target = this.score > 0.16 ? this.score : 0;
    const rate = target > this.breath ? 8.5 : 2.1;
    this.breath += (target - this.breath) * clamp(dt * rate);
    this.breath = clamp(this.breath);
    this.level += (clamp(this.rms * 5.5) - this.level) * clamp(dt * 9);

    const blowing = this.breath > 0.17;
    if (blowing !== this.isBlowing) {
      this.isBlowing = blowing;
      this.emit(blowing ? "breathstart" : "breathend");
    }
    if (blowing) this.emit("breath", this.breath);
  }

  finishCalibration() {
    const samples = this.calibrationSamples.filter((value) => Number.isFinite(value));
    if (samples.length) {
      samples.sort((a, b) => a - b);
      const index = Math.floor(samples.length * 0.35);
      this.noiseFloor = Math.max(0.0025, samples[index]);
    }
    this.recomputeThreshold();
    this.calibrated = true;
    this.state = "on";
    this.calibrationStart = 0;
    this.emit("state", this.state);
    this.emit("calibrated", {
      noiseFloor: this.noiseFloor,
      threshold: this.threshold,
    });
  }

  getWaveform() {
    return this.timeData;
  }

  getLevel() {
    return {
      rms: this.rms,
      level: this.level,
      breath: this.breath,
      score: this.score,
      highRatio: this.highRatio,
      flatness: this.flatness,
      calibrated: this.calibrated,
      blowing: this.isBlowing,
    };
  }

  async ensureContext() {
    if (this.context && this.context.state !== "closed") {
      if (this.context.state === "suspended") await this.context.resume();
      return this.context;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is unavailable.");
    this.context = new AudioContextClass();
    await this.context.resume();
    return this.context;
  }

  async toggleAmbient() {
    if (this.ambient.on) {
      this.stopAmbient();
      return false;
    }
    await this.startAmbient();
    return true;
  }

  async startAmbient() {
    if (this.ambient.on) return;
    const context = await this.ensureContext();
    this.ambient.context = context;

    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 460;
    filter.Q.value = 0.5;
    filter.connect(master);

    const frequencies = [55, 82.41, 110, 164.81];
    const oscillators = frequencies.map((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index % 2 === 0 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = (index - 1.5) * 4.2;
      const gain = context.createGain();
      gain.gain.value = index === 0 ? 0.12 : 0.045 / (index + 1);
      oscillator.connect(gain);
      gain.connect(filter);
      oscillator.start();
      return oscillator;
    });

    const lfo = context.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = context.createGain();
    lfoGain.gain.value = 110;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    const shimmer = context.createOscillator();
    shimmer.type = "sine";
    shimmer.frequency.value = 329.63;
    const shimmerGain = context.createGain();
    shimmerGain.gain.value = 0.007;
    shimmer.connect(shimmerGain);
    shimmerGain.connect(filter);
    shimmer.start();

    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 3.2);

    this.ambient.nodes = [...oscillators, lfo, shimmer];
    this.ambient.gain = master;
    this.ambient.on = true;
    this.emit("ambient", true);
  }

  stopAmbient() {
    const { context, gain, nodes } = this.ambient;
    if (gain && context) {
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.4);
    }
    setTimeout(() => {
      for (const node of nodes) {
        try {
          node.stop();
        } catch {
          // Already stopped.
        }
      }
      try {
        gain?.disconnect();
      } catch {
        // Ignore.
      }
    }, 1400);
    this.ambient.on = false;
    this.ambient.nodes = [];
    this.ambient.gain = null;
    this.emit("ambient", false);
  }

  dispose() {
    this.stopAmbient();
    this.disable();
    if (this.context && this.context.state !== "closed") {
      this.context.close().catch(() => {});
    }
    this.context = null;
  }
}
