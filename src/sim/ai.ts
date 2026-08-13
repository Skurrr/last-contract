/**
 * Combat AI. Two brains behind one loop.
 *
 * The dead and the living are deliberately not the same code path:
 *
 *  - **Zombies** have no idea where you are. Their whole world model is the noise field
 *    (`b.noise`) plus a short line of sight. They walk uphill on sound, and when the map
 *    goes quiet they drift. Everything that makes suppressors and knives worth carrying
 *    falls out of that one rule.
 *  - **Humans** score candidate actions — shoot, reposition into cover, go prone, overwatch,
 *    break and run — and take the best one. They use the same `estimateShot` the player's
 *    tooltip shows, so they never cheat and never fire a shot the UI would call hopeless.
 *
 * Every mutation goes through the action functions in `battle.ts`, so interrupts, noise,
 * stamina and XP keep working. Every random draw goes through the battle's `rngState`, so a
 * fight replays byte-for-byte from its seed.
 */
import { Rng } from '@/core/rng';
import { chebyshev, dist, eq, unkey, type Vec2 } from '@/core/grid';
import { ENEMIES } from '@/data/enemies';
import { bark } from '@/data/barks';
import { EventSink } from './events';
import {
  activeWeapon,
  addStatus,
  applyDamage,
  estimateShot,
  hasStatus,
  unitMods,
  type ResolvedWeapon,
  type ShotEstimate,
  type ShotPlan,
} from './combat';
import {
  endUnitTurn,
  melee,
  moveUnit,
  overwatch,
  reload,
  setStance,
  shoot,
} from './battle';
import {
  coverAgainst,
  emitNoise,
  findPath,
  inBounds,
  isPassable,
  loudestStep,
  noiseAt,
  reachable,
  sightRange,
  stepCost,
  traceSight,
  type CoverLevel,
} from './field';
import { senseRadiusOf } from './spawn';
import {
  BODY_PART_TABLE,
  type BattleState,
  type BodyPart,
  type Team,
  type Unit,
} from './types';

// ─────────────────────────────────────────────────────────────── tunables

/** Hard cap on actions per unit per turn. Belt and braces against a scoring stalemate. */
const MAX_ACTIONS_PER_TURN = 12;

/**
 * Noise below this is background hiss — not worth crossing a street for. Intensity is
 * absolute (see `emitNoise`): a knife is ~0.07 at the tile it happened on, a footstep 0.15,
 * a rifle 0.55 at the muzzle. So this floor means "a zombie standing on top of a quiet kill
 * notices; nobody else does".
 */
const NOISE_FLOOR = 0.07;

/** How far a zombie will scan the noise field for a destination. */
const NOISE_SCAN = 20;

/** A wander leg is this many tiles before the drift direction is reconsidered. */
const WANDER_LEG = 6;
const WANDER_TURN_CHANCE = 0.25;

/** The screamer's horde call, in tiles of noise radius. */
const HORDE_CALL_RADIUS = 30;
/** Marker parked in `inventory` so a screamer only calls once, and survives a save. */
const SCREAMED_MARK = '__screamed';

/** Below this hit chance a shot is not worth the ammunition. */
const MIN_SHOT_CHANCE = 0.18;
/** Called head shots need a genuinely good chance, not a hopeful one. */
const MIN_HEAD_CHANCE = 0.45;
const MIN_CALLED_CHANCE = 0.4;
/** Below this action score, shooting loses to repositioning. */
const SHOOT_THRESHOLD = 0.1;
/** A new tile must beat the current one by this much before a unit gives up its ground. */
const MOVE_IMPROVEMENT = 0.35;

/** What standing on each cover level is worth, per threat that can see you. */
const COVER_VALUE: Record<CoverLevel, number> = { 0: -1.0, 1: 0.7, 2: 1.5 };

/** Weapons this long want a stable firing position. */
const LONG_RANGE = 10;

// ─────────────────────────────────────────────────────────────── public API

/**
 * Act for every unit of the phase whose turn it is. Units act in roster order, which keeps
 * the whole turn deterministic; leftover AP is banked as interrupt reserve.
 */
export function runAiTurn(b: BattleState, sink: EventSink): void {
  const team = b.phase as Team;
  const ctx = makeCtx(b);
  // Snapshot the roster: a unit dying mid-turn must not reshuffle who acts next.
  const roster = b.units.filter((u) => u.alive && !u.critical && u.team === team);

  for (const u of roster) {
    if (b.outcome !== 'ongoing') break;
    if (!u.alive || u.critical) continue;
    b.activeUnitId = u.id;
    runUnit(b, u, sink, ctx);
  }
  b.activeUnitId = null;
}

/**
 * Run one unit until it is out of AP or out of ideas, then bank what is left as interrupt
 * reserve. Returns whether it did anything. This is the entry point the battle controller
 * uses to step the AI one unit at a time.
 */
export function takeAiAction(b: BattleState, u: Unit, sink: EventSink): boolean {
  return runUnit(b, u, sink, makeCtx(b));
}

function runUnit(b: BattleState, u: Unit, sink: EventSink, ctx: AiCtx): boolean {
  const acted = act(b, u, sink, ctx);
  // Overwatch already moved the AP into reserve; endUnitTurn would wipe it.
  if (u.alive && !u.critical && !hasStatus(u, 'overwatch')) endUnitTurn(b, u);
  return acted;
}

/**
 * A bloater's parting gift: a cloud of Fever gas that hurts and poisons the living and
 * leaves the dead alone. Exposed for `battle.ts` to call on death — the AI never kills.
 */
export function bloaterDeathExplosion(b: BattleState, u: Unit, sink: EventSink): void {
  const def = ENEMIES[u.defId];
  if (def && def.special !== 'gas_burst') return;

  const radius = 3;
  const damage = 12;
  const rng = Rng.restore(b.rngState);
  sink.push({ t: 'explosion', at: u.pos, radius, damage });

  for (const t of b.units) {
    if (!t.alive || t.kind === 'zombie') continue;
    const d = dist(u.pos, t.pos);
    if (d > radius) continue;
    // Gas seeps: a wall halves it rather than stopping it.
    const falloff = 1 - d / (radius + 1);
    const blocked = traceSight(b, u.pos, t.pos).clear ? 1 : 0.5;
    applyDamage(b, rng, t, rng.variance(damage * falloff * blocked, 0.2), 'torso', 6, sink, u);
    if (t.alive && addStatus(t, 'poisoned', 3)) {
      sink.push({ t: 'status', unitId: t.id, at: t.pos, kind: 'poisoned', applied: true });
    }
  }

  emitNoise(b, u.pos, 10);
  sink.push({ t: 'noise', at: u.pos, radius: 10 });
  b.rngState = rng.state;
}

// ─────────────────────────────────────────────────────────────── shared plumbing

/**
 * Per-turn context. The noise snapshot is the important part: units make noise as they walk,
 * so without a frozen copy a zombie would chase its own footprints and stall on the spot.
 */
interface AiCtx {
  noise: Float32Array;
}

/**
 * What one unit has already done during this activation. Without it, "stand up to move" and
 * "get down to shoot" happily trade the same AP back and forth until the action cap trips.
 */
interface Memo {
  stances: number;
  moves: number;
}

function makeCtx(b: BattleState): AiCtx {
  return { noise: Float32Array.from(b.noise) };
}

function snapNoise(b: BattleState, ctx: AiCtx, x: number, y: number): number {
  if (!inBounds(b, x, y)) return 0;
  return ctx.noise[y * b.w + x] ?? 0;
}

/** Draw from the battle RNG and write the state back, exactly as combat.ts does. */
function withRng<T>(b: BattleState, fn: (r: Rng) => T): T {
  const rng = Rng.restore(b.rngState);
  const out = fn(rng);
  b.rngState = rng.state;
  return out;
}

function act(b: BattleState, u: Unit, sink: EventSink, ctx: AiCtx): boolean {
  if (!u.alive || u.critical || b.outcome !== 'ongoing') return false;
  const memo: Memo = { stances: 0, moves: 0 };
  let acted = false;

  for (let i = 0; i < MAX_ACTIONS_PER_TURN; i++) {
    if (u.ap <= 0 || !u.alive || u.critical) break;
    const apBefore = u.ap;
    const did = isDead(u) ? zombieStep(b, u, sink, ctx, memo) : humanStep(b, u, sink, ctx, memo);
    if (!did) break;
    acted = true;
    // Anything that "worked" without spending AP would loop forever. Stop instead.
    if (u.ap >= apBefore) break;
  }
  return acted;
}

const isDead = (u: Unit): boolean => u.kind === 'zombie' || ENEMIES[u.defId]?.family === 'zombie';

const squadSide = (t: Team): boolean => t === 'player' || t === 'ally';

/**
 * Who this unit will attack. The dead attack anything warm — raiders included, which is
 * what makes a three-way fight in a ruin worth setting up.
 */
function isHostile(u: Unit, o: Unit): boolean {
  if (u.id === o.id) return false;
  if (isDead(u)) return !isDead(o);
  if (isDead(o)) return true;
  return squadSide(u.team) !== squadSide(o.team);
}

function hostilesOf(b: BattleState, u: Unit): Unit[] {
  return b.units.filter((t) => t.alive && isHostile(u, t));
}

function canSee(b: BattleState, u: Unit, at: Vec2, range: number): boolean {
  if (chebyshev(u.pos, at) > range) return false;
  return traceSight(b, u.pos, at).clear;
}

/** Nearest of a list, ties broken by id so the choice is stable across replays. */
function nearest(from: Vec2, list: readonly Unit[]): Unit | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  for (const t of list) {
    const d = chebyshev(from, t.pos);
    if (d < bestD || (d === bestD && best && t.id < best.id)) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/**
 * Walk as far along the path to `goal` as AP allows, stopping short if it cannot be reached
 * this turn. Mirrors `moveUnit`'s own cost accounting so the prefix we pick is affordable.
 */
function advanceToward(b: BattleState, u: Unit, goal: Vec2, sink: EventSink): boolean {
  if (eq(u.pos, goal)) return false;
  if (u.ap < cheapestStep(b, u)) return false; // cannot afford a single tile — skip the A*
  const path = findPath(b, u, goal);
  if (path.tiles.length === 0) return false;

  const moveMul = unitMods(u).moveCostMul;
  let spent = 0;
  let from = u.pos;
  let dest: Vec2 | null = null;
  for (const t of path.tiles) {
    const c = spent + Math.ceil(stepCost(b, u, from, t) * moveMul);
    if (c > u.ap) break;
    spent = c;
    from = t;
    dest = t;
  }
  if (!dest) return false;
  return moveUnit(b, u, dest, sink).ok;
}

/** AP for the cheapest single step available, or Infinity when boxed in. */
function cheapestStep(b: BattleState, u: Unit): number {
  const moveMul = unitMods(u).moveCostMul;
  let best = Infinity;
  for (const d of FACING_DIR) {
    const p = { x: u.pos.x + d.x, y: u.pos.y + d.y };
    if (!isPassable(b, p.x, p.y, u)) continue;
    best = Math.min(best, Math.ceil(stepCost(b, u, u.pos, p) * moveMul));
  }
  return best;
}

/** Close on a unit: path to the cheapest free tile beside it. */
function advanceOnUnit(b: BattleState, u: Unit, target: Unit, sink: EventSink): boolean {
  const ring: Vec2[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const p = { x: target.pos.x + dx, y: target.pos.y + dy };
      if (isPassable(b, p.x, p.y, u)) ring.push(p);
    }
  }
  // Nearest approach tile first; ties by coordinate so it is deterministic.
  ring.sort((a, c) =>
    chebyshev(u.pos, a) - chebyshev(u.pos, c) || a.y - c.y || a.x - c.x,
  );
  for (const p of ring) {
    if (eq(p, u.pos)) return false; // already adjacent
    if (advanceToward(b, u, p, sink)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════ the dead

/**
 * The zombie ladder, in order:
 *   1. something warm adjacent  → bite it
 *   2. something warm sensed    → walk at it (screamers call the horde instead, once)
 *   3. noise                    → uphill on the sound
 *   4. silence                  → drift, remembering the direction in `u.target`
 */
function zombieStep(b: BattleState, u: Unit, sink: EventSink, ctx: AiCtx, memo: Memo): boolean {
  const def = ENEMIES[u.defId];

  // Crawlers live on the floor; everything else gets back on its feet.
  const wantStance = def?.special === 'low_profile' ? 'prone' : 'standing';
  if (u.stance !== wantStance && memo.stances === 0 && setStance(b, u, wantStance, sink).ok) {
    memo.stances++;
    return true;
  }

  const prey = b.units.filter((t) => t.alive && isHostile(u, t));

  // 1 ── adjacent: bite. Weakest neighbour first, so a wounded merc gets finished.
  const adjacent = prey.filter((t) => chebyshev(u.pos, t.pos) <= 1);
  if (adjacent.length > 0) {
    let victim = adjacent[0]!;
    for (const t of adjacent) if (t.hp < victim.hp || (t.hp === victim.hp && t.id < victim.id)) victim = t;
    // If the bite fails it is for want of AP — the turn is over either way.
    return melee(b, u, victim, sink).ok;
  }

  // 2 ── sensed: within the authored sense radius and in line of sight.
  const senseR = senseRadiusOf(u);
  const sensed = nearest(u.pos, prey.filter((t) => canSee(b, u, t.pos, senseR)));
  if (sensed) {
    if (def?.special === 'horde_call' && !hasScreamed(u)) return screamerCall(b, u, sensed, sink);
    u.target = sensed.pos; // remembered even after it breaks line of sight
    if (advanceOnUnit(b, u, sensed, sink)) return true;
  }

  // 2b ── chase the last known position of something it saw earlier this fight.
  const remembered = u.target;
  if (remembered && !eq(remembered, u.pos) && advanceToward(b, u, remembered, sink)) return true;
  if (remembered && eq(remembered, u.pos)) delete u.target;

  // 3 ── the noise field. `loudestStep` handles the immediate uphill neighbour; the scan
  // finds the source when the gradient next to us has already been trampled flat.
  const step = loudestStep(b, u.pos, u);
  if (step && noiseAt(b, step.x, step.y) >= NOISE_FLOOR) {
    if (moveUnit(b, u, step, sink).ok) return true;
  }
  const heard = loudestNearby(b, u, ctx, Math.min(senseR, NOISE_SCAN));
  if (heard) {
    u.target = heard;
    if (advanceToward(b, u, heard, sink)) return true;
  }

  // 4 ── silence. Drift.
  return wander(b, u, sink);
}

/**
 * Loudest tile within `radius` on the frozen noise map, or null if nothing out there is
 * worth walking to.
 *
 * The reference level is what this unit is already standing in — on the *live* field, so it
 * includes the footsteps it just made. A zombie will not cross the street for a sound
 * quieter than its own feet, and that one line is what stops the dead from following their
 * own trail back and forth forever.
 */
function loudestNearby(b: BattleState, u: Unit, ctx: AiCtx, radius: number): Vec2 | null {
  const here = Math.max(
    noiseAt(b, u.pos.x, u.pos.y),
    snapNoise(b, ctx, u.pos.x, u.pos.y),
  );
  let best: Vec2 | null = null;
  let bestV = Math.max(NOISE_FLOOR, here) + 0.02;
  let bestD = Infinity;

  for (let y = u.pos.y - radius; y <= u.pos.y + radius; y++) {
    for (let x = u.pos.x - radius; x <= u.pos.x + radius; x++) {
      if (!inBounds(b, x, y)) continue;
      const d = chebyshev(u.pos, { x, y });
      if (d === 0 || d > radius) continue;
      const v = snapNoise(b, ctx, x, y);
      if (v < bestV) continue;
      // Equal loudness: take the nearer tile, then the lower coordinate. Deterministic.
      if (v > bestV || d < bestD) {
        best = { x, y };
        bestV = v;
        bestD = d;
      }
    }
  }
  return best;
}

/** Compass offsets indexed by `Facing` (0 = east, clockwise). */
const FACING_DIR: readonly Vec2[] = [
  { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
  { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
];

/**
 * Aimless drift. The destination is persisted in `u.target` so a shambler keeps crossing the
 * street instead of vibrating in place; it only reconsiders on arrival or a rare turn.
 */
function wander(b: BattleState, u: Unit, sink: EventSink): boolean {
  const leg = ENEMIES[u.defId]?.special === 'gas_burst' ? 3 : WANDER_LEG; // bloaters barely drift
  const current = u.target;

  if (current && !eq(current, u.pos)) {
    const rethink = withRng(b, (r) => r.chance(WANDER_TURN_CHANCE * 0.5));
    if (!rethink && advanceToward(b, u, current, sink)) return true;
  }

  // Pick a fresh heading: mostly straight on, sometimes a lazy turn.
  const turn = withRng(b, (r) => (r.chance(WANDER_TURN_CHANCE) ? r.int(-2, 2) : 0));
  for (let attempt = 0; attempt < 8; attempt++) {
    const facing = (((u.facing + turn + attempt) % 8) + 8) % 8;
    const d = FACING_DIR[facing]!;
    const goal = {
      x: Math.max(0, Math.min(b.w - 1, u.pos.x + d.x * leg)),
      y: Math.max(0, Math.min(b.h - 1, u.pos.y + d.y * leg)),
    };
    if (eq(goal, u.pos)) continue;
    if (advanceToward(b, u, goal, sink)) {
      u.target = goal;
      return true;
    }
  }
  delete u.target;
  return false;
}

// ─────────────────────────────────────────────────────────────── screamer

const hasScreamed = (u: Unit): boolean => u.inventory.includes(SCREAMED_MARK);

/**
 * The horde call. Instead of attacking, a screamer converts the sight of you into a noise
 * source big enough to pull every zombie on the map — once, and then it is just a corpse
 * that runs at you like the rest.
 */
function screamerCall(b: BattleState, u: Unit, seen: Unit, sink: EventSink): boolean {
  u.inventory.push(SCREAMED_MARK);
  u.target = seen.pos;

  emitNoise(b, u.pos, HORDE_CALL_RADIUS);
  sink.push({ t: 'noise', at: u.pos, radius: HORDE_CALL_RADIUS });
  const line = withRng(b, (r) => bark('zombie', 'spotHorde', r.next()));
  if (line) sink.push({ t: 'bark', unitId: u.id, text: line });

  // Screaming is the whole turn.
  endUnitTurn(b, u);
  return true;
}

// ═══════════════════════════════════════════════════════════════ the living

interface ShotChoice {
  target: Unit;
  plan: ShotPlan;
  est: ShotEstimate;
  score: number;
}

/**
 * One human decision. In rough order: fix the gun, take a good shot, get behind something,
 * settle in, or watch a lane. A broken unit inverts the middle of that list and runs.
 */
function humanStep(b: BattleState, u: Unit, sink: EventSink, ctx: AiCtx, memo: Memo): boolean {
  const w = activeWeapon(u);
  const sight = sightRange(b, u);
  const hostiles = hostilesOf(b, u).filter((t) => !t.critical);
  const visible = hostiles.filter((t) => canSee(b, u, t.pos, sight));
  if (visible.length > 0) {
    const closest = nearest(u.pos, visible);
    if (closest) u.target = closest.pos;
  }

  // No firearm (cultists with a machete, or anyone disarmed): charge and swing.
  if (!w || w.def.cls === 'melee') return brawl(b, u, sink, hostiles, visible, memo);

  const broken = isBroken(b, u);

  // Dry magazine. Reloading in the open is bad, but an empty gun is worse.
  if (w.inst.loaded <= 0) {
    if (reload(b, u, sink).ok) return true;
    return hold(b, u, sink, visible, w, broken, memo);
  }

  const best = broken ? bestShot(b, u, visible.filter((t) => chebyshev(u.pos, t.pos) <= 2), w)
                      : bestShot(b, u, visible, w);
  if (best && best.score >= SHOOT_THRESHOLD) {
    return shoot(b, u, best.target, best.plan, sink).ok;
  }

  // Suppressed units keep their heads down rather than pushing into fire.
  const pinned = hasStatus(u, 'suppressed') &&
    visible.some((t) => coverAgainst(b, u.pos, t.pos) > 0);

  if (!pinned && visible.length > 0) {
    const moved = reposition(b, u, sink, visible, w, broken, memo);
    if (moved !== 'none') return moved === 'acted';
  }

  // Nothing in sight: walk toward whatever it can hear, or the last known contact.
  if (visible.length === 0 && !broken && memo.moves === 0) {
    const heard = nearest(u.pos, hostiles.filter((t) => chebyshev(u.pos, t.pos) <= senseRadiusOf(u)));
    if (heard && advanceOnUnit(b, u, heard, sink)) { memo.moves++; return true; }
    const remembered = u.target;
    if (remembered && !eq(remembered, u.pos) && advanceToward(b, u, remembered, sink)) {
      memo.moves++;
      return true;
    }
    const heardNoise = loudestNearby(b, u, ctx, NOISE_SCAN);
    if (heardNoise && advanceToward(b, u, heardNoise, sink)) { memo.moves++; return true; }
  }

  return hold(b, u, sink, visible, w, broken, memo);
}

/** Melee-only humans: a machete cultist has exactly one plan and commits to it. */
function brawl(
  b: BattleState,
  u: Unit,
  sink: EventSink,
  hostiles: readonly Unit[],
  visible: readonly Unit[],
  memo: Memo,
): boolean {
  const adjacent = hostiles.filter((t) => chebyshev(u.pos, t.pos) <= 1);
  const victim = adjacent.length > 0 ? nearest(u.pos, adjacent) : null;
  if (victim) return melee(b, u, victim, sink).ok;

  if (u.stance !== 'standing' && memo.stances === 0 && setStance(b, u, 'standing', sink).ok) {
    memo.stances++;
    return true;
  }
  const quarry = nearest(u.pos, visible.length > 0 ? visible : hostiles);
  if (quarry && advanceOnUnit(b, u, quarry, sink)) return true;
  const remembered = u.target;
  return remembered !== undefined && advanceToward(b, u, remembered, sink);
}

/** Settle: drop into a stable stance with a long gun, otherwise watch a lane. */
function hold(
  b: BattleState,
  u: Unit,
  sink: EventSink,
  visible: readonly Unit[],
  w: ResolvedWeapon | null,
  broken: boolean,
  memo: Memo,
): boolean {
  const exposed = visible.some((t) => coverAgainst(b, u.pos, t.pos) === 0);

  // Long-range shooters and anyone caught in the open get low — but only if they have not
  // already spent AP standing up to move this activation.
  if (w && (w.rangeOptimal >= LONG_RANGE || exposed || broken) && u.stance === 'standing' && memo.stances === 0) {
    const want = w.rangeOptimal >= LONG_RANGE && !broken ? 'prone' : 'crouched';
    if (setStance(b, u, want, sink).ok) {
      memo.stances++;
      return true;
    }
  }
  if (broken) return false; // panicked units do not calmly cover a doorway

  if (w && w.inst.loaded < w.magSize * 0.4 && reload(b, u, sink).ok) return true;
  if (visible.length === 0 || !hasShotSomewhere(b, u, visible, w)) {
    if (overwatch(b, u, sink).ok) return true;
  }
  return false;
}

function hasShotSomewhere(
  b: BattleState,
  u: Unit,
  visible: readonly Unit[],
  w: ResolvedWeapon | null,
): boolean {
  if (!w || w.inst.loaded <= 0) return false;
  return visible.some((t) => estimateShot(b, u, t).chance >= MIN_SHOT_CHANCE);
}

// ─────────────────────────────────────────────────────────────── morale

/**
 * Breaking point: a bad wound, a bad day, or half the crew on the floor. Cultists and
 * zealots are written as fearless and never get here.
 */
function isBroken(b: BattleState, u: Unit): boolean {
  if (ENEMIES[u.defId]?.special === 'fearless') return false;
  if (hasStatus(u, 'panicked')) return true;
  if (u.morale < 25) return true;

  const side = b.units.filter((t) => t.team === u.team);
  const down = side.filter((t) => !t.alive || t.critical).length;
  const halfGone = side.length > 1 && down >= side.length / 2;
  return halfGone && (u.morale < 55 || u.hp < u.maxHp * 0.35);
}

// ─────────────────────────────────────────────────────────────── shooting

/** Candidate shot plans, cheapest first. Called shots are gated on being worth the AP. */
function candidatePlans(u: Unit, w: ResolvedWeapon, target: Unit): ShotPlan[] {
  const plans: ShotPlan[] = [];
  for (const mode of w.def.modes) {
    plans.push({ mode, aim: 0, part: 'torso' });
    plans.push({ mode, aim: 2, part: 'torso' });
  }
  // Head for the kill, legs to stop something closing.
  plans.push({ mode: 'single', aim: 2, part: 'head' });
  plans.push({ mode: 'single', aim: 3, part: 'head' });
  if (isCloser(u, target)) plans.push({ mode: 'single', aim: 1, part: 'legs' });
  return plans;
}

/** Something coming at us on foot: a zombie, or anything already close with a blade. */
function isCloser(u: Unit, target: Unit): boolean {
  if (chebyshev(u.pos, target.pos) > 12) return false;
  if (isDead(target)) return true;
  const w = activeWeapon(target);
  return !w || w.def.cls === 'melee';
}

function expectedDamage(u: Unit, w: ResolvedWeapon, target: Unit, est: ShotEstimate, part: BodyPart): number {
  const mods = unitMods(u);
  const armour = Math.max(
    0,
    (target.armour[part] ?? 0) + unitMods(target).armour - (w.penetration + mods.penetration),
  );
  const perHit = Math.max(1, w.damage * mods.damageMul * BODY_PART_TABLE[part].damage - armour);
  const rounds = w.def.cls === 'melee' ? est.perRound.length : Math.min(est.perRound.length, w.inst.loaded);
  let total = 0;
  for (let i = 0; i < rounds; i++) total += (est.perRound[i] ?? 0) * perHit;
  return total;
}

/**
 * Score every (target, plan) pair and return the best.
 *
 * The core term is expected damage as a fraction of the target's remaining HP — so a shot
 * that finishes a wounded raider beats a bigger shot that only dents a fresh one — divided
 * by how much more AP the plan costs than a plain shot.
 */
function bestShot(
  b: BattleState,
  u: Unit,
  targets: readonly Unit[],
  w: ResolvedWeapon,
): ShotChoice | null {
  let best: ShotChoice | null = null;

  for (const target of targets) {
    const adjacent = chebyshev(u.pos, target.pos) <= 1;
    const floor = adjacent ? MIN_SHOT_CHANCE * 0.5 : MIN_SHOT_CHANCE;

    for (const plan of candidatePlans(u, w, target)) {
      const est = estimateShot(b, u, target, plan);
      if (!est.hasLos || !est.hasAmmo || !est.inRange) continue;
      if (est.apCost > u.ap) continue;
      if (est.chance < floor) continue;
      if (plan.part === 'head' && est.chance < MIN_HEAD_CHANCE) continue;
      if (plan.part === 'legs' && est.chance < MIN_CALLED_CHANCE) continue;

      const expected = expectedDamage(u, w, target, est, plan.part);
      const lethality = expected / Math.max(1, target.hp);
      let value = Math.min(1.4, lethality);
      if (lethality >= 1) value += 0.7; // finish it

      // A hobbled runner stops being a problem; a stunned shooter loses its turn.
      if (plan.part === 'legs' && !hasStatus(target, 'hobbled')) value += 0.3;
      if (plan.part === 'head') value += 0.15;

      value *= dangerOf(u, target);
      // Ammunition is finite: burst and auto must earn their extra rounds.
      const apRatio = est.apCost / Math.max(1, w.apCost);
      const score = value / Math.max(0.75, apRatio);

      if (!best || score > best.score) best = { target, plan, est, score };
    }
  }
  return best;
}

/** How much this unit wants that one dead: closer is worse, and so is a bigger gun. */
function dangerOf(u: Unit, target: Unit): number {
  const d = chebyshev(u.pos, target.pos);
  let danger = 1 + Math.max(0, (14 - d) / 14) * 0.5;
  const w = activeWeapon(target);
  if (w && w.def.cls !== 'melee' && w.damage > 30) danger += 0.15;
  if (target.critical) danger *= 0.2;
  return danger;
}

// ─────────────────────────────────────────────────────────────── positioning

/**
 * Look for somewhere better to stand. Returns 'none' when the current tile is already the
 * best on offer, so the caller can fall through to holding.
 */
function reposition(
  b: BattleState,
  u: Unit,
  sink: EventSink,
  threats: readonly Unit[],
  w: ResolvedWeapon | null,
  retreat: boolean,
  memo: Memo,
): 'acted' | 'failed' | 'none' {
  if (memo.moves > 0) return 'none'; // one considered move per activation is enough

  // Prone and crouched units barely move; stand up before crossing ground.
  const needsLegs = retreat || threats.every((t) => chebyshev(u.pos, t.pos) > 3);
  if (u.stance !== 'standing' && needsLegs) {
    if (memo.stances > 0) return 'none';
    if (!setStance(b, u, 'standing', sink).ok) return 'none';
    memo.stances++;
    return 'acted';
  }

  const here = scoreTile(b, u, u.pos, threats, w, retreat, 0);
  const tiles = reachable(b, u, u.ap);
  let bestScore = here + MOVE_IMPROVEMENT;
  let bestAt: Vec2 | null = null;

  for (const [k, cost] of tiles) {
    const p = unkey(k);
    const s = scoreTile(b, u, p, threats, w, retreat, cost);
    if (s > bestScore) {
      bestScore = s;
      bestAt = p;
    }
  }

  if (!bestAt) return 'none';
  if (!moveUnit(b, u, bestAt, sink).ok) return 'failed';
  memo.moves++;
  return 'acted';
}

/**
 * What a tile is worth to this unit right now.
 *
 * Per threat that can see the tile: the cover it grants us (standing in the open is a
 * penalty, not a zero), a flanking bonus for angles that strip the *threat's* cover, and a
 * range term that keeps riflemen out of knife range and shotguns out of long lanes. Tiles no
 * threat can see are safe but useless — worth a lot when retreating, very little otherwise.
 * Movement cost is charged against the score so a unit does not spend its whole turn walking.
 */
function scoreTile(
  b: BattleState,
  u: Unit,
  at: Vec2,
  threats: readonly Unit[],
  w: ResolvedWeapon | null,
  retreat: boolean,
  cost: number,
): number {
  let score = 0;
  let seenBy = 0;

  for (const t of threats) {
    const danger = dangerOf(u, t);
    const d = chebyshev(at, t.pos);
    const los = d <= sightRange(b, t) && traceSight(b, at, t.pos).clear;

    if (!los) {
      score += (retreat ? 1.2 : 0.2) * danger;
      continue;
    }
    seenBy++;

    const cover = coverAgainst(b, at, t.pos);
    score += COVER_VALUE[cover] * danger;

    // Flanking: how much cover the threat keeps from this angle. Less is better.
    const theirCover = coverAgainst(b, t.pos, at);
    score += (theirCover === 0 ? 0.5 : theirCover === 1 ? 0.15 : -0.35) * danger;

    if (retreat) {
      // Distance is the whole plan when a unit breaks; it must clearly beat standing still.
      score -= 1.0 * danger;
      score += Math.min(2.5, d * 0.22) * danger;
    } else {
      score += rangeBand(d, w);
      // Being in contact with a melee threat while holding a rifle is a losing position.
      if (d <= 1 && w && w.def.cls !== 'melee') score -= 0.6;
    }
  }

  if (!retreat && seenBy === 0) score -= 1.5; // nothing to shoot from here
  // AP spent walking is AP not shooting — unless it is running, in which case that is fine.
  score -= cost * (retreat ? 0.02 : 0.06);
  return score;
}

function rangeBand(d: number, w: ResolvedWeapon | null): number {
  if (!w) return 0;
  if (d > w.rangeMax) return -1.2;
  if (d > w.rangeOptimal) return -0.6 * ((d - w.rangeOptimal) / Math.max(1, w.rangeMax - w.rangeOptimal));
  if (w.rangeOptimal >= LONG_RANGE && d < 4) return -0.4; // snipers hate contact
  return 0.6;
}
