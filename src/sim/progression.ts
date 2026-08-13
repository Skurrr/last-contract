/** XP, levels, perks and traits — the shared vocabulary for character growth. */
import type { Attribute, Attributes, BodyPart, WeaponClass } from './types';

/**
 * Numeric modifiers a perk or trait contributes. Every field is optional and they are
 * aggregated over all of a unit's perks and traits by `aggregate()` below, so combat code
 * asks one question ("what are this unit's mods?") instead of checking perks by name.
 *
 * Convention: `*Mul` fields multiply and default to 1; everything else adds and defaults to 0.
 */
export interface Mods {
  // to-hit
  accuracy: number;          // additive percentage points, pre-multipliers
  accuracyMul: number;
  calledShotAccuracy: number;
  longRangeAccuracy: number;
  closeRangeAccuracy: number;
  // damage
  damageMul: number;
  critChance: number;
  critDamageMul: number;
  penetration: number;
  // action economy
  ap: number;
  apMul: number;
  moveCostMul: number;
  shotApCost: number;        // additive, usually negative
  aimApCost: number;
  reloadApCost: number;
  stanceApCost: number;
  interruptChance: number;
  // durability
  hp: number;
  hpMul: number;
  armour: number;
  bleedResist: number;       // 0..1, chance a bleed is prevented
  stunResist: number;
  // stamina
  stamina: number;
  staminaMul: number;
  staminaCostMul: number;
  staminaRegen: number;
  // stealth & senses
  noiseMul: number;
  sightRange: number;
  // support
  healMul: number;
  xpMul: number;
  squadXpMul: number;
  moraleRegen: number;
  // economy / meta
  craftQuality: number;
  repairMul: number;
  salaryMul: number;
  lootMul: number;
  scavengeMul: number;
  recoilMul: number;
  suppressionResist: number;
}

export const ZERO_MODS: Mods = {
  accuracy: 0, accuracyMul: 1, calledShotAccuracy: 0, longRangeAccuracy: 0, closeRangeAccuracy: 0,
  damageMul: 1, critChance: 0, critDamageMul: 1, penetration: 0,
  ap: 0, apMul: 1, moveCostMul: 1, shotApCost: 0, aimApCost: 0, reloadApCost: 0, stanceApCost: 0,
  interruptChance: 0,
  hp: 0, hpMul: 1, armour: 0, bleedResist: 0, stunResist: 0,
  stamina: 0, staminaMul: 1, staminaCostMul: 1, staminaRegen: 0,
  noiseMul: 1, sightRange: 0,
  healMul: 1, xpMul: 1, squadXpMul: 1, moraleRegen: 0,
  craftQuality: 0, repairMul: 1, salaryMul: 1, lootMul: 1, scavengeMul: 1,
  recoilMul: 1, suppressionResist: 0,
};

const MUL_KEYS = new Set<keyof Mods>([
  'accuracyMul', 'damageMul', 'critDamageMul', 'apMul', 'moveCostMul', 'hpMul',
  'staminaMul', 'staminaCostMul', 'noiseMul', 'healMul', 'xpMul', 'squadXpMul',
  'repairMul', 'salaryMul', 'lootMul', 'scavengeMul', 'recoilMul',
]);

/** Fold a list of partial modifier sets into one. Multiplicative keys compound. */
export function aggregate(parts: readonly Partial<Mods>[]): Mods {
  const out: Mods = { ...ZERO_MODS };
  for (const p of parts) {
    for (const k of Object.keys(p) as (keyof Mods)[]) {
      const v = p[k];
      if (v === undefined) continue;
      if (MUL_KEYS.has(k)) out[k] *= v;
      else out[k] += v;
    }
  }
  return out;
}

export type PerkTree = 'gunfighting' | 'survival' | 'movement' | 'support' | 'engineering';

export const PERK_TREE_INFO: Record<PerkTree, { label: string; color: string }> = {
  gunfighting: { label: 'Gunfighting', color: '#ff7a45' },
  survival: { label: 'Survival', color: '#6ad36a' },
  movement: { label: 'Movement', color: '#54c8ff' },
  support: { label: 'Support', color: '#ffd45e' },
  engineering: { label: 'Engineering', color: '#b98cff' },
};

export interface PerkDef {
  id: string;
  name: string;
  tree: PerkTree;
  /** 1–3; higher tiers need a higher level. */
  tier: 1 | 2 | 3;
  desc: string;
  mods: Partial<Mods>;
  /** Minimum attribute values required to be offered this perk. */
  requires?: Partial<Attributes>;
  /** Perk ids that must already be taken. */
  after?: readonly string[];
  /** Only offered to users of these weapon classes. */
  weaponClasses?: readonly WeaponClass[];
  /** Perks with special-cased logic in combat set this so the UI can flag it. */
  special?: string;
}

export interface TraitDef {
  id: string;
  name: string;
  desc: string;
  /** Positive traits cost points, negative refund them. */
  cost: number;
  mods: Partial<Mods>;
  special?: string;
  /** Traits that cannot be taken together. */
  excludes?: readonly string[];
}

// ─────────────────────────────────────────────────────────────── levelling

export const MAX_LEVEL = 20;

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 1.55));
}

export function levelFromXp(xp: number): number {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}

/** Progress through the current level, 0..1. Drives the XP bar. */
export function levelProgress(xp: number): { level: number; frac: number; into: number; need: number } {
  const level = levelFromXp(xp);
  if (level >= MAX_LEVEL) return { level, frac: 1, into: 0, need: 0 };
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const into = xp - base;
  const need = next - base;
  return { level, frac: need > 0 ? into / need : 1, into, need };
}

export function maxHpFor(attrs: Attributes, level: number, mods: Mods): number {
  return Math.round((40 + attrs.vitality * 4 + (level - 1) * 3 + mods.hp) * mods.hpMul);
}

export function maxStaminaFor(attrs: Attributes, mods: Mods): number {
  return Math.round((50 + attrs.endurance * 5 + mods.stamina) * mods.staminaMul);
}

export function maxApFor(attrs: Attributes, mods: Mods): number {
  return Math.max(4, Math.round((8 + Math.floor(attrs.agility / 3) + mods.ap) * mods.apMul));
}

/** XP a merc earns for an event, scaled by wisdom (fast learners) and perks. */
export function xpGain(base: number, wisdom: number, mods: Mods): number {
  return Math.max(1, Math.round(base * (0.7 + wisdom * 0.06) * mods.xpMul));
}

export const XP_AWARDS = {
  damageDealt: 0.6,   // per point of damage
  kill: 25,
  killZombie: 12,
  calledShotLanded: 8,
  headshotKill: 20,
  healPoint: 0.4,
  objective: 60,
  survived: 30,
  craft: 20,
  interrupt: 10,
} as const;

/** Attribute a merc improves by using it — JA2-style learn-by-doing. */
export const SKILL_USE_ATTR: Record<string, Attribute> = {
  shoot: 'marksmanship',
  move: 'agility',
  melee: 'strength',
  heal: 'medical',
  craft: 'mechanical',
  explode: 'explosives',
  takeHit: 'vitality',
  sprint: 'endurance',
};

export type BodyArmourMap = Record<BodyPart, number>;
