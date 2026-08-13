/**
 * Turning content definitions into battlefield units.
 *
 * This is the seam between the authored world (`src/data`) and the simulation. Everything a
 * unit needs at runtime — derived HP, stamina, AP, a loaded weapon, a sprite seed — is
 * computed once here, so the rest of the sim never has to reach back into content files.
 */
import { Rng, hashString } from '@/core/rng';
import type { Vec2 } from '@/core/grid';
import { ALL_WEAPONS } from '@/data/index';
import { ATTACHMENTS } from '@/data/attachments';
import { ENEMIES, type EnemyDef } from '@/data/enemies';
import { MERCS, type MercDef } from '@/data/mercs';
import { PERKS } from '@/data/perks';
import { TRAITS } from '@/data/traits';
import { unitMods } from './combat';
import {
  aggregate,
  levelFromXp,
  maxApFor,
  maxHpFor,
  maxStaminaFor,
  type Mods,
} from './progression';
import type {
  Attributes,
  BodyPart,
  Team,
  Unit,
  WeaponInstance,
} from './types';

let uidCounter = 0;
/** Monotonic instance id. Battles are seeded, but object identity need not be. */
export function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}_${uidCounter.toString(36)}`;
}

export function resetUidCounter(): void {
  uidCounter = 0;
}

const NO_ARMOUR: Record<BodyPart, number> = { head: 0, torso: 0, arms: 0, legs: 0 };

/** Build a fresh, fully-loaded weapon instance. Returns null for an unknown id. */
export function makeWeapon(
  defId: string,
  opts: { condition?: number; attachments?: Record<string, string> } = {},
): WeaponInstance | null {
  const def = ALL_WEAPONS[defId];
  if (!def) return null;

  const attachments: WeaponInstance['attachments'] = {};
  for (const [slot, id] of Object.entries(opts.attachments ?? {})) {
    const att = ATTACHMENTS[id];
    // Silently drop attachments that don't exist or don't fit — a bad save should not
    // prevent a merc from deploying with their gun.
    if (!att) continue;
    if (att.fits.length > 0 && !att.fits.includes(def.cls)) continue;
    attachments[att.slot] = id;
  }

  return {
    uid: uid('w'),
    defId,
    condition: opts.condition ?? 100,
    attachments,
    loaded: def.magSize,
    mode: def.modes[0] ?? 'single',
  };
}

/** Aggregate perk + trait mods without needing a Unit yet. */
function modsFor(perks: readonly string[], traits: readonly string[]): Mods {
  const parts = [];
  for (const id of perks) {
    const p = PERKS[id];
    if (p) parts.push(p.mods);
  }
  for (const id of traits) {
    const t = TRAITS[id];
    if (t) parts.push(t.mods);
  }
  return aggregate(parts);
}

// ─────────────────────────────────────────────────────────────── mercs

export interface MercState {
  /** Persistent campaign identity — survives between battles. */
  id: string;
  defId: string;
  xp: number;
  level: number;
  perks: string[];
  traits: string[];
  attrs: Attributes;
  /** Carried between battles: wounds do not fully heal by themselves. */
  hp: number;
  morale: number;
  weapon: WeaponInstance | null;
  sidearm: WeaponInstance | null;
  armour: Record<BodyPart, number>;
  inventory: string[];
  /** Career record, shown on the character sheet. */
  kills: number;
  missions: number;
  daysHired: number;
}

/** Create a campaign-level merc from their definition, ready to be hired. */
export function createMercState(defId: string): MercState {
  const def = MERCS[defId];
  if (!def) throw new Error(`Unknown merc: ${defId}`);

  const perks = [...def.startingPerks];
  const traits = [...def.startingTraits];
  const mods = modsFor(perks, traits);
  const attrs = { ...def.attrs };

  return {
    id: defId,
    defId,
    xp: 0,
    level: 1,
    perks,
    traits,
    attrs,
    hp: maxHpFor(attrs, 1, mods),
    morale: 65,
    weapon: makeWeapon(def.startingWeapon),
    sidearm: def.startingSidearm ? makeWeapon(def.startingSidearm) : null,
    armour: { ...NO_ARMOUR },
    inventory: [],
    kills: 0,
    missions: 0,
    daysHired: 0,
  };
}

/** Deploy a campaign merc into a battle at a position. */
export function spawnMerc(state: MercState, pos: Vec2, team: Team = 'player'): Unit {
  const def = MERCS[state.defId];
  if (!def) throw new Error(`Unknown merc: ${state.defId}`);

  const level = Math.max(state.level, levelFromXp(state.xp));
  const mods = modsFor(state.perks, state.traits);
  const maxHp = maxHpFor(state.attrs, level, mods);
  const maxStamina = maxStaminaFor(state.attrs, mods);

  return {
    id: state.id,
    defId: state.defId,
    name: def.callsign,
    team,
    kind: 'merc',
    pos,
    facing: 2,
    stance: 'standing',
    hp: Math.max(1, Math.min(maxHp, state.hp)),
    maxHp,
    stamina: maxStamina,
    maxStamina,
    ap: 0,
    maxAp: maxApFor(state.attrs, mods),
    reserve: 0,
    attrs: { ...state.attrs },
    armour: { ...state.armour },
    statuses: [],
    weapon: state.weapon,
    sidearm: state.sidearm,
    inventory: [...state.inventory],
    perks: [...state.perks],
    traits: [...state.traits],
    level,
    xp: state.xp,
    morale: state.morale,
    calm: 0,
    spriteSeed: def.portraitSeed,
    alive: true,
    critical: false,
    criticalTurns: 0,
  };
}

/** Fold a battle's outcome back into the persistent merc record. */
export function absorbBattleResult(state: MercState, unit: Unit): void {
  state.xp = unit.xp;
  state.level = unit.level;
  state.perks = [...unit.perks];
  state.attrs = { ...unit.attrs };
  state.hp = unit.alive ? Math.max(1, unit.hp) : 0;
  state.morale = unit.morale;
  state.weapon = unit.weapon;
  state.sidearm = unit.sidearm;
  state.missions += 1;
}

// ─────────────────────────────────────────────────────────────── enemies

/**
 * Spawn a hostile. `seed` drives cosmetic variation and any stat jitter, so a wave of six
 * raiders reads as six different people rather than one person copied six times.
 */
export function spawnEnemy(defId: string, pos: Vec2, seed: number): Unit {
  const def = ENEMIES[defId];
  if (!def) throw new Error(`Unknown enemy: ${defId}`);
  const rng = new Rng(seed);

  const attrs = { ...def.attrs };
  // Humans vary a little; the dead are uniformly the dead.
  if (def.family === 'human') {
    attrs.marksmanship = clampAttr(attrs.marksmanship + rng.int(-1, 1));
    attrs.agility = clampAttr(attrs.agility + rng.int(-1, 1));
  }

  const mods = modsFor([], []);
  const maxHp = Math.round(def.hp * (def.family === 'human' ? rng.float(0.9, 1.1) : 1));
  const maxStamina = maxStaminaFor(attrs, mods);

  const weapon = makeWeapon(def.weapon, {
    // Enemy gear is used gear. This is also why looted guns need repairing.
    condition: def.family === 'human' ? rng.int(45, 92) : 100,
  });

  return {
    id: uid(defId),
    defId,
    name: def.name,
    team: def.team,
    kind: def.family === 'zombie' ? 'zombie' : 'human',
    pos,
    facing: rng.int(0, 7) as Unit['facing'],
    stance: def.special === 'low_profile' ? 'prone' : 'standing',
    hp: maxHp,
    maxHp,
    stamina: maxStamina,
    maxStamina,
    ap: 0,
    // `speed` is authored per enemy so pacing is a design decision, not a formula output.
    maxAp: def.speed,
    reserve: 0,
    attrs,
    armour: { ...def.armour },
    statuses: [],
    weapon,
    sidearm: def.sidearm ? makeWeapon(def.sidearm) : null,
    inventory: [],
    perks: [],
    traits: [],
    level: 1,
    xp: 0,
    morale: def.family === 'zombie' ? 100 : rng.int(50, 85),
    calm: 0,
    spriteSeed: hashString(def.id) ^ seed,
    alive: true,
    critical: false,
    criticalTurns: 0,
  };
}

const clampAttr = (n: number): number => Math.max(1, Math.min(10, n));

/** Fixed AP for enemies comes from their def, so refresh must not use the agility formula. */
export function refreshEnemyAp(u: Unit): void {
  const def = ENEMIES[u.defId];
  if (def) u.maxAp = def.speed;
}

export function enemyDefOf(u: Unit): EnemyDef | undefined {
  return ENEMIES[u.defId];
}

export function mercDefOf(u: Unit): MercDef | undefined {
  return MERCS[u.defId];
}

/** Sense radius for AI — authored for enemies, derived for mercs. */
export function senseRadiusOf(u: Unit): number {
  const def = ENEMIES[u.defId];
  if (def) return def.senseRadius;
  return 12 + unitMods(u).sightRange;
}
