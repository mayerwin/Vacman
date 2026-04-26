// Web Audio synthesis — every sound effect is generated from oscillators +
// noise so the game ships with zero audio assets.
//
// The AudioContext can only start after a user gesture, so the menu wires
// sound.unlock() to the first click. Until then sound stays silent.

const NOTES = { c: 261.63, d: 293.66, e: 329.63, f: 349.23, g: 392.00, a: 440.00, b: 493.88 };

class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.vacBus = null;
    this.enabled = true;
    this.unlocked = false;
    this.engineSrc = null;
    this.engineGain = null;
    this.engineSpeedTarget = 0;
    this.engineSpeedCurrent = 0;
    this.musicTimer = 0;
    this.lastDirtAt = 0;
  }

  unlock() {
    if (this.unlocked) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.5;
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.85;
      this.sfxBus.connect(this.master);
      this.vacBus = this.ctx.createGain();
      this.vacBus.gain.value = 0.6;
      this.vacBus.connect(this.master);
      this.unlocked = true;
      this._startEngine();
    } catch (err) {
      console.warn("Sound init failed:", err);
      this.enabled = false;
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.6 : 0;
  }

  // ---------- Engine drone ----------

  _startEngine() {
    if (!this.ctx) return;
    // Two detuned saws + a low bandpassed white noise = a vacuum motor.
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = "sawtooth"; osc2.type = "sawtooth";
    osc1.frequency.value = 110; osc2.frequency.value = 113;
    const noise = this.ctx.createBufferSource();
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 1, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    noise.buffer = buf; noise.loop = true;
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 800;
    noiseFilter.Q.value = 1.2;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.15;
    noise.connect(noiseFilter).connect(noiseGain).connect(this.vacBus);

    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 600;
    osc1.connect(lowpass);
    osc2.connect(lowpass);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    lowpass.connect(gain).connect(this.vacBus);

    osc1.start(); osc2.start(); noise.start();
    this.engineSrc = { osc1, osc2, noise, lowpass };
    this.engineGain = gain;
    this.engineNoiseGain = noiseGain;
  }

  setEngineSpeed(speed01) {
    this.engineSpeedTarget = Math.max(0, Math.min(1, speed01));
  }

  tick(dt) {
    if (!this.unlocked || !this.ctx) return;
    // Smooth the engine ramp so it doesn't pop.
    this.engineSpeedCurrent += (this.engineSpeedTarget - this.engineSpeedCurrent) * Math.min(1, dt * 6);
    if (this.engineGain) {
      const idle = 0.04;
      this.engineGain.gain.value = idle + this.engineSpeedCurrent * 0.18;
      const f = 110 + this.engineSpeedCurrent * 80;
      this.engineSrc.osc1.frequency.value = f;
      this.engineSrc.osc2.frequency.value = f * 1.027;
      this.engineSrc.lowpass.frequency.value = 500 + this.engineSpeedCurrent * 1400;
      this.engineNoiseGain.gain.value = 0.04 + this.engineSpeedCurrent * 0.18;
    }
  }

  // ---------- Helpers ----------

  _now() { return this.ctx.currentTime; }

  _envGain(attack, decay, sustain, release, peak = 0.8) {
    const g = this.ctx.createGain();
    const t = this._now();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.linearRampToValueAtTime(sustain, t + attack + decay);
    g.gain.linearRampToValueAtTime(0, t + attack + decay + release);
    return g;
  }

  // Quick beep at a frequency.
  _blip(freq, dur = 0.08, type = "square", peak = 0.3) {
    if (!this.unlocked) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this._envGain(0.005, dur * 0.4, 0, dur * 0.6, peak);
    osc.connect(g).connect(this.sfxBus);
    osc.start();
    osc.stop(this._now() + dur + 0.05);
  }

  _noiseBurst(dur = 0.2, peak = 0.25, lpf = 1500) {
    if (!this.unlocked) return;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = lpf;
    const g = this._envGain(0.005, dur * 0.3, 0, dur * 0.7, peak);
    src.connect(filt).connect(g).connect(this.sfxBus);
    src.start();
    src.stop(this._now() + dur + 0.05);
  }

  // ---------- Public effects ----------

  collect() {
    // Throttle so a sweeping vacuum doesn't sound like an angry chipmunk.
    if (!this.unlocked) return;
    const now = performance.now();
    if (now - this.lastDirtAt < 75) return;
    this.lastDirtAt = now;
    this._blip(660 + Math.random() * 120, 0.05, "triangle", 0.18);
  }

  pickup() {
    if (!this.unlocked) return;
    // Rising arpeggio.
    const base = 440;
    [0, 4, 7, 12].forEach((semi, i) => {
      setTimeout(() => this._blip(base * Math.pow(2, semi / 12), 0.1, "triangle", 0.22), i * 60);
    });
  }

  doorOpen() {
    if (!this.unlocked) return;
    // Heavy mechanical thunk + chime.
    this._noiseBurst(0.3, 0.3, 600);
    setTimeout(() => this._blip(NOTES.g * 2, 0.18, "triangle", 0.28), 120);
    setTimeout(() => this._blip(NOTES.c * 4, 0.22, "triangle", 0.3), 220);
  }

  explode() {
    if (!this.unlocked) return;
    this._noiseBurst(0.45, 0.45, 2200);
    // Sub-bass thump.
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, this._now());
    osc.frequency.exponentialRampToValueAtTime(30, this._now() + 0.3);
    const g = this._envGain(0.005, 0.05, 0, 0.35, 0.5);
    osc.connect(g).connect(this.sfxBus);
    osc.start();
    osc.stop(this._now() + 0.5);
  }

  mineDrop() {
    this._blip(280, 0.06, "square", 0.25);
    setTimeout(() => this._blip(180, 0.08, "square", 0.2), 80);
  }

  mineBeep() {
    this._blip(800, 0.04, "square", 0.18);
  }

  turretShot() {
    if (!this.unlocked) return;
    this._noiseBurst(0.05, 0.15, 5000);
    this._blip(1200, 0.04, "square", 0.12);
  }

  petCry(kind) {
    if (!this.unlocked) return;
    if (kind === "cat") {
      this._blip(720, 0.18, "sawtooth", 0.18);
      setTimeout(() => this._blip(540, 0.22, "sawtooth", 0.18), 130);
    } else if (kind === "dog") {
      this._noiseBurst(0.07, 0.3, 1200);
      setTimeout(() => this._noiseBurst(0.06, 0.25, 1000), 120);
    } else if (kind === "hamster") {
      this._blip(1100, 0.06, "square", 0.16);
      setTimeout(() => this._blip(900, 0.06, "square", 0.16), 70);
    } else if (kind === "parrot") {
      this._blip(1500, 0.08, "sawtooth", 0.18);
      setTimeout(() => this._blip(1900, 0.08, "sawtooth", 0.18), 90);
    }
  }

  hurt() {
    if (!this.unlocked) return;
    // Pitch-down zap.
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(440, this._now());
    osc.frequency.exponentialRampToValueAtTime(110, this._now() + 0.3);
    const g = this._envGain(0.005, 0.05, 0, 0.3, 0.35);
    osc.connect(g).connect(this.sfxBus);
    osc.start();
    osc.stop(this._now() + 0.4);
  }

  win() {
    if (!this.unlocked) return;
    [NOTES.c, NOTES.e, NOTES.g, NOTES.c * 2].forEach((f, i) => {
      setTimeout(() => this._blip(f, 0.16, "triangle", 0.32), i * 110);
    });
  }

  countdown() { this._blip(660, 0.08, "triangle", 0.25); }

  click() { this._blip(880, 0.04, "triangle", 0.18); }
}

export const sound = new Sound();
