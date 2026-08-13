import { describe, expect, it } from 'vitest';
import { vec } from '@/core/grid';
import { EventSink } from '@/sim/events';
import {
  addStatus,
  applyDamage,
  estimateShot,
  fireAt,
  hasStatus,
  resolveWeapon,
  shotApCost,
  unitMods,
  activeWeapon,
  MAX_AIM,
} from '@/sim/combat';
import { makeWeapon } from '@/sim/spawn';
import { Rng } from '@/core/rng';
import { addEnemy, addMerc, arena, arm, put } from './helpers';

const PLAN = { mode: 'single', aim: 0, part: 'torso' } as const;

describe('weapon resolution', () => {
  it('applies attachment deltas on top of the base definition', () => {
    const bare = makeWeapon('warden4')!;
    const scoped = makeWeapon('warden4', { attachments: { optic: 'opt_scope4x' } })!;
    const a = resolveWeapon(bare)!;
    const b = resolveWeapon(scoped)!;
    // Whatever the exact numbers, fitting an optic must change something.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('rejects attachments that do not fit the weapon class', () => {
    // A bipod has no business on a knife.
    const knife = makeWeapon('gutterknife', { attachments: { underbarrel: 'ub_bipod' } })!;
    expect(knife.attachments.underbarrel).toBeUndefined();
  });

  it('costs accuracy as condition degrades', () => {
    const good = resolveWeapon(makeWeapon('warden4', { condition: 100 })!)!;
    const beaten = resolveWeapon(makeWeapon('warden4', { condition: 20 })!)!;
    expect(beaten.accuracy).toBeLessThan(good.accuracy);
  });

  it('resolves natural weapons that are absent from the market catalogue', () => {
    expect(resolveWeapon(makeWeapon('zombie-claws')!)).not.toBeNull();
  });
});

describe('hit chance', () => {
  it('falls off beyond the weapon\'s optimal range', () => {
    const b = arena(60, 20);
    const shooter = addMerc(b, 'nine', vec(2, 10));
    arm(shooter, 'warden4');
    const near = addEnemy(b, 'raider', vec(6, 10));
    const far = addEnemy(b, 'raider', vec(34, 10));
    expect(estimateShot(b, shooter, near, PLAN).chance)
      .toBeGreaterThan(estimateShot(b, shooter, far, PLAN).chance);
  });

  it('improves with each level of aim, with diminishing returns', () => {
    const b = arena(40, 20);
    const shooter = addMerc(b, 'nine', vec(2, 10));
    arm(shooter, 'warden4');
    const target = addEnemy(b, 'raider', vec(12, 10));

    const chances = [];
    for (let aim = 0; aim <= MAX_AIM; aim++) {
      chances.push(estimateShot(b, shooter, target, { ...PLAN, aim }).chance);
    }
    for (let i = 1; i < chances.length; i++) {
      expect(chances[i]!).toBeGreaterThanOrEqual(chances[i - 1]!);
    }
    // Each step must add less than the one before it.
    const firstGain = chances[1]! - chances[0]!;
    const lastGain = chances[MAX_AIM]! - chances[MAX_AIM - 1]!;
    expect(lastGain).toBeLessThan(firstGain);
  });

  it('is reduced by cover and restored by flanking', () => {
    const b = arena(40, 20);
    const target = addEnemy(b, 'raider', vec(20, 10));
    put(b, 'sandbag', 19, 10);

    const behind = addMerc(b, 'nine', vec(10, 10));
    arm(behind, 'warden4');
    const flanker = addMerc(b, 'nine', vec(28, 10));
    arm(flanker, 'warden4');

    expect(estimateShot(b, behind, target, PLAN).cover).toBe(1);
    expect(estimateShot(b, flanker, target, PLAN).cover).toBe(0);
    expect(estimateShot(b, flanker, target, PLAN).chance)
      .toBeGreaterThan(estimateShot(b, behind, target, PLAN).chance);
  });

  it('is zero without line of sight', () => {
    const b = arena(40, 20);
    const shooter = addMerc(b, 'nine', vec(5, 10));
    arm(shooter, 'warden4');
    const target = addEnemy(b, 'raider', vec(15, 10));
    for (let y = 5; y <= 15; y++) put(b, 'wall', 10, y);
    const est = estimateShot(b, shooter, target, PLAN);
    expect(est.hasLos).toBe(false);
    expect(est.chance).toBe(0);
  });

  it('makes a called headshot harder than a torso shot', () => {
    const b = arena(40, 20);
    const shooter = addMerc(b, 'nine', vec(5, 10));
    arm(shooter, 'warden4');
    const target = addEnemy(b, 'raider', vec(12, 10));
    expect(estimateShot(b, shooter, target, { ...PLAN, aim: 2, part: 'head' }).chance)
      .toBeLessThan(estimateShot(b, shooter, target, { ...PLAN, aim: 2, part: 'torso' }).chance);
  });

  it('never exceeds a 99% certainty', () => {
    const b = arena(20, 20);
    const shooter = addMerc(b, 'vy', vec(9, 10));
    arm(shooter, 'longshot');
    const target = addEnemy(b, 'raider', vec(11, 10));
    target.stance = 'standing';
    const est = estimateShot(b, shooter, target, { ...PLAN, aim: MAX_AIM });
    expect(est.chance).toBeLessThanOrEqual(0.99);
  });

  it('degrades successive rounds in a burst through recoil', () => {
    const b = arena(40, 20);
    const shooter = addMerc(b, 'nine', vec(5, 10));
    arm(shooter, 'kalash7');
    const target = addEnemy(b, 'raider', vec(12, 10));
    const est = estimateShot(b, shooter, target, { ...PLAN, mode: 'burst' });
    if (est.rounds > 1) {
      for (let i = 1; i < est.perRound.length; i++) {
        expect(est.perRound[i]!).toBeLessThan(est.perRound[i - 1]!);
      }
    }
  });

  it('charges AP for aiming and for extra rounds', () => {
    const b = arena(20, 20);
    const u = addMerc(b, 'nine', vec(5, 5));
    arm(u, 'kalash7');
    const w = activeWeapon(u)!;
    expect(shotApCost(u, w, { ...PLAN, aim: 2 })).toBeGreaterThan(shotApCost(u, w, PLAN));
    expect(shotApCost(u, w, { ...PLAN, mode: 'burst' })).toBeGreaterThan(shotApCost(u, w, PLAN));
  });
});

describe('damage', () => {
  it('is reduced by armour at the struck location', () => {
    const b = arena();
    const sink = new EventSink();
    const rng = new Rng(1);

    const soft = addEnemy(b, 'raider', vec(5, 5));
    soft.armour = { head: 0, torso: 0, arms: 0, legs: 0 };
    const hard = addEnemy(b, 'raider', vec(6, 5));
    hard.armour = { head: 0, torso: 15, arms: 0, legs: 0 };
    hard.maxHp = soft.maxHp;
    hard.hp = soft.hp;

    const a = applyDamage(b, new Rng(1), soft, 40, 'torso', 0, sink);
    const c = applyDamage(b, rng, hard, 40, 'torso', 0, sink);
    expect(c.dealt).toBeLessThan(a.dealt);
  });

  it('lets penetration cut through armour', () => {
    const b = arena();
    const sink = new EventSink();
    const mk = () => {
      const u = addEnemy(b, 'raider', vec(5, 5));
      u.armour = { head: 0, torso: 20, arms: 0, legs: 0 };
      return u;
    };
    const blunt = applyDamage(b, new Rng(3), mk(), 40, 'torso', 0, sink);
    const ap = applyDamage(b, new Rng(3), mk(), 40, 'torso', 18, sink);
    expect(ap.dealt).toBeGreaterThan(blunt.dealt);
  });

  it('multiplies damage for a headshot', () => {
    const b = arena();
    const sink = new EventSink();
    const mk = () => addEnemy(b, 'raider', vec(5, 5));
    const torso = applyDamage(b, new Rng(9), mk(), 20, 'torso', 0, sink);
    const head = applyDamage(b, new Rng(9), mk(), 20, 'head', 0, sink);
    expect(head.dealt).toBeGreaterThan(torso.dealt);
  });

  it('always deals at least one point, however heavy the armour', () => {
    const b = arena();
    const sink = new EventSink();
    const u = addEnemy(b, 'raider', vec(5, 5));
    u.armour = { head: 0, torso: 999, arms: 0, legs: 0 };
    expect(applyDamage(b, new Rng(1), u, 10, 'torso', 0, sink).dealt).toBeGreaterThanOrEqual(1);
  });

  it('downs a merc into the Critical window rather than killing them outright', () => {
    const b = arena();
    const sink = new EventSink();
    const m = addMerc(b, 'nine', vec(5, 5));
    m.hp = 5;
    const res = applyDamage(b, new Rng(2), m, 8, 'torso', 0, sink);
    expect(res.killed).toBe(false);
    expect(res.downed).toBe(true);
    expect(m.alive).toBe(true);
    expect(m.critical).toBe(true);
    expect(m.criticalTurns).toBe(3);
  });

  it('kills a merc outright when the damage is overwhelming', () => {
    const b = arena();
    const sink = new EventSink();
    const m = addMerc(b, 'nine', vec(5, 5));
    const res = applyDamage(b, new Rng(2), m, m.maxHp * 3, 'torso', 0, sink);
    expect(res.killed).toBe(true);
    expect(m.alive).toBe(false);
  });

  it('kills a zombie outright — the Critical window is for mercs only', () => {
    const b = arena();
    const sink = new EventSink();
    const z = addEnemy(b, 'shambler', vec(5, 5));
    applyDamage(b, new Rng(2), z, z.maxHp + 20, 'torso', 0, sink);
    expect(z.alive).toBe(false);
    expect(z.critical).toBe(false);
  });

  it('writes a blood decal onto the tile that was hit', () => {
    const b = arena();
    const sink = new EventSink();
    const z = addEnemy(b, 'shambler', vec(7, 7));
    expect(b.decals[7 * b.w + 7]).toBe(0);
    applyDamage(b, new Rng(2), z, 20, 'torso', 0, sink);
    expect(b.decals[7 * b.w + 7]!).toBeGreaterThan(0);
  });
});

describe('firing', () => {
  it('consumes AP and ammunition', () => {
    const b = arena(30, 20);
    const sink = new EventSink();
    const u = addMerc(b, 'nine', vec(5, 10));
    arm(u, 'warden4');
    const t = addEnemy(b, 'raider', vec(12, 10));

    const apBefore = u.ap;
    const ammoBefore = u.weapon!.loaded;
    fireAt(b, u, t, PLAN, sink);
    expect(u.ap).toBeLessThan(apBefore);
    expect(u.weapon!.loaded).toBe(ammoBefore - 1);
  });

  it('refuses to fire without the AP to pay for it', () => {
    const b = arena(30, 20);
    const sink = new EventSink();
    const u = addMerc(b, 'nine', vec(5, 10));
    arm(u, 'warden4');
    const t = addEnemy(b, 'raider', vec(12, 10));
    u.ap = 0;
    expect(fireAt(b, u, t, PLAN, sink).fired).toBe(0);
  });

  it('fires multiple rounds on burst', () => {
    const b = arena(30, 20);
    const sink = new EventSink();
    const u = addMerc(b, 'nine', vec(5, 10));
    arm(u, 'kalash7');
    u.ap = 30;
    const t = addEnemy(b, 'raider', vec(12, 10));
    t.hp = 9999;
    t.maxHp = 9999;
    const out = fireAt(b, u, t, { ...PLAN, mode: 'burst' }, sink);
    expect(out.fired).toBeGreaterThan(1);
  });

  it('emits noise the dead can follow', () => {
    const b = arena(40, 30);
    const sink = new EventSink();
    const u = addMerc(b, 'nine', vec(10, 15));
    arm(u, 'warden4');
    const t = addEnemy(b, 'raider', vec(18, 15));
    fireAt(b, u, t, PLAN, sink);
    expect(b.noise[15 * b.w + 10]!).toBeGreaterThan(0);
    expect(sink.events.some((e) => e.t === 'noise')).toBe(true);
  });

  it('makes far less noise with a suppressor fitted', () => {
    const b = arena(40, 30);
    const loud = addMerc(b, 'nine', vec(10, 15));
    loud.weapon = makeWeapon('warden4');
    const quiet = addMerc(b, 'nine', vec(30, 15));
    quiet.weapon = makeWeapon('warden4', { attachments: { barrel: 'bar_suppressor' } });

    const a = resolveWeapon(loud.weapon!)!;
    const c = resolveWeapon(quiet.weapon!)!;
    expect(c.noise).toBeLessThan(a.noise);
  });

  it('wears the weapon down as it is used', () => {
    const b = arena(30, 20);
    const sink = new EventSink();
    const u = addMerc(b, 'nine', vec(5, 10));
    arm(u, 'kalash7');
    u.ap = 200;
    const t = addEnemy(b, 'raider', vec(12, 10));
    t.hp = 99999;
    t.maxHp = 99999;
    const before = u.weapon!.condition;
    for (let i = 0; i < 5; i++) fireAt(b, u, t, PLAN, sink);
    expect(u.weapon!.condition).toBeLessThan(before);
  });

  it('suppresses a target that survives sustained fire', () => {
    const b = arena(30, 20);
    const sink = new EventSink();
    const u = addMerc(b, 'nine', vec(5, 10));
    arm(u, 'kalash7');
    u.ap = 40;
    const t = addEnemy(b, 'raider', vec(12, 10));
    t.hp = 99999;
    t.maxHp = 99999;
    fireAt(b, u, t, { ...PLAN, mode: 'auto' }, sink);
    expect(hasStatus(t, 'suppressed')).toBe(true);
  });

  it('is reproducible from the same RNG state', () => {
    const run = (): number => {
      const b = arena(30, 20, 7);
      b.rngState = 4242;
      const sink = new EventSink();
      const u = addMerc(b, 'nine', vec(5, 10));
      arm(u, 'kalash7');
      u.ap = 40;
      const t = addEnemy(b, 'raider', vec(12, 10));
      t.hp = 500;
      t.maxHp = 500;
      return fireAt(b, u, t, { ...PLAN, mode: 'burst' }, sink).damage;
    };
    expect(run()).toBe(run());
  });
});

describe('modifiers', () => {
  it('aggregates perk and trait mods for a unit', () => {
    const b = arena();
    const vy = addMerc(b, 'vy', vec(5, 5));
    const mods = unitMods(vy);
    // Grandma Vy is built from real perks and traits, so something must be off-default.
    expect(JSON.stringify(mods)).not.toBe(JSON.stringify(unitMods(addMerc(b, 'nine', vec(6, 5)))));
  });

  it('lets a shaky arm wound cut accuracy', () => {
    const b = arena(30, 20);
    const u = addMerc(b, 'nine', vec(5, 10));
    arm(u, 'warden4');
    const t = addEnemy(b, 'raider', vec(12, 10));
    const before = estimateShot(b, u, t, PLAN).chance;
    addStatus(u, 'shaky', 3);
    expect(estimateShot(b, u, t, PLAN).chance).toBeLessThan(before);
  });
});
