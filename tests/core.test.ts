import { describe, expect, it } from 'vitest';
import { Rng, hashString } from '@/core/rng';
import { chebyshev, facingBetween, line, vec } from '@/core/grid';

describe('Rng', () => {
  it('produces an identical stream from the same seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('diverges for different seeds', () => {
    const a = Array.from({ length: 20 }, (_, i) => new Rng(i).next());
    expect(new Set(a).size).toBe(20);
  });

  it('resumes an identical stream from a captured state', () => {
    const a = new Rng(99);
    for (let i = 0; i < 10; i++) a.next();
    const resumed = Rng.restore(a.state);
    expect(Array.from({ length: 10 }, () => resumed.next()))
      .toEqual(Array.from({ length: 10 }, () => a.next()));
  });

  it('keeps int() within the requested inclusive range', () => {
    const r = new Rng(7);
    for (let i = 0; i < 500; i++) {
      const v = r.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it('never returns below 1 from variance()', () => {
    const r = new Rng(5);
    for (let i = 0; i < 200; i++) expect(r.variance(1, 0.9)).toBeGreaterThanOrEqual(1);
  });

  it('respects weighted() proportions', () => {
    const r = new Rng(42);
    let heavy = 0;
    for (let i = 0; i < 4000; i++) {
      if (r.weighted([['a', 9], ['b', 1]] as const) === 'a') heavy++;
    }
    // 90/10 split; allow generous slack for a 4000-sample run.
    expect(heavy / 4000).toBeGreaterThan(0.85);
    expect(heavy / 4000).toBeLessThan(0.95);
  });

  it('hashes strings deterministically and distinctly', () => {
    expect(hashString('steroid')).toBe(hashString('steroid'));
    expect(hashString('steroid')).not.toBe(hashString('sable'));
  });
});

describe('grid', () => {
  it('draws a symmetric line between endpoints', () => {
    const a = line(vec(0, 0), vec(5, 3));
    expect(a[0]).toEqual({ x: 0, y: 0 });
    expect(a[a.length - 1]).toEqual({ x: 5, y: 3 });
    const back = line(vec(5, 3), vec(0, 0));
    expect(back.length).toBe(a.length);
  });

  it('returns a single tile for a zero-length line', () => {
    expect(line(vec(2, 2), vec(2, 2))).toEqual([{ x: 2, y: 2 }]);
  });

  it('measures chebyshev distance diagonally', () => {
    expect(chebyshev(vec(0, 0), vec(3, 3))).toBe(3);
    expect(chebyshev(vec(0, 0), vec(0, 4))).toBe(4);
  });

  it('derives compass facing, 0 = east and increasing clockwise', () => {
    expect(facingBetween(vec(0, 0), vec(1, 0))).toBe(0);
    expect(facingBetween(vec(0, 0), vec(0, 1))).toBe(2);
    expect(facingBetween(vec(0, 0), vec(-1, 0))).toBe(4);
    expect(facingBetween(vec(0, 0), vec(0, -1))).toBe(6);
  });
});
