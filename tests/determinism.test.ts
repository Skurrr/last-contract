/**
 * Reproducibility is the load-bearing claim of this architecture: the balance harness, the
 * regression suite, and any future replay or spectator feature all rest on a battle being a
 * pure function of its seed. These tests hold that claim to account end to end, through the
 * AI and map generation rather than just through the RNG.
 */
import { describe, expect, it } from 'vitest';
import { takeAiAction } from '@/sim/ai';
import { advancePhase, checkOutcome } from '@/sim/battle';
import { EventSink } from '@/sim/events';
import { generateMap } from '@/sim/mapgen';
import { createMercState } from '@/sim/spawn';
import { deploy } from '@/game/deploy';
import { SECTORS } from '@/data/sectors';
import type { BattleState } from '@/sim/types';

const SQUAD = ['nine', 'maggie', 'steroid'];

/** A compact fingerprint of everything a battle could differ in. */
function digest(b: BattleState): string {
  const units = b.units
    .map((u) =>
      [
        u.id, u.pos.x, u.pos.y, u.hp, Math.round(u.stamina), u.ap, u.stance,
        u.alive ? 1 : 0, u.critical ? 1 : 0, u.xp,
        u.statuses.map((s) => `${s.kind}:${s.stacks}`).sort().join('+'),
        u.weapon?.loaded ?? -1,
      ].join(','),
    )
    .sort()
    .join('|');
  // Terrain and noise matter too — destruction and sound are part of the state.
  let terrain = 0;
  for (let i = 0; i < b.terrain.length; i++) terrain = (terrain * 31 + (b.terrain[i] ?? 0)) | 0;
  let noise = 0;
  for (let i = 0; i < b.noise.length; i++) noise = (noise * 31 + Math.round((b.noise[i] ?? 0) * 1000)) | 0;
  return `${b.turn}/${b.phase}/${b.outcome}/${b.rngState}/${terrain}/${noise}/${units}`;
}

/** Play a battle headlessly with the AI driving every side. */
function playOut(seed: number, sectorIndex: number, turns: number): string {
  const sector = SECTORS[sectorIndex % SECTORS.length]!;
  const dep = deploy({
    seed,
    sector,
    squad: SQUAD.map((id) => createMercState(id)),
    opposition: sector.owner ?? null,
  });
  const b = dep.battle;
  const sink = new EventSink();

  while (b.outcome === 'ongoing' && b.turn <= turns) {
    for (const u of b.units.filter((x) => x.alive && !x.critical && x.team === b.phase)) {
      let guard = 0;
      while (u.alive && !u.critical && u.ap > 0 && guard++ < 12) {
        if (!takeAiAction(b, u, sink)) break;
      }
    }
    sink.drain();
    checkOutcome(b, sink);
    if (b.outcome !== 'ongoing') break;
    advancePhase(b, sink);
  }
  return digest(b);
}

describe('map generation', () => {
  it('produces byte-identical terrain for the same seed', () => {
    const a = generateMap({ seed: 4242, biome: 'industrial' });
    const b = generateMap({ seed: 4242, biome: 'industrial' });
    expect(Array.from(a.battle.terrain)).toEqual(Array.from(b.battle.terrain));
  });

  it('produces identical spawn and loot placement for the same seed', () => {
    const a = generateMap({ seed: 99, biome: 'village' });
    const b = generateMap({ seed: 99, biome: 'village' });
    expect(a.playerSpawns).toEqual(b.playerSpawns);
    expect(a.enemySpawns).toEqual(b.enemySpawns);
    expect(a.lootSpots).toEqual(b.lootSpots);
  });

  it('produces different maps for different seeds', () => {
    const a = generateMap({ seed: 1, biome: 'woods' });
    const b = generateMap({ seed: 2, biome: 'woods' });
    expect(Array.from(a.battle.terrain)).not.toEqual(Array.from(b.battle.terrain));
  });

  it('keeps every player spawn walkable and clustered', () => {
    for (const biome of ['village', 'farmland', 'woods', 'industrial', 'highway', 'ruins', 'military', 'swamp'] as const) {
      const m = generateMap({ seed: 777, biome });
      expect(m.playerSpawns.length, biome).toBeGreaterThanOrEqual(6);
      expect(m.enemySpawns.length, biome).toBeGreaterThanOrEqual(12);
      const first = m.playerSpawns[0]!;
      for (const s of m.playerSpawns) {
        expect(Math.max(Math.abs(s.x - first.x), Math.abs(s.y - first.y)), biome).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe('deployment', () => {
  it('places identical forces for the same seed', () => {
    const build = (): string => {
      const sector = SECTORS[10]!;
      const dep = deploy({
        seed: 31337,
        sector,
        squad: SQUAD.map((id) => createMercState(id)),
        opposition: sector.owner ?? null,
      });
      return dep.battle.units
        .map((u) => `${u.defId}@${u.pos.x},${u.pos.y}:${u.maxHp}`)
        .sort()
        .join('|');
    };
    expect(build()).toBe(build());
  });

  it('scales the opposition with sector threat', () => {
    const countFor = (threat: number): number => {
      const sector = SECTORS.find((s) => s.threat === threat);
      if (!sector) return 0;
      const dep = deploy({
        seed: 555,
        sector,
        squad: SQUAD.map((id) => createMercState(id)),
        opposition: sector.owner ?? null,
      });
      return dep.battle.units.filter((u) => u.team !== 'player').length;
    };
    expect(countFor(5)).toBeGreaterThan(countFor(1));
  });
});

describe('battle replay', () => {
  it('replays a full AI-driven battle identically from the same seed', () => {
    expect(playOut(8080, 12, 12)).toBe(playOut(8080, 12, 12));
  });

  it('diverges for a different seed', () => {
    expect(playOut(8080, 12, 12)).not.toBe(playOut(9090, 12, 12));
  });

  it('stays reproducible across several sectors and seeds', () => {
    for (const [seed, sector] of [[11, 3], [22, 17], [33, 29]] as const) {
      expect(playOut(seed, sector, 8), `seed ${seed} sector ${sector}`).toBe(playOut(seed, sector, 8));
    }
  });

  it('never leaves a unit in an incoherent state', () => {
    const sector = SECTORS[7]!;
    const dep = deploy({
      seed: 6161,
      sector,
      squad: SQUAD.map((id) => createMercState(id)),
      opposition: sector.owner ?? null,
    });
    const b = dep.battle;
    const sink = new EventSink();

    for (let t = 0; t < 20 && b.outcome === 'ongoing'; t++) {
      for (const u of b.units.filter((x) => x.alive && !x.critical && x.team === b.phase)) {
        let guard = 0;
        while (u.alive && !u.critical && u.ap > 0 && guard++ < 12) {
          if (!takeAiAction(b, u, sink)) break;
        }
      }
      sink.drain();
      checkOutcome(b, sink);
      if (b.outcome !== 'ongoing') break;
      advancePhase(b, sink);

      for (const u of b.units) {
        expect(Number.isFinite(u.hp), `${u.name} hp`).toBe(true);
        expect(u.hp, `${u.name} hp`).toBeGreaterThanOrEqual(0);
        expect(u.hp, `${u.name} hp`).toBeLessThanOrEqual(u.maxHp);
        expect(u.ap, `${u.name} ap`).toBeGreaterThanOrEqual(0);
        expect(u.stamina, `${u.name} stamina`).toBeGreaterThanOrEqual(0);
        expect(u.pos.x, `${u.name} x`).toBeGreaterThanOrEqual(0);
        expect(u.pos.x, `${u.name} x`).toBeLessThan(b.w);
        expect(u.pos.y, `${u.name} y`).toBeGreaterThanOrEqual(0);
        expect(u.pos.y, `${u.name} y`).toBeLessThan(b.h);
        // A dead unit must not also be waiting to be rescued.
        if (!u.alive) expect(u.critical, `${u.name}`).toBe(false);
      }
    }
  });

  it('never puts two living units on the same tile', () => {
    const sector = SECTORS[21]!;
    const dep = deploy({
      seed: 4711,
      sector,
      squad: SQUAD.map((id) => createMercState(id)),
      opposition: sector.owner ?? null,
    });
    const b = dep.battle;
    const sink = new EventSink();

    for (let t = 0; t < 15 && b.outcome === 'ongoing'; t++) {
      for (const u of b.units.filter((x) => x.alive && !x.critical && x.team === b.phase)) {
        let guard = 0;
        while (u.alive && !u.critical && u.ap > 0 && guard++ < 12) {
          if (!takeAiAction(b, u, sink)) break;
        }
      }
      sink.drain();
      checkOutcome(b, sink);
      if (b.outcome !== 'ongoing') break;
      advancePhase(b, sink);

      const seen = new Map<number, string>();
      for (const u of b.units) {
        if (!u.alive || u.critical) continue;
        const k = (u.pos.y << 10) | u.pos.x;
        const other = seen.get(k);
        expect(other, `${u.name} shares a tile with ${other}`).toBeUndefined();
        seen.set(k, u.name);
      }
    }
  });
});
