import { describe, expect, it } from 'vitest';
import { vec } from '@/core/grid';
import { EventSink } from '@/sim/events';
import {
  canThrow,
  throwables,
  throwApCost,
  throwAt,
  throwRange,
} from '@/sim/throwing';
import { hasStatus } from '@/sim/combat';
import { noiseAt } from '@/sim/field';
import { addEnemy, addMerc, arena } from './helpers';

describe('carrying ordnance', () => {
  it('only counts thrown items as throwables', () => {
    const b = arena();
    const u = addMerc(b, 'bricks', vec(5, 5));
    u.inventory = ['frag', 'molotov', 'frag', 'bandage', 'warden4'];
    const list = throwables(u);
    expect(list.map((t) => t.id).sort()).toEqual(['frag', 'molotov']);
    expect(list.find((t) => t.id === 'frag')?.count).toBe(2);
  });

  it('refuses to throw what is not carried', () => {
    const b = arena();
    const u = addMerc(b, 'nine', vec(5, 5));
    u.inventory = [];
    expect(canThrow(u, 'frag')).toBe(false);
  });

  it('reaches further for a stronger arm', () => {
    const b = arena();
    const weak = addMerc(b, 'vy', vec(5, 5));
    const strong = addMerc(b, 'steroid', vec(6, 5));
    expect(throwRange(strong, 'frag')).toBeGreaterThan(throwRange(weak, 'frag'));
  });
});

describe('throwing', () => {
  it('spends AP and consumes the item', () => {
    const b = arena(30, 30);
    const sink = new EventSink();
    const u = addMerc(b, 'bricks', vec(5, 5));
    u.inventory = ['frag'];
    const ap = u.ap;

    const out = throwAt(b, u, vec(9, 5), 'frag', sink);
    expect(out.ok).toBe(true);
    expect(u.inventory).toEqual([]);
    expect(u.ap).toBe(ap - throwApCost(u, 'frag'));
  });

  it('will not throw beyond its reach', () => {
    const b = arena(40, 40);
    const sink = new EventSink();
    const u = addMerc(b, 'nine', vec(5, 5));
    u.inventory = ['frag'];
    const out = throwAt(b, u, vec(35, 5), 'frag', sink);
    expect(out.ok).toBe(false);
    // The item must not be consumed by a throw that never happened.
    expect(u.inventory).toEqual(['frag']);
  });

  it('will not throw without the AP', () => {
    const b = arena(30, 30);
    const sink = new EventSink();
    const u = addMerc(b, 'nine', vec(5, 5));
    u.inventory = ['frag'];
    u.ap = 0;
    expect(throwAt(b, u, vec(8, 5), 'frag', sink).ok).toBe(false);
    expect(u.inventory).toEqual(['frag']);
  });

  it('damages everything caught in a frag burst', () => {
    const b = arena(30, 30);
    const sink = new EventSink();
    const u = addMerc(b, 'bricks', vec(5, 5));
    u.inventory = ['frag'];
    const a = addEnemy(b, 'shambler', vec(12, 12), 1);
    const c = addEnemy(b, 'shambler', vec(13, 12), 2);
    const far = addEnemy(b, 'shambler', vec(25, 25), 3);
    const hpA = a.hp;
    const hpFar = far.hp;

    throwAt(b, u, vec(12, 12), 'frag', sink);
    expect(a.hp).toBeLessThan(hpA);
    expect(c.hp).toBeLessThan(c.maxHp);
    expect(far.hp).toBe(hpFar);
  });

  it('lands a molotov as fire that poisons, not just damage', () => {
    const b = arena(30, 30);
    const sink = new EventSink();
    const u = addMerc(b, 'bricks', vec(5, 5));
    u.inventory = ['molotov'];
    const v = addEnemy(b, 'raider', vec(10, 5), 4);
    // Tough enough to survive the burst — a corpse cannot catch fire, which is why the
    // burn is applied to the living only.
    v.maxHp = 500;
    v.hp = 500;
    throwAt(b, u, vec(10, 5), 'molotov', sink);
    expect(v.hp).toBeLessThan(500);
    expect(hasStatus(v, 'poisoned')).toBe(true);
  });

  it('suppresses with smoke without hurting anyone', () => {
    const b = arena(30, 30);
    const sink = new EventSink();
    const u = addMerc(b, 'nine', vec(5, 5));
    u.inventory = ['smoke'];
    const v = addEnemy(b, 'raider', vec(10, 5), 5);
    const hp = v.hp;
    throwAt(b, u, vec(10, 5), 'smoke', sink);
    expect(v.hp).toBe(hp);
    expect(hasStatus(v, 'suppressed')).toBe(true);
  });

  it('makes a noisemaker the loudest thing on the map', () => {
    const b = arena(40, 40);
    const sink = new EventSink();
    const u = addMerc(b, 'coyote', vec(5, 20));
    u.inventory = ['chattercan'];
    const z = addEnemy(b, 'shambler', vec(20, 20), 6);

    throwAt(b, u, vec(14, 20), 'chattercan', sink);
    // The racket is louder where it landed than where it was thrown from.
    expect(noiseAt(b, 14, 20)).toBeGreaterThan(noiseAt(b, 5, 20));
    // And the dead are now interested in it rather than in the squad.
    expect(z.target).toEqual({ x: 14, y: 20 });
  });

  it('scatters less for a demolitions expert than for a novice', () => {
    // Averaged over many throws: skill should tighten the group.
    const missDistance = (mercId: string): number => {
      let total = 0;
      const trials = 60;
      for (let i = 0; i < trials; i++) {
        const b = arena(40, 40);
        b.rngState = 1000 + i * 7919;
        const u = addMerc(b, mercId, vec(5, 20));
        u.inventory = ['frag'];
        u.ap = 20;
        const aim = vec(12, 20);
        const out = throwAt(b, u, aim, 'frag', new EventSink());
        const at = out.landed ?? aim;
        total += Math.hypot(at.x - aim.x, at.y - aim.y);
      }
      return total / trials;
    };
    // Bricks has explosives 10; Steroid does not.
    expect(missDistance('bricks')).toBeLessThan(missDistance('steroid'));
  });

  it('is reproducible from the same RNG state', () => {
    const run = (): string => {
      const b = arena(30, 30);
      b.rngState = 4242;
      const u = addMerc(b, 'bricks', vec(5, 5));
      u.inventory = ['frag'];
      u.ap = 20;
      const v = addEnemy(b, 'raider', vec(11, 5), 7);
      throwAt(b, u, vec(11, 5), 'frag', new EventSink());
      return `${v.hp}`;
    };
    expect(run()).toBe(run());
  });
});

describe('field issue', () => {
  it('hands out bought ordnance and spends it from the stash', async () => {
    const { deploy } = await import('@/game/deploy');
    const { createMercState } = await import('@/sim/spawn');
    const { SECTORS } = await import('@/data/sectors');

    const supplies: Record<string, number> = { frag: 4 };
    const dep = deploy({
      seed: 4242,
      sector: SECTORS[0]!,
      squad: ['bricks', 'nine'].map((id) => createMercState(id)),
      supplies,
    });

    const carried = dep.squad.reduce(
      (n, u) => n + u.inventory.filter((i) => i === 'frag').length,
      0,
    );
    // Bricks takes up to three, Nine up to one, so all four leave the stash.
    expect(carried).toBeGreaterThanOrEqual(4);
    expect(supplies['frag']).toBe(0);
  });

  it('still issues a standard kit when the stash is empty', async () => {
    const { deploy } = await import('@/game/deploy');
    const { createMercState } = await import('@/sim/spawn');
    const { SECTORS } = await import('@/data/sectors');

    const dep = deploy({
      seed: 99,
      sector: SECTORS[0]!,
      squad: [createMercState('nine')],
      supplies: {},
    });
    const u = dep.squad[0]!;
    // Everyone carries a noisemaker — it is the counterplay to the noise system.
    expect(u.inventory).toContain('chattercan');
  });
});
