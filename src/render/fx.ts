/**
 * The juice layer: particles, floating numbers, screen shake, hitstop, and flashes.
 *
 * This is where a hit stops being a number in a log and starts feeling like a hit. It is
 * driven entirely by CombatEvents, so the simulation stays ignorant of presentation and
 * every effect here can be tuned or muted without touching game logic.
 */
import { Rng } from '@/core/rng';
import { damageColor, PAL } from '@/art/palette';
import { toHex } from '@/art/forge';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Gravity applied per second. */
  g: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  /** Particles with drag slow down; sparks do, smoke does more. */
  drag: number;
  shape: 'square' | 'circle' | 'streak';
  fade: boolean;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
  /** Punch scale on spawn, decaying to 1. */
  pop: number;
  outline: boolean;
}

/** An XP shard that homes toward a screen-space target (the merc's portrait). */
export interface Shard {
  x: number;
  y: number;
  tx: number;
  ty: number;
  life: number;
  maxLife: number;
  color: string;
  /** Random control point so shards arc instead of travelling in a boring straight line. */
  cx: number;
  cy: number;
}

export class Fx {
  readonly particles: Particle[] = [];
  readonly texts: FloatingText[] = [];
  readonly shards: Shard[] = [];

  private shake = 0;
  private shakeDecay = 6;
  private hitstop = 0;
  private flashColor = '';
  private flashAlpha = 0;
  private rng = new Rng(0x51ce);

  /** Current camera offset from shake, in world pixels. */
  shakeX = 0;
  shakeY = 0;

  /** True while hitstop is freezing the simulation clock. */
  get frozen(): boolean {
    return this.hitstop > 0;
  }

  // ─────────────────────────────────────────────── triggers

  addShake(amount: number): void {
    this.shake = Math.min(14, this.shake + amount);
  }

  addHitstop(seconds: number): void {
    this.hitstop = Math.max(this.hitstop, seconds);
  }

  flash(color: string, alpha = 0.35): void {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  text(x: number, y: number, text: string, color: string, size = 12, pop = 1.6): void {
    this.texts.push({
      x, y, vy: -34, life: 1.1, maxLife: 1.1, text, color, size, pop, outline: true,
    });
  }

  /** The damage number. Scale and colour both carry how badly it hurt. */
  damageNumber(x: number, y: number, damage: number, fraction: number, crit: boolean): void {
    const size = crit ? 20 : 11 + Math.min(11, fraction * 30);
    this.texts.push({
      x: x + this.rng.float(-4, 4),
      y,
      vy: crit ? -52 : -38,
      life: crit ? 1.5 : 1.1,
      maxLife: crit ? 1.5 : 1.1,
      text: crit ? `${damage}!` : `${damage}`,
      color: damageColor(fraction, crit),
      size,
      pop: crit ? 2.6 : 1.7,
      outline: true,
    });
  }

  // ─────────────────────────────────────────────── emitters

  blood(x: number, y: number, amount: number): void {
    const n = Math.min(26, 5 + Math.floor(amount * 0.7));
    for (let i = 0; i < n; i++) {
      const a = this.rng.float(0, Math.PI * 2);
      const s = this.rng.float(25, 130);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 30,
        g: 260,
        life: this.rng.float(0.35, 0.8),
        maxLife: 0.8,
        size: this.rng.float(1, 2.6),
        color: this.rng.chance(0.25) ? toHex(PAL.bloodBright) : toHex(PAL.blood),
        drag: 1.5,
        shape: 'square',
        fade: true,
      });
    }
  }

  /** Grey-green mist for the dead — they do not bleed red any more. */
  rot(x: number, y: number, amount: number): void {
    const n = Math.min(20, 4 + Math.floor(amount * 0.5));
    for (let i = 0; i < n; i++) {
      const a = this.rng.float(0, Math.PI * 2);
      const s = this.rng.float(15, 80);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 20,
        g: 120,
        life: this.rng.float(0.4, 1),
        maxLife: 1,
        size: this.rng.float(1.5, 3.4),
        color: this.rng.chance(0.4) ? toHex(PAL.rotDark) : toHex(PAL.rot),
        drag: 2.4,
        shape: 'circle',
        fade: true,
      });
    }
  }

  sparks(x: number, y: number, dirX: number, dirY: number, n = 8): void {
    for (let i = 0; i < n; i++) {
      const spread = this.rng.float(-0.6, 0.6);
      const c = Math.cos(spread);
      const s = Math.sin(spread);
      const vx = (dirX * c - dirY * s) * this.rng.float(60, 220);
      const vy = (dirX * s + dirY * c) * this.rng.float(60, 220);
      this.particles.push({
        x, y, vx, vy,
        g: 340,
        life: this.rng.float(0.15, 0.4),
        maxLife: 0.4,
        size: this.rng.float(1, 2),
        color: this.rng.chance(0.5) ? toHex(PAL.gold) : toHex(PAL.amber),
        drag: 2,
        shape: 'streak',
        fade: true,
      });
    }
  }

  /** Dust kicked up by a footstep or an impact on the ground. */
  dust(x: number, y: number, n = 5): void {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: x + this.rng.float(-3, 3),
        y: y + this.rng.float(-2, 2),
        vx: this.rng.float(-18, 18),
        vy: this.rng.float(-26, -6),
        g: 30,
        life: this.rng.float(0.3, 0.7),
        maxLife: 0.7,
        size: this.rng.float(1.5, 3.5),
        color: toHex(PAL.ash),
        drag: 3,
        shape: 'circle',
        fade: true,
      });
    }
  }

  explosion(x: number, y: number, radius: number): void {
    // Core fireball.
    for (let i = 0; i < 30; i++) {
      const a = this.rng.float(0, Math.PI * 2);
      const s = this.rng.float(40, 60 + radius * 40);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        g: -40,
        life: this.rng.float(0.25, 0.6),
        maxLife: 0.6,
        size: this.rng.float(2, 6),
        color: this.rng.chance(0.4) ? toHex(PAL.gold) : toHex(PAL.rust),
        drag: 2.5,
        shape: 'circle',
        fade: true,
      });
    }
    // Smoke that lingers after the flash is gone.
    for (let i = 0; i < 22; i++) {
      const a = this.rng.float(0, Math.PI * 2);
      const s = this.rng.float(10, 50);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 20,
        g: -18,
        life: this.rng.float(0.8, 1.8),
        maxLife: 1.8,
        size: this.rng.float(4, 9),
        color: '#3a3733',
        drag: 1.6,
        shape: 'circle',
        fade: true,
      });
    }
    this.addShake(6 + radius);
    this.addHitstop(0.06);
    this.flash('#ffcf6b', 0.3);
  }

  /** Tracer streak from muzzle to target. */
  tracer(x0: number, y0: number, x1: number, y1: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const steps = Math.min(20, Math.max(4, Math.floor(len / 8)));
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      this.particles.push({
        x: x0 + dx * t,
        y: y0 + dy * t,
        vx: (dx / len) * 30,
        vy: (dy / len) * 30,
        g: 0,
        life: 0.09 + t * 0.05,
        maxLife: 0.16,
        size: 1.4,
        color: toHex(PAL.gold),
        drag: 0,
        shape: 'streak',
        fade: true,
      });
    }
  }

  /** Ejected brass — small, but it sells the act of firing. */
  brass(x: number, y: number, count = 1): void {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x, y,
        vx: this.rng.float(20, 70) * (this.rng.chance(0.5) ? 1 : -1),
        vy: this.rng.float(-90, -40),
        g: 420,
        life: this.rng.float(0.5, 0.9),
        maxLife: 0.9,
        size: 1.4,
        color: toHex(PAL.gold),
        drag: 0.6,
        shape: 'square',
        fade: false,
      });
    }
  }

  /** XP shards flying from a corpse to the merc's portrait. */
  xpBurst(x: number, y: number, tx: number, ty: number, count: number): void {
    for (let i = 0; i < Math.min(14, count); i++) {
      this.shards.push({
        x: x + this.rng.float(-6, 6),
        y: y + this.rng.float(-6, 6),
        tx, ty,
        life: 0,
        maxLife: this.rng.float(0.55, 0.95),
        color: toHex(PAL.cyan),
        cx: this.rng.float(-90, 90),
        cy: this.rng.float(-120, -30),
      });
    }
  }

  /** Rising motes for a level-up — deliberately gold, deliberately unmissable. */
  levelUp(x: number, y: number): void {
    for (let i = 0; i < 34; i++) {
      this.particles.push({
        x: x + this.rng.float(-14, 14),
        y: y + this.rng.float(-4, 12),
        vx: this.rng.float(-16, 16),
        vy: this.rng.float(-120, -50),
        g: 40,
        life: this.rng.float(0.7, 1.5),
        maxLife: 1.5,
        size: this.rng.float(1.4, 3),
        color: this.rng.chance(0.5) ? toHex(PAL.gold) : toHex(PAL.white),
        drag: 1,
        shape: 'square',
        fade: true,
      });
    }
    this.flash(toHex(PAL.gold), 0.22);
  }

  // ─────────────────────────────────────────────── update & draw

  /**
   * Advance effects. Returns the simulation time delta, which is zero during hitstop —
   * so callers should drive game logic with the return value, not the raw dt.
   */
  update(dt: number): number {
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
    }

    // Shake decays exponentially and is sampled as noise, not a sine — sine reads as a wobble.
    if (this.shake > 0.05) {
      this.shake *= Math.exp(-this.shakeDecay * dt);
      this.shakeX = this.rng.float(-this.shake, this.shake);
      this.shakeY = this.rng.float(-this.shake, this.shake);
    } else {
      this.shake = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }

    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2.2);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]!;
      t.life -= dt;
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      t.y += t.vy * dt;
      t.vy *= Math.exp(-2.4 * dt);
      t.pop += (1 - t.pop) * Math.min(1, dt * 12);
    }

    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i]!;
      s.life += dt;
      if (s.life >= s.maxLife) this.shards.splice(i, 1);
    }

    return this.hitstop > 0 ? 0 : dt;
  }

  /** Draw world-space effects. Call inside the camera transform. */
  drawWorld(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      ctx.globalAlpha = p.fade ? Math.max(0, Math.min(1, t)) : 1;
      ctx.fillStyle = p.color;
      const s = p.size * (p.shape === 'circle' ? Math.max(0.4, t) : 1);
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'streak') {
        const len = Math.hypot(p.vx, p.vy) * 0.03;
        const a = Math.atan2(p.vy, p.vx);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(a);
        ctx.fillRect(-len, -s / 2, len * 2, s);
        ctx.restore();
      } else {
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Draw screen-space effects: numbers, shards, and the full-screen flash. */
  drawScreen(
    ctx: CanvasRenderingContext2D,
    toScreen: (x: number, y: number) => { x: number; y: number },
    w: number,
    h: number,
  ): void {
    // XP shards arc toward the portrait using a quadratic bezier.
    for (const s of this.shards) {
      const t = Math.min(1, s.life / s.maxLife);
      const e = t * t * (3 - 2 * t); // smoothstep — slow out, fast in
      const p0 = toScreen(s.x, s.y);
      const mx = (p0.x + s.tx) / 2 + s.cx;
      const my = (p0.y + s.ty) / 2 + s.cy;
      const it = 1 - e;
      const x = it * it * p0.x + 2 * it * e * mx + e * e * s.tx;
      const y = it * it * p0.y + 2 * it * e * my + e * e * s.ty;
      ctx.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : 1;
      ctx.fillStyle = s.color;
      const size = 3 + (1 - e) * 2;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      // Trailing glow.
      ctx.globalAlpha *= 0.35;
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const frac = t.life / t.maxLife;
      const p = toScreen(t.x, t.y);
      const size = t.size * t.pop;
      ctx.globalAlpha = frac > 0.7 ? 1 : frac / 0.7;
      ctx.font = `900 ${size.toFixed(1)}px "Courier New", monospace`;
      if (t.outline) {
        ctx.lineWidth = Math.max(2, size * 0.22);
        ctx.strokeStyle = '#0b0d09';
        ctx.lineJoin = 'round';
        ctx.strokeText(t.text, p.x, p.y);
      }
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    if (this.flashAlpha > 0.002) {
      ctx.globalAlpha = this.flashAlpha;
      ctx.fillStyle = this.flashColor || '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  clear(): void {
    this.particles.length = 0;
    this.texts.length = 0;
    this.shards.length = 0;
    this.shake = 0;
    this.hitstop = 0;
    this.flashAlpha = 0;
  }
}
