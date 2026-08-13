/** Shared fixtures for the simulation tests: a bare arena and units placed into it. */
import { createBattle } from '@/sim/battle';
import { setTerrain } from '@/sim/field';
import { makeWeapon, spawnEnemy, spawnMerc, createMercState } from '@/sim/spawn';
import type { BattleState, TerrainKind, Unit } from '@/sim/types';
import type { Vec2 } from '@/core/grid';

/** An empty grass arena with a wall border, so nothing walks off the edge. */
export function arena(w = 20, h = 20, seed = 1): BattleState {
  const b = createBattle({ seed, w, h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      setTerrain(b, x, y, edge ? 'wall' : 'grass');
    }
  }
  return b;
}

export function put(b: BattleState, kind: TerrainKind, x: number, y: number): void {
  setTerrain(b, x, y, kind);
}

/** Place a merc into the battle and return the unit. */
export function addMerc(b: BattleState, defId: string, pos: Vec2): Unit {
  const u = spawnMerc(createMercState(defId), pos);
  // Tests need a stable identity per placement, not per campaign.
  u.id = `${defId}@${pos.x},${pos.y}`;
  u.ap = u.maxAp;
  b.units.push(u);
  return u;
}

export function addEnemy(b: BattleState, defId: string, pos: Vec2, seed = 1): Unit {
  const u = spawnEnemy(defId, pos, seed);
  u.ap = u.maxAp;
  b.units.push(u);
  return u;
}

/** Give a unit a specific weapon, fully loaded and pristine. */
export function arm(u: Unit, weaponId: string): void {
  u.weapon = makeWeapon(weaponId, { condition: 100 });
}

/** Deterministically drive a unit's rolls by pinning the battle's RNG state. */
export function withSeed(b: BattleState, seed: number): void {
  b.rngState = seed;
}
