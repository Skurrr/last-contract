/**
 * Shot resolution: what a weapon actually is once attachments and wear are applied, what
 * chance a shot has, and what happens when it lands. Every random draw goes through the
 * battle's seeded RNG so a fight is reproducible.
 */
import { Rng } from '@/core/rng';
import { chebyshev, dist, facingBetween, type Vec2 } from '@/core/grid';
import { ATTACHMENTS } from '@/data/attachments';
import { ENEMIES } from '@/data/enemies';
// ALL_WEAPONS rather than WEAPONS: the resolver must also find natural attacks (claws, fists),
// which are deliberately kept out of the market catalogue.
import { ALL_WEAPONS } from '@/data/index';
import { PERKS } from '@/data/perks';
import { TRAITS } from '@/data/traits';
import { aggregate, xpGain, XP_AWARDS, type Mods } from './progression';
import type { CombatEvent } from './events';
import { EventSink } from './events';
import {
  coverAgainst,
  COVER_MOD,
  damageTerrain,
  emitNoise,
  hasLineOfSight,
  traceSight,
  unitAt,
} from './field';
import {
  BODY_PART_TABLE,
  STANCE_TABLE,
  type BattleState,
  type BodyPart,
  type FireMode,
  type StatDelta,
  type Status,
  type StatusKind,
  type Unit,
  type WeaponDef,
  type WeaponInstance,
} from './types';

// ─────────────────────────────────────────────────────────────── modifiers

const modCache = new WeakMap<Unit, { key: string; mods: Mods }>();

/** All perk and trait modifiers for a unit, cached until its perk/trait list changes. */
export function unitMods(u: Unit): Mods {
  const key = `${u.perks.join(',')}|${u.traits.join(',')}`;
  const hit = modCache.get(u);
  if (hit && hit.key === key) return hit.mods;
  const parts: Partial<Mods>[] = [];
  for (const id of u.perks) {
    const p = PERKS[id];
    if (p) parts.push(p.mods);
  }
  for (const id of u.traits) {
    const t = TRAITS[id];
    if (t) parts.push(t.mods);
  }
  const mods = aggregate(parts);
  modCache.set(u, { key, mods });
  return mods;
}

export function hasPerk(u: Unit, id: string): boolean {
  return u.perks.includes(id);
}

export function hasTrait(u: Unit, id: string): boolean {
  return u.traits.includes(id);
}

// ─────────────────────────────────────────────────────────────── resolved weapons

/** A weapon's real stats: base definition + attachments + condition wear. */
export interface ResolvedWeapon {
  def: WeaponDef;
  inst: WeaponInstance;
  name: string;
  damage: number;
  accuracy: number;
  rangeOptimal: number;
  rangeMax: number;
  recoil: number;
  noise: number;
  magSize: number;
  apCost: number;
  weight: number;
  penetration: number;
  longRangeAccuracy: number;
  closeRangePenalty: number;
  proneAccuracy: number;
  /** 0..1. Below 0.4 the weapon starts jamming. */
  condition: number;
}

const EMPTY_DELTA: StatDelta = {};

export function resolveWeapon(inst: WeaponInstance): ResolvedWeapon | null {
  const def = ALL_WEAPONS[inst.defId];
  if (!def) return null;

  const deltas: StatDelta[] = [];
  for (const attId of Object.values(inst.attachments)) {
    if (!attId) continue;
    deltas.push(ATTACHMENTS[attId]?.delta ?? EMPTY_DELTA);
  }

  let damageMul = 1;
  let recoilMul = 1;
  let noiseMul = 1;
  let accuracy = def.accuracy * 100;
  let rangeOptimal = def.rangeOptimal;
  let rangeMax = def.rangeMax;
  let magSize = def.magSize;
  let apCost = def.apCost;
  let weight = def.weight;
  let longRangeAccuracy = 0;
  let closeRangePenalty = 0;
  let proneAccuracy = 0;
  let penetration = def.penetration;

  for (const d of deltas) {
    penetration += d.penetration ?? 0;
    accuracy += d.accuracy ?? 0;
    damageMul *= d.damage ?? 1;
    recoilMul *= d.recoil ?? 1;
    noiseMul *= d.noise ?? 1;
    rangeOptimal += d.rangeOptimal ?? 0;
    rangeMax += d.rangeMax ?? 0;
    magSize += d.magSize ?? 0;
    apCost += d.apCost ?? 0;
    weight += d.weight ?? 0;
    longRangeAccuracy += d.longRangeAccuracy ?? 0;
    closeRangePenalty += d.closeRangePenalty ?? 0;
    proneAccuracy += d.proneAccuracy ?? 0;
  }

  // Wear costs accuracy before it costs anything else — a beaten rifle sprays.
  const condition = Math.max(0, Math.min(100, inst.condition)) / 100;
  const wearAcc = 0.7 + 0.3 * condition;

  return {
    def,
    inst,
    name: inst.customName ?? def.name,
    damage: Math.max(1, def.damage * damageMul),
    accuracy: accuracy * wearAcc,
    rangeOptimal: Math.max(1, rangeOptimal),
    rangeMax: Math.max(2, rangeMax),
    recoil: def.recoil * recoilMul,
    noise: Math.max(1, def.noise * noiseMul),
    magSize: Math.max(1, magSize),
    apCost: Math.max(1, apCost),
    weight,
    penetration,
    longRangeAccuracy,
    closeRangePenalty,
    proneAccuracy,
    condition,
  };
}

export function activeWeapon(u: Unit): ResolvedWeapon | null {
  if (u.weapon) return resolveWeapon(u.weapon);
  if (u.sidearm) return resolveWeapon(u.sidearm);
  return null;
}

// ─────────────────────────────────────────────────────────────── aiming

export const MAX_AIM = 4;
/** Cumulative to-hit multiplier per aim level. Diminishing, so over-aiming is a real choice. */
export const AIM_BONUS = [1.0, 1.08, 1.15, 1.21, 1.26] as const;

export interface ShotPlan {
  mode: FireMode;
  /** Extra AP spent aiming, 0..MAX_AIM. */
  aim: number;
  /** Called shot target. Requires aim >= 1. */
  part: BodyPart;
}

export const DEFAULT_PLAN: ShotPlan = { mode: 'single', aim: 0, part: 'torso' };

export function roundsFor(w: ResolvedWeapon, mode: FireMode): number {
  if (mode === 'burst') return w.def.burstRounds;
  if (mode === 'auto') return w.def.autoRounds;
  return 1;
}

/** Total AP a planned shot costs, including aim and extra rounds. */
export function shotApCost(u: Unit, w: ResolvedWeapon, plan: ShotPlan): number {
  const mods = unitMods(u);
  const rounds = roundsFor(w, plan.mode);
  // Floored at 0.5 rather than 1 so perks can genuinely make aiming cheaper — the total
  // is ceiled below, so a discount shows up as fewer AP once it accumulates across levels.
  const aimCost = plan.aim * Math.max(0.5, 1 + mods.aimApCost);
  const base = w.apCost + mods.shotApCost;
  return Math.max(1, Math.ceil(base + (rounds - 1) + aimCost));
}

// ─────────────────────────────────────────────────────────────── hit chance

export interface ShotEstimate {
  /** Final chance for the first round, 0..1. */
  chance: number;
  /** Per-round chances across a burst, each degraded by accumulating recoil. */
  perRound: number[];
  apCost: number;
  rounds: number;
  inRange: boolean;
  hasLos: boolean;
  hasAmmo: boolean;
  /** Human-readable breakdown for the UI tooltip. */
  breakdown: { label: string; value: number }[];
  cover: 0 | 1 | 2;
  distance: number;
}

/** Accuracy falloff: full inside optimal, linear decline to zero at max range. */
function rangeFactor(w: ResolvedWeapon, d: number): number {
  if (d <= w.rangeOptimal) return 1;
  if (d >= w.rangeMax) return 0;
  return 1 - (d - w.rangeOptimal) / (w.rangeMax - w.rangeOptimal);
}

export function estimateShot(
  b: BattleState,
  shooter: Unit,
  target: Unit,
  plan: ShotPlan = DEFAULT_PLAN,
): ShotEstimate {
  const w = activeWeapon(shooter);
  const breakdown: { label: string; value: number }[] = [];
  const d = dist(shooter.pos, target.pos);
  const cover = coverAgainst(b, target.pos, shooter.pos);

  if (!w) {
    return {
      chance: 0, perRound: [], apCost: 0, rounds: 0, inRange: false,
      hasLos: false, hasAmmo: false, breakdown, cover, distance: d,
    };
  }

  const mods = unitMods(shooter);
  const rounds = roundsFor(w, plan.mode);
  const apCost = shotApCost(shooter, w, plan);
  const hasLos = hasLineOfSight(b, shooter.pos, target.pos, w.rangeMax);
  const inRange = chebyshev(shooter.pos, target.pos) <= w.rangeMax;
  const hasAmmo = w.def.cls === 'melee' || w.inst.loaded > 0;

  // Base: weapon accuracy carried by the shooter's marksmanship.
  let acc = w.accuracy + shooter.attrs.marksmanship * 3.2 + mods.accuracy;
  breakdown.push({ label: 'Weapon + skill', value: acc });

  const rf = rangeFactor(w, d);
  acc *= rf;
  if (rf < 1) breakdown.push({ label: `Range ${d.toFixed(1)}t`, value: (rf - 1) * 100 });

  // Optics help far and hurt near; bipods only pay off prone.
  if (d > w.rangeOptimal && w.longRangeAccuracy) {
    acc += w.longRangeAccuracy + mods.longRangeAccuracy;
    breakdown.push({ label: 'Optic', value: w.longRangeAccuracy });
  }
  if (d <= 4 && w.closeRangePenalty) {
    acc -= w.closeRangePenalty - mods.closeRangeAccuracy;
    breakdown.push({ label: 'Optic (close)', value: -w.closeRangePenalty });
  }
  if (shooter.stance === 'prone' && w.proneAccuracy) {
    acc += w.proneAccuracy;
    breakdown.push({ label: 'Bipod', value: w.proneAccuracy });
  }

  let chance = Math.max(0, acc) / 100;

  const aimMul = AIM_BONUS[Math.min(plan.aim, MAX_AIM)] ?? 1;
  if (plan.aim > 0) {
    chance *= aimMul;
    breakdown.push({ label: `Aim ×${plan.aim}`, value: (aimMul - 1) * 100 });
  }

  const shooterStance = STANCE_TABLE[shooter.stance].hitGiven;
  const targetStance = STANCE_TABLE[target.stance].hitTaken;
  chance *= shooterStance * targetStance;
  if (shooterStance !== 1) breakdown.push({ label: `${shooter.stance}`, value: (shooterStance - 1) * 100 });
  if (targetStance !== 1) breakdown.push({ label: `Target ${target.stance}`, value: (targetStance - 1) * 100 });

  const coverMul = COVER_MOD[cover];
  chance *= coverMul;
  if (cover > 0) breakdown.push({ label: cover === 2 ? 'High cover' : 'Low cover', value: (coverMul - 1) * 100 });

  // Called shots pay their body-part multiplier, softened by the perk line.
  if (plan.part !== 'torso') {
    const partMul = Math.min(1, BODY_PART_TABLE[plan.part].hit + mods.calledShotAccuracy / 100);
    chance *= partMul;
    breakdown.push({ label: `Called: ${BODY_PART_TABLE[plan.part].label}`, value: (partMul - 1) * 100 });
  }

  // Light, stamina, and wounds.
  const lightMul = 0.6 + 0.4 * b.light;
  chance *= lightMul;
  if (b.light < 0.99) breakdown.push({ label: 'Light', value: (lightMul - 1) * 100 });

  const staminaFrac = shooter.stamina / Math.max(1, shooter.maxStamina);
  if (staminaFrac < 0.3) {
    chance *= 0.8;
    breakdown.push({ label: 'Exhausted', value: -20 });
  }

  for (const s of shooter.statuses) {
    if (s.kind === 'shaky') { chance *= 0.75; breakdown.push({ label: 'Shaky', value: -25 }); }
    if (s.kind === 'suppressed') {
      const m = 0.7 + 0.3 * mods.suppressionResist;
      chance *= m;
      breakdown.push({ label: 'Suppressed', value: (m - 1) * 100 });
    }
    if (s.kind === 'inspired') { chance *= 1.15; breakdown.push({ label: 'Inspired', value: 15 }); }
    if (s.kind === 'panicked') { chance *= 0.7; breakdown.push({ label: 'Panicked', value: -30 }); }
  }

  if (shooter.morale > 80) { chance *= 1.1; breakdown.push({ label: 'High morale', value: 10 }); }
  else if (shooter.morale < 25) { chance *= 0.85; breakdown.push({ label: 'Low morale', value: -15 }); }

  chance *= mods.accuracyMul;
  if (!hasLos) chance = 0;

  chance = Math.max(0, Math.min(0.99, chance));

  // Recoil degrades each successive round in a burst.
  const recoil = w.recoil * mods.recoilMul * (1 - Math.min(0.5, shooter.attrs.strength * 0.04));
  const perRound: number[] = [];
  for (let i = 0; i < rounds; i++) {
    perRound.push(Math.max(0.02, chance * Math.pow(1 - recoil, i)));
  }

  return { chance, perRound, apCost, rounds, inRange, hasLos, hasAmmo, breakdown, cover, distance: d };
}

// ─────────────────────────────────────────────────────────────── status helpers

export function addStatus(u: Unit, kind: StatusKind, turns: number, stacks = 1): boolean {
  const existing = u.statuses.find((s) => s.kind === kind);
  if (existing) {
    existing.turns = Math.max(existing.turns, turns);
    existing.stacks += stacks;
    return false;
  }
  u.statuses.push({ kind, turns, stacks } satisfies Status);
  return true;
}

export function clearStatus(u: Unit, kind: StatusKind): void {
  const i = u.statuses.findIndex((s) => s.kind === kind);
  if (i >= 0) u.statuses.splice(i, 1);
}

export function hasStatus(u: Unit, kind: StatusKind): boolean {
  return u.statuses.some((s) => s.kind === kind);
}

// ─────────────────────────────────────────────────────────────── damage

export interface DamageResult {
  dealt: number;
  killed: boolean;
  downed: boolean;
  crit: boolean;
}

/**
 * Apply damage to one body part. Armour at that location subtracts flat, reduced by the
 * weapon's penetration. Mercs go Critical at 0 HP instead of dying outright; everything
 * else just dies.
 */
export function applyDamage(
  b: BattleState,
  rng: Rng,
  target: Unit,
  raw: number,
  part: BodyPart,
  penetration: number,
  sink: EventSink,
  attacker?: Unit,
  crit = false,
): DamageResult {
  const mods = unitMods(target);
  const armour = Math.max(0, (target.armour[part] ?? 0) + mods.armour - penetration);
  const partInfo = BODY_PART_TABLE[part];

  let dmg = raw * partInfo.damage;
  if (crit) dmg *= 1.5 * (attacker ? unitMods(attacker).critDamageMul : 1);
  dmg = Math.max(1, Math.round(dmg - armour));

  target.hp -= dmg;
  target.calm = 0;

  sink.push({
    t: 'hit',
    unitId: target.id,
    at: target.pos,
    damage: dmg,
    part,
    crit,
    overkill: target.hp < -target.maxHp * 0.5,
  });

  // Blood on the tile — cosmetic, but it makes a firefight read at a glance.
  const di = target.pos.y * b.w + target.pos.x;
  b.decals[di] = Math.min(255, (b.decals[di] ?? 0) + Math.min(160, dmg * 6));

  // Wound side-effects.
  if (partInfo.inflicts && target.alive) {
    const resist = partInfo.inflicts === 'stunned' ? mods.stunResist : 0;
    const threshold = target.maxHp * 0.08;
    if (dmg >= threshold && rng.chance(Math.max(0.15, 0.75 - resist))) {
      if (addStatus(target, partInfo.inflicts, partInfo.inflicts === 'stunned' ? 1 : 4)) {
        sink.push({ t: 'status', unitId: target.id, at: target.pos, kind: partInfo.inflicts, applied: true });
      }
    }
  }

  // Bleeding: heavy hits open wounds. This is what actually kills mercs.
  if (target.kind !== 'zombie' && dmg >= target.maxHp * 0.15 && rng.chance(0.5 - mods.bleedResist)) {
    addStatus(target, 'bleeding', -1, 1);
    sink.push({ t: 'status', unitId: target.id, at: target.pos, kind: 'bleeding', applied: true });
  }

  let killed = false;
  let downed = false;

  if (target.hp <= 0) {
    target.hp = 0;
    // A merc who is not obliterated gets three turns to be dragged back.
    const survivable = target.kind === 'merc' && !crit && dmg < target.maxHp * 0.9;
    if (survivable && !target.critical) {
      target.critical = true;
      target.criticalTurns = 3;
      target.ap = 0;
      target.stance = 'prone';
      downed = true;
      sink.push({ t: 'critical', unitId: target.id, at: target.pos });
    } else {
      target.alive = false;
      target.critical = false;
      killed = true;
      sink.push({
        t: 'kill',
        unitId: target.id,
        at: target.pos,
        by: attacker?.id ?? '',
        headshot: part === 'head',
      });
      onDeath(b, target, sink);
    }
  }

  return { dealt: dmg, killed, downed, crit };
}

/**
 * Death side-effects. A bloater's whole design is that killing it at the wrong moment is
 * worse than leaving it alone, so the burst has to fire from the death itself rather than
 * from whatever happened to land the blow.
 */
function onDeath(b: BattleState, victim: Unit, sink: EventSink): void {
  if (victim.detonated) return;
  const def = ENEMIES[victim.defId];
  if (def?.special !== 'gas_burst') return;
  // Marked before the blast so a chain of bloaters resolves once each, never recursively.
  victim.detonated = true;
  gasBurst(b, victim, sink);
}

/** Corrosive gas: hurts and poisons the living, leaves the dead entirely unbothered. */
export function gasBurst(b: BattleState, source: Unit, sink: EventSink): void {
  const rng = Rng.restore(b.rngState);
  const radius = 3;
  sink.push({ t: 'explosion', at: source.pos, radius, damage: 12 });

  for (const u of b.units) {
    if (!u.alive || u.kind === 'zombie') continue;
    const d = dist(source.pos, u.pos);
    if (d > radius) continue;
    const falloff = 1 - d / (radius + 1);
    applyDamage(b, rng, u, rng.variance(12 * falloff, 0.2), 'torso', 6, sink);
    if (u.alive && addStatus(u, 'poisoned', 3)) {
      sink.push({ t: 'status', unitId: u.id, at: u.pos, kind: 'poisoned', applied: true });
    }
  }

  emitNoise(b, source.pos, 10);
  b.rngState = rng.state;
}

// ─────────────────────────────────────────────────────────────── firing

export interface ShotOutcome {
  fired: number;
  hits: number;
  damage: number;
  killed: boolean;
  jammed: boolean;
  events: CombatEvent[];
}

/**
 * Fire the planned shot. Mutates the battle state and returns what happened.
 * Rounds that miss still travel — a stray round can break the cover the target is hiding
 * behind, which is how sustained fire opens up a position.
 */
export function fireAt(
  b: BattleState,
  shooter: Unit,
  target: Unit,
  plan: ShotPlan,
  sink: EventSink,
): ShotOutcome {
  const rng = Rng.restore(b.rngState);
  const out: ShotOutcome = { fired: 0, hits: 0, damage: 0, killed: false, jammed: false, events: [] };

  const w = activeWeapon(shooter);
  if (!w) return out;

  const est = estimateShot(b, shooter, target, plan);
  const cost = est.apCost;
  if (shooter.ap < cost || !est.hasLos) return out;

  shooter.ap -= cost;
  shooter.facing = facingBetween(shooter.pos, target.pos);

  // A worn weapon can jam instead of firing, wasting the AP. Condition matters.
  if (w.def.cls !== 'melee' && w.condition < 0.4 && rng.chance((0.4 - w.condition) * 0.5)) {
    out.jammed = true;
    sink.push({ t: 'jam', unitId: shooter.id, at: shooter.pos });
    b.rngState = rng.state;
    return out;
  }

  const mods = unitMods(shooter);
  const rounds = Math.min(est.rounds, w.def.cls === 'melee' ? est.rounds : w.inst.loaded);
  if (rounds <= 0) return out;

  const noise = Math.round(w.noise * mods.noiseMul);
  sink.push({
    t: 'shot',
    from: shooter.pos,
    to: target.pos,
    unitId: shooter.id,
    hit: false,
    noise,
    tracer: w.def.cls !== 'melee',
  });

  for (let i = 0; i < rounds; i++) {
    if (!target.alive) break;
    out.fired++;
    if (w.def.cls !== 'melee') w.inst.loaded--;

    const chance = est.perRound[i] ?? est.chance;
    if (rng.chance(chance)) {
      out.hits++;
      const crit = rng.chance(0.05 + mods.critChance + (plan.part === 'head' ? 0.1 : 0));
      const raw = rng.variance(w.damage * mods.damageMul, 0.2);
      const res = applyDamage(
        b, rng, target, raw, plan.part,
        w.penetration + mods.penetration, sink, shooter, crit,
      );
      out.damage += res.dealt;
      if (res.killed) out.killed = true;
    } else {
      sink.push({ t: 'miss', unitId: target.id, at: target.pos });
      // Stray rounds chew through whatever is in the way.
      const trace = traceSight(b, shooter.pos, target.pos);
      const strayAt = trace.path[Math.max(1, trace.path.length - 2)];
      if (strayAt && damageTerrain(b, strayAt.x, strayAt.y, w.damage * 0.5)) {
        sink.push({ t: 'terrainBroken', at: strayAt });
      }
    }
  }

  // Suppression: being shot at pins you even when every round misses.
  if (out.fired >= 3 && target.alive && !hasStatus(target, 'suppressed')) {
    addStatus(target, 'suppressed', 1);
    sink.push({ t: 'status', unitId: target.id, at: target.pos, kind: 'suppressed', applied: true });
  }

  emitNoise(b, shooter.pos, noise);
  sink.push({ t: 'noise', at: shooter.pos, radius: noise });

  // Wear. Full-auto is hard on a gun.
  if (w.def.cls !== 'melee') {
    w.inst.condition = Math.max(0, w.inst.condition - out.fired * 0.06);
  }

  awardShotXp(shooter, out, plan, sink);
  b.rngState = rng.state;
  out.events = sink.events;
  return out;
}

function awardShotXp(shooter: Unit, out: ShotOutcome, plan: ShotPlan, sink: EventSink): void {
  if (shooter.kind !== 'merc') return;
  const mods = unitMods(shooter);
  let xp = out.damage * XP_AWARDS.damageDealt;
  if (out.hits > 0 && plan.part !== 'torso') xp += XP_AWARDS.calledShotLanded;
  if (out.killed) xp += plan.part === 'head' ? XP_AWARDS.headshotKill : XP_AWARDS.kill;
  if (xp <= 0) return;
  const gain = xpGain(xp, shooter.attrs.wisdom, mods);
  shooter.xp += gain;
  sink.push({ t: 'xp', unitId: shooter.id, amount: gain, reason: out.killed ? 'Kill' : 'Damage', at: shooter.pos });
}

// ─────────────────────────────────────────────────────────────── melee

export function meleeAt(b: BattleState, attacker: Unit, target: Unit, sink: EventSink): ShotOutcome {
  const rng = Rng.restore(b.rngState);
  const out: ShotOutcome = { fired: 0, hits: 0, damage: 0, killed: false, jammed: false, events: [] };
  if (chebyshev(attacker.pos, target.pos) > 1) return out;

  const mods = unitMods(attacker);
  const w = attacker.weapon ? resolveWeapon(attacker.weapon) : null;
  const isMeleeWeapon = w?.def.cls === 'melee';
  const damage = isMeleeWeapon ? w.damage : 4 + attacker.attrs.strength * 1.2;
  const apCost = Math.max(2, Math.ceil((isMeleeWeapon ? w.apCost : 4) + mods.shotApCost));
  const staminaCost = Math.round(
    (isMeleeWeapon ? (w.def.staminaCost ?? 12) : 10) * mods.staminaCostMul,
  );

  if (attacker.ap < apCost) return out;
  attacker.ap -= apCost;
  attacker.stamina = Math.max(0, attacker.stamina - staminaCost);
  attacker.facing = facingBetween(attacker.pos, target.pos);
  out.fired = 1;

  // Melee is a strength/agility contest, not a marksmanship one.
  let chance = 0.55 + attacker.attrs.agility * 0.035 + attacker.attrs.strength * 0.02;
  chance *= mods.accuracyMul;
  chance -= target.attrs.agility * 0.02;
  if (attacker.stamina < attacker.maxStamina * 0.3) chance *= 0.75;
  chance = Math.max(0.05, Math.min(0.97, chance));

  if (rng.chance(chance)) {
    out.hits = 1;
    const crit = rng.chance(0.12 + mods.critChance);
    // Melee finds the gaps in armour — knives especially.
    const part: BodyPart = crit ? 'head' : 'torso';
    const res = applyDamage(
      b, rng, target,
      rng.variance(damage * mods.damageMul, 0.2),
      part, (w?.penetration ?? 2) + mods.penetration, sink, attacker, crit,
    );
    out.damage = res.dealt;
    out.killed = res.killed;
    sink.push({ t: 'melee', unitId: attacker.id, targetId: target.id, damage: res.dealt, crit });
  } else {
    sink.push({ t: 'miss', unitId: target.id, at: target.pos });
  }

  const noise = Math.round(3 * mods.noiseMul);
  emitNoise(b, attacker.pos, noise);

  if (attacker.kind === 'merc' && out.damage > 0) {
    const gain = xpGain(
      out.damage * XP_AWARDS.damageDealt + (out.killed ? XP_AWARDS.kill : 0),
      attacker.attrs.wisdom, mods,
    );
    attacker.xp += gain;
    sink.push({ t: 'xp', unitId: attacker.id, amount: gain, reason: 'Melee', at: attacker.pos });
  }

  b.rngState = rng.state;
  out.events = sink.events;
  return out;
}

// ─────────────────────────────────────────────────────────────── explosives

export function explode(
  b: BattleState,
  at: Vec2,
  radius: number,
  damage: number,
  sink: EventSink,
  source?: Unit,
): void {
  const rng = Rng.restore(b.rngState);
  sink.push({ t: 'explosion', at, radius, damage });

  for (const u of b.units) {
    if (!u.alive) continue;
    const d = dist(at, u.pos);
    if (d > radius) continue;
    // Falloff, and cover between the blast and the victim actually helps.
    const falloff = 1 - d / (radius + 1);
    const blocked = traceSight(b, at, u.pos).clear ? 1 : 0.5;
    const dmg = rng.variance(damage * falloff * blocked, 0.15);
    if (dmg > 0) applyDamage(b, rng, u, dmg, 'torso', 20, sink, source);
  }

  // Blasts rearrange the map.
  const r = Math.ceil(radius);
  for (let y = at.y - r; y <= at.y + r; y++) {
    for (let x = at.x - r; x <= at.x + r; x++) {
      const d = dist(at, { x, y });
      if (d > radius) continue;
      if (damageTerrain(b, x, y, damage * (1 - d / (radius + 1)))) {
        sink.push({ t: 'terrainBroken', at: { x, y } });
      }
    }
  }

  emitNoise(b, at, radius * 4);
  sink.push({ t: 'noise', at, radius: radius * 4 });
  b.rngState = rng.state;
}

// ─────────────────────────────────────────────────────────────── healing

export function healUnit(
  b: BattleState,
  medic: Unit,
  target: Unit,
  potency: number,
  sink: EventSink,
): number {
  const mods = unitMods(medic);
  const amount = Math.round(potency * (0.6 + medic.attrs.medical * 0.09) * mods.healMul);

  if (target.critical) {
    // Stabilising is the whole point of the Critical window.
    target.critical = false;
    target.criticalTurns = 0;
    target.hp = Math.max(1, Math.round(target.maxHp * 0.15));
    clearStatus(target, 'bleeding');
    sink.push({ t: 'stabilised', unitId: target.id, at: target.pos });
  } else {
    target.hp = Math.min(target.maxHp, target.hp + amount);
    clearStatus(target, 'bleeding');
  }

  if (medic.kind === 'merc') {
    const gain = xpGain(amount * XP_AWARDS.healPoint + 10, medic.attrs.wisdom, mods);
    medic.xp += gain;
    sink.push({ t: 'xp', unitId: medic.id, amount: gain, reason: 'Medicine', at: medic.pos });
  }
  return amount;
}

// ─────────────────────────────────────────────────────────────── interrupts

/**
 * Rolled when an enemy moves within a reserved unit's view. Reserve AP is the cost of
 * staying alert instead of spending everything on your own turn.
 */
export function tryInterrupt(b: BattleState, watcher: Unit, mover: Unit): boolean {
  if (watcher.reserve <= 0 || !watcher.alive || watcher.critical) return false;
  if (watcher.team === mover.team) return false;
  const w = activeWeapon(watcher);
  if (!w || (w.def.cls !== 'melee' && w.inst.loaded <= 0)) return false;
  if (!hasLineOfSight(b, watcher.pos, mover.pos, w.rangeMax)) return false;

  const rng = Rng.restore(b.rngState);
  const mods = unitMods(watcher);
  const skill = watcher.attrs.agility + watcher.attrs.marksmanship;
  const chance = Math.min(0.9, 0.15 + skill * 0.03 + mods.interruptChance - mover.attrs.agility * 0.02);
  const won = rng.chance(chance);
  b.rngState = rng.state;
  return won;
}

/** Units on this tile that could interrupt a mover passing through. */
export function watchersOf(b: BattleState, mover: Unit): Unit[] {
  return b.units.filter(
    (u) => u.alive && !u.critical && u.team !== mover.team && u.reserve > 0 && hasStatus(u, 'overwatch'),
  );
}

export { unitAt };
