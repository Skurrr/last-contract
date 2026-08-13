/** Camera with smooth follow and clamped zoom. World units are pixels at zoom 1. */
import type { Vec2 } from '@/core/grid';

export const TILE_PX = 16;
/** Base scale — the world is drawn at this multiple of native pixel size. */
export const BASE_SCALE = 3;

/**
 * Zoom bounds. The floor is low enough to frame a whole 40x32 map on a 1366-wide screen,
 * which is the opening shot a tactics player needs.
 */
export const MIN_ZOOM = 0.34;
export const MAX_ZOOM = 2.5;

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  private targetX = 0;
  private targetY = 0;
  private targetZoom = 1;

  constructor(
    public viewW: number,
    public viewH: number,
    readonly worldW: number,
    readonly worldH: number,
  ) {}

  /** Pixels per world tile at the current zoom. */
  get tileSize(): number {
    return TILE_PX * BASE_SCALE * this.zoom;
  }

  centerOn(tile: Vec2, immediate = false): void {
    const ts = TILE_PX * BASE_SCALE;
    this.targetX = (tile.x + 0.5) * ts;
    this.targetY = (tile.y + 0.5) * ts;
    if (immediate) {
      this.x = this.targetX;
      this.y = this.targetY;
    }
  }

  panBy(dx: number, dy: number): void {
    this.targetX += dx / this.zoom;
    this.targetY += dy / this.zoom;
    this.clampTarget();
  }

  zoomBy(factor: number): void {
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.targetZoom * factor));
  }

  setZoom(z: number, immediate = false): void {
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    if (immediate) this.zoom = this.targetZoom;
  }

  /**
   * Zoom that fits the whole battlefield in view, clamped to the usable range. Used as the
   * opening framing: a tactics player needs the shape of the ground before they need detail.
   */
  fitZoom(): number {
    const ts = TILE_PX * BASE_SCALE;
    return Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, Math.min(this.viewW / (this.worldW * ts), this.viewH / (this.worldH * ts))),
    );
  }

  private clampTarget(): void {
    const ts = TILE_PX * BASE_SCALE;
    const halfW = this.viewW / (2 * this.zoom);
    const halfH = this.viewH / (2 * this.zoom);
    const wpx = this.worldW * ts;
    const hpx = this.worldH * ts;
    // When the map is smaller than the viewport, pin it centred rather than letting it drift.
    this.targetX = wpx < halfW * 2 ? wpx / 2 : Math.max(halfW, Math.min(wpx - halfW, this.targetX));
    this.targetY = hpx < halfH * 2 ? hpx / 2 : Math.max(halfH, Math.min(hpx - halfH, this.targetY));
  }

  update(dt: number): void {
    this.clampTarget();
    // Exponential smoothing, framerate independent.
    const k = 1 - Math.exp(-11 * dt);
    this.x += (this.targetX - this.x) * k;
    this.y += (this.targetY - this.y) * k;
    this.zoom += (this.targetZoom - this.zoom) * (1 - Math.exp(-9 * dt));
  }

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  /** Apply the camera transform. Call `ctx.restore()` when done drawing the world. */
  apply(ctx: CanvasRenderingContext2D, shakeX = 0, shakeY = 0): void {
    ctx.save();
    ctx.translate(this.viewW / 2, this.viewH / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x + shakeX, -this.y + shakeY);
  }

  /** World pixel → screen pixel. */
  toScreen(wx: number, wy: number, shakeX = 0, shakeY = 0): { x: number; y: number } {
    return {
      x: (wx - this.x + shakeX) * this.zoom + this.viewW / 2,
      y: (wy - this.y + shakeY) * this.zoom + this.viewH / 2,
    };
  }

  /** Screen pixel → world tile. */
  toTile(sx: number, sy: number): Vec2 {
    const ts = TILE_PX * BASE_SCALE;
    const wx = (sx - this.viewW / 2) / this.zoom + this.x;
    const wy = (sy - this.viewH / 2) / this.zoom + this.y;
    return { x: Math.floor(wx / ts), y: Math.floor(wy / ts) };
  }

  /** Tile → centre of that tile in world pixels. */
  tileCenter(t: Vec2): { x: number; y: number } {
    const ts = TILE_PX * BASE_SCALE;
    return { x: (t.x + 0.5) * ts, y: (t.y + 0.5) * ts };
  }

  /** Inclusive tile bounds currently on screen, padded by one tile. */
  visibleBounds(): { x0: number; y0: number; x1: number; y1: number } {
    const ts = TILE_PX * BASE_SCALE;
    const halfW = this.viewW / (2 * this.zoom);
    const halfH = this.viewH / (2 * this.zoom);
    return {
      x0: Math.max(0, Math.floor((this.x - halfW) / ts) - 1),
      y0: Math.max(0, Math.floor((this.y - halfH) / ts) - 1),
      x1: Math.min(this.worldW - 1, Math.ceil((this.x + halfW) / ts) + 1),
      y1: Math.min(this.worldH - 1, Math.ceil((this.y + halfH) / ts) + 1),
    };
  }
}
