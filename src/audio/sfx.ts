// All sounds are synthesized in real time with the Web Audio API (no audio files).
import type { Settings } from '../state/settings';

type SoundKey = 'cards' | 'shuffle' | 'chips' | 'knock' | 'fold' | 'bell' | 'timer' | 'win' | 'ui';

class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private fx!: GainNode;
  private musicBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private settings: Settings['audio'] | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicNext = 0;
  private musicStep = 0;
  private lastUi = 0;
  private unlocked = false;

  configure(a: Settings['audio']) {
    this.settings = a;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(a.master, t, 0.05);
    this.fx.gain.setTargetAtTime(a.effects, t, 0.05);
    this.musicBus.gain.setTargetAtTime(a.music * 0.5, t, 0.2);
    if (a.musicOn && a.music > 0) this.startMusic();
    else this.stopMusic();
  }

  /** Must be called from a user gesture on iOS. */
  unlock() {
    if (this.unlocked && this.ctx?.state === 'running') return;
    try {
      if (!this.ctx) this.init();
      void this.ctx!.resume();
      // play a silent buffer to fully unlock iOS audio
      const b = this.ctx!.createBuffer(1, 1, 22050);
      const s = this.ctx!.createBufferSource();
      s.buffer = b;
      s.connect(this.ctx!.destination);
      s.start(0);
      this.unlocked = true;
      if (this.settings) this.configure(this.settings);
    } catch (e) {
      console.warn('audio unlock failed', e);
    }
  }

  suspend() {
    void this.ctx?.suspend();
  }
  resume() {
    if (this.unlocked) void this.ctx?.resume();
  }

  private init() {
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.fx = ctx.createGain();
    this.fx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);
    // procedural room reverb
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 200 ? i / 200 : 1);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.18;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  private ok(k: SoundKey) {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    if (this.settings && this.settings.sounds[k] === false) return false;
    return true;
  }

  private out(pan = 0, wet = 0.15): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const spatial = this.settings?.spatial !== false;
    if (spatial && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(this.fx);
      if (wet > 0) {
        const s = ctx.createGain();
        s.gain.value = wet;
        p.connect(s);
        s.connect(this.reverbSend);
      }
    } else {
      g.connect(this.fx);
    }
    return g;
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.002, freqEnd?: number) {
    if (![t, dur, freq, q, gain, attack].every(Number.isFinite) || dur <= 0 || dur > 30) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', attack = 0.001) {
    if (![t, freq, dur, gain, attack].every(Number.isFinite) || dur <= 0 || dur > 30) return;
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------------- UI ----------------
  ui(kind: 'press' | 'release' | 'switch' | 'detent' | 'tab') {
    this.unlock();
    if (!this.ok('ui')) return;
    const now = this.ctx!.currentTime;
    if (kind === 'detent' && now - this.lastUi < 0.03) return;
    this.lastUi = now;
    const o = this.out(0, 0.05);
    switch (kind) {
      case 'press':
        this.noiseBurst(o, now, 0.03, 'bandpass', 1800, 2, 0.25);
        this.tone(o, now, 140, 0.05, 0.12);
        break;
      case 'release':
        this.noiseBurst(o, now, 0.02, 'bandpass', 3200, 3, 0.12);
        break;
      case 'switch':
        this.noiseBurst(o, now, 0.015, 'highpass', 3000, 1, 0.3);
        this.noiseBurst(o, now + 0.03, 0.02, 'bandpass', 2400, 4, 0.2);
        this.tone(o, now + 0.03, 2200, 0.04, 0.05, 'triangle');
        break;
      case 'detent':
        this.noiseBurst(o, now, 0.012, 'bandpass', 4200, 6, 0.15);
        break;
      case 'tab':
        this.noiseBurst(o, now, 0.06, 'lowpass', 900, 0.7, 0.25, 0.005);
        break;
    }
  }

  // ---------------- Cards ----------------
  cardFlick(pan = 0, delay = 0) {
    if (!this.ok('cards')) return;
    const t = this.ctx!.currentTime + delay;
    const o = this.out(pan);
    this.noiseBurst(o, t, 0.025, 'highpass', 2500, 0.8, 0.35);
    this.noiseBurst(o, t + 0.01, 0.16, 'bandpass', 5000, 1.2, 0.1, 0.02, 1500);
  }
  cardSlide(pan = 0, dur = 0.2, delay = 0, gain = 0.12) {
    if (!this.ok('cards')) return;
    const t = this.ctx!.currentTime + delay;
    this.noiseBurst(this.out(pan), t, Math.max(0.05, dur), 'bandpass', 3500, 0.9, gain, Math.min(0.03, dur * 0.3), 1800);
  }
  cardLand(pan = 0, delay = 0) {
    if (!this.ok('cards')) return;
    const t = this.ctx!.currentTime + delay;
    const o = this.out(pan);
    this.noiseBurst(o, t, 0.03, 'bandpass', 1400, 1.5, 0.22);
  }
  cardFlip(pan = 0, delay = 0) {
    if (!this.ok('cards')) return;
    const t = this.ctx!.currentTime + delay;
    const o = this.out(pan);
    this.noiseBurst(o, t, 0.05, 'bandpass', 2600, 1, 0.18, 0.01, 4500);
    this.noiseBurst(o, t + 0.06, 0.025, 'highpass', 2000, 1, 0.3);
  }
  riffle(dur = 0.9, delay = 0) {
    if (!this.ok('shuffle')) return;
    const t0 = this.ctx!.currentTime + delay;
    const o = this.out(0, 0.1);
    const n = 52;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const tt = t0 + dur * (1 - Math.pow(1 - k, 1.4)) + (Math.random() - 0.5) * 0.006;
      this.noiseBurst(o, tt, 0.012, 'bandpass', 3000 + Math.random() * 2500, 2, 0.12 + Math.random() * 0.08);
    }
    // final squaring thump
    this.noiseBurst(o, t0 + dur + 0.08, 0.06, 'lowpass', 900, 1, 0.3);
  }
  bridge(delay = 0) {
    if (!this.ok('shuffle')) return;
    const t = this.ctx!.currentTime + delay;
    this.noiseBurst(this.out(0), t, 0.35, 'bandpass', 4000, 0.8, 0.12, 0.08, 2000);
  }
  wash(dur = 1.5, delay = 0) {
    if (!this.ok('shuffle')) return;
    const t = this.ctx!.currentTime + delay;
    const o = this.out(0);
    for (let i = 0; i < 6; i++) this.noiseBurst(o, t + i * (dur / 6), dur / 4, 'bandpass', 2000 + Math.random() * 1500, 0.7, 0.1, 0.06);
  }
  squareUp(delay = 0) {
    if (!this.ok('shuffle')) return;
    const t = this.ctx!.currentTime + delay;
    const o = this.out(0);
    this.noiseBurst(o, t, 0.04, 'lowpass', 1100, 1, 0.3);
    this.noiseBurst(o, t + 0.09, 0.03, 'lowpass', 1300, 1, 0.22);
  }

  // ---------------- Chips ----------------
  /** Ceramic/clay chip clacks. count = chips involved, denom affects pitch slightly. */
  chips(count = 1, pan = 0, delay = 0, spread?: number) {
    if (!this.ok('chips')) return;
    const n = Math.min(14, Math.max(1, Math.round(Math.sqrt(count) * 2)));
    const t0 = this.ctx!.currentTime + delay;
    const o = this.out(pan, 0.12);
    const span = spread ?? Math.min(0.5, 0.05 + n * 0.025);
    for (let i = 0; i < n; i++) {
      const t = t0 + (i === 0 ? 0 : Math.random() * span);
      const base = 2600 + Math.random() * 1800;
      const g = 0.06 + Math.random() * 0.06;
      this.tone(o, t, base, 0.035 + Math.random() * 0.03, g);
      this.tone(o, t, base * 1.52, 0.025, g * 0.6);
      this.tone(o, t, base * 2.31, 0.018, g * 0.35);
      this.noiseBurst(o, t, 0.012, 'highpass', 5000, 1, g * 1.4);
    }
  }
  chipSettle(pan = 0, delay = 0) {
    if (!this.ok('chips')) return;
    const t0 = this.ctx!.currentTime + delay;
    const o = this.out(pan);
    for (let i = 0; i < 5; i++) {
      const t = t0 + 0.04 * i * (1 + i * 0.25);
      this.tone(o, t, 3200 + Math.random() * 600, 0.02, 0.05 * (1 - i / 6));
    }
  }
  chipSlide(pan = 0, dur = 0.4, delay = 0) {
    if (!this.ok('chips')) return;
    const t = this.ctx!.currentTime + delay;
    this.noiseBurst(this.out(pan), t, dur, 'bandpass', 900, 0.8, 0.12, dur * 0.2, 600);
  }

  // ---------------- Table ----------------
  knock(pan = 0, delay = 0) {
    if (!this.ok('knock')) return;
    const t = this.ctx!.currentTime + delay;
    const o = this.out(pan, 0.2);
    for (const d of [0, 0.13]) {
      this.tone(o, t + d, 190, 0.09, 0.4);
      this.tone(o, t + d, 340, 0.05, 0.2);
      this.noiseBurst(o, t + d, 0.03, 'bandpass', 1100, 2, 0.25);
    }
  }
  foldThud(pan = 0, delay = 0) {
    if (!this.ok('fold')) return;
    const t = this.ctx!.currentTime + delay;
    const o = this.out(pan);
    this.noiseBurst(o, t, 0.09, 'lowpass', 500, 0.8, 0.35, 0.004);
    this.tone(o, t, 85, 0.1, 0.18);
  }
  bell() {
    if (!this.ok('bell')) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = this.out(0, 0.5);
    for (const [f, d] of [
      [1318, 0],
      [1046, 0.35],
    ] as const) {
      const car = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const mg = ctx.createGain();
      car.frequency.value = f;
      mod.frequency.value = f * 3.5;
      mg.gain.setValueAtTime(f * 2, t + d);
      mg.gain.exponentialRampToValueAtTime(1, t + d + 1.5);
      mod.connect(mg);
      mg.connect(car.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.8);
      car.connect(g);
      g.connect(o);
      car.start(t + d);
      mod.start(t + d);
      car.stop(t + d + 2);
      mod.stop(t + d + 2);
    }
  }
  timerTick(urgent = false) {
    if (!this.ok('timer')) return;
    const t = this.ctx!.currentTime;
    this.tone(this.out(0, 0), t, urgent ? 1320 : 990, 0.08, urgent ? 0.18 : 0.1, 'triangle');
  }
  win(big = false) {
    if (!this.ok('win')) return;
    const t = this.ctx!.currentTime;
    const o = this.out(0, 0.5);
    const notes = big ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.tone(o, t + i * 0.09, f, 0.9, 0.09, 'triangle', 0.01);
      this.tone(o, t + i * 0.09, f * 2, 0.5, 0.02, 'sine', 0.01);
    });
  }

  // ---------------- Generative lounge music ----------------
  private startMusic() {
    if (this.musicTimer || !this.ctx) return;
    this.musicNext = this.ctx.currentTime + 0.2;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 200);
  }
  private stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
  private ep(t: number, f: number, dur: number, vel: number) {
    // FM electric piano
    const ctx = this.ctx!;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 1.0;
    mg.gain.setValueAtTime(f * 1.2 * vel, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.6);
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * vel, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = (Math.random() - 0.5) * 0.6;
    car.connect(g);
    g.connect(p);
    p.connect(this.musicBus);
    const s = ctx.createGain();
    s.gain.value = 0.6;
    p.connect(s);
    s.connect(this.reverbSend);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.1);
    mod.stop(t + dur + 0.1);
  }
  private scheduleMusic() {
    const ctx = this.ctx!;
    const beat = 60 / 72;
    // ii-V-I-VI in C with extensions (midi notes)
    const prog = [
      { bass: 38, chord: [53, 57, 60, 64] }, // Dm9
      { bass: 43, chord: [53, 57, 59, 64] }, // G13
      { bass: 36, chord: [52, 55, 59, 62] }, // Cmaj9
      { bass: 45, chord: [55, 58, 61, 65] }, // A7b9
    ];
    const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    while (this.musicNext < ctx.currentTime + 0.6) {
      const t = this.musicNext;
      const bar = Math.floor(this.musicStep / 4) % prog.length;
      const b = this.musicStep % 4;
      const c = prog[bar];
      if (b === 0) {
        c.chord.forEach((m, i) => this.ep(t + i * 0.015, mtof(m), beat * 3.5, 0.6 + Math.random() * 0.3));
      } else if (Math.random() < 0.35) {
        const m = c.chord[Math.floor(Math.random() * 4)] + 12;
        this.ep(t + beat * (Math.random() < 0.5 ? 0 : 0.5), mtof(m), beat * 1.5, 0.4);
      }
      // walking-ish bass
      const bassNote = c.bass + [0, 7, 12, 7][b] - (b === 3 ? 1 : 0);
      this.tone(this.musicBus, t, mtof(bassNote), beat * 0.9, 0.07, 'sine', 0.02);
      // brushes
      this.noiseBurst(this.musicBus, t + beat * 0.5, beat * 0.4, 'bandpass', 6000, 0.6, 0.015, 0.05);
      this.musicNext += beat;
      this.musicStep++;
    }
  }
}

// Audio must never break the game: wrap every public method in a try/catch.
for (const name of Object.getOwnPropertyNames(Sfx.prototype)) {
  if (name === 'constructor' || name.startsWith('_')) continue;
  const orig = (Sfx.prototype as any)[name];
  if (typeof orig !== 'function') continue;
  (Sfx.prototype as any)[name] = function (this: Sfx, ...args: unknown[]) {
    try {
      return orig.apply(this, args);
    } catch (e) {
      console.warn('sfx', name, e);
    }
  };
}

export const sfx = new Sfx();
