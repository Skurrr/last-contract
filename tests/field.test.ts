import { describe, expect, it } from 'vitest';
import { vec } from '@/core/grid';
import {
  coverAgainst,
  decayNoise,
  emitNoise,
  findPath,
  hasLineOfSight,
  isOpen,
  loudestStep,
  noiseAt,
  reachable,
  stepCost,
  traceSight,
} from '@/sim/field';
import { addMerc, arena, put } from './helpers';

describe('line of sight', () => {
  it('is clear across open ground', () => {
    const b = arena();
    expect(traceSight(b, vec(2, 2), vec(10, 10)).clear).toBe(true);
  });

  it('is blocked by a wall between the endpoints', () => {
    const b = arena();
    put(b, 'wall', 5, 5);
    expect(traceSight(b, vec(4, 4), vec(6, 6)).clear).toBe(false);
  });

  it('is not blocked by cover that does not block sight', () => {
    const b = arena();
    put(b, 'sandbag', 5, 5);
    // Sandbags give cover but you can still see and shoot over them.
    expect(traceSight(b, vec(4, 4), vec(6, 6)).clear).toBe(true);
  });

  it('never lets the endpoints block themselves', () => {
    const b = arena();
    put(b, 'wall', 6, 6);
    // Standing in a doorway should not blind you.
    expect(traceSight(b, vec(6, 6), vec(6, 6)).clear).toBe(true);
  });

  it('respects maximum range', () => {
    const b = arena(40, 40);
    expect(hasLineOfSight(b, vec(2, 2), vec(30, 2), 10)).toBe(false);
    expect(hasLineOfSight(b, vec(2, 2), vec(8, 2), 10)).toBe(true);
  });
});

describe('directional cover', () => {
  it('protects a target from the side the cover is on', () => {
    const b = arena();
    // Wall directly west of the target; shooter is further west.
    put(b, 'wall', 9, 10);
    expect(coverAgainst(b, vec(10, 10), vec(4, 10))).toBe(2);
  });

  it('is negated by flanking around to the far side', () => {
    const b = arena();
    put(b, 'wall', 9, 10);
    // Same wall, but the shooter is now east of the target.
    expect(coverAgainst(b, vec(10, 10), vec(16, 10))).toBe(0);
  });

  it('rates low cover below high cover', () => {
    const b = arena();
    put(b, 'sandbag', 9, 10);
    expect(coverAgainst(b, vec(10, 10), vec(4, 10))).toBe(1);
  });

  it('discounts cover that only clips the corner of the shot', () => {
    const b = arena();
    // High cover on a diagonal is worth one level less.
    put(b, 'wall', 9, 9);
    expect(coverAgainst(b, vec(10, 10), vec(4, 4))).toBe(1);
  });
});

describe('pathfinding', () => {
  it('finds a straight path across open ground', () => {
    const b = arena();
    const u = addMerc(b, 'nine', vec(2, 2));
    u.ap = 99;
    const { tiles } = findPath(b, u, vec(8, 2), 99);
    expect(tiles.length).toBe(6);
    expect(tiles[tiles.length - 1]).toEqual({ x: 8, y: 2 });
  });

  it('routes around an obstacle rather than through it', () => {
    const b = arena();
    for (let y = 2; y <= 8; y++) put(b, 'wall', 5, y);
    const u = addMerc(b, 'nine', vec(2, 5));
    u.ap = 99;
    const { tiles } = findPath(b, u, vec(8, 5), 99);
    expect(tiles.length).toBeGreaterThan(6);
    for (const t of tiles) expect(isOpen(b, t.x, t.y)).toBe(true);
  });

  it('returns no path when the goal is walled off', () => {
    const b = arena();
    for (const [x, y] of [[9, 9], [10, 9], [11, 9], [9, 10], [11, 10], [9, 11], [10, 11], [11, 11]]) {
      put(b, 'wall', x!, y!);
    }
    const u = addMerc(b, 'nine', vec(2, 2));
    u.ap = 99;
    expect(findPath(b, u, vec(10, 10), 99).tiles).toEqual([]);
  });

  it('respects the AP budget', () => {
    const b = arena();
    const u = addMerc(b, 'nine', vec(2, 2));
    const { tiles } = findPath(b, u, vec(18, 2), 6);
    // 6 AP buys three orthogonal steps at 2 AP each, so it cannot reach.
    expect(tiles).toEqual([]);
  });

  it('does not cut diagonally between two blocked tiles', () => {
    const b = arena();
    put(b, 'wall', 5, 4);
    put(b, 'wall', 4, 5);
    const u = addMerc(b, 'nine', vec(4, 4));
    u.ap = 99;
    const { tiles } = findPath(b, u, vec(5, 5), 99);
    // The direct diagonal is illegal, so any valid path must be longer than one step.
    expect(tiles.length).toBeGreaterThan(1);
  });
});

describe('movement cost', () => {
  it('charges more for diagonals than cardinals', () => {
    const b = arena();
    const u = addMerc(b, 'nine', vec(5, 5));
    expect(stepCost(b, u, vec(5, 5), vec(6, 5))).toBe(2);
    expect(stepCost(b, u, vec(5, 5), vec(6, 6))).toBe(3);
  });

  it('makes crawling genuinely expensive', () => {
    const b = arena();
    const u = addMerc(b, 'nine', vec(5, 5));
    const standing = stepCost(b, u, vec(5, 5), vec(6, 5));
    u.stance = 'prone';
    expect(stepCost(b, u, vec(5, 5), vec(6, 5))).toBe(standing * 3);
  });

  it('restricts prone units to cardinal moves', () => {
    const b = arena();
    const u = addMerc(b, 'nine', vec(5, 5));
    u.stance = 'prone';
    u.ap = 99;
    const { tiles } = findPath(b, u, vec(7, 7), 99);
    for (let i = 1; i < tiles.length; i++) {
      const a = tiles[i - 1]!;
      const c = tiles[i]!;
      expect(Math.abs(a.x - c.x) + Math.abs(a.y - c.y)).toBe(1);
    }
  });
});

describe('reachable', () => {
  it('excludes the starting tile and stays within budget', () => {
    const b = arena();
    const u = addMerc(b, 'nine', vec(10, 10));
    const tiles = reachable(b, u, 6);
    expect(tiles.has((10 << 10) | 10)).toBe(false);
    for (const cost of tiles.values()) expect(cost).toBeLessThanOrEqual(6);
  });

  it('agrees with findPath on cost', () => {
    const b = arena();
    const u = addMerc(b, 'nine', vec(5, 5));
    const tiles = reachable(b, u, 12);
    for (const [k, cost] of tiles) {
      const goal = { x: k & 1023, y: k >> 10 };
      expect(findPath(b, u, goal, 12).cost).toBe(cost);
    }
  });
});

describe('noise propagation', () => {
  it('is loudest at the source and falls off with distance', () => {
    const b = arena(30, 30);
    emitNoise(b, vec(15, 15), 10);
    expect(noiseAt(b, 15, 15)).toBeGreaterThan(noiseAt(b, 20, 15));
    expect(noiseAt(b, 20, 15)).toBeGreaterThan(0);
    expect(noiseAt(b, 27, 15)).toBe(0);
  });

  it('is muffled by walls between the source and the listener', () => {
    const b = arena(30, 30);
    for (let y = 10; y <= 20; y++) put(b, 'wall', 18, y);
    emitNoise(b, vec(15, 15), 12);
    // Same distance, one side walled off.
    expect(noiseAt(b, 21, 15)).toBeLessThan(noiseAt(b, 15, 21));
  });

  it('decays over rounds so the dead lose interest', () => {
    const b = arena(30, 30);
    emitNoise(b, vec(15, 15), 10);
    const before = noiseAt(b, 15, 15);
    decayNoise(b);
    expect(noiseAt(b, 15, 15)).toBeLessThan(before);
    for (let i = 0; i < 30; i++) decayNoise(b);
    expect(noiseAt(b, 15, 15)).toBe(0);
  });

  it('gives a gradient a zombie can climb toward the source', () => {
    const b = arena(30, 30);
    const z = addMerc(b, 'nine', vec(10, 15));
    emitNoise(b, vec(20, 15), 14);
    const step = loudestStep(b, z.pos, z);
    expect(step).not.toBeNull();
    // The chosen step must be strictly louder, and head toward the source.
    expect(noiseAt(b, step!.x, step!.y)).toBeGreaterThan(noiseAt(b, z.pos.x, z.pos.y));
    expect(step!.x).toBeGreaterThan(z.pos.x);
  });

  it('has no gradient to follow in silence', () => {
    const b = arena(30, 30);
    const z = addMerc(b, 'nine', vec(10, 15));
    expect(loudestStep(b, z.pos, z)).toBeNull();
  });
});
