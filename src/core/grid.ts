/** Spatial primitives. Everything tactical happens on this integer square grid. */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });

/** Pack a coordinate into a single integer key. Grids are capped at 1024 wide. */
export const key = (x: number, y: number): number => (y << 10) | x;
export const unkey = (k: number): Vec2 => ({ x: k & 1023, y: k >> 10 });

export const eq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** Chebyshev distance — the honest "how many diagonal steps" metric for a square grid. */
export const chebyshev = (a: Vec2, b: Vec2): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Euclidean distance in tiles. Used for range falloff, never for movement cost. */
export const dist = (a: Vec2, b: Vec2): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const manhattan = (a: Vec2, b: Vec2): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The 8 neighbour offsets, cardinals first so paths prefer straight lines on ties. */
export const DIRS8: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export const DIRS4: readonly Vec2[] = DIRS8.slice(0, 4);

export const isDiagonal = (d: Vec2): boolean => d.x !== 0 && d.y !== 0;

/** Compass facing, 0=E and increasing clockwise. Used for cover and flanking. */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function facingBetween(from: Vec2, to: Vec2): Facing {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const oct = Math.round((a / (Math.PI / 4) + 8) % 8);
  return (oct % 8) as Facing;
}

/**
 * Bresenham line between two tiles, inclusive of both endpoints.
 * The single shared line routine for LOS, projectiles, and noise rays, so what the
 * player is shown and what the sim resolves can never disagree.
 */
export function line(a: Vec2, b: Vec2): Vec2[] {
  const out: Vec2[] = [];
  let x0 = a.x;
  let y0 = a.y;
  const x1 = b.x;
  const y1 = b.y;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    out.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}

/** A dense typed-array grid. The workhorse container for terrain, cover, and noise. */
export class Field<T extends Int8Array | Int16Array | Int32Array | Uint8Array | Float32Array> {
  constructor(
    readonly w: number,
    readonly h: number,
    readonly data: T,
  ) {}

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    return this.data[y * this.w + x] ?? 0;
  }

  set(x: number, y: number, v: number): void {
    if (this.inBounds(x, y)) this.data[y * this.w + x] = v;
  }

  fill(v: number): void {
    this.data.fill(v);
  }
}

export const u8Field = (w: number, h: number): Field<Uint8Array> =>
  new Field(w, h, new Uint8Array(w * h));
export const i16Field = (w: number, h: number): Field<Int16Array> =>
  new Field(w, h, new Int16Array(w * h));
export const f32Field = (w: number, h: number): Field<Float32Array> =>
  new Field(w, h, new Float32Array(w * h));
