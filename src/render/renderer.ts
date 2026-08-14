/**
 * The battlefield renderer. Draws terrain, decals, overlays, units and effects, then hands
 * screen-space work (numbers, shards) to the Fx layer.
 *
 * Sprites are baked once into offscreen canvases by the art forge and blitted with image
 * smoothing off, so everything stays pixel-crisp at any zoom.
 */
import { chebyshev, type Vec2 } from '@/core/grid';
import { hashString } from '@/core/rng';
import { PAL, TEAM_OUTLINE } from '@/art/palette';
import { toHex } from '@/art/forge';
import { bloodDecal, lootSprite, tileSprite, TILE, variantFor } from '@/art/tiles';
import {
  lookFromPalette,
  mercSprite,
  UNIT_H,
  UNIT_W,
  zombieSprite,
  type UnitLook,
  type ZombieVariant,
} from '@/art/units';
import { muzzleFlash, weaponSprite, WEAPON_H, WEAPON_W } from '@/art/weapons';
import { attachmentKey, weaponBodyKey } from '@/art/spritemap';
import { resolveWeapon } from '@/sim/combat';
import { terrainAt, visibleTiles } from '@/sim/field';
import type { BattleState, Unit } from '@/sim/types';
import { BASE_SCALE, Camera, TILE_PX } from './camera';
import type { Fx } from './fx';

const S = BASE_SCALE;
const TS = TILE_PX * S;

/** Baked sprite cache — keyed by the same strings the forge memoises on. */
const canvasCache = new Map<string, HTMLCanvasElement>();

function baked(key: string, build: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = canvasCache.get(key);
  if (!c) {
    c = build();
    canvasCache.set(key, c);
  }
  return c;
}

export interface RenderOverlays {
  /** Tiles reachable with current AP, mapped to cost. */
  reachable?: Map<number, number>;
  /** Preview path the cursor is proposing. */
  path?: Vec2[];
  /** Tile under the cursor. */
  hover?: Vec2 | null;
  /** Unit currently selected. */
  selectedId?: string | null;
  /** Unit under the cursor, highlighted as a target. */
  targetId?: string | null;
  /** Tiles a throw can reach, drawn as a distinct band from the movement overlay. */
  throwTiles?: Set<number>;
  /** Draw the noise field — genuinely useful, since noise is what the dead follow. */
  showNoise?: boolean;
  /** Hide tiles no living squad member can see. */
  fogOfWar?: boolean;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  /** Per-unit look, resolved once and reused. */
  private looks = new Map<string, UnitLook>();
  /** Muzzle flashes to draw for a frame or two after a shot. */
  private flashes: { at: Vec2; toward: Vec2; life: number; size: 0 | 1 | 2 }[] = [];
  private visionCache: { turn: number; tiles: Set<number> } | null = null;
  private time = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly camera: Camera,
    readonly fx: Fx,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Register a merc's authored palette so their sprite matches their portrait. */
  setLook(unitId: string, look: UnitLook): void {
    this.looks.set(unitId, look);
  }

  lookFor(u: Unit): UnitLook {
    let l = this.looks.get(u.id);
    if (!l) {
      l = lookFromPalette(u.spriteSeed, undefined);
      this.looks.set(u.id, l);
    }
    return l;
  }

  addMuzzleFlash(at: Vec2, toward: Vec2, size: 0 | 1 | 2): void {
    this.flashes.push({ at, toward, life: 0.09, size });
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.life -= dt;
      if (f.life <= 0) this.flashes.splice(i, 1);
    }
  }

  draw(b: BattleState, ov: RenderOverlays = {}): void {
    const ctx = this.ctx;
    const { width: w, height: h } = this.canvas;

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a0c08';
    ctx.fillRect(0, 0, w, h);

    this.camera.apply(ctx, this.fx.shakeX, this.fx.shakeY);

    const vis = ov.fogOfWar ? this.squadVision(b) : null;
    const bounds = this.camera.visibleBounds();

    this.drawTerrain(b, bounds, vis);
    this.drawDecals(b, bounds, vis);
    if (ov.showNoise) this.drawNoise(b, bounds);
    this.drawOverlays(b, ov);
    this.drawLoot(b, vis);
    this.drawUnits(b, ov, vis);
    this.drawFlashes();

    this.fx.drawWorld(ctx);
    this.drawLighting(b, w, h);

    ctx.restore();

    this.fx.drawScreen(
      ctx,
      (x, y) => this.camera.toScreen(x, y, this.fx.shakeX, this.fx.shakeY),
      w,
      h,
    );
  }

  // ─────────────────────────────────────────────── layers

  private squadVision(b: BattleState): Set<number> {
    if (this.visionCache && this.visionCache.turn === b.turn) return this.visionCache.tiles;
    const tiles = new Set<number>();
    for (const u of b.units) {
      if (!u.alive || u.team !== 'player') continue;
      for (const t of visibleTiles(b, u)) tiles.add(t);
    }
    this.visionCache = { turn: b.turn, tiles };
    return tiles;
  }

  /** Invalidate cached vision — call after any squad member moves. */
  invalidateVision(): void {
    this.visionCache = null;
  }

  private drawTerrain(
    b: BattleState,
    bounds: { x0: number; y0: number; x1: number; y1: number },
    vis: Set<number> | null,
  ): void {
    const ctx = this.ctx;
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      for (let x = bounds.x0; x <= bounds.x1; x++) {
        const kind = terrainAt(b, x, y);
        const variant = variantFor(x, y);
        const key = `t:${kind}:${variant}`;
        const spr = baked(key, () => tileSprite(kind, variant).toCanvas(S));
        ctx.drawImage(spr, x * TS, y * TS);

        if (vis && !vis.has((y << 10) | x)) {
          // Remembered but unseen: cooled and dimmed, not blacked out. The player keeps
          // their map, and the colour survives — a fog heavy enough to grey the whole
          // board makes the art pointless and the ground unreadable.
          ctx.fillStyle = 'rgba(12,18,32,0.46)';
          ctx.fillRect(x * TS, y * TS, TS, TS);
        }
      }
    }
  }

  private drawDecals(
    b: BattleState,
    bounds: { x0: number; y0: number; x1: number; y1: number },
    vis: Set<number> | null,
  ): void {
    const ctx = this.ctx;
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      for (let x = bounds.x0; x <= bounds.x1; x++) {
        const v = b.decals[y * b.w + x] ?? 0;
        if (v < 12) continue;
        if (vis && !vis.has((y << 10) | x)) continue;
        const intensity = Math.min(1, v / 255);
        const variant = variantFor(x, y, 6);
        const key = `d:${variant}:${Math.round(intensity * 6)}`;
        const spr = baked(key, () => bloodDecal(variant, intensity).toCanvas(S));
        ctx.drawImage(spr, x * TS, y * TS);
      }
    }
  }

  /** The noise field, drawn as a heat wash. Toggleable, because it is the zombie AI's mind. */
  private drawNoise(
    b: BattleState,
    bounds: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const ctx = this.ctx;
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      for (let x = bounds.x0; x <= bounds.x1; x++) {
        const v = b.noise[y * b.w + x] ?? 0;
        if (v < 0.03) continue;
        ctx.fillStyle = `rgba(230,120,60,${(v * 0.45).toFixed(3)})`;
        ctx.fillRect(x * TS, y * TS, TS, TS);
      }
    }
  }

  private drawOverlays(b: BattleState, ov: RenderOverlays): void {
    const ctx = this.ctx;

    if (ov.reachable) {
      // Pulse gently so the move range reads as active rather than as painted terrain.
      const pulse = 0.10 + 0.035 * Math.sin(this.time * 3.4);
      for (const [k, cost] of ov.reachable) {
        const x = k & 1023;
        const y = k >> 10;
        // Two bands: comfortably in range, and "this will cost you your whole turn".
        const far = cost > 0.6 * (b.units.find((u) => u.id === ov.selectedId)?.maxAp ?? 10);
        ctx.fillStyle = far
          ? `rgba(255,180,80,${pulse.toFixed(3)})`
          : `rgba(95,211,232,${pulse.toFixed(3)})`;
        ctx.fillRect(x * TS, y * TS, TS, TS);
      }
    }

    if (ov.throwTiles && ov.throwTiles.size > 0) {
      // Amber, and distinct from the cyan movement band — reach is not the same as range.
      // A faint fill alone was unreadable against the map, so the boundary is drawn as a
      // hard edge: the player needs to see exactly where their arm stops.
      const pulse = 0.11 + 0.04 * Math.sin(this.time * 3.4);
      ctx.fillStyle = `rgba(232,163,61,${pulse.toFixed(3)})`;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const k of ov.throwTiles) {
        const x = k & 1023;
        const y = k >> 10;
        ctx.fillRect(x * TS, y * TS, TS, TS);
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      ctx.save();
      ctx.strokeStyle = 'rgba(232,163,61,0.75)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -this.time * 18;
      ctx.strokeRect(x0 * TS + 1, y0 * TS + 1, (x1 - x0 + 1) * TS - 2, (y1 - y0 + 1) * TS - 2);
      ctx.restore();
    }

    if (ov.path && ov.path.length > 0) {
      ctx.strokeStyle = 'rgba(95,211,232,0.85)';
      ctx.lineWidth = 2 * S * 0.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash([6 * S * 0.5, 4 * S * 0.5]);
      ctx.lineDashOffset = -this.time * 30;
      ctx.beginPath();
      const start = b.units.find((u) => u.id === ov.selectedId)?.pos;
      if (start) ctx.moveTo((start.x + 0.5) * TS, (start.y + 0.5) * TS);
      for (const p of ov.path) ctx.lineTo((p.x + 0.5) * TS, (p.y + 0.5) * TS);
      ctx.stroke();
      ctx.setLineDash([]);

      const end = ov.path[ov.path.length - 1]!;
      ctx.strokeStyle = 'rgba(95,211,232,0.95)';
      ctx.lineWidth = 2;
      ctx.strokeRect(end.x * TS + 2, end.y * TS + 2, TS - 4, TS - 4);
    }

    if (ov.hover) {
      ctx.strokeStyle = 'rgba(245,242,232,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(ov.hover.x * TS + 1, ov.hover.y * TS + 1, TS - 2, TS - 2);
    }
  }

  private drawLoot(b: BattleState, vis: Set<number> | null): void {
    const ctx = this.ctx;
    for (const l of b.loot) {
      if (vis && !vis.has((l.pos.y << 10) | l.pos.x)) continue;
      const spr = baked('loot', () => lootSprite('#ffffff').toCanvas(S));
      // Gentle bob so drops catch the eye.
      const bob = Math.sin(this.time * 2.6 + l.pos.x) * 2;
      ctx.drawImage(spr, l.pos.x * TS, l.pos.y * TS + bob);
    }
  }

  private drawUnits(b: BattleState, ov: RenderOverlays, vis: Set<number> | null): void {
    const ctx = this.ctx;
    // Sort by y so units lower on the screen overlap those behind them.
    const order = b.units
      .filter((u) => u.alive || u.critical)
      .slice()
      .sort((a, c) => a.pos.y - c.pos.y);

    for (const u of order) {
      if (vis && u.team !== 'player' && !vis.has((u.pos.y << 10) | u.pos.x)) continue;

      const cx = u.pos.x * TS;
      // Units are taller than a tile; sink them so their feet sit on the tile centre.
      const cy = u.pos.y * TS - (UNIT_H - TILE) * S;

      const selected = ov.selectedId === u.id;
      const targeted = ov.targetId === u.id;

      if (selected) this.drawSelectionRing(u, '#5fd3e8');
      else if (targeted) this.drawSelectionRing(u, '#ff6b4a');

      const spr = this.unitCanvas(u);
      ctx.save();
      if (u.critical) {
        // Downed units lie flat — rotating the sprite is cheap and reads instantly.
        ctx.translate(cx + (UNIT_W * S) / 2, cy + (UNIT_H * S) / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(spr, -(UNIT_W * S) / 2, -(UNIT_H * S) / 2);
      } else {
        ctx.drawImage(spr, cx, cy);
      }
      ctx.restore();

      if (!u.critical) this.drawHeldWeapon(u, cx, cy);
      this.drawUnitBars(u, cx, cy);
    }
  }

  private unitCanvas(u: Unit): HTMLCanvasElement {
    const state = !u.alive ? 'dead' : u.critical ? 'down' : 'ok';
    if (u.kind === 'zombie') {
      const variant = (u.defId.replace(/^.*?-/, '') || 'shambler') as ZombieVariant;
      const key = `u:z:${u.spriteSeed}:${variant}`;
      return baked(key, () => zombieSprite(u.spriteSeed, variant).toCanvas(S));
    }
    const look = this.lookFor(u);
    const key = `u:${u.spriteSeed}:${u.team}:${state}:${look.headgear}${look.vest}${look.hairStyle}${look.build}`;
    return baked(key, () => mercSprite(u.spriteSeed, u.team, look, state).toCanvas(S));
  }

  /** Draw the unit's weapon rotated toward its facing, so aim direction is always readable. */
  private drawHeldWeapon(u: Unit, cx: number, cy: number): void {
    const inst = u.weapon ?? u.sidearm;
    if (!inst) return;
    const w = resolveWeapon(inst);
    if (!w) return;

    const attachKeys = Object.entries(inst.attachments)
      .filter((e): e is [string, string] => Boolean(e[1]))
      .map(([slot, id]) =>
        attachmentKey(id, slot as Parameters<typeof attachmentKey>[1]),
      );

    const spec = {
      body: weaponBodyKey(w.def.sprite, w.def.cls),
      attachments: attachKeys,
      condition: w.condition,
    };
    const key = `w:${spec.body}:${attachKeys.join('+')}:${Math.round(w.condition * 10)}`;
    const spr = baked(key, () => weaponSprite(spec).toCanvas(S));

    const ctx = this.ctx;
    const angle = (u.facing * Math.PI) / 4;
    // Pivot at the unit's hands, roughly centre-mass.
    const px = cx + (UNIT_W * S) / 2;
    const py = cy + 10 * S;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    // Flip vertically when aiming left so the gun is never upside-down.
    if (u.facing > 2 && u.facing < 6) ctx.scale(1, -1);
    ctx.drawImage(spr, -2 * S, (-WEAPON_H / 2) * S);
    ctx.restore();
  }

  private drawSelectionRing(u: Unit, color: string): void {
    const ctx = this.ctx;
    const cx = (u.pos.x + 0.5) * TS;
    const cy = (u.pos.y + 0.72) * TS;
    const pulse = 1 + 0.06 * Math.sin(this.time * 5);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.ellipse(cx, cy, TS * 0.42 * pulse, TS * 0.2 * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /** Health, and for the active team a compact AP pip strip. */
  private drawUnitBars(u: Unit, cx: number, cy: number): void {
    const ctx = this.ctx;
    const w = UNIT_W * S;
    const barW = w - 6;
    const x = cx + 3;
    const y = cy - 6;

    const hpFrac = Math.max(0, u.hp / Math.max(1, u.maxHp));

    ctx.fillStyle = 'rgba(8,10,7,0.85)';
    ctx.fillRect(x - 1, y - 1, barW + 2, 5);

    ctx.fillStyle =
      u.critical ? '#7a1010' :
      hpFrac > 0.6 ? toHex(PAL.lime) :
      hpFrac > 0.3 ? toHex(PAL.amber) :
      toHex(PAL.bloodBright);
    ctx.fillRect(x, y, barW * hpFrac, 3);

    // Bleeding shows as a pulsing red tick on the bar — the wound you must deal with.
    if (u.statuses.some((s) => s.kind === 'bleeding')) {
      ctx.fillStyle = `rgba(255,60,50,${(0.5 + 0.5 * Math.sin(this.time * 8)).toFixed(2)})`;
      ctx.fillRect(x + barW * hpFrac - 2, y - 2, 3, 7);
    }

    if (u.team === 'player' && !u.critical && u.maxAp > 0) {
      const pips = Math.min(12, u.maxAp);
      const pw = barW / pips;
      for (let i = 0; i < pips; i++) {
        ctx.fillStyle = i < u.ap ? toHex(PAL.cyan) : 'rgba(255,255,255,0.16)';
        ctx.fillRect(x + i * pw, y + 5, Math.max(1, pw - 1), 2);
      }
    }

    // Status icons as coloured ticks above the bar.
    const bad = u.statuses.filter((s) => s.kind !== 'overwatch');
    if (bad.length > 0) {
      let sx = x;
      for (const s of bad.slice(0, 5)) {
        ctx.fillStyle =
          s.kind === 'bleeding' ? '#c62828' :
          s.kind === 'stunned' ? '#f2c94c' :
          s.kind === 'suppressed' ? '#8d8b7e' :
          s.kind === 'poisoned' ? '#7ed957' :
          s.kind === 'inspired' ? '#4fc3e8' :
          '#9b6fd6';
        ctx.fillRect(sx, y - 5, 3, 3);
        sx += 4;
      }
    }

    if (u.statuses.some((s) => s.kind === 'overwatch')) {
      // Overwatch cone, so the player can see what is covered without clicking.
      ctx.save();
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = '#ffd45e';
      const px = (u.pos.x + 0.5) * TS;
      const py = (u.pos.y + 0.5) * TS;
      const a = (u.facing * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, TS * 6, a - 0.5, a + 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawFlashes(): void {
    const ctx = this.ctx;
    for (const f of this.flashes) {
      const spr = baked(`mf${f.size}`, () => muzzleFlash(f.size).toCanvas(S));
      const dx = f.toward.x - f.at.x;
      const dy = f.toward.y - f.at.y;
      const len = Math.hypot(dx, dy) || 1;
      // Sit the flash out at the muzzle, not on the unit.
      const px = (f.at.x + 0.5) * TS + (dx / len) * TS * 0.7;
      const py = (f.at.y + 0.5) * TS + (dy / len) * TS * 0.7;
      ctx.save();
      ctx.globalAlpha = Math.min(1, f.life / 0.09);
      ctx.translate(px, py);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.drawImage(spr, (-5 * S), (-5 * S));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** A single multiply pass tinting the whole field by time of day. */
  private drawLighting(b: BattleState, w: number, h: number): void {
    if (b.light >= 0.99) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.resetTransform();
    ctx.globalCompositeOperation = 'multiply';
    const t = b.light;
    const r = Math.round(60 + 195 * t);
    const g = Math.round(70 + 185 * t);
    const bl = Math.round(110 + 145 * t);
    ctx.fillStyle = `rgb(${r},${g},${bl})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

/** Stable sprite seed for any unit id — mercs override this with their authored seed. */
export function seedFor(id: string): number {
  return hashString(id);
}

export { chebyshev, TEAM_OUTLINE };
