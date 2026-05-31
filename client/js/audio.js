export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.unlocked = false;
  }

  unlock() {
    if (!this.enabled || this.unlocked) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.ctx = new AudioContext();
    this.ctx.resume?.();
    this.unlocked = true;
  }

  tone(freq, duration = 0.08, type = "sine", gainValue = 0.03, sweepTo = null) {
    if (!this.enabled || !this.unlocked || !this.ctx) return;

    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    gain.gain.value = gainValue;
    gain.connect(ctx.destination);
    osc.connect(gain);

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    if (sweepTo) {
      osc.frequency.exponentialRampToValueAtTime(sweepTo, now + duration);
    }

    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  hover() {
    this.tone(520, 0.05, "triangle", 0.018, 640);
  }

  attack() {
    this.tone(220, 0.08, "square", 0.028, 120);
  }

  dash() {
    this.tone(880, 0.06, "sawtooth", 0.022, 520);
  }

  hit() {
    this.tone(160, 0.07, "square", 0.03, 90);
  }

  death() {
    this.tone(84, 0.18, "sine", 0.04, 50);
  }
}