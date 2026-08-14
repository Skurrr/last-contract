/**
 * Consumables: everything the company buys by the unit rather than by the piece.
 *
 * This exists because three separate places were each carrying their own private table of
 * these ids — the market for labels, the economy for prices, and nothing at all for what a
 * consumable actually *does*. The result was that a player could buy a noisemaker and it
 * would never reach a battlefield, because the shop's `noisemaker` and the thrown weapon
 * `chattercan` were different strings that nobody had ever put side by side.
 *
 * `throwsAs` is that missing link: the weapon id a consumable becomes when it is issued.
 */
import type { MaterialId, Materials, Rarity } from '@/sim/types';

export type ConsumableCategory = 'medicine' | 'chems' | 'weapons' | 'materials' | 'ammo';

export interface ConsumableDef {
  id: string;
  name: string;
  /** One line, shown in the market and the workshop. */
  desc: string;
  category: ConsumableCategory;
  /** Base price before faction and reputation multipliers. */
  value: number;
  rarity: Rarity;
  /** The thrown-weapon id this becomes when issued to a merc, if it is ordnance. */
  throwsAs?: string;
  /** Ammunition calibre this feeds, if it is ammunition. */
  ammo?: string;
  /** Healing applied in the field, if it is medical. */
  heal?: number;
  /** Materials returned by breaking it down. */
  scrap?: Materials;
}

export const CONSUMABLES: Record<string, ConsumableDef> = {
  // ── medical ────────────────────────────────────────────────────────────
  bandage: {
    id: 'bandage',
    name: 'Bandages',
    desc: 'Boiled cotton strips rolled tight. Stops a bleed; does nothing about the hole.',
    category: 'medicine',
    value: 25,
    rarity: 'common',
    heal: 12,
    scrap: { tape: 1 },
  },
  medkit: {
    id: 'medkit',
    name: 'Medkit',
    desc: 'A green canvas roll with a red cross somebody scratched most of the way off.',
    category: 'medicine',
    value: 120,
    rarity: 'uncommon',
    heal: 30,
    scrap: { tape: 2, polymer: 1 },
  },
  'trauma-kit': {
    id: 'trauma-kit',
    name: 'Trauma Kit',
    desc: 'Clotting powder, a chest seal, and a tourniquet that has been used before.',
    category: 'medicine',
    value: 320,
    rarity: 'rare',
    heal: 55,
    scrap: { tape: 3, polymer: 2 },
  },
  antibiotics: {
    id: 'antibiotics',
    name: 'Antibiotics',
    desc: 'Eight years past the date on the bottle and still the most valuable thing in it.',
    category: 'medicine',
    value: 180,
    rarity: 'rare',
    heal: 20,
  },
  'adrenaline-shot': {
    id: 'adrenaline-shot',
    name: 'Adrenaline Shot',
    desc: 'Gets a body moving that had decided otherwise. The bill comes later.',
    category: 'chems',
    value: 150,
    rarity: 'uncommon',
    heal: 8,
  },

  // ── ordnance ───────────────────────────────────────────────────────────
  // Each of these is issued to a merc as the thrown weapon named in `throwsAs`.
  molotov: {
    id: 'molotov',
    name: 'Rag Bottle',
    desc: 'Fuel is worth more than the bottle, and the bottle is worth more than the rag.',
    category: 'weapons',
    value: 60,
    rarity: 'common',
    throwsAs: 'molotov',
    scrap: { tape: 1 },
  },
  'pipe-bomb': {
    id: 'pipe-bomb',
    name: 'Pipe Bomb',
    desc: 'Threaded cap, black powder, and a fuse cut by guesswork. Throw it early.',
    category: 'weapons',
    value: 90,
    rarity: 'common',
    throwsAs: 'pipebomb',
    scrap: { scrap: 1, powder: 1 },
  },
  'nail-bomb': {
    id: 'nail-bomb',
    name: 'Remnant Frag',
    desc: 'Green, heavy, and stencilled with a date from before the Fever. They still work.',
    category: 'weapons',
    value: 160,
    rarity: 'uncommon',
    throwsAs: 'frag',
    scrap: { steel: 1, powder: 1 },
  },
  noisemaker: {
    id: 'noisemaker',
    name: 'Chatter Can',
    desc: 'A wind-up alarm clock in a paint tin. Throw it down the street and walk the other way.',
    category: 'materials',
    value: 45,
    rarity: 'common',
    throwsAs: 'chattercan',
    scrap: { scrap: 1, springs: 1 },
  },
  'smoke-pot': {
    id: 'smoke-pot',
    name: 'Smoke Pot',
    desc: 'Burns thick and grey for a minute and a half. Hides you from the living, not the dead.',
    category: 'materials',
    value: 70,
    rarity: 'common',
    throwsAs: 'smoke',
    scrap: { powder: 1 },
  },
  'road-flare': {
    id: 'road-flare',
    name: 'Road Flare',
    desc: 'Bright, hot, and visible for a mile. Useful exactly as often as it is a mistake.',
    category: 'materials',
    value: 30,
    rarity: 'common',
    throwsAs: 'chattercan',
    scrap: { powder: 1 },
  },

  // ── maintenance ────────────────────────────────────────────────────────
  'repair-kit': {
    id: 'repair-kit',
    name: 'Repair Kit',
    desc: 'Files, springs, a bore brush, and a tin of the good oil.',
    category: 'materials',
    value: 110,
    rarity: 'uncommon',
    scrap: { steel: 1, springs: 1, tape: 1 },
  },
  'armour-patch': {
    id: 'armour-patch',
    name: 'Armour Patch',
    desc: 'A plate offcut and the webbing to hold it. Covers the hole the last one made.',
    category: 'materials',
    value: 95,
    rarity: 'uncommon',
    scrap: { steel: 2 },
  },

  // ── ammunition ─────────────────────────────────────────────────────────
  'ammo-9mm': { id: 'ammo-9mm', name: '9mm', desc: 'Common as dirt, and about as respected.', category: 'ammo', value: 3, rarity: 'common', ammo: '9mm' },
  'ammo-45acp': { id: 'ammo-45acp', name: '.45 ACP', desc: 'Slow, heavy, and it does not ask twice.', category: 'ammo', value: 4, rarity: 'common', ammo: '45acp' },
  'ammo-556': { id: 'ammo-556', name: '5.56mm', desc: 'What the Remnant armoury still has crates of.', category: 'ammo', value: 5, rarity: 'common', ammo: '556' },
  'ammo-762': { id: 'ammo-762', name: '7.62mm', desc: 'Everything east of the highway eats this.', category: 'ammo', value: 6, rarity: 'common', ammo: '762' },
  'ammo-12ga': { id: 'ammo-12ga', name: '12 Gauge', desc: 'Farm shells, mostly. Some of them are even loaded right.', category: 'ammo', value: 5, rarity: 'common', ammo: '12ga' },
  'ammo-338': { id: 'ammo-338', name: '.338', desc: 'Match grade, hand-counted, and priced like it.', category: 'ammo', value: 14, rarity: 'rare', ammo: '338' },
};

export const CONSUMABLE_LIST: ConsumableDef[] = Object.values(CONSUMABLES);

export const CONSUMABLE_IDS: string[] = Object.keys(CONSUMABLES);

export function consumablesInCategory(cat: ConsumableCategory): ConsumableDef[] {
  return CONSUMABLE_LIST.filter((c) => c.category === cat);
}

/** Everything the company can issue as thrown ordnance, best first. */
export const ORDNANCE: ConsumableDef[] = CONSUMABLE_LIST.filter((c) => c.throwsAs).sort(
  (a, z) => z.value - a.value,
);

/** The thrown-weapon id a consumable becomes when issued, if any. */
export function throwsAs(consumableId: string): string | undefined {
  return CONSUMABLES[consumableId]?.throwsAs;
}

export function consumableName(id: string): string {
  return CONSUMABLES[id]?.name ?? id;
}

export function consumableValue(id: string): number | null {
  return CONSUMABLES[id]?.value ?? null;
}

export const MATERIAL_KEYS: MaterialId[] = [
  'scrap', 'steel', 'polymer', 'springs', 'optics', 'powder', 'electronics', 'tape',
];
