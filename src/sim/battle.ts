/**
 * Turn flow and the player-facing action API. Every mutation of a battle goes through a
 * function in here, so the UI, the AI, and the balance harness all drive the game the
 * same way — and any of them can be swapped out without the others noticing.
 */
import { Rng } from '@/core/rng';
import { chebyshev, facingBetween, type Vec2 } from '@/core/grid';
import { EventSink } from './events';
import {
  activeWeapon,
  addStatus,
  clearStatus,
  fireAt,
  hasStatus,
  healUnit,
  meleeAt,
  resolveWeapon,
  tryInterrupt,
  unitMods,
} from './combat';
import {
  decayNoise,
  emitNoise,
  findPath,
  isPassable,
  stepCost,
  unitAt,
} from './field';
import {
  levelFromXp,
  maxApFor,
  XP_AWARDS,
  xpGain,
} from './progression';
import { refreshEnemyAp } from './spawn';
import {
  STANCE_TABLE,
  type BattleState,
  type LogEntry,
  type Objective,
  type Phase,
  type Stance,
  type Unit,
} from './types';
import type { CombatEvent } from './events';

/** Phases run in this order; each wraps back to 'player' and increments the turn counter. */
const PHASE_ORDER: readonly Phase[] = ['player', 'ally', 'enemy', 'zombie'];

const TEAM_OF_PHASE: Record<Phase, Unit['team']> = {
  player: 'player',
  ally: 'ally',
  enemy: 'enemy',
  zombie: 'zombie',
};

export function log(b: BattleState, text: string, tone: LogEntry['tone'] = 'info'): void {
  b.log.push({ turn: b.turn, text, tone });
  if (b.log.length > 400) b.log.shift();
}

export function unitById(b: BattleState, id: string): Unit | undefined {
  return b.units.find((u) => u.id === id);
}

export function livingUnits(b: BattleState, team: Unit['team']): Unit[] {
  return b.units.filter((u) => u.alive && u.team === team);
}

/** Units that can still act this phase. Critical mercs are alive but cannot act. */
export function actableUnits(b: BattleState, team: Unit['team']): Unit[] {
  return b.units.filter((u) => u.alive && !u.critical && u.team === team && u.ap > 0);
}

// ─────────────────────────────────────────────────────────────── action results

export interface ActionResult {
  ok: boolean;
  /** Why it failed, for the UI to surface. */
  reason?: string;
  events: CombatEvent[];
}

const fail = (reason: string): ActionResult => ({ ok: false, reason, events: [] });

// ─────────────────────────────────────────────────────────────── movement

/**
 * Move along a path, spending AP per step. The move stops early if an enemy on overwatch
 * wins an interrupt — that is the whole reason reserve AP is worth keeping.
 */
export function moveUnit(b: BattleState, u: Unit, goal: Vec2, sink = new EventSink()): ActionResult {
  if (!u.alive || u.critical) return fail('Unit cannot act');
  const { tiles } = findPath(b, u, goal, u.ap);
  if (tiles.length === 0) return fail('No path');

  const mods = unitMods(u);
  const walked: Vec2[] = [];
  let spent = 0;

  for (const step of tiles) {
    const cost = Math.ceil(stepCost(b, u, u.pos, step) * mods.moveCostMul);
    if (cost > u.ap) break;
    if (!isPassable(b, step.x, step.y, u)) break;

    u.ap -= cost;
    spent += cost;
    u.facing = facingBetween(u.pos, step);
    u.pos = step;
    walked.push(step);

    // Moving costs stamina and makes noise. Prone crawling is quiet; running is not.
    const staminaCost = (u.stance === 'standing' ? 2 : u.stance === 'crouched' ? 1 : 1) * mods.staminaCostMul;
    u.stamina = Math.max(0, u.stamina - staminaCost);
    const noise = Math.round(
      (u.stance === 'standing' ? 6 : u.stance === 'crouched' ? 3 : 1) * mods.noiseMul,
    );
    emitNoise(b, u.pos, noise);

    // Overwatch check after each tile.
    let interrupted = false;
    for (const w of b.units) {
      if (!w.alive || w.critical || w.team === u.team) continue;
      if (!hasStatus(w, 'overwatch')) continue;
      if (!tryInterrupt(b, w, u)) continue;
      sink.push({ t: 'interrupt', unitId: w.id, at: w.pos });
      clearStatus(w, 'overwatch');
      const reserve = w.reserve;
      w.ap = reserve;
      w.reserve = 0;
      fireAt(b, w, u, { mode: 'single', aim: 1, part: 'torso' }, sink);
      if (w.kind === 'merc') {
        const g = xpGain(XP_AWARDS.interrupt, w.attrs.wisdom, unitMods(w));
        w.xp += g;
        sink.push({ t: 'xp', unitId: w.id, amount: g, reason: 'Interrupt', at: w.pos });
      }
      interrupted = true;
      break;
    }
    if (interrupted || !u.alive || u.critical) break;
  }

  if (walked.length === 0) return fail('Not enough AP');
  sink.push({ t: 'move', unitId: u.id, path: walked, cost: spent });
  return { ok: true, events: sink.events };
}

// ─────────────────────────────────────────────────────────────── stance

export function setStance(b: BattleState, u: Unit, stance: Stance, sink = new EventSink()): ActionResult {
  if (u.stance === stance) return fail('Already in that stance');
  if (u.critical) return fail('Unit is down');
  const mods = unitMods(u);
  // Cost is the target stance's own cost, so standing up from prone is the expensive part.
  const cost = Math.max(
    1,
    Math.ceil(Math.max(STANCE_TABLE[stance].changeAP, STANCE_TABLE[u.stance].changeAP) + mods.stanceApCost),
  );
  if (u.ap < cost) return fail('Not enough AP');
  u.ap -= cost;
  u.stance = stance;
  sink.push({ t: 'stance', unitId: u.id, stance });
  return { ok: true, events: sink.events };
}

// ─────────────────────────────────────────────────────────────── attacks

export function shoot(
  b: BattleState,
  u: Unit,
  target: Unit,
  plan: Parameters<typeof fireAt>[3],
  sink = new EventSink(),
): ActionResult {
  if (!u.alive || u.critical) return fail('Unit cannot act');
  if (!target.alive) return fail('Target is down');
  const w = activeWeapon(u);
  if (!w) return fail('No weapon');
  if (w.def.cls === 'melee') return melee(b, u, target, sink);
  if (w.inst.loaded <= 0) return fail('Empty magazine');

  const out = fireAt(b, u, target, plan, sink);
  if (out.fired === 0 && !out.jammed) return fail('Shot not possible');
  return { ok: true, events: sink.events };
}

export function melee(b: BattleState, u: Unit, target: Unit, sink = new EventSink()): ActionResult {
  if (chebyshev(u.pos, target.pos) > 1) return fail('Out of reach');
  const out = meleeAt(b, u, target, sink);
  if (out.fired === 0) return fail('Not enough AP');
  return { ok: true, events: sink.events };
}

export function reload(b: BattleState, u: Unit, sink = new EventSink()): ActionResult {
  const w = activeWeapon(u);
  if (!w || w.def.cls === 'melee') return fail('Nothing to reload');
  if (w.inst.loaded >= w.magSize) return fail('Already full');
  const mods = unitMods(u);
  const cost = Math.max(1, Math.ceil(4 + mods.reloadApCost));
  if (u.ap < cost) return fail('Not enough AP');
  u.ap -= cost;
  w.inst.loaded = w.magSize;
  emitNoise(b, u.pos, 2);
  sink.push({ t: 'reload', unitId: u.id, at: u.pos });
  return { ok: true, events: sink.events };
}

/** Bank remaining AP as interrupt reserve and watch for movers. */
export function overwatch(b: BattleState, u: Unit, sink = new EventSink()): ActionResult {
  if (u.ap < 2) return fail('Not enough AP');
  const w = activeWeapon(u);
  if (!w) return fail('No weapon');
  u.reserve = Math.min(6, u.ap);
  u.ap = 0;
  addStatus(u, 'overwatch', 1);
  sink.push({ t: 'status', unitId: u.id, at: u.pos, kind: 'overwatch', applied: true });
  return { ok: true, events: sink.events };
}

export function bandage(b: BattleState, medic: Unit, target: Unit, sink = new EventSink()): ActionResult {
  if (chebyshev(medic.pos, target.pos) > 1) return fail('Too far away');
  const cost = target.critical ? 6 : 4;
  if (medic.ap < cost) return fail('Not enough AP');
  medic.ap -= cost;
  healUnit(b, medic, target, target.critical ? 0 : 18, sink);
  return { ok: true, events: sink.events };
}

// ─────────────────────────────────────────────────────────────── turn cycle

/** Refresh AP and stamina for a team at the start of its phase. */
function beginPhaseFor(b: BattleState, team: Unit['team'], sink: EventSink): void {
  for (const u of b.units) {
    if (!u.alive || u.team !== team) continue;
    const mods = unitMods(u);

    if (u.critical) {
      // The Critical countdown only runs on the unit's own phase, so a downed merc
      // genuinely gets three of their own turns to be reached.
      u.criticalTurns--;
      if (u.criticalTurns <= 0) {
        u.alive = false;
        u.critical = false;
        sink.push({ t: 'kill', unitId: u.id, at: u.pos, by: '', headshot: false });
        log(b, `${u.name} bled out.`, 'bad');
      }
      u.ap = 0;
      continue;
    }

    // Mercs derive AP from agility; enemies use the value authored on their def, so a
    // shambler stays slow and a runner stays fast regardless of their attribute spread.
    if (u.kind === 'merc') u.maxAp = maxApFor(u.attrs, mods);
    else refreshEnemyAp(u);
    let ap = u.maxAp;
    if (hasStatus(u, 'stunned')) ap = Math.floor(ap / 2);
    if (hasStatus(u, 'adrenaline')) ap += 2;
    if (hasStatus(u, 'inspired')) ap += 1;
    // Exhaustion bites into the action economy, not just accuracy.
    if (u.stamina < u.maxStamina * 0.2) ap = Math.max(2, ap - 2);
    u.ap = ap;
    u.reserve = 0;

    const regen = Math.round(u.maxStamina * 0.15 + mods.staminaRegen);
    u.stamina = Math.min(u.maxStamina, u.stamina + regen);
  }
}

/** Tick statuses and bleeding for a team at the END of its phase. */
function endPhaseFor(b: BattleState, team: Unit['team'], sink: EventSink): void {
  for (const u of b.units) {
    if (!u.alive || u.team !== team) continue;

    const bleed = u.statuses.find((s) => s.kind === 'bleeding');
    if (bleed) {
      const dmg = 2 * bleed.stacks;
      u.hp -= dmg;
      sink.push({ t: 'hit', unitId: u.id, at: u.pos, damage: dmg, part: 'torso', crit: false, overkill: false });
      if (u.hp <= 0) {
        u.hp = 0;
        if (u.kind === 'merc' && !u.critical) {
          u.critical = true;
          u.criticalTurns = 3;
          sink.push({ t: 'critical', unitId: u.id, at: u.pos });
        } else {
          u.alive = false;
          sink.push({ t: 'kill', unitId: u.id, at: u.pos, by: '', headshot: false });
          log(b, `${u.name} bled out.`, 'bad');
        }
      }
    }

    const poison = u.statuses.find((s) => s.kind === 'poisoned');
    if (poison) {
      u.hp = Math.max(0, u.hp - 3);
      u.stamina = Math.max(0, u.stamina - 8);
    }

    for (const s of u.statuses) {
      if (s.turns > 0) s.turns--;
    }
    u.statuses = u.statuses.filter((s) => s.turns !== 0);
    u.calm++;
  }
}

/** Advance to the next phase, wrapping to a new turn. Returns the phase now active. */
export function advancePhase(b: BattleState, sink = new EventSink()): Phase {
  endPhaseFor(b, TEAM_OF_PHASE[b.phase], sink);

  let idx = PHASE_ORDER.indexOf(b.phase);
  for (let i = 0; i < PHASE_ORDER.length; i++) {
    idx = (idx + 1) % PHASE_ORDER.length;
    const next = PHASE_ORDER[idx]!;
    if (idx === 0) {
      // Wrapped past the end of the round.
      b.turn++;
      decayNoise(b);
      emitLivingScent(b);
      tickObjectives(b, sink);
    }
    b.phase = next;
    const team = TEAM_OF_PHASE[next];
    if (livingUnits(b, team).length > 0) break;
  }

  beginPhaseFor(b, TEAM_OF_PHASE[b.phase], sink);
  sink.push({ t: 'phase', phase: b.phase, turn: b.turn });
  checkOutcome(b, sink);
  return b.phase;
}

/** How often the living give themselves away, in rounds. */
const SCENT_INTERVAL = 3;
/** Wide reach, so the gradient is followable from across the map. */
const SCENT_RADIUS = 30;
/**
 * Peak intensity, deliberately just below a single footstep (~0.15). Any real sound
 * outranks it, so a quiet squad still chooses when the fight happens — it just cannot
 * hide from the dead forever.
 */
const SCENT_PEAK = 0.13;

/**
 * The living are never entirely silent. Every few rounds each breathing unit leaks a faint,
 * wide signal that the dead drift toward.
 *
 * Without this, zombies with no sound to follow wander at random and a "clear all hostiles"
 * objective degenerates into hunting the last shambler across the whole map — measured at
 * 20% of battles stalling out. The intensity is far below any real noise, so a squad that
 * stays quiet still controls when the fight happens; it just cannot hide forever.
 */
function emitLivingScent(b: BattleState): void {
  if (b.turn % SCENT_INTERVAL !== 0) return;
  for (const u of b.units) {
    if (!u.alive || u.kind === 'zombie') continue;
    emitNoise(b, u.pos, SCENT_RADIUS, SCENT_PEAK);
  }
}

/** End the active unit's turn by zeroing its AP into reserve. */
export function endUnitTurn(b: BattleState, u: Unit): void {
  u.reserve = Math.min(6, u.ap);
  u.ap = 0;
}

// ─────────────────────────────────────────────────────────────── objectives

function tickObjectives(b: BattleState, sink: EventSink): void {
  for (const o of b.objectives) {
    if (o.done || o.failed) continue;
    if (o.kind === 'survive' && o.turns !== undefined) {
      o.turns--;
      if (o.turns <= 0) {
        o.done = true;
        sink.push({ t: 'objective', label: o.label, done: true });
      }
    }
  }
}

export function evaluateObjectives(b: BattleState, sink = new EventSink()): void {
  for (const o of b.objectives) {
    if (o.done || o.failed) continue;

    switch (o.kind) {
      case 'eliminate': {
        const hostiles = b.units.filter((u) => u.alive && (u.team === 'enemy' || u.team === 'zombie'));
        if (hostiles.length === 0) {
          o.done = true;
          sink.push({ t: 'objective', label: o.label, done: true });
        }
        break;
      }
      case 'reach': {
        if (!o.at) break;
        const there = b.units.some(
          (u) => u.alive && u.team === 'player' && u.pos.x === o.at!.x && u.pos.y === o.at!.y,
        );
        if (there) {
          o.done = true;
          sink.push({ t: 'objective', label: o.label, done: true });
        }
        break;
      }
      case 'protect': {
        const target = o.unitId ? unitById(b, o.unitId) : undefined;
        if (target && !target.alive) {
          o.failed = true;
          sink.push({ t: 'objective', label: o.label, done: false });
        }
        break;
      }
      case 'retrieve':
      case 'survive':
        break;
    }
  }
}

export function checkOutcome(b: BattleState, sink = new EventSink()): void {
  if (b.outcome !== 'ongoing') return;
  evaluateObjectives(b, sink);

  const squad = b.units.filter((u) => u.team === 'player' && u.alive);
  if (squad.length === 0 || squad.every((u) => u.critical)) {
    b.outcome = 'defeat';
    sink.push({ t: 'outcome', outcome: 'defeat' });
    return;
  }
  if (b.objectives.some((o) => o.failed)) {
    b.outcome = 'defeat';
    sink.push({ t: 'outcome', outcome: 'defeat' });
    return;
  }
  if (b.objectives.length > 0 && b.objectives.every((o) => o.done)) {
    b.outcome = 'victory';
    awardSurvivalXp(b, sink);
    sink.push({ t: 'outcome', outcome: 'victory' });
  }
}

function awardSurvivalXp(b: BattleState, sink: EventSink): void {
  for (const u of b.units) {
    if (!u.alive || u.team !== 'player' || u.kind !== 'merc') continue;
    const mods = unitMods(u);
    const gain = xpGain(XP_AWARDS.survived + XP_AWARDS.objective, u.attrs.wisdom, mods);
    u.xp += gain;
    sink.push({ t: 'xp', unitId: u.id, amount: gain, reason: 'Contract complete', at: u.pos });
  }
}

// ─────────────────────────────────────────────────────────────── levelling

export interface PendingLevelUp {
  unitId: string;
  newLevel: number;
}

/**
 * Detect mercs whose XP has outgrown their level. The caller (the UI) presents perk choices
 * and calls `applyLevelUp` — the sim never picks perks on the player's behalf.
 */
export function pendingLevelUps(b: BattleState): PendingLevelUp[] {
  const out: PendingLevelUp[] = [];
  for (const u of b.units) {
    if (u.kind !== 'merc') continue;
    const should = levelFromXp(u.xp);
    if (should > u.level) out.push({ unitId: u.id, newLevel: should });
  }
  return out;
}

export function applyLevelUp(
  b: BattleState,
  u: Unit,
  perkId: string | null,
  attribute: keyof Unit['attrs'] | null,
  sink = new EventSink(),
): void {
  u.level++;
  if (perkId && !u.perks.includes(perkId)) u.perks.push(perkId);
  if (attribute) u.attrs[attribute] = Math.min(10, u.attrs[attribute] + 1);

  const mods = unitMods(u);
  const gainedHp = 3;
  u.maxHp += gainedHp;
  u.hp += gainedHp;
  u.maxAp = maxApFor(u.attrs, mods);
  sink.push({ t: 'levelUp', unitId: u.id, level: u.level, at: u.pos });
  log(b, `${u.name} reached level ${u.level}.`, 'good');
}

// ─────────────────────────────────────────────────────────────── setup

export interface BattleInit {
  seed: number;
  w: number;
  h: number;
  light?: number;
  objectives?: Objective[];
}

export function createBattle(init: BattleInit): BattleState {
  const rng = new Rng(init.seed);
  return {
    seed: init.seed,
    rngState: rng.state,
    w: init.w,
    h: init.h,
    terrain: new Uint8Array(init.w * init.h),
    integrity: new Int16Array(init.w * init.h),
    decals: new Uint8Array(init.w * init.h),
    units: [],
    loot: [],
    objectives: init.objectives ?? [
      { kind: 'eliminate', label: 'Clear all hostiles', done: false, failed: false },
    ],
    phase: 'player',
    turn: 1,
    activeUnitId: null,
    noise: new Float32Array(init.w * init.h),
    light: init.light ?? 1,
    outcome: 'ongoing',
    log: [],
  };
}

/** Give every unit its opening AP and stamina. Call once after placing units. */
export function startBattle(b: BattleState, sink = new EventSink()): void {
  for (const u of b.units) {
    if (u.kind === 'merc') u.maxAp = maxApFor(u.attrs, unitMods(u));
    else refreshEnemyAp(u);
    u.ap = u.team === 'player' ? u.maxAp : 0;
    u.stamina = u.maxStamina;
  }
  b.phase = 'player';
  b.turn = 1;
  sink.push({ t: 'phase', phase: 'player', turn: 1 });
  log(b, 'Contact. Weapons free.', 'info');
}

export { resolveWeapon, unitAt };
