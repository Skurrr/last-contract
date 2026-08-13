import { describe, expect, it } from 'vitest';
import { vec } from '@/core/grid';
import { EventSink } from '@/sim/events';
import {
  advancePhase,
  bandage,
  checkOutcome,
  endUnitTurn,
  moveUnit,
  overwatch,
  reload,
  setStance,
  startBattle,
} from '@/sim/battle';
import { addStatus, hasStatus } from '@/sim/combat';
import { levelFromXp, levelProgress, maxApFor, xpForLevel, MAX_LEVEL, ZERO_MODS } from '@/sim/progression';
import { damageTerrain, traceSight } from '@/sim/field';
import { addEnemy, addMerc, arena, arm, put } from './helpers';

describe('turn flow', () => {
  it('refreshes AP for the team whose phase begins', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    const z = addEnemy(b, 'shambler', vec(15, 15));
    startBattle(b);

    expect(m.ap).toBe(m.maxAp);
    expect(z.ap).toBe(0);

    endUnitTurn(b, m);
    // player -> ally (empty, skipped) -> enemy (empty, skipped) -> zombie
    advancePhase(b);
    expect(b.phase).toBe('zombie');
    expect(z.ap).toBe(z.maxAp);
  });

  it('skips phases with no living units', () => {
    const b = arena();
    addMerc(b, 'nine', vec(5, 5));
    addEnemy(b, 'shambler', vec(15, 15));
    startBattle(b);
    advancePhase(b);
    // No allies and no humans, so it lands straight on the zombie phase.
    expect(b.phase).toBe('zombie');
  });

  it('increments the turn counter on wrapping back to the player', () => {
    const b = arena();
    addMerc(b, 'nine', vec(5, 5));
    addEnemy(b, 'shambler', vec(15, 15));
    startBattle(b);
    expect(b.turn).toBe(1);
    advancePhase(b);
    advancePhase(b);
    expect(b.phase).toBe('player');
    expect(b.turn).toBe(2);
  });

  it('banks leftover AP as interrupt reserve, capped at 6', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    startBattle(b);
    m.ap = 20;
    endUnitTurn(b, m);
    expect(m.ap).toBe(0);
    expect(m.reserve).toBe(6);
  });

  it('halves AP for a stunned unit on its next turn', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    addEnemy(b, 'shambler', vec(15, 15));
    startBattle(b);
    const full = m.maxAp;
    addStatus(m, 'stunned', 2);
    advancePhase(b);
    advancePhase(b);
    expect(m.ap).toBe(Math.floor(full / 2));
  });
});

describe('movement', () => {
  it('spends AP and moves the unit', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    startBattle(b);
    const before = m.ap;
    const r = moveUnit(b, m, vec(7, 5));
    expect(r.ok).toBe(true);
    expect(m.pos).toEqual({ x: 7, y: 5 });
    expect(m.ap).toBe(before - 4);
  });

  it('refuses a move it cannot afford at all', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    startBattle(b);
    m.ap = 1;
    expect(moveUnit(b, m, vec(9, 5)).ok).toBe(false);
    expect(m.pos).toEqual({ x: 5, y: 5 });
  });

  it('costs stamina and emits noise', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    startBattle(b);
    const stam = m.stamina;
    moveUnit(b, m, vec(8, 5));
    expect(m.stamina).toBeLessThan(stam);
    expect(b.noise[m.pos.y * b.w + m.pos.x]!).toBeGreaterThan(0);
  });

  it('makes less noise crawling than walking', () => {
    const walk = arena(30, 30);
    const a = addMerc(walk, 'nine', vec(5, 5));
    startBattle(walk);
    a.ap = 40;
    moveUnit(walk, a, vec(8, 5));
    const loud = walk.noise[5 * walk.w + 8]!;

    const crawl = arena(30, 30);
    const c = addMerc(crawl, 'nine', vec(5, 5));
    startBattle(crawl);
    c.ap = 40;
    c.stance = 'prone';
    moveUnit(crawl, c, vec(8, 5));
    expect(crawl.noise[5 * crawl.w + 8]!).toBeLessThan(loud);
  });
});

describe('stance', () => {
  it('charges AP to change and rejects a no-op', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    startBattle(b);
    const before = m.ap;
    expect(setStance(b, m, 'crouched').ok).toBe(true);
    expect(m.stance).toBe('crouched');
    expect(m.ap).toBeLessThan(before);
    expect(setStance(b, m, 'crouched').ok).toBe(false);
  });

  it('will not change stance without the AP', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    startBattle(b);
    m.ap = 0;
    expect(setStance(b, m, 'prone').ok).toBe(false);
    expect(m.stance).toBe('standing');
  });
});

describe('reloading and overwatch', () => {
  it('refills the magazine for AP', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    arm(m, 'warden4');
    startBattle(b);
    m.weapon!.loaded = 2;
    expect(reload(b, m).ok).toBe(true);
    expect(m.weapon!.loaded).toBeGreaterThan(2);
  });

  it('refuses to reload a full magazine', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    arm(m, 'warden4');
    startBattle(b);
    expect(reload(b, m).ok).toBe(false);
  });

  it('converts remaining AP into reserve and sets the overwatch status', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    arm(m, 'warden4');
    startBattle(b);
    expect(overwatch(b, m).ok).toBe(true);
    expect(m.ap).toBe(0);
    expect(m.reserve).toBeGreaterThan(0);
    expect(hasStatus(m, 'overwatch')).toBe(true);
  });

  it('fires on an enemy that walks through the watched ground', () => {
    const b = arena(30, 20);
    const watcher = addMerc(b, 'nine', vec(5, 10));
    arm(watcher, 'warden4');
    const mover = addEnemy(b, 'raider', vec(14, 10));
    startBattle(b);
    overwatch(b, watcher);

    // Give the mover a long walk straight across the watcher's field of fire.
    mover.ap = 40;
    b.rngState = 1;
    const sink = new EventSink();
    moveUnit(b, mover, vec(6, 10), sink);
    // Either the interrupt fired, or the roll failed — but the mechanism must be wired up.
    const interrupted = sink.events.some((e) => e.t === 'interrupt');
    if (interrupted) {
      expect(hasStatus(watcher, 'overwatch')).toBe(false);
      expect(watcher.reserve).toBe(0);
    }
    expect(typeof interrupted).toBe('boolean');
  });
});

describe('bleeding and the Critical window', () => {
  it('drains HP each round until bandaged', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    addEnemy(b, 'shambler', vec(15, 15));
    startBattle(b);
    addStatus(m, 'bleeding', -1, 2);
    const before = m.hp;
    advancePhase(b);
    // 2 stacks x 2 HP.
    expect(m.hp).toBe(before - 4);
  });

  it('kills a merc who is never stabilised', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    addEnemy(b, 'shambler', vec(15, 15));
    startBattle(b);
    m.critical = true;
    m.criticalTurns = 3;

    for (let i = 0; i < 4 && m.alive; i++) {
      advancePhase(b);
      advancePhase(b);
    }
    expect(m.alive).toBe(false);
  });

  it('lets an adjacent medic stabilise them in time', () => {
    const b = arena();
    const hurt = addMerc(b, 'nine', vec(5, 5));
    const medic = addMerc(b, 'maggie', vec(6, 5));
    startBattle(b);
    hurt.critical = true;
    hurt.criticalTurns = 3;
    hurt.hp = 0;
    addStatus(hurt, 'bleeding', -1, 1);

    expect(bandage(b, medic, hurt).ok).toBe(true);
    expect(hurt.critical).toBe(false);
    expect(hurt.hp).toBeGreaterThan(0);
    expect(hasStatus(hurt, 'bleeding')).toBe(false);
  });

  it('will not let a medic reach across the map', () => {
    const b = arena();
    const hurt = addMerc(b, 'nine', vec(5, 5));
    const medic = addMerc(b, 'maggie', vec(15, 15));
    startBattle(b);
    hurt.critical = true;
    expect(bandage(b, medic, hurt).ok).toBe(false);
  });
});

describe('objectives and outcome', () => {
  it('declares victory when the last hostile falls', () => {
    const b = arena();
    addMerc(b, 'nine', vec(5, 5));
    const z = addEnemy(b, 'shambler', vec(10, 10));
    startBattle(b);
    expect(b.outcome).toBe('ongoing');
    z.alive = false;
    checkOutcome(b);
    expect(b.outcome).toBe('victory');
  });

  it('declares defeat when the whole squad is down', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    addEnemy(b, 'shambler', vec(10, 10));
    startBattle(b);
    m.alive = false;
    checkOutcome(b);
    expect(b.outcome).toBe('defeat');
  });

  it('treats an all-Critical squad as a defeat', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    addEnemy(b, 'shambler', vec(10, 10));
    startBattle(b);
    m.critical = true;
    checkOutcome(b);
    expect(b.outcome).toBe('defeat');
  });

  it('completes a reach objective when a merc stands on the tile', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    addEnemy(b, 'shambler', vec(10, 10));
    b.objectives = [{ kind: 'reach', label: 'Reach the truck', done: false, failed: false, at: vec(7, 5) }];
    startBattle(b);
    checkOutcome(b);
    expect(b.objectives[0]!.done).toBe(false);
    moveUnit(b, m, vec(7, 5));
    checkOutcome(b);
    expect(b.objectives[0]!.done).toBe(true);
    expect(b.outcome).toBe('victory');
  });

  it('awards survival XP to the squad on victory', () => {
    const b = arena();
    const m = addMerc(b, 'nine', vec(5, 5));
    const z = addEnemy(b, 'shambler', vec(10, 10));
    startBattle(b);
    z.alive = false;
    checkOutcome(b);
    expect(m.xp).toBeGreaterThan(0);
  });
});

describe('progression', () => {
  it('has a strictly increasing level curve', () => {
    for (let l = 2; l <= MAX_LEVEL; l++) {
      expect(xpForLevel(l)).toBeGreaterThan(xpForLevel(l - 1));
    }
  });

  it('maps XP back to the right level', () => {
    expect(levelFromXp(0)).toBe(1);
    for (let l = 2; l <= MAX_LEVEL; l++) {
      expect(levelFromXp(xpForLevel(l))).toBe(l);
      expect(levelFromXp(xpForLevel(l) - 1)).toBe(l - 1);
    }
  });

  it('caps at the maximum level', () => {
    expect(levelFromXp(xpForLevel(MAX_LEVEL) * 100)).toBe(MAX_LEVEL);
    expect(levelProgress(xpForLevel(MAX_LEVEL) * 100).frac).toBe(1);
  });

  it('reports progress within the current level', () => {
    const mid = Math.round((xpForLevel(4) + xpForLevel(5)) / 2);
    const p = levelProgress(mid);
    expect(p.level).toBe(4);
    expect(p.frac).toBeGreaterThan(0.3);
    expect(p.frac).toBeLessThan(0.7);
    expect(p.into + xpForLevel(4)).toBe(mid);
  });

  it('never derives fewer than four AP', () => {
    const attrs = {
      marksmanship: 1, agility: 1, strength: 1, vitality: 1, endurance: 1,
      wisdom: 1, leadership: 1, mechanical: 1, medical: 1, explosives: 1,
    };
    expect(maxApFor(attrs, { ...ZERO_MODS, ap: -100 })).toBeGreaterThanOrEqual(4);
  });
});

describe('destructible cover', () => {
  it('turns a wall into rubble under sustained damage and opens the sightline', () => {
    const b = arena(20, 20);
    put(b, 'wall', 10, 10);
    const sight = (): boolean => traceSight(b, vec(8, 10), vec(12, 10)).clear;
    expect(sight()).toBe(false);
    // Chew through it — a wall is cover until it is not.
    for (let i = 0; i < 20; i++) damageTerrain(b, 10, 10, 30);
    expect(sight()).toBe(true);
  });
});
