/**
 * Content integrity. Four agents authored these catalogues in parallel, and the failure mode
 * that actually bit us was cross-file id drift — a merc referencing a perk that no longer
 * existed. These tests make that class of bug impossible to merge.
 */
import { describe, expect, it } from 'vitest';
import { ATTACHMENTS } from '@/data/attachments';
import { BARKS, BARK_SITUATIONS } from '@/data/barks';
import { ENEMIES, HUMAN_ENEMY_IDS, ZOMBIE_IDS } from '@/data/enemies';
import { FACTIONS } from '@/data/factions';
import { MERCS } from '@/data/mercs';
import { PERKS } from '@/data/perks';
import { RECIPES } from '@/data/crafting';
import { SECTORS, MAP_H, MAP_W } from '@/data/sectors';
import { TRAITS } from '@/data/traits';
import { ALL_WEAPONS } from '@/data/index';
import { WEAPONS } from '@/data/weapons';
import { ATTRIBUTES, BODY_PARTS } from '@/sim/types';
import { createMercState, spawnEnemy, spawnMerc } from '@/sim/spawn';
import { activeWeapon, resolveWeapon } from '@/sim/combat';
import { vec } from '@/core/grid';

describe('registry keys match their ids', () => {
  const registries = {
    WEAPONS, ATTACHMENTS, PERKS, TRAITS, MERCS, ENEMIES, FACTIONS, RECIPES,
  } as const;

  for (const [name, reg] of Object.entries(registries)) {
    it(`${name} has no key/id mismatch`, () => {
      for (const [key, def] of Object.entries(reg as Record<string, { id: string }>)) {
        expect(def.id, `${name}["${key}"]`).toBe(key);
      }
    });
  }
});

describe('merc roster references resolve', () => {
  it('every starting weapon and sidearm exists', () => {
    for (const m of Object.values(MERCS)) {
      expect(ALL_WEAPONS[m.startingWeapon], `${m.callsign} weapon`).toBeDefined();
      if (m.startingSidearm) {
        expect(ALL_WEAPONS[m.startingSidearm], `${m.callsign} sidearm`).toBeDefined();
      }
    }
  });

  it('every starting perk exists', () => {
    for (const m of Object.values(MERCS)) {
      for (const p of m.startingPerks) {
        expect(PERKS[p], `${m.callsign} perk ${p}`).toBeDefined();
      }
    }
  });

  it('every starting trait exists', () => {
    for (const m of Object.values(MERCS)) {
      for (const t of m.startingTraits) {
        expect(TRAITS[t], `${m.callsign} trait ${t}`).toBeDefined();
      }
    }
  });

  it('no merc holds a perk their attributes cannot support', () => {
    for (const m of Object.values(MERCS)) {
      for (const id of m.startingPerks) {
        const perk = PERKS[id];
        if (!perk?.requires) continue;
        for (const [attr, min] of Object.entries(perk.requires)) {
          expect(
            m.attrs[attr as keyof typeof m.attrs],
            `${m.callsign} needs ${attr} >= ${min} for ${id}`,
          ).toBeGreaterThanOrEqual(min as number);
        }
      }
    }
  });

  it('no merc holds a perk whose prerequisite they lack', () => {
    for (const m of Object.values(MERCS)) {
      for (const id of m.startingPerks) {
        for (const req of PERKS[id]?.after ?? []) {
          expect(m.startingPerks, `${m.callsign} needs ${req} before ${id}`).toContain(req);
        }
      }
    }
  });

  it('no merc holds two mutually excluded traits', () => {
    for (const m of Object.values(MERCS)) {
      for (const id of m.startingTraits) {
        for (const ex of TRAITS[id]?.excludes ?? []) {
          expect(m.startingTraits, `${m.callsign}: ${id} excludes ${ex}`).not.toContain(ex);
        }
      }
    }
  });

  it('resolves relationships to real mercs', () => {
    for (const m of Object.values(MERCS)) {
      for (const id of [...m.likes, ...m.dislikes]) {
        expect(MERCS[id], `${m.callsign} references ${id}`).toBeDefined();
        expect(id, `${m.callsign} cannot like or dislike themselves`).not.toBe(m.id);
      }
    }
  });

  it('gives every merc a unique portrait seed', () => {
    const seeds = Object.values(MERCS).map((m) => m.portraitSeed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('keeps every attribute inside 1..10', () => {
    for (const m of Object.values(MERCS)) {
      for (const a of ATTRIBUTES) {
        expect(m.attrs[a], `${m.callsign}.${a}`).toBeGreaterThanOrEqual(1);
        expect(m.attrs[a], `${m.callsign}.${a}`).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe('perk and trait graphs are sound', () => {
  it('points every `after` at a real perk', () => {
    for (const p of Object.values(PERKS)) {
      for (const req of p.after ?? []) {
        expect(PERKS[req], `${p.id} -> ${req}`).toBeDefined();
      }
    }
  });

  it('has no perk prerequisite cycles', () => {
    const seen = new Map<string, 'visiting' | 'done'>();
    const visit = (id: string, path: string[]): void => {
      const mark = seen.get(id);
      if (mark === 'done') return;
      expect(mark, `cycle: ${[...path, id].join(' -> ')}`).not.toBe('visiting');
      seen.set(id, 'visiting');
      for (const req of PERKS[id]?.after ?? []) visit(req, [...path, id]);
      seen.set(id, 'done');
    };
    for (const id of Object.keys(PERKS)) visit(id, []);
  });

  it('requires a prerequisite to be a strictly lower tier', () => {
    for (const p of Object.values(PERKS)) {
      for (const req of p.after ?? []) {
        const parent = PERKS[req];
        if (parent) expect(parent.tier, `${p.id} after ${req}`).toBeLessThan(p.tier);
      }
    }
  });

  it('keeps every trait exclusion symmetric and real', () => {
    for (const t of Object.values(TRAITS)) {
      for (const ex of t.excludes ?? []) {
        const other = TRAITS[ex];
        expect(other, `${t.id} excludes missing ${ex}`).toBeDefined();
        expect(other?.excludes ?? [], `${ex} must exclude ${t.id} back`).toContain(t.id);
      }
    }
  });

  it('gives positive traits a cost and negative traits a refund', () => {
    for (const t of Object.values(TRAITS)) {
      expect(t.cost, `${t.id} must not be free`).not.toBe(0);
    }
  });
});

describe('weapons and attachments', () => {
  it('resolves every catalogue weapon', () => {
    for (const w of Object.values(ALL_WEAPONS)) {
      const inst = {
        uid: 't', defId: w.id, condition: 100, attachments: {},
        loaded: w.magSize, mode: w.modes[0] ?? 'single',
      };
      expect(resolveWeapon(inst), w.id).not.toBeNull();
    }
  });

  it('keeps optimal range within maximum range', () => {
    for (const w of Object.values(ALL_WEAPONS)) {
      expect(w.rangeOptimal, `${w.id}`).toBeLessThanOrEqual(w.rangeMax);
    }
  });

  it('gives every weapon a positive damage, AP cost and magazine', () => {
    for (const w of Object.values(ALL_WEAPONS)) {
      // Thrown utility items — smoke, noisemakers — are allowed to deal nothing. Their
      // whole point is changing what the enemy can see or hear.
      if (w.cls === 'thrown') expect(w.damage, `${w.id} damage`).toBeGreaterThanOrEqual(0);
      else expect(w.damage, `${w.id} damage`).toBeGreaterThan(0);
      expect(w.apCost, `${w.id} apCost`).toBeGreaterThan(0);
      expect(w.magSize, `${w.id} magSize`).toBeGreaterThan(0);
      expect(w.modes.length, `${w.id} modes`).toBeGreaterThan(0);
    }
  });

  it('only offers burst and auto to weapons with rounds to spend', () => {
    for (const w of Object.values(ALL_WEAPONS)) {
      if (w.modes.includes('burst')) expect(w.burstRounds, `${w.id}`).toBeGreaterThan(1);
      if (w.modes.includes('auto')) expect(w.autoRounds, `${w.id}`).toBeGreaterThan(1);
    }
  });

  it('never fits an attachment to a slot the weapon does not have', () => {
    for (const a of Object.values(ATTACHMENTS)) {
      const fits = a.fits.length > 0
        ? a.fits.map((c) => Object.values(WEAPONS).filter((w) => w.cls === c)).flat()
        : Object.values(WEAPONS);
      // At least one weapon it claims to fit must actually have that slot, or it is dead content.
      expect(fits.some((w) => w.slots.includes(a.slot)), `${a.id} fits nothing with a ${a.slot} slot`)
        .toBe(true);
    }
  });

  it('keeps melee weapons at melee range with no ammunition', () => {
    for (const w of Object.values(ALL_WEAPONS)) {
      if (w.cls !== 'melee') continue;
      expect(w.ammo, `${w.id}`).toBe('none');
      expect(w.rangeMax, `${w.id}`).toBeLessThanOrEqual(2);
    }
  });
});

describe('enemies', () => {
  it('arms every enemy with a resolvable weapon', () => {
    for (const e of Object.values(ENEMIES)) {
      expect(ALL_WEAPONS[e.weapon], `${e.id} weapon ${e.weapon}`).toBeDefined();
      if (e.sidearm) expect(ALL_WEAPONS[e.sidearm], `${e.id} sidearm`).toBeDefined();
    }
  });

  it('gives every enemy armour values for all body parts', () => {
    for (const e of Object.values(ENEMIES)) {
      for (const p of BODY_PARTS) {
        expect(e.armour[p], `${e.id}.${p}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('gives every enemy positive HP, AP and sense radius', () => {
    for (const e of Object.values(ENEMIES)) {
      expect(e.hp, `${e.id} hp`).toBeGreaterThan(0);
      expect(e.speed, `${e.id} speed`).toBeGreaterThan(0);
      expect(e.senseRadius, `${e.id} senseRadius`).toBeGreaterThan(0);
    }
  });

  it('partitions cleanly into zombies and humans', () => {
    expect(ZOMBIE_IDS.length + HUMAN_ENEMY_IDS.length).toBe(Object.keys(ENEMIES).length);
    for (const id of ZOMBIE_IDS) expect(ENEMIES[id]?.team).toBe('zombie');
  });
});

describe('factions and sectors', () => {
  it('resolves faction hostilities to real factions', () => {
    for (const f of Object.values(FACTIONS)) {
      for (const other of f.hostileTo) {
        expect(FACTIONS[other], `${f.id} hostile to ${other}`).toBeDefined();
        expect(other, `${f.id} cannot be hostile to itself`).not.toBe(f.id);
      }
    }
  });

  it('fields only real enemies in every faction roster', () => {
    for (const f of Object.values(FACTIONS)) {
      for (const id of f.enemyRoster) {
        expect(ENEMIES[id], `${f.id} fields ${id}`).toBeDefined();
      }
    }
  });

  it('covers the whole map exactly once', () => {
    expect(SECTORS.length).toBe(MAP_W * MAP_H);
    const seen = new Set(SECTORS.map((s) => `${s.x},${s.y}`));
    expect(seen.size).toBe(MAP_W * MAP_H);
    for (const s of SECTORS) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(MAP_W);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(MAP_H);
    }
  });

  it('assigns sectors only to real factions', () => {
    for (const s of SECTORS) {
      if (s.owner) expect(FACTIONS[s.owner], `${s.id} owned by ${s.owner}`).toBeDefined();
    }
  });

  it('gives every sector a distinct id and a threat rating in range', () => {
    expect(new Set(SECTORS.map((s) => s.id)).size).toBe(SECTORS.length);
    for (const s of SECTORS) {
      expect(s.threat, `${s.id}`).toBeGreaterThanOrEqual(1);
      expect(s.threat, `${s.id}`).toBeLessThanOrEqual(5);
    }
  });
});

describe('crafting recipes', () => {
  it('produces something that exists', () => {
    for (const r of Object.values(RECIPES)) {
      if (r.output.kind === 'weapon') {
        expect(ALL_WEAPONS[r.output.id], `${r.id} outputs ${r.output.id}`).toBeDefined();
      } else if (r.output.kind === 'attachment') {
        expect(ATTACHMENTS[r.output.id], `${r.id} outputs ${r.output.id}`).toBeDefined();
      }
    }
  });

  it('costs something and yields something', () => {
    for (const r of Object.values(RECIPES)) {
      expect(Object.keys(r.cost).length, `${r.id} is free`).toBeGreaterThan(0);
      expect(r.output.qty, `${r.id} qty`).toBeGreaterThan(0);
      expect(r.days, `${r.id} days`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('barks', () => {
  it('gives every merc a bark set', () => {
    for (const m of Object.values(MERCS)) {
      expect(BARKS[m.voice], `${m.callsign} voice ${m.voice}`).toBeDefined();
    }
  });

  it('covers every situation with several lines', () => {
    for (const [voice, set] of Object.entries(BARKS)) {
      for (const s of BARK_SITUATIONS) {
        const lines = set[s];
        expect(lines, `${voice}.${s}`).toBeDefined();
        expect(lines.length, `${voice}.${s}`).toBeGreaterThanOrEqual(3);
        for (const l of lines) expect(l.trim().length, `${voice}.${s}`).toBeGreaterThan(0);
      }
    }
  });

  it('gives each merc a distinct voice — no copy-paste sets', () => {
    const firstLines = Object.values(MERCS).map((m) => BARKS[m.voice]?.kill[0] ?? '');
    expect(new Set(firstLines).size).toBe(firstLines.length);
  });
});

describe('spawning', () => {
  it('deploys every merc with derived stats and a working weapon', () => {
    for (const m of Object.values(MERCS)) {
      const u = spawnMerc(createMercState(m.id), vec(1, 1));
      expect(u.maxHp, `${m.callsign} hp`).toBeGreaterThan(0);
      expect(u.maxStamina, `${m.callsign} stamina`).toBeGreaterThan(0);
      expect(u.maxAp, `${m.callsign} ap`).toBeGreaterThanOrEqual(4);
      expect(activeWeapon(u), `${m.callsign} weapon`).not.toBeNull();
    }
  });

  it('deploys every enemy with a working weapon', () => {
    for (const e of Object.values(ENEMIES)) {
      const u = spawnEnemy(e.id, vec(1, 1), 12345);
      expect(u.maxHp, `${e.id}`).toBeGreaterThan(0);
      expect(activeWeapon(u), `${e.id} weapon`).not.toBeNull();
      expect(u.maxAp, `${e.id} ap`).toBe(e.speed);
    }
  });

  it('varies enemies of the same type across seeds', () => {
    const a = spawnEnemy('raider', vec(1, 1), 1);
    const b = spawnEnemy('raider', vec(1, 1), 2);
    expect(a.id).not.toBe(b.id);
    expect(a.spriteSeed).not.toBe(b.spriteSeed);
  });
});
