/**
 * Battlefield queries: terrain access, walkability, line of sight, cover, pathfinding,
 * and noise propagation. Pure functions over BattleState — no mutation except where the
 * name says so (`emitNoise`, `decayNoise`, `damageTerrain`).
 */
import {
  DIRS4,
  DIRS8,
  chebyshev,
  isDiagonal,
  line,
  type Vec2,
} from '@/core/grid';
import {
  TERRAIN,
  TERRAIN_KINDS,
  type BattleState,
  type TerrainInfo,
  type TerrainKind,
  type Unit,
} from './types';

// ─────────────────────────────────────────────────────────────── terrain access

export function terrainAt(b: BattleState, x: number, y: number): TerrainKind {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return 'wall';
  return TERRAIN_KINDS[b.terrain[y * b.w + x] ?? 0] ?? 'floor';
}

export function infoAt(b: BattleState, x: number, y: number): TerrainInfo {
  return TERRAIN[terrainAt(b, x, y)];
}

export function setTerrain(b: BattleState, x: number, y: number, k: TerrainKind): void {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const i = y * b.w + x;
  b.terrain[i] = TERRAIN_KINDS.indexOf(k);
  b.integrity[i] = TERRAIN[k].integrity;
}

export function inBounds(b: BattleState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < b.w && y < b.h;
}

export function unitAt(b: BattleState, x: number, y: number): Unit | undefined {
  return b.units.find((u) => u.alive && u.pos.x === x && u.pos.y === y);
}

/** Walkable ignoring units — used for terrain reasoning and cover. */
export function isOpen(b: BattleState, x: number, y: number): boolean {
  return inBounds(b, x, y) && infoAt(b, x, y).walkable;
}

/** Walkable for a specific unit — blocked by living units of other teams. */
export function isPassable(b: BattleState, x: number, y: number, mover: Unit): boolean {
  if (!isOpen(b, x, y)) return false;
  const u = unitAt(b, x, y);
  if (!u) return true;
  // Squadmates can be squeezed past; enemies cannot.
  return u.team === mover.team && !u.critical;
}

// ─────────────────────────────────────────────────────────────── destruction

/** Returns true if the tile was destroyed by this damage. */
export function damageTerrain(b: BattleState, x: number, y: number, dmg: number): boolean {
  if (!inBounds(b, x, y)) return false;
  const i = y * b.w + x;
  const info = infoAt(b, x, y);
  if (info.integrity === 0) return false;
  const left = (b.integrity[i] ?? 0) - dmg;
  if (left > 0) {
    b.integrity[i] = left;
    return false;
  }
  // Windows and fences vanish; heavier cover collapses into rubble.
  const kind = terrainAt(b, x, y);
  setTerrain(b, x, y, kind === 'window' || kind === 'fence' ? 'floor' : 'rubble');
  emitNoise(b, { x, y }, info.breakNoise);
  return true;
}

// ─────────────────────────────────────────────────────────────── line of sight

export interface SightResult {
  clear: boolean;
  /** Tiles the shot passes through, endpoints included. */
  path: Vec2[];
  /** The tile that blocked it, if any. */
  blockedAt?: Vec2;
}

/**
 * Traces a line from `from` to `to`. Endpoints never block themselves, so a unit standing
 * behind sandbags can still shoot over them — cover reduces accuracy, it does not forbid
 * the shot. Only `blocksSight` terrain stops the trace.
 */
export function traceSight(b: BattleState, from: Vec2, to: Vec2): SightResult {
  const path = line(from, to);
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i]!;
    if (infoAt(b, p.x, p.y).blocksSight) {
      return { clear: false, path: path.slice(0, i + 1), blockedAt: p };
    }
  }
  return { clear: true, path };
}

export function hasLineOfSight(b: BattleState, from: Vec2, to: Vec2, maxRange: number): boolean {
  if (chebyshev(from, to) > maxRange) return false;
  return traceSight(b, from, to).clear;
}

/** Sight range in tiles, shortened by darkness and lengthened by being prone-and-still. */
export function sightRange(b: BattleState, u: Unit): number {
  const base = u.kind === 'zombie' ? 7 : 14;
  const lit = 0.45 + 0.55 * b.light;
  return Math.round(base * lit + u.attrs.wisdom * 0.3);
}

/** Every tile a unit can currently see. Used for fog of war and AI. */
export function visibleTiles(b: BattleState, u: Unit): Set<number> {
  const out = new Set<number>();
  const r = sightRange(b, u);
  for (let y = u.pos.y - r; y <= u.pos.y + r; y++) {
    for (let x = u.pos.x - r; x <= u.pos.x + r; x++) {
      if (!inBounds(b, x, y)) continue;
      if (chebyshev(u.pos, { x, y }) > r) continue;
      if (traceSight(b, u.pos, { x, y }).clear) out.add((y << 10) | x);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── cover

export type CoverLevel = 0 | 1 | 2;

export const COVER_MOD: Record<CoverLevel, number> = { 0: 1.0, 1: 0.75, 2: 0.55 };

/**
 * Cover the target enjoys against a shot coming from `from`.
 *
 * A tile gives cover only if the blocking terrain sits between the target and the shooter.
 * We test the target's neighbours whose offset points back toward the shooter — so moving
 * around a wall genuinely flanks it, without needing to store per-edge data.
 */
export function coverAgainst(b: BattleState, target: Vec2, from: Vec2): CoverLevel {
  const dx = from.x - target.x;
  const dy = from.y - target.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;

  let best: CoverLevel = 0;
  for (const d of DIRS8) {
    // Only neighbours facing the shooter count. 0.35 ≈ within ~70° of the shot line.
    const dl = Math.hypot(d.x, d.y);
    if ((d.x * nx + d.y * ny) / dl < 0.35) continue;
    const c = infoAt(b, target.x + d.x, target.y + d.y).cover;
    // Diagonal cover is worth less — it only clips the corner of the shot.
    const eff = (isDiagonal(d) ? Math.max(0, c - 1) : c) as CoverLevel;
    if (eff > best) best = eff;
  }
  return best;
}

// ─────────────────────────────────────────────────────────────── movement cost

export const AP_ORTHO = 2;
export const AP_DIAG = 3;

/** AP to step from `a` onto adjacent `b`, including stance and terrain penalties. */
export function stepCost(bs: BattleState, u: Unit, from: Vec2, to: Vec2): number {
  const base = isDiagonal({ x: to.x - from.x, y: to.y - from.y }) ? AP_DIAG : AP_ORTHO;
  const terrain = infoAt(bs, to.x, to.y).moveCost;
  // A natural crawler pays no prone penalty — dragging itself along IS its walking pace.
  const stanceMul =
    u.stance === 'prone' ? (u.naturalProne ? 1 : 3) : u.stance === 'crouched' ? 1.5 : 1;
  const hobbled = u.statuses.some((s) => s.kind === 'hobbled') ? 2 : 1;
  return Math.ceil((base + terrain) * stanceMul * hobbled);
}

// ─────────────────────────────────────────────────────────────── pathfinding

export interface PathResult {
  /** Tiles from start (exclusive) to goal (inclusive). Empty if unreachable. */
  tiles: Vec2[];
  cost: number;
}

/**
 * A* over the AP cost function. Prone units are restricted to cardinal moves, which is
 * what makes crawling feel as heavy as it should.
 */
export function findPath(
  b: BattleState,
  u: Unit,
  goal: Vec2,
  budget = Infinity,
): PathResult {
  const start = u.pos;
  if (start.x === goal.x && start.y === goal.y) return { tiles: [], cost: 0 };
  if (!inBounds(b, goal.x, goal.y)) return { tiles: [], cost: 0 };

  const dirs = u.stance === 'prone' ? DIRS4 : DIRS8;
  const startKey = (start.y << 10) | start.x;
  const goalKey = (goal.y << 10) | goal.x;

  const gScore = new Map<number, number>([[startKey, 0]]);
  const cameFrom = new Map<number, number>();
  // Simple binary heap keyed on f.
  const heap: { k: number; f: number }[] = [{ k: startKey, f: 0 }];
  const closed = new Set<number>();

  const push = (k: number, f: number): void => {
    heap.push({ k, f });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.f <= heap[i]!.f) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = (): { k: number; f: number } | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < heap.length && heap[l]!.f < heap[s]!.f) s = l;
        if (r < heap.length && heap[r]!.f < heap[s]!.f) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i]!, heap[s]!];
        i = s;
      }
    }
    return top;
  };

  while (heap.length > 0) {
    const cur = pop()!;
    if (closed.has(cur.k)) continue;
    closed.add(cur.k);

    if (cur.k === goalKey) break;

    const cx = cur.k & 1023;
    const cy = cur.k >> 10;
    const g = gScore.get(cur.k) ?? 0;

    for (const d of dirs) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (!isPassable(b, nx, ny, u)) continue;
      // No cutting corners diagonally through two blocked tiles.
      if (isDiagonal(d) && !isOpen(b, cx + d.x, cy) && !isOpen(b, cx, cy + d.y)) continue;

      const nk = (ny << 10) | nx;
      if (closed.has(nk)) continue;
      const ng = g + stepCost(b, u, { x: cx, y: cy }, { x: nx, y: ny });
      if (ng > budget) continue;
      if (ng >= (gScore.get(nk) ?? Infinity)) continue;

      gScore.set(nk, ng);
      cameFrom.set(nk, cur.k);
      push(nk, ng + chebyshev({ x: nx, y: ny }, goal) * AP_ORTHO);
    }
  }

  if (!gScore.has(goalKey)) return { tiles: [], cost: 0 };

  const tiles: Vec2[] = [];
  let k = goalKey;
  while (k !== startKey) {
    tiles.push({ x: k & 1023, y: k >> 10 });
    const prev = cameFrom.get(k);
    if (prev === undefined) return { tiles: [], cost: 0 };
    k = prev;
  }
  tiles.reverse();
  return { tiles, cost: gScore.get(goalKey) ?? 0 };
}

/** Every tile reachable within `budget` AP, mapped to its cost. Drives the move overlay. */
export function reachable(b: BattleState, u: Unit, budget: number): Map<number, number> {
  const dirs = u.stance === 'prone' ? DIRS4 : DIRS8;
  const startKey = (u.pos.y << 10) | u.pos.x;
  const cost = new Map<number, number>([[startKey, 0]]);
  // Costs are small integers, so a bucket queue beats a heap here.
  const buckets: number[][] = [[startKey]];

  for (let c = 0; c < buckets.length; c++) {
    const bucket = buckets[c];
    if (!bucket) continue;
    for (const k of bucket) {
      if ((cost.get(k) ?? Infinity) < c) continue;
      const cx = k & 1023;
      const cy = k >> 10;
      for (const d of dirs) {
        const nx = cx + d.x;
        const ny = cy + d.y;
        if (!isPassable(b, nx, ny, u)) continue;
        if (isDiagonal(d) && !isOpen(b, cx + d.x, cy) && !isOpen(b, cx, cy + d.y)) continue;
        const nc = c + stepCost(b, u, { x: cx, y: cy }, { x: nx, y: ny });
        if (nc > budget) continue;
        const nk = (ny << 10) | nx;
        if (nc >= (cost.get(nk) ?? Infinity)) continue;
        cost.set(nk, nc);
        while (buckets.length <= nc) buckets.push([]);
        buckets[nc]!.push(nk);
      }
    }
  }
  cost.delete(startKey);
  return cost;
}

// ─────────────────────────────────────────────────────────────── noise

/**
 * Reference radius that maps to full intensity. Anything at or above this (an explosion)
 * saturates the field; everything quieter writes proportionally less.
 */
const NOISE_REFERENCE = 40;

/**
 * Noise is the zombie AI's entire world model. A sound writes a decaying gradient into
 * the noise field; zombies walk uphill on it. Suppressors and melee matter because they
 * write a much smaller gradient, not because of a special-case rule.
 *
 * Intensity is absolute rather than normalised per-source — otherwise every sound would peak
 * at 1.0 at its origin, and a footstep next to a zombie would outrank a rifle across the
 * street. Encoding real loudness is what makes a suppressor a tactical choice.
 */
export function emitNoise(b: BattleState, at: Vec2, radius: number): void {
  if (radius <= 0) return;
  const r = Math.ceil(radius);
  for (let y = at.y - r; y <= at.y + r; y++) {
    for (let x = at.x - r; x <= at.x + r; x++) {
      if (!inBounds(b, x, y)) continue;
      const d = Math.hypot(x - at.x, y - at.y);
      if (d > radius) continue;
      // Walls muffle sound: each blocking tile on the path costs a chunk of intensity.
      const trace = line(at, { x, y });
      let muffle = 0;
      for (let i = 1; i < trace.length - 1; i++) {
        const p = trace[i]!;
        if (infoAt(b, p.x, p.y).blocksSight) muffle += 2.5;
      }
      const v = Math.min(1, Math.max(0, (radius - d - muffle) / NOISE_REFERENCE));
      const i = y * b.w + x;
      if (v > (b.noise[i] ?? 0)) b.noise[i] = v;
    }
  }
}

export function noiseAt(b: BattleState, x: number, y: number): number {
  if (!inBounds(b, x, y)) return 0;
  return b.noise[y * b.w + x] ?? 0;
}

/** Called once per round. Sound fades, so zombies lose interest and wander. */
export function decayNoise(b: BattleState, factor = 0.72): void {
  for (let i = 0; i < b.noise.length; i++) {
    const v = (b.noise[i] ?? 0) * factor;
    b.noise[i] = v < 0.02 ? 0 : v;
  }
}

/** The loudest adjacent tile a unit could step to. Zombies follow this gradient. */
export function loudestStep(b: BattleState, from: Vec2, u: Unit): Vec2 | null {
  let best: Vec2 | null = null;
  let bestV = noiseAt(b, from.x, from.y);
  for (const d of DIRS8) {
    const x = from.x + d.x;
    const y = from.y + d.y;
    if (!isPassable(b, x, y, u)) continue;
    const v = noiseAt(b, x, y);
    if (v > bestV) {
      bestV = v;
      best = { x, y };
    }
  }
  return best;
}
