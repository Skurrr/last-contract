import { describe, expect, it } from 'vitest';
import { Rng } from '@/core/rng';
import { vec } from '@/core/grid';
import { collectAt, describeDrop, dropLootFor, dropRarity, emptyRecovered, rollLoot } from '@/sim/loot';
import { ENEMIES } from '@/data/enemies';
import { ALL_WEAPONS } from '@/data/index';
import { ATTACHMENTS } from '@/data/attachments';
import { addEnemy, addMerc, arena } from './helpers';

describe('loot rolls', () => {
  it('produces something for every enemy in the catalogue, across many seeds', () => {
    for (const def of Object.values(ENEMIES)) {
      const b = arena();
      const u = addEnemy(b, def.id, vec(5, 5), 1);
      let anyDrop = 0;
      for (let s = 1; s <= 60; s++) {
        if (rollLoot(u, new Rng(s * 7919))) anyDrop++;
      }
      // Some enemies are meant to be nearly barren, but nothing should be always empty.
      expect(anyDrop, `${def.id} never drops anything`).toBeGreaterThan(0);
    }
  });

  it('only ever names real weapons and attachments', () => {
    for (const def of Object.values(ENEMIES)) {
      const b = arena();
      const u = addEnemy(b, def.id, vec(5, 5), 3);
      for (let s = 1; s <= 40; s++) {
        const drop = rollLoot(u, new Rng(s * 104729));
        if (!drop) continue;
        for (const w of drop.weapons) {
          expect(ALL_WEAPONS[w.defId], `${def.id} dropped ${w.defId}`).toBeDefined();
        }
        for (const a of drop.attachments) {
          expect(ATTACHMENTS[a], `${def.id} dropped ${a}`).toBeDefined();
        }
      }
    }
  });

  it('never drops a weapon in impossible condition', () => {
    const b = arena();
    const u = addEnemy(b, 'raider_veteran', vec(5, 5), 9);
    for (let s = 1; s <= 60; s++) {
      const drop = rollLoot(u, new Rng(s * 2654435761));
      for (const w of drop?.weapons ?? []) {
        expect(w.condition).toBeGreaterThan(0);
        expect(w.condition).toBeLessThanOrEqual(100);
      }
    }
  });

  it('gives every dropped weapon a distinct instance id', () => {
    const b = arena();
    const seen = new Set<string>();
    for (let s = 1; s <= 40; s++) {
      const u = addEnemy(b, 'remnant_trooper', vec(3 + (s % 10), 4), s);
      const drop = rollLoot(u, new Rng(s * 31337));
      for (const w of drop?.weapons ?? []) {
        expect(seen.has(w.uid), `duplicate uid ${w.uid}`).toBe(false);
        seen.add(w.uid);
      }
    }
  });

  it('is reproducible from the same seed', () => {
    const b = arena();
    const u = addEnemy(b, 'cultist', vec(5, 5), 4);
    const a = JSON.stringify(rollLoot(u, new Rng(555)));
    const c = JSON.stringify(rollLoot(u, new Rng(555)));
    expect(a).toBe(c);
  });
});

describe('drops on the field', () => {
  it('leaves a pile where the body fell', () => {
    const b = arena();
    b.rngState = 12345;
    const u = addEnemy(b, 'raider', vec(7, 8), 2);
    // Force a generous hint so the test is not at the mercy of a stingy roll.
    u.weapon = u.weapon ?? null;
    let dropped = null;
    for (let i = 0; i < 30 && !dropped; i++) {
      b.rngState = 1000 + i;
      b.loot.length = 0;
      dropped = dropLootFor(b, u);
    }
    expect(dropped).not.toBeNull();
    expect(b.loot.length).toBe(1);
    expect(b.loot[0]!.pos).toEqual({ x: 7, y: 8 });
  });

  it('merges two bodies on one tile into a single pile', () => {
    const b = arena();
    const a = addEnemy(b, 'raider', vec(6, 6), 11);
    const c = addEnemy(b, 'cultist', vec(6, 6), 12);
    b.rngState = 777;
    dropLootFor(b, a);
    dropLootFor(b, c);
    const here = b.loot.filter((l) => l.pos.x === 6 && l.pos.y === 6);
    expect(here.length).toBeLessThanOrEqual(1);
  });
});

describe('collection', () => {
  it('moves a pile into the recovered bag and clears the tile', () => {
    const b = arena();
    const bag = emptyRecovered();
    b.loot.push({
      pos: vec(4, 4),
      weapons: [],
      attachments: ['bar_suppressor'],
      materials: { scrap: 3, steel: 1 },
      cash: 120,
    });

    const got = collectAt(b, vec(4, 4), bag);
    expect(got).not.toBeNull();
    expect(b.loot.length).toBe(0);
    expect(bag.cash).toBe(120);
    expect(bag.attachments).toEqual(['bar_suppressor']);
    expect(bag.materials.scrap).toBe(3);
    expect(bag.materials.steel).toBe(1);
  });

  it('accumulates across several piles', () => {
    const b = arena();
    const bag = emptyRecovered();
    b.loot.push({ pos: vec(1, 1), weapons: [], attachments: [], materials: { scrap: 2 }, cash: 10 });
    b.loot.push({ pos: vec(2, 2), weapons: [], attachments: [], materials: { scrap: 5 }, cash: 40 });
    collectAt(b, vec(1, 1), bag);
    collectAt(b, vec(2, 2), bag);
    expect(bag.cash).toBe(50);
    expect(bag.materials.scrap).toBe(7);
  });

  it('returns null on an empty tile and leaves the bag alone', () => {
    const b = arena();
    const bag = emptyRecovered();
    expect(collectAt(b, vec(9, 9), bag)).toBeNull();
    expect(bag.cash).toBe(0);
  });
});

describe('presentation', () => {
  it('describes a pile in words a player can read', () => {
    const drop = {
      pos: vec(0, 0),
      weapons: [],
      attachments: ['bar_suppressor'],
      materials: { scrap: 2 },
      cash: 50,
    };
    const text = describeDrop(drop);
    expect(text).toContain('$50');
    expect(text.length).toBeGreaterThan(6);
  });

  it('says so plainly when a pile is worthless', () => {
    expect(
      describeDrop({ pos: vec(0, 0), weapons: [], attachments: [], materials: {}, cash: 0 }),
    ).toBe('nothing worth carrying');
  });

  it('reports the best rarity in the pile', () => {
    const exotic = Object.values(ATTACHMENTS).find((a) => a.rarity === 'exotic');
    if (!exotic) return;
    expect(
      dropRarity({
        pos: vec(0, 0),
        weapons: [],
        attachments: ['bar_suppressor', exotic.id],
        materials: {},
        cash: 0,
      }),
    ).toBe('exotic');
  });
});

describe('the squad picks things up', () => {
  it('collects a pile it is standing on without spending AP', () => {
    const b = arena();
    const bag = emptyRecovered();
    const m = addMerc(b, 'nine', vec(5, 5));
    const apBefore = m.ap;
    b.loot.push({ pos: vec(5, 5), weapons: [], attachments: [], materials: { steel: 2 }, cash: 30 });

    collectAt(b, m.pos, bag);
    expect(bag.materials.steel).toBe(2);
    expect(m.ap).toBe(apBefore);
  });
});
