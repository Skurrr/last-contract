/**
 * Seeded, serialisable RNG. The whole simulation runs off these so a battle can be
 * replayed byte-for-byte from a seed — which is what makes the balance harness and the
 * regression tests possible.
 *
 * Algorithm: mulberry32. Fast, tiny, good enough distribution for a game.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    // Avoid the degenerate 0 state.
    this.s = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0;
  }

  /** Current state — pass to `Rng.restore` to resume an identical stream. */
  get state(): number {
    return this.s;
  }

  static restore(state: number): Rng {
    const r = new Rng(1);
    r.s = state | 0;
    return r;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability `p` (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick on empty array');
    return arr[this.int(0, arr.length - 1)]!;
  }

  /** Weighted pick. Weights need not sum to 1. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of entries) total += Math.max(0, w);
    if (total <= 0) throw new Error('Rng.weighted with no positive weight');
    let roll = this.next() * total;
    for (const [value, w] of entries) {
      roll -= Math.max(0, w);
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1]![0];
  }

  /** Fisher–Yates, in place, returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = a;
    }
    return arr;
  }

  /**
   * Roll damage as `base` ± `spread` fraction, e.g. spread 0.2 → 80%..120%.
   * Rounded to an integer, floored at 1.
   */
  variance(base: number, spread: number): number {
    return Math.max(1, Math.round(base * this.float(1 - spread, 1 + spread)));
  }

  /** Derive an independent stream. Used so cosmetic rolls can't desync the sim. */
  fork(salt: number): Rng {
    return new Rng((this.s ^ Math.imul(salt | 0, 0x85ebca6b)) | 0);
  }
}

/** Deterministic 32-bit hash of a string — used to turn merc ids into sprite seeds. */
export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
