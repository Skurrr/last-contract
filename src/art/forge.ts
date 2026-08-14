/**
 * The pixel forge: a tiny immediate-mode drawing API over a raw RGBA buffer.
 *
 * All game art is produced here at native pixel resolution and blitted up with nearest-
 * neighbour filtering, so everything stays crisp and on-grid. Working on a byte buffer rather
 * than a canvas context means the drawing is deterministic across browsers — the same seed
 * gives the same sprite everywhere, which matters because a merc's appearance is derived
 * from their id.
 */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i;

export function hex(color: string): RGBA {
  const m = HEX.exec(color);
  if (!m) return { r: 255, g: 0, b: 255, a: 255 };
  return {
    r: parseInt(m[1]!, 16),
    g: parseInt(m[2]!, 16),
    b: parseInt(m[3]!, 16),
    a: m[4] ? parseInt(m[4], 16) : 255,
  };
}

export function toHex({ r, g, b }: RGBA): string {
  const h = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Multiply lightness while keeping hue. Used for the top-light shading ramp. */
export function shade(color: RGBA, amount: number): RGBA {
  const f = (n: number): number =>
    amount >= 0 ? n + (255 - n) * amount : n * (1 + amount);
  return { r: f(color.r), g: f(color.g), b: f(color.b), a: color.a };
}

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

/**
 * A fixed-size RGBA pixel buffer with a small drawing vocabulary.
 * Every method clips silently, so generators can draw off-edge without guarding.
 */
export class Pix {
  readonly data: Uint8ClampedArray;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  clear(): void {
    this.data.fill(0);
  }

  idx(x: number, y: number): number {
    return (y * this.w + x) * 4;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Read a pixel. Returns fully transparent black when out of bounds. */
  get(x: number, y: number): RGBA {
    if (!this.inside(x, y)) return { r: 0, g: 0, b: 0, a: 0 };
    const i = this.idx(x, y);
    return { r: this.data[i]!, g: this.data[i + 1]!, b: this.data[i + 2]!, a: this.data[i + 3]! };
  }

  alphaAt(x: number, y: number): number {
    if (!this.inside(x, y)) return 0;
    return this.data[this.idx(x, y) + 3]!;
  }

  /** Write a pixel, replacing whatever was there. */
  set(x: number, y: number, c: RGBA): void {
    if (!this.inside(x, y)) return;
    const i = this.idx(x, y);
    this.data[i] = c.r;
    this.data[i + 1] = c.g;
    this.data[i + 2] = c.b;
    this.data[i + 3] = c.a;
  }

  /** Source-over alpha blend. */
  blend(x: number, y: number, c: RGBA): void {
    if (!this.inside(x, y) || c.a <= 0) return;
    if (c.a >= 255) return this.set(x, y, c);
    const i = this.idx(x, y);
    const sa = c.a / 255;
    const da = (this.data[i + 3]! / 255) * (1 - sa);
    const oa = sa + da;
    if (oa <= 0) return;
    this.data[i] = (c.r * sa + this.data[i]! * da) / oa;
    this.data[i + 1] = (c.g * sa + this.data[i + 1]! * da) / oa;
    this.data[i + 2] = (c.b * sa + this.data[i + 2]! * da) / oa;
    this.data[i + 3] = oa * 255;
  }

  /** Draw only where a pixel already exists — for shading passes over a silhouette. */
  over(x: number, y: number, c: RGBA): void {
    if (this.alphaAt(x, y) > 0) this.blend(x, y, c);
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }

  rectBlend(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.blend(i, j, c);
  }

  frame(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let i = x; i < x + w; i++) {
      this.set(i, y, c);
      this.set(i, y + h - 1, c);
    }
    for (let j = y; j < y + h; j++) {
      this.set(x, j, c);
      this.set(x + w - 1, j, c);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const ex = Math.round(x1);
    const ey = Math.round(y1);
    const dx = Math.abs(ex - x);
    const dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x, y, c);
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  /** Filled ellipse. cx/cy may be fractional to land the shape between pixels. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, c);
      }
    }
  }

  /**
   * Filled ellipse, alpha-blended over whatever is already there.
   *
   * Use this rather than `ellipse` for anything translucent: `ellipse` writes pixels
   * outright, so painting a shadow with it erases the face underneath instead of darkening
   * it, and painting with alpha 0 punches a permanent hole.
   */
  ellipseBlend(cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.blend(x, y, c);
      }
    }
  }

  /** An elliptical ring: fills between the outer and inner radii, leaving the middle alone. */
  ellipseRing(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    innerRx: number,
    innerRy: number,
    c: RGBA,
  ): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        const ix = (x + 0.5 - cx) / innerRx;
        const iy = (y + 0.5 - cy) / innerRy;
        if (ix * ix + iy * iy <= 1) continue;
        this.set(x, y, c);
      }
    }
  }

  /** Mirror the left half onto the right. Gives sprites clean bilateral symmetry. */
  mirrorX(): void {
    const half = Math.floor(this.w / 2);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < half; x++) {
        this.set(this.w - 1 - x, y, this.get(x, y));
      }
    }
  }

  /**
   * Add a 1px outline around every opaque region. The single biggest thing that makes
   * small sprites read against a busy battlefield.
   */
  outline(c: RGBA, diagonal = false): void {
    const src = new Uint8ClampedArray(this.data);
    const alphaOf = (x: number, y: number): number =>
      x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : src[(y * this.w + x) * 4 + 3]!;

    const offsets = diagonal
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (alphaOf(x, y) > 0) continue;
        for (const [dx, dy] of offsets) {
          if (alphaOf(x + dx!, y + dy!) > 0) {
            this.set(x, y, c);
            break;
          }
        }
      }
    }
  }

  /**
   * Top-down light pass: brighten the topmost pixel of each column and darken the bottom.
   * Cheap, and it gives flat shapes a convincing sense of volume.
   */
  topLight(strength = 0.28): void {
    for (let x = 0; x < this.w; x++) {
      let top = -1;
      let bottom = -1;
      for (let y = 0; y < this.h; y++) {
        if (this.alphaAt(x, y) > 0) {
          if (top < 0) top = y;
          bottom = y;
        }
      }
      if (top < 0) continue;
      this.over(x, top, { r: 255, g: 255, b: 255, a: Math.round(255 * strength) });
      if (bottom > top) {
        this.over(x, bottom, { r: 0, g: 0, b: 0, a: Math.round(255 * strength * 0.9) });
      }
    }
  }

  /** Drop a soft contact shadow ellipse beneath the sprite. */
  groundShadow(cx: number, cy: number, rx: number, ry: number, alpha = 90): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        const d = nx * nx + ny * ny;
        if (d > 1) continue;
        if (this.alphaAt(x, y) > 0) continue;
        this.blend(x, y, { r: 0, g: 0, b: 0, a: Math.round(alpha * (1 - d)) });
      }
    }
  }

  /** Composite another buffer at an offset. */
  stamp(other: Pix, ox: number, oy: number): void {
    for (let y = 0; y < other.h; y++) {
      for (let x = 0; x < other.w; x++) {
        const c = other.get(x, y);
        if (c.a > 0) this.blend(ox + x, oy + y, c);
      }
    }
  }

  /** Tint every opaque pixel toward a colour — used for team colours and hit flashes. */
  tint(c: RGBA, amount: number): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.alphaAt(x, y) === 0) continue;
        const cur = this.get(x, y);
        this.set(x, y, { ...mix(cur, c, amount), a: cur.a });
      }
    }
  }

  toImageData(): ImageData {
    // The DOM lib types ImageData's first argument as Uint8ClampedArray<ArrayBuffer>, which
    // our plain Uint8ClampedArray does not structurally satisfy under newer TS libs.
    return new ImageData(this.data as unknown as Uint8ClampedArray<ArrayBuffer>, this.w, this.h);
  }

  /** Bake into a canvas at an integer scale, ready to blit. */
  toCanvas(scale = 1): HTMLCanvasElement {
    const src = document.createElement('canvas');
    src.width = this.w;
    src.height = this.h;
    src.getContext('2d')!.putImageData(this.toImageData(), 0, 0);
    if (scale === 1) return src;

    const dst = document.createElement('canvas');
    dst.width = this.w * scale;
    dst.height = this.h * scale;
    const ctx = dst.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, dst.width, dst.height);
    return dst;
  }
}

/** Memoise generated sprites — every sprite is pure in its arguments, so this is always safe. */
export function memoise<A extends readonly unknown[], R>(
  fn: (...args: A) => R,
  keyOf: (...args: A) => string,
): (...args: A) => R {
  const cache = new Map<string, R>();
  return (...args: A): R => {
    const k = keyOf(...args);
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    const v = fn(...args);
    cache.set(k, v);
    return v;
  };
}
