/**
 * Thrown weapons: grenades, firebombs, smoke, and noisemakers.
 *
 * Each of these does something the gun catalogue cannot. A frag clears a room, a molotov
 * denies one, smoke breaks a sightline, and a noisemaker moves the dead — which in a game
 * where zombies navigate by sound is the most tactical object in the inventory.
 *
 * Accuracy here is deliberately not the shooting model: you are lobbing a heavy object, so
 * a miss scatters rather than simply failing, and it scatters further the further you throw.
 */
import { Rng } from '@/core/rng';
import { chebyshev, dist, facingBetween, type Vec2 } from '@/core/grid';
import { ALL_WEAPONS } from '@/data/index';
import { unitMods, addStatus, explode } from './combat';
import { emitNoise, inBounds, isOpen, terrainAt } from './field';
import type { EventSink } from './events';
import type { BattleState, Unit } from './types';

export interface ThrowOutcome {
  ok: boolean;
  reason?: string;
  /** Where it actually landed, which is not always where it was aimed. */
  landed?: Vec2;
  scattered?: boolean;
}

const FAIL = (reason: string): ThrowOutcome => ({ ok: false, reason });

/** Can this unit throw the given item at all? */
export function canThrow(u: Unit, itemId: string): boolean {
  const def = ALL_WEAPONS[itemId];
  return Boolean(def && def.cls === 'thrown' && u.inventory.includes(itemId));
}

/** Everything thrown that this unit is carrying, deduplicated with counts. */
export function throwables(u: Unit): { id: string; name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const id of u.inventory) {
    if (ALL_WEAPONS[id]?.cls === 'thrown') counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].map(([id, count]) => ({
    id,
    name: ALL_WEAPONS[id]?.name ?? id,
    count,
  }));
}

/** AP a throw costs for this unit. */
export function throwApCost(u: Unit, itemId: string): number {
  const def = ALL_WEAPONS[itemId];
  if (!def) return 0;
  return Math.max(1, Math.ceil(def.apCost + unitMods(u).shotApCost));
}

/**
 * How far a throw can reach. Strength extends it — a heavy grenade goes as far as the arm
 * behind it, which is one of the few places raw strength matters at range.
 */
export function throwRange(u: Unit, itemId: string): number {
  const def = ALL_WEAPONS[itemId];
  if (!def) return 0;
  return Math.max(2, Math.round(def.rangeMax + (u.attrs.strength - 5) * 0.6));
}

/**
 * Scatter radius on a miss, in tiles. Explosives skill and short range tighten it; throwing
 * to the edge of your reach loosens it.
 */
function scatterFor(u: Unit, target: Vec2, range: number): number {
  const d = dist(u.pos, target);
  const skill = 1 - Math.min(0.75, u.attrs.explosives * 0.075);
  const reach = Math.min(1, d / Math.max(1, range));
  return Math.max(0, Math.round(skill * (0.6 + reach * 2.4)));
}

/** Nudge a landing point off target, keeping it on the map and out of solid terrain. */
function scatterLand(b: BattleState, aim: Vec2, radius: number, rng: Rng): Vec2 {
  if (radius <= 0) return aim;
  for (let tries = 0; tries < 12; tries++) {
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(0.5, radius);
    const x = Math.round(aim.x + Math.cos(a) * r);
    const y = Math.round(aim.y + Math.sin(a) * r);
    if (inBounds(b, x, y) && isOpen(b, x, y)) return { x, y };
  }
  return aim;
}

/**
 * Throw an item at a tile. Consumes it from the unit's inventory whether or not it lands
 * where they wanted — you do not get the grenade back.
 */
export function throwAt(
  b: BattleState,
  u: Unit,
  aim: Vec2,
  itemId: string,
  sink: EventSink,
): ThrowOutcome {
  const def = ALL_WEAPONS[itemId];
  if (!def || def.cls !== 'thrown') return FAIL('not a throwable');
  const held = u.inventory.indexOf(itemId);
  if (held < 0) return FAIL(`no ${def.name} carried`);
  if (!inBounds(b, aim.x, aim.y)) return FAIL('off the map');

  const range = throwRange(u, itemId);
  if (chebyshev(u.pos, aim) > range) return FAIL(`out of reach (${range} tiles)`);

  const cost = throwApCost(u, itemId);
  if (u.ap < cost) return FAIL('not enough AP');

  u.ap -= cost;
  u.inventory.splice(held, 1);
  u.facing = facingBetween(u.pos, aim);

  const rng = Rng.restore(b.rngState);
  const scatter = scatterFor(u, aim, range);
  const landed = scatterLand(b, aim, scatter, rng);
  const scattered = landed.x !== aim.x || landed.y !== aim.y;
  b.rngState = rng.state;

  // The arc itself, so the renderer can animate something leaving the hand.
  sink.push({
    t: 'shot',
    from: u.pos,
    to: landed,
    unitId: u.id,
    hit: !scattered,
    noise: 2,
    tracer: false,
    cls: 'thrown',
  });

  resolveImpact(b, u, def.id, landed, sink);
  return { ok: true, landed, scattered };
}

/** What each thrown item does where it lands. */
function resolveImpact(
  b: BattleState,
  thrower: Unit,
  itemId: string,
  at: Vec2,
  sink: EventSink,
): void {
  const def = ALL_WEAPONS[itemId];
  if (!def) return;
  const mods = unitMods(thrower);
  // Explosives skill is the damage stat for everything in this file.
  const power = 1 + thrower.attrs.explosives * 0.05;

  switch (itemId) {
    case 'frag':
    case 'pipebomb': {
      const radius = itemId === 'frag' ? 3 : 2.5;
      explode(b, at, radius, def.damage * power * mods.damageMul, sink, thrower);
      break;
    }

    case 'molotov': {
      // Fire is less about the burst than about what it does to everyone standing in it.
      explode(b, at, 2, def.damage * power * mods.damageMul * 0.7, sink, thrower);
      for (const v of b.units) {
        if (!v.alive || dist(at, v.pos) > 2.2) continue;
        if (addStatus(v, 'poisoned', 3)) {
          sink.push({ t: 'status', unitId: v.id, at: v.pos, kind: 'poisoned', applied: true });
        }
      }
      emitNoise(b, at, Math.round(def.noise * mods.noiseMul));
      break;
    }

    case 'smoke': {
      // Suppresses everyone caught in it: they cannot see well enough to shoot straight.
      for (const v of b.units) {
        if (!v.alive || dist(at, v.pos) > 3) continue;
        if (addStatus(v, 'suppressed', 2)) {
          sink.push({ t: 'status', unitId: v.id, at: v.pos, kind: 'suppressed', applied: true });
        }
      }
      emitNoise(b, at, Math.round(def.noise * mods.noiseMul));
      sink.push({ t: 'explosion', at, radius: 3, damage: 0 });
      break;
    }

    case 'chattercan': {
      // The whole point: a very loud noise somewhere you are not.
      const radius = Math.round(def.noise * mods.noiseMul);
      emitNoise(b, at, radius);
      sink.push({ t: 'noise', at, radius });
      // Redirect anything already hunting toward the racket.
      for (const v of b.units) {
        if (v.alive && v.kind === 'zombie') v.target = at;
      }
      break;
    }

    default: {
      // Any future throwable behaves as a small charge rather than doing nothing at all.
      explode(b, at, 2, def.damage * power * mods.damageMul, sink, thrower);
      break;
    }
  }

  // Fire and explosions scorch the ground they land on.
  if (def.damage > 0) {
    const i = at.y * b.w + at.x;
    if (i >= 0 && i < b.decals.length && terrainAt(b, at.x, at.y) !== 'wall') {
      b.decals[i] = Math.min(255, (b.decals[i] ?? 0) + 90);
    }
  }
}
