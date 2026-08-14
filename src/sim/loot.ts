/**
 * What the dead leave behind, and picking it up.
 *
 * Loot is rolled from each enemy's authored `LootHint` rather than from a global table, so a
 * Remnant marksman drops mil-spec gear and a shambler drops whatever was in its pockets eight
 * years ago. Everything a squad recovers accumulates on the battle so the after-action report
 * and the campaign stash can be filled from one place.
 */
import { Rng } from '@/core/rng';
import type { Vec2 } from '@/core/grid';
import { ATTACHMENT_LIST } from '@/data/attachments';
import { ENEMIES, type LootHint } from '@/data/enemies';
import { WEAPONS } from '@/data/weapons';
import { makeWeapon, seededUid } from './spawn';
import type {
  BattleState,
  LootDrop,
  MaterialId,
  Materials,
  Rarity,
  Unit,
  WeaponInstance,
} from './types';

/** Everything the squad has picked up this battle. */
export interface Recovered {
  weapons: WeaponInstance[];
  attachments: string[];
  materials: Materials;
  cash: number;
}

export const emptyRecovered = (): Recovered => ({
  weapons: [],
  attachments: [],
  materials: {},
  cash: 0,
});

export function addMaterials(into: Materials, from: Materials): void {
  for (const [k, v] of Object.entries(from) as [MaterialId, number][]) {
    if (v > 0) into[k] = (into[k] ?? 0) + v;
  }
}

/**
 * Roll what a body leaves. The killed unit's own weapon is the interesting drop — it comes
 * with its wear and whatever was bolted to it, which is where most looted gear originates.
 */
export function rollLoot(unit: Unit, rng: Rng): LootDrop | null {
  const def = ENEMIES[unit.defId];
  if (!def) return null;
  const hint: LootHint = def.loot;

  const drop: LootDrop = {
    pos: unit.pos,
    weapons: [],
    attachments: [],
    materials: {},
    cash: rng.int(hint.cash[0], hint.cash[1]),
  };

  // The gun they were carrying, in the state they left it.
  if (unit.weapon && WEAPONS[unit.weapon.defId] && rng.chance(hint.weaponDropChance)) {
    drop.weapons.push({
      ...unit.weapon,
      uid: seededUid('loot', rng.int(1, 1e9), unit.pos.x * 1024 + unit.pos.y),
      // A weapon taken off a corpse has not been looked after.
      condition: Math.max(5, Math.round(unit.weapon.condition * rng.float(0.7, 0.95))),
    });
  }

  // A loose fitting, sometimes — the kind of thing you find in a pouch.
  if (rng.chance(hint.attachmentChance)) {
    const tier: Rarity = rng.weighted([
      ['common', 6],
      ['uncommon', 3],
      ['rare', 1.2],
      ['exotic', 0.25],
    ] as const);
    const pool = ATTACHMENT_LIST.filter((a) => a.rarity === tier);
    if (pool.length > 0) drop.attachments.push(rng.pick(pool).id);
  }

  for (const [mat, range] of Object.entries(hint.materials) as [MaterialId, [number, number]][]) {
    const n = rng.int(range[0], range[1]);
    if (n > 0) drop.materials[mat] = n;
  }

  const empty =
    drop.weapons.length === 0 &&
    drop.attachments.length === 0 &&
    drop.cash === 0 &&
    Object.keys(drop.materials).length === 0;
  return empty ? null : drop;
}

/** Drop a killed unit's effects onto the tile it fell on. */
export function dropLootFor(b: BattleState, unit: Unit): LootDrop | null {
  const rng = Rng.restore(b.rngState);
  const drop = rollLoot(unit, rng);
  b.rngState = rng.state;
  if (!drop) return null;

  // Merge into an existing pile rather than stacking invisible drops on one tile.
  const existing = b.loot.find((l) => l.pos.x === drop.pos.x && l.pos.y === drop.pos.y);
  if (existing) {
    existing.weapons.push(...drop.weapons);
    existing.attachments.push(...drop.attachments);
    existing.cash += drop.cash;
    addMaterials(existing.materials, drop.materials);
    return existing;
  }
  b.loot.push(drop);
  return drop;
}

/**
 * Collect any pile on this tile. Free — walking over a body and taking its rifle should not
 * cost an action; the cost was getting there.
 */
export function collectAt(b: BattleState, pos: Vec2, into: Recovered): LootDrop | null {
  const i = b.loot.findIndex((l) => l.pos.x === pos.x && l.pos.y === pos.y);
  if (i < 0) return null;
  const drop = b.loot[i]!;
  b.loot.splice(i, 1);

  into.weapons.push(...drop.weapons);
  into.attachments.push(...drop.attachments);
  into.cash += drop.cash;
  addMaterials(into.materials, drop.materials);
  return drop;
}

/** A short human summary of a pile, for the pickup toast and the log. */
export function describeDrop(drop: LootDrop): string {
  const bits: string[] = [];
  for (const w of drop.weapons) bits.push(WEAPONS[w.defId]?.name ?? w.defId);
  for (const a of drop.attachments) {
    bits.push(ATTACHMENT_LIST.find((x) => x.id === a)?.name ?? a);
  }
  const mats = Object.entries(drop.materials).filter(([, v]) => (v ?? 0) > 0).length;
  if (mats > 0) bits.push(`${mats} kind${mats === 1 ? '' : 's'} of salvage`);
  if (drop.cash > 0) bits.push(`$${drop.cash}`);
  return bits.length > 0 ? bits.join(', ') : 'nothing worth carrying';
}

/** The best rarity in a pile, so the pickup can be presented with the right weight. */
export function dropRarity(drop: LootDrop): Rarity {
  const order: Rarity[] = ['common', 'uncommon', 'rare', 'exotic'];
  let best = 0;
  for (const w of drop.weapons) {
    best = Math.max(best, order.indexOf(WEAPONS[w.defId]?.rarity ?? 'common'));
  }
  for (const a of drop.attachments) {
    const att = ATTACHMENT_LIST.find((x) => x.id === a);
    best = Math.max(best, order.indexOf(att?.rarity ?? 'common'));
  }
  return order[best] ?? 'common';
}

export { makeWeapon };
