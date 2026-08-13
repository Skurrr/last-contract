/**
 * Procedural sound. Every effect is synthesised from oscillators and shaped noise at play
 * time — no audio files, for the same reason there are no image files: the whole game stays
 * one bundle, and a weapon's sound can be derived from its stats rather than hand-authored.
 *
 * The audio context starts suspended in every browser until a user gesture, so `unlock()`
 * must be called from a real click or keypress before anything is audible.
 */

export type SfxName =
  | 'shot_light' | 'shot_heavy' | 'shot_shotgun' | 'shot_suppressed'
  | 'melee_hit' | 'melee_miss'
  | 'impact_flesh' | 'impact_armour' | 'impact_wall'
  | 'zombie_groan' | 'zombie_scream' | 'death'
  | 'reload' | 'jam' | 'explosion'
  | 'ui_click' | 'ui_hover' | 'ui_deny'
  | 'xp' | 'level_up' | 'loot' | 'victory' | 'defeat';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Shared noise buffer — regenerating it per shot is pure waste. */
  private noise: AudioBuffer | null = null;
  private unlocked = false;

  muted = false;
  volume = 0.5;

  /** Call from a genuine user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.unlocked) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(this.ctx, 1);
      this.unlocked = true;
    } catch {
      // Audio is a nicety; a browser that refuses it must not break the game.
      this.ctx = null;
    }
    void this.ctx?.resume();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Deterministic white noise, so the same shot sounds the same every time.
    let s = 0x2545f491;
    for (let i = 0; i < len; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      data[i] = ((s >>> 0) / 2147483648) - 1;
    }
    return buf;
  }

  /** A burst of filtered noise — the backbone of every percussive sound here. */
  private burst(opts: {
    duration: number;
    gain: number;
    type: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
    delay?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted) return;
    const t = ctx.currentTime + (opts.delay ?? 0);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqEnd), t + opts.duration);
    }
    filter.Q.value = opts.q ?? 1;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);

    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + opts.duration + 0.02);
  }

  /** A pitched tone — used for UI and reward sounds. */
  private tone(opts: {
    freq: number;
    freqEnd?: number;
    duration: number;
    gain: number;
    type?: OscillatorType;
    delay?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime + (opts.delay ?? 0);

    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t + opts.duration);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);

    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + opts.duration + 0.02);
  }

  play(name: SfxName): void {
    if (!this.ctx || this.muted) return;
    switch (name) {
      // ── gunfire: a sharp crack over a low thump, scaled by calibre ──
      case 'shot_light':
        this.burst({ duration: 0.13, gain: 0.34, type: 'bandpass', freq: 2600, freqEnd: 700, q: 0.8 });
        this.tone({ freq: 180, freqEnd: 60, duration: 0.09, gain: 0.16, type: 'triangle' });
        break;
      case 'shot_heavy':
        this.burst({ duration: 0.24, gain: 0.42, type: 'bandpass', freq: 1700, freqEnd: 260, q: 0.7 });
        this.tone({ freq: 120, freqEnd: 38, duration: 0.17, gain: 0.26, type: 'triangle' });
        break;
      case 'shot_shotgun':
        this.burst({ duration: 0.3, gain: 0.46, type: 'lowpass', freq: 2400, freqEnd: 200, q: 0.6 });
        this.tone({ freq: 95, freqEnd: 32, duration: 0.2, gain: 0.28, type: 'triangle' });
        break;
      case 'shot_suppressed':
        // The point of a suppressor is that it is a thud, not a crack.
        this.burst({ duration: 0.1, gain: 0.16, type: 'lowpass', freq: 700, freqEnd: 200, q: 1 });
        break;

      case 'melee_hit':
        this.burst({ duration: 0.11, gain: 0.3, type: 'lowpass', freq: 900, freqEnd: 160, q: 1.4 });
        this.tone({ freq: 220, freqEnd: 70, duration: 0.08, gain: 0.14, type: 'sine' });
        break;
      case 'melee_miss':
        this.burst({ duration: 0.14, gain: 0.12, type: 'bandpass', freq: 1400, freqEnd: 500, q: 2 });
        break;

      case 'impact_flesh':
        this.burst({ duration: 0.12, gain: 0.26, type: 'lowpass', freq: 600, freqEnd: 120, q: 1.2 });
        break;
      case 'impact_armour':
        this.burst({ duration: 0.09, gain: 0.24, type: 'bandpass', freq: 3200, freqEnd: 1400, q: 3 });
        this.tone({ freq: 900, freqEnd: 400, duration: 0.07, gain: 0.1, type: 'square' });
        break;
      case 'impact_wall':
        this.burst({ duration: 0.16, gain: 0.2, type: 'bandpass', freq: 1800, freqEnd: 400, q: 1.5 });
        break;

      // ── the dead ──
      case 'zombie_groan':
        this.tone({ freq: 92, freqEnd: 58, duration: 0.62, gain: 0.13, type: 'sawtooth' });
        this.burst({ duration: 0.5, gain: 0.07, type: 'lowpass', freq: 420, freqEnd: 180, q: 1 });
        break;
      case 'zombie_scream':
        // The horde call. It should make the player flinch.
        this.tone({ freq: 420, freqEnd: 1500, duration: 0.5, gain: 0.24, type: 'sawtooth' });
        this.tone({ freq: 620, freqEnd: 1900, duration: 0.55, gain: 0.16, type: 'square', delay: 0.04 });
        this.burst({ duration: 0.7, gain: 0.14, type: 'bandpass', freq: 1600, freqEnd: 3000, q: 1.5 });
        break;
      case 'death':
        this.tone({ freq: 160, freqEnd: 44, duration: 0.5, gain: 0.16, type: 'sawtooth' });
        this.burst({ duration: 0.35, gain: 0.14, type: 'lowpass', freq: 500, freqEnd: 90, q: 1 });
        break;

      // ── handling ──
      case 'reload':
        this.burst({ duration: 0.05, gain: 0.16, type: 'bandpass', freq: 2600, q: 4 });
        this.burst({ duration: 0.06, gain: 0.2, type: 'bandpass', freq: 1500, q: 3, delay: 0.11 });
        this.burst({ duration: 0.04, gain: 0.14, type: 'bandpass', freq: 3400, q: 5, delay: 0.2 });
        break;
      case 'jam':
        this.burst({ duration: 0.07, gain: 0.22, type: 'bandpass', freq: 1200, q: 6 });
        this.tone({ freq: 300, freqEnd: 140, duration: 0.1, gain: 0.1, type: 'square', delay: 0.05 });
        break;
      case 'explosion':
        this.burst({ duration: 0.75, gain: 0.55, type: 'lowpass', freq: 1800, freqEnd: 60, q: 0.5 });
        this.tone({ freq: 70, freqEnd: 24, duration: 0.6, gain: 0.34, type: 'triangle' });
        break;

      // ── interface ──
      case 'ui_click':
        this.tone({ freq: 620, freqEnd: 760, duration: 0.045, gain: 0.1 });
        break;
      case 'ui_hover':
        this.tone({ freq: 900, duration: 0.025, gain: 0.035 });
        break;
      case 'ui_deny':
        this.tone({ freq: 200, freqEnd: 120, duration: 0.14, gain: 0.12, type: 'square' });
        break;

      // ── reward ──
      case 'xp':
        this.tone({ freq: 1050, freqEnd: 1500, duration: 0.09, gain: 0.07, type: 'sine' });
        break;
      case 'loot':
        // A rising three-note figure; the ear reads it as "you got something".
        this.tone({ freq: 620, duration: 0.09, gain: 0.1, type: 'square' });
        this.tone({ freq: 780, duration: 0.09, gain: 0.1, type: 'square', delay: 0.08 });
        this.tone({ freq: 1040, duration: 0.16, gain: 0.11, type: 'square', delay: 0.16 });
        break;
      case 'level_up':
        // A major arpeggio, deliberately the most triumphant sound in the game.
        [523, 659, 784, 1047].forEach((f, i) => {
          this.tone({ freq: f, duration: 0.22, gain: 0.12, type: 'square', delay: i * 0.075 });
        });
        this.tone({ freq: 1568, duration: 0.4, gain: 0.08, type: 'sine', delay: 0.3 });
        break;
      case 'victory':
        [392, 523, 659, 784, 1047].forEach((f, i) => {
          this.tone({ freq: f, duration: 0.3, gain: 0.11, type: 'square', delay: i * 0.12 });
        });
        break;
      case 'defeat':
        [440, 370, 294, 220].forEach((f, i) => {
          this.tone({ freq: f, duration: 0.42, gain: 0.12, type: 'sawtooth', delay: i * 0.17 });
        });
        break;
    }
  }
}

export const sfx = new Sfx();

/** Map a weapon's class and noise level onto the right report. */
export function shotSound(cls: string, noise: number): SfxName {
  if (noise <= 8) return 'shot_suppressed';
  if (cls === 'shotgun') return 'shot_shotgun';
  if (cls === 'sniper' || cls === 'lmg' || cls === 'battlerifle') return 'shot_heavy';
  return 'shot_light';
}
