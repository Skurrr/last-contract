/**
 * Procedural battle-map generation.
 *
 * A map is built in four passes, and the last two are what make the difference between a
 * tactics map and noise:
 *
 *   1. `paintBase`   — the biome's ground cover.
 *   2. a biome painter — the readable structure (roads, buildings, tree lines, channels).
 *   3. `balance`     — nudges walkable % and cover-adjacency % into the biome's band, so we
 *                      never ship an empty killing field or an impassable thicket.
 *   4. `repairConnectivity` — carves the cheapest breach to anything the player must reach,
 *                      so an objective can never be walled off.
 *
 * Everything derives from `opts.seed` through `Rng`. No `Math.random` anywhere: the same
 * seed always yields a byte-identical terrain array.
 */
import { Rng } from '@/core/rng';
import { DIRS4, DIRS8, chebyshev, isDiagonal, type Vec2 } from '@/core/grid';
import type { SectorBiome } from '@/data/sectors';
import { createBattle } from './battle';
import { isOpen, setTerrain, terrainAt } from './field';
import { TERRAIN, type BattleState, type TerrainKind } from './types';

// ─────────────────────────────────────────────────────────────── public API

export interface MapGenOptions {
  seed: number;
  biome: SectorBiome;
  /** Defaults to 40x32 — wide enough for rifle sightlines, short enough to cross in a fight. */
  w?: number;
  h?: number;
  light?: number;
}

export interface GeneratedMap {
  battle: BattleState;
  /** At least 6, clustered on one edge, all walkable. */
  playerSpawns: Vec2[];
  /** At least 12, spread across the far side, all ≥20 tiles from every player spawn. */
  enemySpawns: Vec2[];
  /** Scattered over the whole map, away from the player's landing zone. */
  zombieSpawns: Vec2[];
  /** Building interiors and prop clusters — places worth searching. */
  lootSpots: Vec2[];
}

const DEFAULT_W = 40;
const DEFAULT_H = 32;

/** How far enemies must be from the nearest player spawn. */
const ENEMY_MIN_DIST = 20;

// ─────────────────────────────────────────────────────────────── biome tables

const BIOME_BASE: Record<SectorBiome, TerrainKind> = {
  village: 'grass',
  farmland: 'grass',
  woods: 'grass',
  industrial: 'dirt',
  highway: 'grass',
  ruins: 'dirt',
  military: 'dirt',
  swamp: 'grass',
};

/**
 * Target fraction of walkable tiles that touch some cover.
 *
 * The design target is 15–30%, and the open biomes hold it. Woods, ruins and highway sit
 * above it on purpose: their defining features — dense trees, rubble fields, a wrecked
 * road with ditched verges — *are* cover, and thinning them to 30% would turn woods into a
 * meadow and ruins into a car park. The point of the band is that no biome is a bare
 * killing field and none is a maze; the exact number is per-biome character.
 */
const COVER_BAND: Record<SectorBiome, readonly [number, number]> = {
  village: [0.20, 0.36],
  farmland: [0.12, 0.26],
  woods: [0.45, 0.72],
  industrial: [0.22, 0.40],
  highway: [0.22, 0.40],
  ruins: [0.30, 0.52],
  military: [0.22, 0.40],
  swamp: [0.14, 0.30],
};

/** Walkable-tile fraction band. Kept well inside the 0.45–0.9 sanity range. */
const WALK_BAND: readonly [number, number] = [0.55, 0.87];

/** Props the balancer may clump together when a biome comes out too bare. */
const FILLER_COVER: Record<SectorBiome, readonly TerrainKind[]> = {
  village: ['fence', 'crate', 'tree'],
  farmland: ['fence', 'tree'],
  woods: ['tree', 'tree', 'rubble'],
  industrial: ['crate', 'crate', 'car'],
  highway: ['car', 'rubble', 'sandbag'],
  ruins: ['rubble', 'rubble', 'wall'],
  military: ['sandbag', 'crate', 'car'],
  swamp: ['tree', 'rubble'],
};

/** Dijkstra weight for tunnelling through a tile when carving a guaranteed route. */
const BREAK_COST: Record<TerrainKind, number> = {
  floor: 1,
  grass: 1,
  road: 1,
  dirt: 1,
  rubble: 2,
  door: 2,
  water: 4,
  fence: 8,
  crate: 12,
  window: 14,
  sandbag: 16,
  tree: 26,
  car: 40,
  wall: 70,
};

// ─────────────────────────────────────────────────────────────── context & primitives

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Edge = 'n' | 's' | 'e' | 'w';

interface Ctx {
  b: BattleState;
  rng: Rng;
  w: number;
  h: number;
  biome: SectorBiome;
  base: TerrainKind;
  /** 1 = deployment band: ground stays walkable here, no structures, no props. */
  reserved: Uint8Array;
  /** Interiors worth looting. Recorded by the building helpers. */
  rooms: Rect[];
}

const idx = (c: Ctx, x: number, y: number): number => y * c.w + x;

const inside = (c: Ctx, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < c.w && y < c.h;

/**
 * The single write path. Refuses to put blocking terrain into a deployment band, which is
 * what keeps spawn areas walkable without a separate clean-up pass.
 */
function put(c: Ctx, x: number, y: number, k: TerrainKind, respectReserved = true): void {
  if (!inside(c, x, y)) return;
  if (respectReserved && !TERRAIN[k].walkable && c.reserved[idx(c, x, y)] === 1) return;
  setTerrain(c.b, x, y, k);
}

function fillRect(c: Ctx, r: Rect, k: TerrainKind, respectReserved = true): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) put(c, x, y, k, respectReserved);
  }
}

/** Perimeter only. `gap` skips that fraction of tiles — how a fence reads as a fence. */
function strokeRect(c: Ctx, r: Rect, k: TerrainKind, gap = 0): void {
  for (let x = r.x; x < r.x + r.w; x++) {
    if (gap === 0 || !c.rng.chance(gap)) put(c, x, r.y, k);
    if (gap === 0 || !c.rng.chance(gap)) put(c, x, r.y + r.h - 1, k);
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    if (gap === 0 || !c.rng.chance(gap)) put(c, r.x, y, k);
    if (gap === 0 || !c.rng.chance(gap)) put(c, r.x + r.w - 1, y, k);
  }
}

function stamp(c: Ctx, cx: number, cy: number, r: number, k: TerrainKind, force = false): void {
  const ri = Math.max(0, Math.ceil(r));
  const rr = r * r + 0.25;
  for (let y = cy - ri; y <= cy + ri; y++) {
    for (let x = cx - ri; x <= cx + ri; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rr) put(c, x, y, k, !force);
    }
  }
}

/** Scattered blob — `density` of the disc, not all of it. Reads as organic clutter. */
function blob(c: Ctx, cx: number, cy: number, r: number, k: TerrainKind, density: number): void {
  const ri = Math.ceil(r);
  for (let y = cy - ri; y <= cy + ri; y++) {
    for (let x = cx - ri; x <= cx + ri; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      if (c.rng.chance(density)) put(c, x, y, k);
    }
  }
}

/**
 * A wobbling band from `a` to `b`, `width` tiles across. The workhorse for roads, water
 * channels and forest clearings — a straight line reads as machine-made, a wobble does not.
 */
function paintWinding(
  c: Ctx,
  a: Vec2,
  b: Vec2,
  width: number,
  k: TerrainKind,
  maxOffset = 3,
  force = false,
): Vec2[] {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
  const dx = (b.x - a.x) / steps;
  const dy = (b.y - a.y) / steps;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;

  const spine: Vec2[] = [];
  let off = 0;
  for (let i = 0; i <= steps; i++) {
    if (c.rng.chance(0.4)) off += c.rng.int(-1, 1);
    off = Math.max(-maxOffset, Math.min(maxOffset, off));
    const cx = Math.round(a.x + dx * i + px * off);
    const cy = Math.round(a.y + dy * i + py * off);
    spine.push({ x: cx, y: cy });
    stamp(c, cx, cy, width / 2, k, force);
  }
  return spine;
}

// ─────────────────────────────────────────────────────────────── rects & buildings

function rectFree(c: Ctx, r: Rect, pad = 2, margin = 1): boolean {
  if (r.x < margin || r.y < margin || r.x + r.w > c.w - margin || r.y + r.h > c.h - margin) {
    return false;
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (c.reserved[idx(c, x, y)] === 1) return false;
    }
  }
  return !c.rooms.some(
    (o) =>
      r.x < o.x + o.w + pad &&
      o.x < r.x + r.w + pad &&
      r.y < o.y + o.h + pad &&
      o.y < r.y + r.h + pad,
  );
}

interface PerimCell extends Vec2 {
  /** Outward normal — used to clear the tile a door opens onto. */
  nx: number;
  ny: number;
}

/** Perimeter cells excluding corners (a door in a corner reads as a bug). */
function perimeter(r: Rect): PerimCell[] {
  const out: PerimCell[] = [];
  for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
    out.push({ x, y: r.y, nx: 0, ny: -1 });
    out.push({ x, y: r.y + r.h - 1, nx: 0, ny: 1 });
  }
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    out.push({ x: r.x, y, nx: -1, ny: 0 });
    out.push({ x: r.x + r.w - 1, y, nx: 1, ny: 0 });
  }
  return out;
}

interface BuildingOpts {
  doors: number;
  windows: number;
  /** Split larger footprints into rooms, always with a doorway between them. */
  partition: boolean;
  floor?: TerrainKind;
  /** Interior clutter placed on ~this fraction of floor tiles. */
  clutter?: { kind: TerrainKind; density: number };
}

/**
 * Walled building with a floor, at least one door, and outward-facing windows.
 * Doors always get the tile outside them cleared, so an interior is never sealed by a prop
 * that happened to be sitting on the step.
 */
function placeBuilding(c: Ctx, r: Rect, o: BuildingOpts): void {
  const floor = o.floor ?? 'floor';
  fillRect(c, r, floor);
  strokeRect(c, r, 'wall');

  if (o.partition && r.w >= 9 && r.h >= 6 && c.rng.chance(0.8)) {
    if (r.w >= r.h) {
      const px = r.x + c.rng.int(3, r.w - 4);
      const gap = r.y + c.rng.int(1, r.h - 2);
      for (let y = r.y + 1; y < r.y + r.h - 1; y++) put(c, px, y, y === gap ? 'door' : 'wall');
    } else {
      const py = r.y + c.rng.int(3, r.h - 4);
      const gap = r.x + c.rng.int(1, r.w - 2);
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) put(c, x, py, x === gap ? 'door' : 'wall');
    }
  }

  if (o.clutter) {
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
        if (c.rng.chance(o.clutter.density)) put(c, x, y, o.clutter.kind);
      }
    }
  }

  const cells = c.rng.shuffle(perimeter(r));
  const doors = Math.max(1, o.doors);
  for (let i = 0; i < doors && i < cells.length; i++) {
    const p = cells[i]!;
    put(c, p.x, p.y, 'door');
    // Clear the step outside and the tile inside, so the door is always usable.
    if (!isOpen(c.b, p.x + p.nx, p.y + p.ny)) put(c, p.x + p.nx, p.y + p.ny, c.base, false);
    put(c, p.x - p.nx, p.y - p.ny, floor);
  }
  for (let i = doors; i < doors + o.windows && i < cells.length; i++) {
    const p = cells[i]!;
    put(c, p.x, p.y, 'window');
  }

  c.rooms.push(r);
}

// ─────────────────────────────────────────────────────────────── biome painters

function paintBase(c: Ctx): void {
  fillRect(c, { x: 0, y: 0, w: c.w, h: c.h }, c.base, false);
}

function scatter(c: Ctx, count: number, k: TerrainKind, margin = 0): void {
  for (let i = 0; i < count; i++) {
    const x = c.rng.int(margin, c.w - 1 - margin);
    const y = c.rng.int(margin, c.h - 1 - margin);
    put(c, x, y, k);
  }
}

/**
 * `count` clumps of 2–5 touching tiles rather than `count` lone props. Loners are visual
 * litter and each one drags eight tiles into cover; a grove or a pile-up is a landmark.
 */
function clumps(c: Ctx, count: number, k: TerrainKind, margin = 1): void {
  for (let i = 0; i < count; i++) {
    let x = c.rng.int(margin, c.w - 1 - margin);
    let y = c.rng.int(margin, c.h - 1 - margin);
    for (let n = c.rng.int(2, 5); n > 0; n--) {
      put(c, x, y, k);
      const d = c.rng.pick(DIRS8);
      x += d.x;
      y += d.y;
    }
  }
}

// ── village ───────────────────────────────────────────────────────────────────

function genVillage(c: Ctx): void {
  const horizontal = c.rng.chance(0.5);
  const spine = horizontal
    ? paintWinding(c, { x: 0, y: c.rng.int(10, c.h - 10) }, { x: c.w - 1, y: c.rng.int(10, c.h - 10) }, 3, 'dirt', 4, true)
    : paintWinding(c, { x: c.rng.int(10, c.w - 10), y: 0 }, { x: c.rng.int(10, c.w - 10), y: c.h - 1 }, 3, 'dirt', 4, true);

  // A couple of spurs off the main road so the plots at the back are still addressed.
  for (let i = 0; i < 2; i++) {
    const p = spine[c.rng.int(4, spine.length - 5)]!;
    const away = c.rng.chance(0.5) ? 1 : -1;
    const end = horizontal
      ? { x: p.x + c.rng.int(-4, 4), y: p.y + away * c.rng.int(8, 13) }
      : { x: p.x + away * c.rng.int(8, 13), y: p.y + c.rng.int(-4, 4) };
    paintWinding(c, p, end, 2, 'dirt', 2, true);
  }

  // Plots laid out along the road, alternating sides.
  let placed = 0;
  for (let attempt = 0; attempt < 90 && placed < 7; attempt++) {
    const p = spine[c.rng.int(3, spine.length - 4)]!;
    const side = c.rng.chance(0.5) ? 1 : -1;
    const dist = c.rng.int(4, 11);
    const bw = c.rng.int(5, 9);
    const bh = c.rng.int(4, 7);
    const cx = horizontal ? p.x : p.x + side * dist;
    const cy = horizontal ? p.y + side * dist : p.y;
    const r: Rect = { x: cx - (bw >> 1), y: cy - (bh >> 1), w: bw, h: bh };
    if (!rectFree(c, r, 3)) continue;
    placeBuilding(c, r, { doors: c.rng.int(1, 2), windows: c.rng.int(3, 5), partition: true });
    // Garden fence around the plot, with gaps so it channels rather than walls off.
    if (c.rng.chance(0.55)) {
      strokeRect(c, { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 }, 'fence', 0.55);
    }
    placed++;
  }

  clumps(c, c.rng.int(4, 7), 'tree');
  clumps(c, c.rng.int(2, 3), 'car');
}

// ── farmland ──────────────────────────────────────────────────────────────────

function genFarmland(c: Ctx): void {
  // Long crop rows: alternating dirt/grass strips give the eye a direction to read.
  const fields = c.rng.int(3, 5);
  for (let i = 0; i < fields; i++) {
    const horizontalRows = c.rng.chance(0.6);
    const fw = c.rng.int(12, 22);
    const fh = c.rng.int(9, 16);
    const r: Rect = { x: c.rng.int(1, c.w - fw - 1), y: c.rng.int(1, c.h - fh - 1), w: fw, h: fh };
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const band = horizontalRows ? y : x;
        put(c, x, y, band % 2 === 0 ? 'dirt' : 'grass', false);
      }
    }
    strokeRect(c, r, 'fence', 0.62);
  }

  // The barn is the one hard piece of cover on the whole map.
  for (let attempt = 0; attempt < 40; attempt++) {
    const bw = c.rng.int(10, 13);
    const bh = c.rng.int(7, 9);
    const r: Rect = { x: c.rng.int(3, c.w - bw - 3), y: c.rng.int(3, c.h - bh - 3), w: bw, h: bh };
    if (!rectFree(c, r, 2)) continue;
    placeBuilding(c, r, {
      doors: 2,
      windows: 4,
      partition: true,
      clutter: { kind: 'crate', density: 0.1 },
    });
    break;
  }

  // Loose wire runs across the open ground — the only thing to hug when crossing.
  for (let i = 0; i < c.rng.int(3, 6); i++) {
    const a: Vec2 = { x: c.rng.int(2, c.w - 3), y: c.rng.int(2, c.h - 3) };
    const bpt: Vec2 = c.rng.chance(0.5)
      ? { x: a.x + c.rng.int(-16, 16), y: a.y }
      : { x: a.x, y: a.y + c.rng.int(-12, 12) };
    for (const p of paintWinding(c, a, bpt, 1, 'grass', 1, true)) {
      if (!c.rng.chance(0.25)) put(c, p.x, p.y, 'fence');
    }
  }

  // A windbreak of trees along one field edge, plus a couple of loose stands.
  const wa: Vec2 = { x: c.rng.int(3, c.w - 4), y: c.rng.int(3, c.h - 4) };
  paintWinding(c, wa, c.rng.chance(0.5) ? { x: wa.x + c.rng.int(9, 16), y: wa.y } : { x: wa.x, y: wa.y + c.rng.int(8, 13) }, 1, 'tree', 1);
  clumps(c, c.rng.int(2, 4), 'tree');
}

// ── woods ─────────────────────────────────────────────────────────────────────

function genWoods(c: Ctx): void {
  // Thickets first, then clearings cut back through them: the negative space is the map.
  const thickets = c.rng.int(30, 44);
  for (let i = 0; i < thickets; i++) {
    blob(c, c.rng.int(0, c.w - 1), c.rng.int(0, c.h - 1), c.rng.float(2.5, 5.5), 'tree', 0.78);
  }

  const clearings = c.rng.int(6, 9);
  for (let i = 0; i < clearings; i++) {
    const vertical = c.rng.chance(0.5);
    const a: Vec2 = vertical
      ? { x: c.rng.int(2, c.w - 3), y: 0 }
      : { x: 0, y: c.rng.int(2, c.h - 3) };
    const bpt: Vec2 = vertical
      ? { x: c.rng.int(2, c.w - 3), y: c.h - 1 }
      : { x: c.w - 1, y: c.rng.int(2, c.h - 3) };
    paintWinding(c, a, bpt, c.rng.int(3, 5), 'grass', 5, true);
  }

  // Glades — the few places a firefight can actually open up.
  for (let i = 0; i < c.rng.int(2, 4); i++) {
    stamp(c, c.rng.int(6, c.w - 7), c.rng.int(6, c.h - 7), c.rng.float(3.5, 5.5), 'grass', true);
  }

  for (let i = 0; i < c.rng.int(4, 8); i++) {
    blob(c, c.rng.int(2, c.w - 3), c.rng.int(2, c.h - 3), c.rng.float(1.5, 3), 'rubble', 0.7);
  }

  // A ranger cabin, occasionally — somewhere to loot.
  if (c.rng.chance(0.6)) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const r: Rect = { x: c.rng.int(4, c.w - 12), y: c.rng.int(4, c.h - 10), w: c.rng.int(6, 8), h: c.rng.int(5, 6) };
      if (!rectFree(c, r, 3)) continue;
      stamp(c, r.x + (r.w >> 1), r.y + (r.h >> 1), Math.max(r.w, r.h) * 0.8, 'grass', true);
      placeBuilding(c, r, { doors: 1, windows: 3, partition: false });
      break;
    }
  }
}

// ── industrial ────────────────────────────────────────────────────────────────

function genIndustrial(c: Ctx): void {
  // Fenced yard with gates on every side.
  const inset = c.rng.int(2, 4);
  const yard: Rect = { x: inset, y: inset, w: c.w - inset * 2, h: c.h - inset * 2 };
  strokeRect(c, yard, 'fence');
  for (let g = 0; g < 6; g++) {
    const p = c.rng.pick(perimeter(yard));
    for (let d = -1; d <= 1; d++) {
      put(c, p.x + (p.ny !== 0 ? d : 0), p.y + (p.nx !== 0 ? d : 0), c.base, false);
    }
  }

  // Warehouse shells: big concrete boxes with roll-up bay doors punched out.
  let sheds = 0;
  for (let attempt = 0; attempt < 60 && sheds < 3; attempt++) {
    const bw = c.rng.int(12, 18);
    const bh = c.rng.int(8, 12);
    const r: Rect = {
      x: c.rng.int(inset + 2, c.w - bw - inset - 2),
      y: c.rng.int(inset + 2, c.h - bh - inset - 2),
      w: bw,
      h: bh,
    };
    if (!rectFree(c, r, 3)) continue;
    placeBuilding(c, r, {
      doors: 1,
      windows: c.rng.int(4, 7),
      partition: true,
      clutter: { kind: 'crate', density: 0.09 },
    });
    // Bay doors — 3-wide openings, the reason a warehouse is worth fighting over.
    for (let bay = 0; bay < c.rng.int(1, 2); bay++) {
      const side = c.rng.chance(0.5);
      if (side) {
        const bx = c.rng.int(r.x + 2, r.x + r.w - 4);
        const by = c.rng.chance(0.5) ? r.y : r.y + r.h - 1;
        for (let d = 0; d < 3; d++) put(c, bx + d, by, 'floor');
      } else {
        const by = c.rng.int(r.y + 2, r.y + r.h - 4);
        const bx = c.rng.chance(0.5) ? r.x : r.x + r.w - 1;
        for (let d = 0; d < 3; d++) put(c, bx, by + d, 'floor');
      }
    }
    sheds++;
  }

  // Crate stacks in the yard, and a few dead trucks.
  for (let i = 0; i < c.rng.int(6, 10); i++) {
    const cx = c.rng.int(inset + 1, c.w - inset - 2);
    const cy = c.rng.int(inset + 1, c.h - inset - 2);
    for (let n = 0; n < c.rng.int(2, 5); n++) {
      put(c, cx + c.rng.int(-1, 1), cy + c.rng.int(-1, 1), 'crate');
    }
  }
  clumps(c, c.rng.int(2, 4), 'car', 2);
}

// ── highway ───────────────────────────────────────────────────────────────────

function genHighway(c: Ctx): void {
  const horizontal = c.w >= c.h;
  const roadW = c.rng.int(8, 10);
  const a: Vec2 = horizontal
    ? { x: 0, y: c.rng.int(Math.floor(c.h * 0.35), Math.floor(c.h * 0.65)) }
    : { x: c.rng.int(Math.floor(c.w * 0.35), Math.floor(c.w * 0.65)), y: 0 };
  const bpt: Vec2 = horizontal
    ? { x: c.w - 1, y: c.rng.int(Math.floor(c.h * 0.35), Math.floor(c.h * 0.65)) }
    : { x: c.rng.int(Math.floor(c.w * 0.35), Math.floor(c.w * 0.65)), y: c.h - 1 };

  const spine = paintWinding(c, a, bpt, roadW, 'road', 4, true);

  // Ditches at both verges — walkable, costly, and low cover if you go prone in them.
  const off = Math.floor(roadW / 2) + 1;
  for (const p of spine) {
    if (c.rng.chance(0.35)) continue; // ditches break up, they are not a continuous kerb
    for (const s of [-1, 1]) {
      const vx = horizontal ? p.x : p.x + s * off;
      const vy = horizontal ? p.y + s * off : p.y;
      stamp(c, vx, vy, 1, 'rubble', true);
    }
  }

  // Wrecks: pile-ups rather than confetti, always on the asphalt.
  for (let i = 0; i < c.rng.int(7, 11); i++) {
    const p = spine[c.rng.int(0, spine.length - 1)]!;
    const jx = horizontal ? c.rng.int(-1, 1) : c.rng.int(-roadW / 2 + 1, roadW / 2 - 1);
    const jy = horizontal ? c.rng.int(-roadW / 2 + 1, roadW / 2 - 1) : c.rng.int(-1, 1);
    const lengthwise = c.rng.int(2, 4);
    for (let n = 0; n < lengthwise; n++) {
      put(c, p.x + jx + (horizontal ? n : 0), p.y + jy + (horizontal ? 0 : n), 'car');
      if (c.rng.chance(0.45)) put(c, p.x + jx + (horizontal ? n : 1), p.y + jy + (horizontal ? 1 : n), 'car');
    }
  }

  // Sandbag checkpoints straddling the road with a gap you have to walk through.
  for (let i = 0; i < c.rng.int(2, 3); i++) {
    const p = spine[Math.floor((spine.length * (i + 1)) / 4) + c.rng.int(-2, 2)] ?? spine[0]!;
    const gap = c.rng.int(-2, 2);
    for (let d = -roadW; d <= roadW; d++) {
      if (Math.abs(d - gap) <= 1) continue;
      const sx = horizontal ? p.x : p.x + d;
      const sy = horizontal ? p.y + d : p.y;
      put(c, sx, sy, 'sandbag');
    }
  }

  clumps(c, c.rng.int(3, 6), 'tree');
  for (let i = 0; i < c.rng.int(1, 2); i++) {
    const fa: Vec2 = { x: c.rng.int(2, c.w - 3), y: c.rng.int(2, c.h - 3) };
    paintWinding(c, fa, { x: fa.x + c.rng.int(-12, 12), y: fa.y + c.rng.int(-10, 10) }, 1, 'fence', 2);
  }
}

// ── ruins ─────────────────────────────────────────────────────────────────────

function genRuins(c: Ctx): void {
  // Collapsed shells: the wall line is there, but only in fragments.
  let placed = 0;
  for (let attempt = 0; attempt < 100 && placed < 11; attempt++) {
    const bw = c.rng.int(6, 13);
    const bh = c.rng.int(5, 10);
    const r: Rect = { x: c.rng.int(1, c.w - bw - 1), y: c.rng.int(1, c.h - bh - 1), w: bw, h: bh };
    if (!rectFree(c, r, 2)) continue;

    fillRect(c, r, 'floor');
    const standing = c.rng.float(0.45, 0.7);
    for (const p of [...perimeter(r), ...corners(r)]) {
      put(c, p.x, p.y, c.rng.chance(standing) ? 'wall' : 'rubble');
    }
    // A partial interior wall — the memory of a room.
    if (r.w >= 8 && c.rng.chance(0.6)) {
      const px = r.x + c.rng.int(2, r.w - 3);
      for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
        if (c.rng.chance(0.6)) put(c, px, y, 'wall');
      }
    }
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
        if (c.rng.chance(0.22)) put(c, x, y, 'rubble');
      }
    }
    c.rooms.push(r);
    placed++;
  }

  // Rubble fields between the shells.
  for (let i = 0; i < c.rng.int(4, 8); i++) {
    blob(c, c.rng.int(1, c.w - 2), c.rng.int(1, c.h - 2), c.rng.float(2.5, 5.5), 'rubble', 0.7);
  }

  // Free-standing wall fragments — cover with nothing behind it.
  for (let i = 0; i < c.rng.int(4, 8); i++) {
    const sx = c.rng.int(2, c.w - 3);
    const sy = c.rng.int(2, c.h - 3);
    const len = c.rng.int(3, 7);
    const vertical = c.rng.chance(0.5);
    for (let d = 0; d < len; d++) {
      if (c.rng.chance(0.2)) continue;
      put(c, sx + (vertical ? 0 : d), sy + (vertical ? d : 0), 'wall');
    }
  }
  clumps(c, c.rng.int(2, 4), 'car');
  clumps(c, c.rng.int(2, 4), 'tree');
}

function corners(r: Rect): Vec2[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w - 1, y: r.y },
    { x: r.x, y: r.y + r.h - 1 },
    { x: r.x + r.w - 1, y: r.y + r.h - 1 },
  ];
}

// ── military ──────────────────────────────────────────────────────────────────

function genMilitary(c: Ctx): void {
  // Chain-link perimeter with gates.
  const inset = 3;
  const wire: Rect = { x: inset, y: inset, w: c.w - inset * 2, h: c.h - inset * 2 };
  strokeRect(c, wire, 'fence');
  for (let g = 0; g < 5; g++) {
    const p = c.rng.pick(perimeter(wire));
    for (let d = -1; d <= 1; d++) {
      put(c, p.x + (p.ny !== 0 ? d : 0), p.y + (p.nx !== 0 ? d : 0), c.base, false);
    }
  }

  // Concrete apron and a regular row of identical blocks — the depot reads as *planned*.
  fillRect(c, { x: inset + 1, y: inset + 1, w: wire.w - 2, h: wire.h - 2 }, 'floor', false);

  const bw = 8;
  const bh = 6;
  const cols = Math.floor((wire.w - 4) / (bw + 4));
  const rows = Math.floor((wire.h - 4) / (bh + 4));
  const ox = wire.x + 3;
  const oy = wire.y + 3;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      if (c.rng.chance(0.2)) continue;
      const r: Rect = { x: ox + rx * (bw + 4), y: oy + ry * (bh + 4), w: bw, h: bh };
      if (!rectFree(c, r, 2)) continue;
      placeBuilding(c, r, {
        doors: c.rng.int(1, 2),
        windows: c.rng.int(3, 5),
        partition: true,
        clutter: { kind: 'crate', density: 0.08 },
      });
    }
  }

  // Sandbag emplacements: three-sided, opening inward.
  for (let i = 0; i < c.rng.int(4, 7); i++) {
    const sx = c.rng.int(wire.x + 1, wire.x + wire.w - 6);
    const sy = c.rng.int(wire.y + 1, wire.y + wire.h - 5);
    const len = c.rng.int(3, 5);
    const facing = c.rng.int(0, 3);
    for (let d = 0; d < len; d++) {
      if (facing % 2 === 0) {
        put(c, sx + d, sy, 'sandbag');
        put(c, sx, sy + (facing === 0 ? 1 : -1), 'sandbag');
        put(c, sx + len - 1, sy + (facing === 0 ? 1 : -1), 'sandbag');
      } else {
        put(c, sx, sy + d, 'sandbag');
        put(c, sx + (facing === 1 ? 1 : -1), sy, 'sandbag');
        put(c, sx + (facing === 1 ? 1 : -1), sy + len - 1, 'sandbag');
      }
    }
  }

  // Motor pool: parked rows of wrecks.
  for (let attempt = 0; attempt < 30; attempt++) {
    const r: Rect = {
      x: c.rng.int(wire.x + 1, wire.x + wire.w - 13),
      y: c.rng.int(wire.y + 1, wire.y + wire.h - 9),
      w: 12,
      h: 8,
    };
    if (!rectFree(c, r, 1)) continue;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 5; col++) {
        put(c, r.x + col * 2 + 1, r.y + row * 4 + 1, 'car');
        if (c.rng.chance(0.5)) put(c, r.x + col * 2 + 1, r.y + row * 4 + 2, 'car');
      }
    }
    c.rooms.push(r);
    break;
  }

  clumps(c, c.rng.int(4, 7), 'crate', 4);
}

// ── swamp ─────────────────────────────────────────────────────────────────────

function genSwamp(c: Ctx): void {
  // Channels: walkable but slow, so they shape movement without blocking it.
  const channels = c.rng.int(3, 5);
  for (let i = 0; i < channels; i++) {
    const vertical = c.rng.chance(0.5);
    const a: Vec2 = vertical ? { x: c.rng.int(2, c.w - 3), y: 0 } : { x: 0, y: c.rng.int(2, c.h - 3) };
    const bpt: Vec2 = vertical
      ? { x: c.rng.int(2, c.w - 3), y: c.h - 1 }
      : { x: c.w - 1, y: c.rng.int(2, c.h - 3) };
    const spine = paintWinding(c, a, bpt, c.rng.int(3, 5), 'water', 6, true);
    // Dead trees crowd the bank.
    for (const p of spine) {
      if (!c.rng.chance(0.14)) continue;
      const d = c.rng.int(3, 4) * (c.rng.chance(0.5) ? 1 : -1);
      put(c, p.x + (vertical ? d : 0), p.y + (vertical ? 0 : d), 'tree');
    }
  }

  for (let i = 0; i < c.rng.int(4, 8); i++) {
    stamp(c, c.rng.int(2, c.w - 3), c.rng.int(2, c.h - 3), c.rng.float(2, 4), 'water', true);
  }

  // Hummocks of solid ground and standing deadwood. Cover is deliberately thin here.
  for (let i = 0; i < c.rng.int(4, 7); i++) {
    blob(c, c.rng.int(1, c.w - 2), c.rng.int(1, c.h - 2), c.rng.float(1.5, 3), 'rubble', 0.6);
  }
  clumps(c, c.rng.int(7, 12), 'tree', 0);

  // A rotting shack on stilts gives the map one interior.
  if (c.rng.chance(0.7)) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const r: Rect = { x: c.rng.int(3, c.w - 10), y: c.rng.int(3, c.h - 9), w: c.rng.int(6, 8), h: c.rng.int(5, 6) };
      if (!rectFree(c, r, 3)) continue;
      placeBuilding(c, r, { doors: 1, windows: 3, partition: false });
      break;
    }
  }
}

const PAINTERS: Record<SectorBiome, (c: Ctx) => void> = {
  village: genVillage,
  farmland: genFarmland,
  woods: genWoods,
  industrial: genIndustrial,
  highway: genHighway,
  ruins: genRuins,
  military: genMilitary,
  swamp: genSwamp,
};

// ─────────────────────────────────────────────────────────────── balance pass

interface MapStats {
  tiles: number;
  walkable: number;
  /** Walkable tiles with at least one neighbouring cover tile. */
  covered: number;
  walkFrac: number;
  coverFrac: number;
}

function measure(b: BattleState): MapStats {
  let walkable = 0;
  let covered = 0;
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      if (!isOpen(b, x, y)) continue;
      walkable++;
      for (const d of DIRS8) {
        const k = terrainAt(b, x + d.x, y + d.y);
        if (TERRAIN[k].cover > 0) {
          covered++;
          break;
        }
      }
    }
  }
  const tiles = b.w * b.h;
  return {
    tiles,
    walkable,
    covered,
    walkFrac: walkable / tiles,
    coverFrac: walkable === 0 ? 0 : covered / walkable,
  };
}

const isCoverAdjacent = (b: BattleState, x: number, y: number): boolean =>
  DIRS8.some((d) => TERRAIN[terrainAt(b, x + d.x, y + d.y)].cover > 0);

/** Walkable neighbours — used to avoid dropping a prop into a one-tile corridor. */
const openNeighbours = (b: BattleState, x: number, y: number): number =>
  DIRS8.reduce((n, d) => n + (isOpen(b, x + d.x, y + d.y) ? 1 : 0), 0);

/** Every walkable tile, in a fixed scan order. Shuffled by the caller when needed. */
function walkableTiles(c: Ctx): Vec2[] {
  const out: Vec2[] = [];
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) if (isOpen(c.b, x, y)) out.push({ x, y });
  }
  return out;
}

const inRoom = (c: Ctx, x: number, y: number): boolean =>
  c.rooms.some((r) => x >= r.x - 1 && x < r.x + r.w + 1 && y >= r.y - 1 && y < r.y + r.h + 1);

/**
 * A building's shell. The balancer may thin the clutter inside a room, but never the walls,
 * doors or windows — deleting those is how a generator ends up with roofless nonsense.
 */
const isShell = (c: Ctx, x: number, y: number): boolean => {
  const k = terrainAt(c.b, x, y);
  return (k === 'wall' || k === 'door' || k === 'window') && inRoom(c, x, y);
};

/** How many currently-uncovered walkable tiles would become covered if `p` were blocked. */
function newExposure(c: Ctx, p: Vec2): number {
  let n = 0;
  for (const d of DIRS8) {
    const x = p.x + d.x;
    const y = p.y + d.y;
    if (!isOpen(c.b, x, y)) continue;
    if (!isCoverAdjacent(c.b, x, y)) n++;
  }
  return n;
}

/**
 * Push the map into its biome's walkable / cover-adjacency bands.
 *
 * The insight that makes this converge: a *scattered* blocker covers eight tiles, a blocker
 * welded onto an existing mass covers almost none. So the two knobs are not independent —
 * "too much cover, too few walls" is fixed by the same operation from both ends: strip the
 * isolated props, then thicken what is left into proper masses. Both `thicken` and
 * `stripIsolatedCover` move the map toward clumped cover, which is also what reads best on
 * screen: a hedge line and a wrecked truck, not confetti.
 *
 * Anything this pinches off is reopened by `repairConnectivity` afterwards.
 */
function balance(c: Ctx): void {
  const [coverLo, coverHi] = COVER_BAND[c.biome];
  const [walkLo, walkHi] = WALK_BAND;

  for (let round = 0; round < 24; round++) {
    const s = measure(c.b);
    if (s.coverFrac > coverHi) {
      stripIsolatedCover(c, Math.ceil(((s.coverFrac - coverHi) * s.walkable) / 5) + 4);
      continue;
    }
    if (s.walkFrac > walkHi) {
      thicken(c, Math.ceil((s.walkFrac - walkHi) * s.tiles) + 6);
      continue;
    }
    if (s.coverFrac < coverLo) {
      addClumps(c, Math.ceil(((coverLo - s.coverFrac) * s.walkable) / 7) + 1, FILLER_COVER[c.biome]);
      continue;
    }
    if (s.walkFrac < walkLo) {
      clearBlockers(c, Math.ceil((walkLo - s.walkFrac) * s.tiles) + 6);
      continue;
    }
    return;
  }
}

/**
 * Block more ground while exposing as little of it to cover as possible: fill the concave
 * pockets of masses that already exist, so a ragged tree line becomes a solid stand rather
 * than the map growing new isolated props. This is how an open biome reaches the walkable
 * band without its cover-adjacency running away.
 */
function thicken(c: Ctx, count: number): void {
  let done = 0;
  for (let pass = 0; pass < 5 && done < count; pass++) {
    const cands: { p: Vec2; score: number }[] = [];
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        if (!isOpen(c.b, x, y) || inRoom(c, x, y) || c.reserved[idx(c, x, y)] === 1) continue;
        const hugging = 8 - openNeighbours(c.b, x, y);
        if (hugging < 2) continue;
        // Best tiles are deep in a pocket (high `hugging`) and expose nothing new.
        cands.push({ p: { x, y }, score: hugging * 2 - newExposure(c, { x, y }) });
      }
    }
    if (cands.length === 0) return;
    c.rng.shuffle(cands);
    cands.sort((a, z) => z.score - a.score);

    const take = Math.max(1, Math.min(count - done, Math.ceil(cands.length / 3)));
    for (const { p } of cands.slice(0, take)) {
      // Copy the mass we are extending so the fill still reads as that feature.
      let kind: TerrainKind = 'rubble';
      for (const d of DIRS4) {
        const k = terrainAt(c.b, p.x + d.x, p.y + d.y);
        if (!TERRAIN[k].walkable && k !== 'window' && k !== 'door') {
          kind = k;
          break;
        }
      }
      put(c, p.x, p.y, kind);
      done++;
    }
  }
}

/** Small clusters of cover dropped into bare ground. The fix for a map with nothing to hide behind. */
function addClumps(c: Ctx, clumps: number, props: readonly TerrainKind[]): void {
  const bare = c.rng.shuffle(walkableTiles(c).filter((p) => !isCoverAdjacent(c.b, p.x, p.y)));
  let placed = 0;
  for (const p of bare) {
    if (placed >= clumps) break;
    if (!isOpen(c.b, p.x, p.y) || openNeighbours(c.b, p.x, p.y) < 7) continue;
    const kind = c.rng.pick(props);
    put(c, p.x, p.y, kind);
    const run = c.rng.int(1, 3);
    const dir = c.rng.pick(DIRS4);
    for (let i = 1; i <= run; i++) {
      const q = { x: p.x + dir.x * i, y: p.y + dir.y * i };
      if (!isOpen(c.b, q.x, q.y) || openNeighbours(c.b, q.x, q.y) < 6) break;
      put(c, q.x, q.y, kind);
    }
    placed++;
  }
}

/** Open up blocked tiles that are not part of a recorded building. */
function clearBlockers(c: Ctx, count: number): void {
  const cands: Vec2[] = [];
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      if (!isOpen(c.b, x, y) && !inRoom(c, x, y)) cands.push({ x, y });
    }
  }
  for (const p of c.rng.shuffle(cands).slice(0, count)) put(c, p.x, p.y, c.base, false);
}

/**
 * Remove the cover tiles that buy the least: the loners standing in the open, which are
 * exactly the ones that inflate cover-adjacency while looking like litter. Buildings are
 * never touched.
 */
function stripIsolatedCover(c: Ctx, count: number): void {
  const cands: { p: Vec2; neighbours: number }[] = [];
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      if (TERRAIN[terrainAt(c.b, x, y)].cover === 0) continue;
      if (inRoom(c, x, y)) continue;
      let neighbours = 0;
      for (const d of DIRS8) {
        if (TERRAIN[terrainAt(c.b, x + d.x, y + d.y)].cover > 0) neighbours++;
      }
      cands.push({ p: { x, y }, neighbours });
    }
  }
  c.rng.shuffle(cands);
  cands.sort((a, z) => a.neighbours - z.neighbours);
  for (const { p } of cands.slice(0, count)) put(c, p.x, p.y, c.base, false);
}

// ─────────────────────────────────────────────────────────────── connectivity

/** Movement-accurate flood fill: 8-way, no cutting a diagonal between two blocked tiles. */
function floodFrom(b: BattleState, from: Vec2): Uint8Array {
  const seen = new Uint8Array(b.w * b.h);
  if (!isOpen(b, from.x, from.y)) return seen;
  const queue: number[] = [from.y * b.w + from.x];
  seen[queue[0]!] = 1;
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head]!;
    const cx = k % b.w;
    const cy = (k - cx) / b.w;
    for (const d of DIRS8) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (!isOpen(b, nx, ny)) continue;
      if (isDiagonal(d) && !isOpen(b, cx + d.x, cy) && !isOpen(b, cx, cy + d.y)) continue;
      const nk = ny * b.w + nx;
      if (seen[nk] === 1) continue;
      seen[nk] = 1;
      queue.push(nk);
    }
  }
  return seen;
}

/**
 * True when every target is reachable on foot from `from`. Uses the same neighbour rules as
 * `findPath`, so a "connected" answer here means a unit can genuinely walk it.
 */
export function isFullyConnected(b: BattleState, from: Vec2, targets: Vec2[]): boolean {
  if (!isOpen(b, from.x, from.y)) return false;
  const seen = floodFrom(b, from);
  return targets.every(
    (t) =>
      t.x >= 0 && t.y >= 0 && t.x < b.w && t.y < b.h && seen[t.y * b.w + t.x] === 1,
  );
}

/** What a blocked tile becomes when we have to breach it. Walls become doors, not holes. */
function opened(k: TerrainKind, base: TerrainKind): TerrainKind {
  switch (k) {
    case 'wall':
    case 'window':
      return 'door';
    case 'car':
    case 'sandbag':
      return 'rubble';
    case 'crate':
      return 'floor';
    default:
      return base;
  }
}

/**
 * Guarantee reachability by construction.
 *
 * Runs a 4-way Dijkstra from the anchor where entering a blocked tile costs what it would
 * cost to knock it down, then walks the parent chain back from every unreachable target,
 * opening only the tiles on that chain. The result prefers going around cover and breaches
 * exactly one wall when going around is impossible.
 */
function repairConnectivity(c: Ctx, from: Vec2, targets: readonly Vec2[]): void {
  const n = c.w * c.h;
  const cost = new Int32Array(n).fill(0x7fffffff);
  const parent = new Int32Array(n).fill(-1);
  const start = idx(c, from.x, from.y);
  cost[start] = 0;

  const buckets: number[][] = [[start]];
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (const k of bucket) {
      if ((cost[k] ?? 0) < d) continue;
      const cx = k % c.w;
      const cy = (k - cx) / c.w;
      for (const dir of DIRS4) {
        const nx = cx + dir.x;
        const ny = cy + dir.y;
        if (!inside(c, nx, ny)) continue;
        const nk = ny * c.w + nx;
        const kind = terrainAt(c.b, nx, ny);
        const step = TERRAIN[kind].walkable ? 1 : BREAK_COST[kind];
        const nd = d + step;
        if (nd >= (cost[nk] ?? 0)) continue;
        cost[nk] = nd;
        parent[nk] = k;
        while (buckets.length <= nd) buckets.push([]);
        buckets[nd]!.push(nk);
      }
    }
  }

  for (const t of targets) {
    if (!inside(c, t.x, t.y)) continue;
    let k = idx(c, t.x, t.y);
    let guard = 0;
    while (k !== start && k >= 0 && guard++ < n) {
      const x = k % c.w;
      const y = (k - x) / c.w;
      if (!isOpen(c.b, x, y)) {
        put(c, x, y, opened(terrainAt(c.b, x, y), c.base), false);
      }
      k = parent[k] ?? -1;
    }
  }
}

// ─────────────────────────────────────────────────────────────── spawn placement

function edgeAnchor(c: Ctx, edge: Edge): Vec2 {
  const jitter = (span: number): number =>
    Math.max(3, Math.min(span - 4, Math.round(span / 2) + c.rng.int(-Math.floor(span / 5), Math.floor(span / 5))));
  switch (edge) {
    case 'n':
      return { x: jitter(c.w), y: 1 };
    case 's':
      return { x: jitter(c.w), y: c.h - 2 };
    case 'w':
      return { x: 1, y: jitter(c.h) };
    case 'e':
      return { x: c.w - 2, y: jitter(c.h) };
  }
}

/** Deployment band (and its mirror on the far side) — kept walkable and structure-free. */
function markReserved(c: Ctx, edge: Edge, depth: number): void {
  const mark = (r: Rect): void => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (inside(c, x, y)) c.reserved[idx(c, x, y)] = 1;
      }
    }
  };
  if (edge === 'n' || edge === 's') {
    mark({ x: 0, y: edge === 'n' ? 0 : c.h - depth, w: c.w, h: depth });
    mark({ x: 0, y: edge === 'n' ? c.h - depth : 0, w: c.w, h: depth });
  } else {
    mark({ x: edge === 'w' ? 0 : c.w - depth, y: 0, w: depth, h: c.h });
    mark({ x: edge === 'w' ? c.w - depth : 0, y: 0, w: depth, h: c.h });
  }
}

/** Nearest walkable tiles to the anchor, in BFS order — guaranteed clustered and connected. */
function clusterAround(c: Ctx, anchor: Vec2, count: number): Vec2[] {
  const seed = isOpen(c.b, anchor.x, anchor.y) ? anchor : nearestOpen(c, anchor);
  if (!seed) return [];
  const seen = new Uint8Array(c.w * c.h);
  const queue: Vec2[] = [seed];
  seen[idx(c, seed.x, seed.y)] = 1;
  const out: Vec2[] = [];
  for (let head = 0; head < queue.length && out.length < count; head++) {
    const p = queue[head]!;
    out.push(p);
    for (const d of DIRS8) {
      const nx = p.x + d.x;
      const ny = p.y + d.y;
      if (!isOpen(c.b, nx, ny)) continue;
      if (isDiagonal(d) && !isOpen(c.b, p.x + d.x, p.y) && !isOpen(c.b, p.x, p.y + d.y)) continue;
      const nk = idx(c, nx, ny);
      if (seen[nk] === 1) continue;
      seen[nk] = 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return out;
}

function nearestOpen(c: Ctx, from: Vec2): Vec2 | null {
  for (let r = 1; r < Math.max(c.w, c.h); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = from.x + dx;
        const y = from.y + dy;
        if (isOpen(c.b, x, y)) return { x, y };
      }
    }
  }
  return null;
}

/**
 * Greedy Poisson-ish selection. Relaxes the separation requirement rather than returning
 * short — a map with 12 tightly packed enemies still beats a map with 8 well-spread ones.
 */
function spread(rng: Rng, cands: readonly Vec2[], count: number, minSep: number): Vec2[] {
  const shuffled = rng.shuffle([...cands]);
  const out: Vec2[] = [];
  for (let sep = minSep; sep >= 1 && out.length < count; sep--) {
    for (const p of shuffled) {
      if (out.length >= count) break;
      if (out.some((q) => chebyshev(p, q) < sep)) continue;
      out.push(p);
    }
  }
  return out;
}

/** Interiors and prop clusters, scored so loot lands somewhere worth walking to. */
function pickLootSpots(c: Ctx, rng: Rng, count: number, avoid: readonly Vec2[]): Vec2[] {
  const scored: { p: Vec2; score: number }[] = [];
  for (const p of walkableTiles(c)) {
    if (avoid.some((q) => chebyshev(p, q) < 6)) continue;
    let score = 0;
    if (c.rooms.some((r) => p.x > r.x && p.y > r.y && p.x < r.x + r.w - 1 && p.y < r.y + r.h - 1)) score += 4;
    for (const d of DIRS4) {
      const k = terrainAt(c.b, p.x + d.x, p.y + d.y);
      if (k === 'crate') score += 3;
      else if (k === 'car' || k === 'sandbag') score += 2;
      else if (k === 'rubble' || k === 'wall') score += 1;
    }
    if (score > 0) scored.push({ p, score });
  }
  // Stable: sort by score, then by tile index, so the shuffle below is the only randomness.
  scored.sort((a, z) => z.score - a.score || idx(c, a.p.x, a.p.y) - idx(c, z.p.x, z.p.y));
  const pool = scored.slice(0, Math.max(count * 8, 60)).map((s) => s.p);
  return spread(rng, pool, count, 7);
}

// ─────────────────────────────────────────────────────────────── generation

function build(opts: MapGenOptions, w: number, h: number, layoutSeed: number): GeneratedMap | null {
  const rng = new Rng(layoutSeed);
  const b = createBattle({
    seed: opts.seed,
    w,
    h,
    ...(opts.light !== undefined ? { light: opts.light } : {}),
  });

  const c: Ctx = {
    b,
    rng,
    w,
    h,
    biome: opts.biome,
    base: BIOME_BASE[opts.biome],
    reserved: new Uint8Array(w * h),
    rooms: [],
  };

  const edge = rng.pick<Edge>(['n', 's', 'e', 'w']);
  markReserved(c, edge, 2);

  paintBase(c);
  PAINTERS[opts.biome](c);
  balance(c);

  // Player squad: a tight cluster on its edge.
  const anchor = edgeAnchor(c, edge);
  const cluster = clusterAround(c, anchor, 10);
  if (cluster.length < 6) return null;
  const playerSpawns = cluster.slice(0, 8);
  const origin = playerSpawns[0]!;

  // Enemies: the far side, at least ENEMY_MIN_DIST from everyone we deploy.
  const far = walkableTiles(c).filter((p) => playerSpawns.every((q) => chebyshev(p, q) >= ENEMY_MIN_DIST));
  if (far.length < 12) return null;
  const enemySpawns = spread(rng, far, 16, 4);
  if (enemySpawns.length < 12) return null;

  const lootSpots = pickLootSpots(c, rng, 10, playerSpawns);

  // Zombies wander in from everywhere, just not on top of the landing zone.
  const roam = walkableTiles(c).filter((p) => playerSpawns.every((q) => chebyshev(p, q) >= 6));
  const zombieSpawns = spread(rng, roam, 14, 6);

  // Nothing may be walled off. Carve first, then prove it.
  repairConnectivity(c, origin, [...enemySpawns, ...lootSpots, ...zombieSpawns, ...playerSpawns]);
  if (!isFullyConnected(b, origin, [...playerSpawns, ...enemySpawns, ...lootSpots])) return null;

  const s = measure(b);
  if (s.walkFrac < 0.45 || s.walkFrac > 0.9) return null;

  return {
    battle: b,
    playerSpawns,
    enemySpawns,
    zombieSpawns: zombieSpawns.filter((p) => isFullyConnected(b, origin, [p])),
    lootSpots,
  };
}

/**
 * Build a battle map for a sector. Deterministic in `opts.seed`: identical options always
 * produce an identical terrain array, spawn list and loot layout.
 */
export function generateMap(opts: MapGenOptions): GeneratedMap {
  const w = opts.w ?? DEFAULT_W;
  const h = opts.h ?? DEFAULT_H;
  for (let attempt = 0; attempt < 6; attempt++) {
    const layoutSeed = (opts.seed ^ Math.imul(attempt + 1, 0x9e3779b9)) | 0;
    const m = build(opts, w, h, layoutSeed);
    if (m) return m;
  }
  throw new Error(`mapgen: could not build a valid ${opts.biome} map for seed ${opts.seed}`);
}

/** One line for logs and test output. */
export function describeMap(m: GeneratedMap): string {
  const s = measure(m.battle);
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const p0 = m.playerSpawns[0];
  const minEnemy = p0
    ? Math.min(...m.enemySpawns.map((e) => Math.min(...m.playerSpawns.map((q) => chebyshev(e, q)))))
    : 0;
  return (
    `${m.battle.w}x${m.battle.h} map, seed ${m.battle.seed}: ` +
    `${pct(s.walkFrac)} walkable, ${pct(s.coverFrac)} of it in cover, ` +
    `${m.playerSpawns.length} player / ${m.enemySpawns.length} enemy (nearest ${minEnemy} tiles) / ` +
    `${m.zombieSpawns.length} zombie spawns, ${m.lootSpots.length} loot spots`
  );
}
