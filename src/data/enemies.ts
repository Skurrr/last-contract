/**
 * Everything that shoots back, and everything that does not shoot but keeps walking.
 *
 * Enemies are cheap by design — a stat line, a weapon, a loot hint. All the writing budget
 * went into the roster (mercs.ts); what these need is to be *readable at a glance* on the
 * grid, so each has a distinct silhouette (`sprite`) and palette.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * EXTERNAL IDS REFERENCED HERE (owned by weapons.ts — reconcile before wiring up):
 *   zombie-claws (natural melee attack, ammo 'none'), pipe-rifle, fire-axe, machete,
 *   sks, ak-74, m4-carbine, mp5, makarov, m1911, mossberg-590, sawn-off, remington-700
 * Bark set ids (barks.ts): 'zombie', 'enemy_human'.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import type { Attributes, BodyPart, MaterialId, Team } from '@/sim/types';

export type EnemyFamily = 'zombie' | 'human';

/** Which side of the Basin's politics this unit belongs to. Drives reputation on kill. */
export type EnemyFaction =
  | 'none'
  | 'havenhold'
  | 'rustkings'
  | 'ashorder'
  | 'remnant'
  | 'freetraders';

/**
 * Hints, not tables. The loot generator reads these and rolls actual items — keeping it
 * declarative here means a designer can retune drops without touching generator code.
 */
export interface LootHint {
  /** Inclusive cash range. */
  cash: [number, number];
  /** 0..1 chance the equipped weapon survives the kill and drops. */
  weaponDropChance: number;
  /** 0..1 chance a fitted attachment comes with it. */
  attachmentChance: number;
  /** Materials salvaged from the corpse, as inclusive ranges. */
  materials: Partial<Record<MaterialId, [number, number]>>;
  /** Free-form pool tags: 'ammo', 'medical', 'chems', 'milspec', 'trinket', 'food'. */
  tags: string[];
}

export interface EnemyDef {
  id: string;
  name: string;
  family: EnemyFamily;
  team: Team;
  faction: EnemyFaction;
  /** One line, shown on the inspect panel. */
  desc: string;
  attrs: Attributes;
  hp: number;
  /** Flat damage reduction per hit location. Armoured zombies are why headshots exist. */
  armour: Record<BodyPart, number>;
  /** Weapon id from weapons.ts. Zombies carry `zombie-claws`. */
  weapon: string;
  sidearm?: string;
  /** Base XP award for the kill, before the killer's wisdom scaling. */
  xp: number;
  loot: LootHint;
  /** Art forge key. */
  sprite: string;
  palette: { skin: string; cloth: string; accent: string };
  /**
   * Tiles this unit perceives a target across. Zombies *hear* — this is their radius on the
   * noise map, and it is deliberately far larger than their sight. Humans see, and use it
   * as sight range in good light.
   */
  senseRadius: number;
  /** Fixed AP per turn. Overrides the agility formula so zombie pacing is authored, not derived. */
  speed: number;
  /** Flag for the combat layer's special-case handlers (gas, horde call, etc.). */
  special?: string;
}

const NO_ARMOUR: Record<BodyPart, number> = { head: 0, torso: 0, arms: 0, legs: 0 };

/** Zombies have no skills — only the three attributes that describe a walking body. */
function deadAttrs(strength: number, vitality: number, agility: number): Attributes {
  return {
    marksmanship: 1, agility, strength, vitality, endurance: 10,
    wisdom: 1, leadership: 1, mechanical: 1, medical: 1, explosives: 1,
  };
}

export const ENEMIES: Record<string, EnemyDef> = {
  // ─────────────────────────────────────────────────────────────────────────────── the dead
  shambler: {
    id: 'shambler',
    name: 'Shambler',
    family: 'zombie',
    team: 'zombie',
    faction: 'none',
    desc: 'Eight years dead and still upright. Slow, patient, and never alone.',
    attrs: deadAttrs(6, 5, 2),
    hp: 42,
    armour: { ...NO_ARMOUR },
    weapon: 'zombie-claws',
    xp: 12,
    loot: {
      cash: [0, 6],
      weaponDropChance: 0,
      attachmentChance: 0,
      materials: { scrap: [0, 1], tape: [0, 1] },
      tags: ['trinket'],
    },
    sprite: 'zed_shambler',
    palette: { skin: '#7f8a72', cloth: '#4a4438', accent: '#6b2a26' },
    senseRadius: 16,
    speed: 5,
  },

  runner: {
    id: 'runner',
    name: 'Runner',
    family: 'zombie',
    team: 'zombie',
    faction: 'none',
    desc: 'Turned recently, or turned warm. Thin, fast, and it closes the gap before you reload.',
    attrs: deadAttrs(4, 3, 8),
    hp: 26,
    armour: { ...NO_ARMOUR },
    weapon: 'zombie-claws',
    xp: 18,
    loot: {
      cash: [0, 12],
      weaponDropChance: 0,
      attachmentChance: 0,
      materials: { scrap: [0, 1] },
      tags: ['trinket', 'food'],
    },
    sprite: 'zed_runner',
    palette: { skin: '#96a07c', cloth: '#3a3c44', accent: '#8c3128' },
    senseRadius: 22,
    speed: 11,
  },

  bloater: {
    id: 'bloater',
    name: 'Bloater',
    family: 'zombie',
    team: 'zombie',
    faction: 'none',
    desc: 'Swollen with Fever gas. Kill it at range or share what is inside it.',
    attrs: deadAttrs(7, 9, 1),
    hp: 66,
    armour: { head: 0, torso: 2, arms: 0, legs: 0 },
    weapon: 'zombie-claws',
    xp: 26,
    loot: {
      cash: [0, 8],
      weaponDropChance: 0,
      attachmentChance: 0,
      materials: { powder: [1, 2] },
      tags: ['chems'],
    },
    sprite: 'zed_bloater',
    palette: { skin: '#8f9a5e', cloth: '#5a5040', accent: '#b6c24a' },
    senseRadius: 14,
    speed: 4,
    special: 'gas_burst',
  },

  armoured: {
    id: 'armoured',
    name: 'Armoured Dead',
    family: 'zombie',
    team: 'zombie',
    faction: 'none',
    desc: 'Died in a plate carrier and never took it off. Body shots are wasted ammunition.',
    attrs: deadAttrs(8, 8, 2),
    hp: 58,
    armour: { head: 2, torso: 14, arms: 8, legs: 6 },
    weapon: 'zombie-claws',
    xp: 34,
    loot: {
      cash: [10, 40],
      weaponDropChance: 0.15,
      attachmentChance: 0.1,
      materials: { steel: [1, 2], polymer: [0, 2] },
      tags: ['milspec', 'ammo'],
    },
    sprite: 'zed_armoured',
    palette: { skin: '#6e7a68', cloth: '#3c4436', accent: '#2b2f2a' },
    senseRadius: 16,
    speed: 5,
  },

  screamer: {
    id: 'screamer',
    name: 'Screamer',
    family: 'zombie',
    team: 'zombie',
    faction: 'none',
    desc: 'Its throat still works. If it sees you before you drop it, everything within a sector hears about it.',
    attrs: deadAttrs(3, 4, 4),
    hp: 30,
    armour: { ...NO_ARMOUR },
    weapon: 'zombie-claws',
    xp: 40,
    loot: {
      cash: [0, 10],
      weaponDropChance: 0,
      attachmentChance: 0,
      materials: { scrap: [0, 2] },
      tags: ['trinket'],
    },
    sprite: 'zed_screamer',
    palette: { skin: '#a09a86', cloth: '#4e4250', accent: '#d05a7a' },
    senseRadius: 26,
    speed: 6,
    special: 'horde_call',
  },

  crawler: {
    id: 'crawler',
    name: 'Crawler',
    family: 'zombie',
    team: 'zombie',
    faction: 'none',
    desc: 'Lost its legs somewhere and did not stop. Sits below cover, below sightlines, below notice.',
    attrs: deadAttrs(6, 6, 3),
    hp: 34,
    armour: { ...NO_ARMOUR },
    weapon: 'zombie-claws',
    xp: 16,
    loot: {
      cash: [0, 6],
      weaponDropChance: 0,
      attachmentChance: 0,
      materials: { scrap: [0, 1] },
      tags: ['trinket'],
    },
    sprite: 'zed_crawler',
    palette: { skin: '#7a8468', cloth: '#453d33', accent: '#5e2622' },
    senseRadius: 18,
    speed: 4,
    // Permanently prone: ×0.5 to-hit taken, ignores low cover, gets no move-diagonal.
    special: 'low_profile',
  },

  // ─────────────────────────────────────────────────────────────────────────────── the living
  raider: {
    id: 'raider',
    name: 'Rust King Raider',
    family: 'human',
    team: 'enemy',
    faction: 'rustkings',
    desc: 'Toll collector with a pipe gun and a strong opinion about who owns this road.',
    attrs: {
      marksmanship: 4, agility: 5, strength: 5, vitality: 4, endurance: 5,
      wisdom: 3, leadership: 3, mechanical: 4, medical: 2, explosives: 2,
    },
    hp: 46,
    armour: { head: 0, torso: 3, arms: 1, legs: 1 },
    weapon: 'pipe-rifle',
    sidearm: 'machete',
    xp: 30,
    loot: {
      cash: [20, 70],
      weaponDropChance: 0.5,
      attachmentChance: 0.1,
      materials: { scrap: [1, 3], tape: [0, 2] },
      tags: ['ammo', 'food'],
    },
    sprite: 'hum_raider',
    palette: { skin: '#c08a60', cloth: '#6a4030', accent: '#c8541f' },
    senseRadius: 14,
    speed: 9,
  },

  raider_veteran: {
    id: 'raider_veteran',
    name: 'Rust King Bruiser',
    family: 'human',
    team: 'enemy',
    faction: 'rustkings',
    desc: 'Ran a highway crew for four years. Wears salvaged plate and shoots in disciplined bursts.',
    attrs: {
      marksmanship: 7, agility: 5, strength: 7, vitality: 7, endurance: 6,
      wisdom: 5, leadership: 6, mechanical: 6, medical: 3, explosives: 4,
    },
    hp: 62,
    armour: { head: 4, torso: 9, arms: 4, legs: 3 },
    weapon: 'ak-74',
    sidearm: 'm1911',
    xp: 60,
    loot: {
      cash: [60, 180],
      weaponDropChance: 0.65,
      attachmentChance: 0.35,
      materials: { scrap: [2, 4], steel: [1, 2], springs: [0, 2] },
      tags: ['ammo', 'milspec'],
    },
    sprite: 'hum_raider_vet',
    palette: { skin: '#a4703f', cloth: '#4d3c2c', accent: '#e07a1f' },
    senseRadius: 17,
    speed: 9,
  },

  cultist: {
    id: 'cultist',
    name: 'Ash Order Penitent',
    family: 'human',
    team: 'enemy',
    faction: 'ashorder',
    desc: 'Believes the Fever is a mercy and that you are interrupting it. Charges without cover.',
    attrs: {
      marksmanship: 3, agility: 5, strength: 5, vitality: 5, endurance: 7,
      wisdom: 3, leadership: 2, mechanical: 2, medical: 3, explosives: 2,
    },
    hp: 44,
    armour: { head: 0, torso: 2, arms: 0, legs: 0 },
    weapon: 'machete',
    sidearm: 'makarov',
    xp: 28,
    loot: {
      cash: [10, 45],
      weaponDropChance: 0.4,
      attachmentChance: 0.05,
      materials: { powder: [0, 2], tape: [0, 1] },
      tags: ['chems', 'trinket'],
    },
    sprite: 'hum_cultist',
    palette: { skin: '#b8a08c', cloth: '#5c5a58', accent: '#d8d2c4' },
    senseRadius: 13,
    speed: 10,
    special: 'fearless',
  },

  cult_zealot: {
    id: 'cult_zealot',
    name: 'Ash Order Cinder',
    family: 'human',
    team: 'enemy',
    faction: 'ashorder',
    desc: 'Ash-painted, chem-fed, and does not register the first two hits you land.',
    attrs: {
      marksmanship: 5, agility: 6, strength: 8, vitality: 8, endurance: 9,
      wisdom: 4, leadership: 7, mechanical: 2, medical: 4, explosives: 6,
    },
    hp: 70,
    armour: { head: 2, torso: 6, arms: 2, legs: 2 },
    weapon: 'mossberg-590',
    sidearm: 'fire-axe',
    xp: 65,
    loot: {
      cash: [40, 140],
      weaponDropChance: 0.55,
      attachmentChance: 0.2,
      materials: { powder: [2, 4], electronics: [0, 1] },
      tags: ['chems', 'ammo', 'trinket'],
    },
    sprite: 'hum_zealot',
    palette: { skin: '#a89684', cloth: '#3a3836', accent: '#e8532c' },
    senseRadius: 15,
    speed: 10,
    special: 'fearless',
  },

  remnant_trooper: {
    id: 'remnant_trooper',
    name: 'Remnant Trooper',
    family: 'human',
    team: 'enemy',
    faction: 'remnant',
    desc: 'Still drills every morning. Moves in pairs, uses cover correctly, calls contacts.',
    attrs: {
      marksmanship: 7, agility: 6, strength: 6, vitality: 6, endurance: 7,
      wisdom: 5, leadership: 6, mechanical: 5, medical: 5, explosives: 4,
    },
    hp: 58,
    armour: { head: 6, torso: 12, arms: 5, legs: 5 },
    weapon: 'm4-carbine',
    sidearm: 'm1911',
    xp: 70,
    loot: {
      cash: [50, 150],
      weaponDropChance: 0.6,
      attachmentChance: 0.4,
      materials: { steel: [1, 3], polymer: [1, 2], springs: [0, 2] },
      tags: ['milspec', 'ammo', 'medical'],
    },
    sprite: 'hum_remnant',
    palette: { skin: '#c69468', cloth: '#4a5240', accent: '#2f3a2a' },
    senseRadius: 18,
    speed: 9,
    special: 'suppress_tactics',
  },

  remnant_marksman: {
    id: 'remnant_marksman',
    name: 'Remnant Marksman',
    family: 'human',
    team: 'enemy',
    faction: 'remnant',
    desc: 'Sets up prone on the long axis of the sector and waits for you to cross it.',
    attrs: {
      marksmanship: 9, agility: 5, strength: 5, vitality: 5, endurance: 6,
      wisdom: 6, leadership: 5, mechanical: 6, medical: 4, explosives: 3,
    },
    hp: 50,
    armour: { head: 5, torso: 9, arms: 4, legs: 4 },
    weapon: 'remington-700',
    sidearm: 'm1911',
    xp: 85,
    loot: {
      cash: [70, 200],
      weaponDropChance: 0.55,
      attachmentChance: 0.6,
      materials: { steel: [1, 2], optics: [1, 2], springs: [1, 2] },
      tags: ['milspec', 'ammo'],
    },
    sprite: 'hum_marksman',
    palette: { skin: '#b98a5e', cloth: '#3f4a3a', accent: '#6e7a52' },
    senseRadius: 24,
    speed: 8,
    special: 'prefers_prone',
  },

  trader_guard: {
    id: 'trader_guard',
    name: 'Caravan Guard',
    family: 'human',
    team: 'enemy',
    faction: 'freetraders',
    desc: 'Paid to look expensive to attack. Will surrender the cargo before dying for it.',
    attrs: {
      marksmanship: 6, agility: 6, strength: 5, vitality: 5, endurance: 6,
      wisdom: 5, leadership: 5, mechanical: 5, medical: 4, explosives: 2,
    },
    hp: 52,
    armour: { head: 3, torso: 7, arms: 3, legs: 3 },
    weapon: 'mp5',
    sidearm: 'm1911',
    xp: 55,
    loot: {
      cash: [80, 240],
      weaponDropChance: 0.5,
      attachmentChance: 0.3,
      materials: { scrap: [1, 2], electronics: [0, 2], tape: [1, 2] },
      tags: ['ammo', 'medical', 'food', 'trinket'],
    },
    sprite: 'hum_guard',
    palette: { skin: '#d0a074', cloth: '#5a4e42', accent: '#3f7fa0' },
    senseRadius: 16,
    speed: 9,
    special: 'may_surrender',
  },

  militia: {
    id: 'militia',
    name: 'Havenhold Militia',
    family: 'human',
    team: 'enemy',
    faction: 'havenhold',
    desc: 'A farmer with a surplus rifle and a wall to stand on. Fights hard at home and nowhere else.',
    attrs: {
      marksmanship: 5, agility: 4, strength: 6, vitality: 6, endurance: 6,
      wisdom: 4, leadership: 4, mechanical: 5, medical: 4, explosives: 2,
    },
    hp: 50,
    armour: { head: 1, torso: 4, arms: 1, legs: 1 },
    weapon: 'sks',
    sidearm: 'sawn-off',
    xp: 40,
    loot: {
      cash: [25, 90],
      weaponDropChance: 0.55,
      attachmentChance: 0.15,
      materials: { scrap: [1, 2], steel: [0, 1], tape: [0, 2] },
      tags: ['ammo', 'food', 'medical'],
    },
    sprite: 'hum_militia',
    palette: { skin: '#cf9c6e', cloth: '#6b6a4a', accent: '#8faa5e' },
    senseRadius: 15,
    speed: 8,
    special: 'defends_home',
  },
};

export const ZOMBIE_IDS: string[] = Object.values(ENEMIES)
  .filter((e) => e.family === 'zombie')
  .map((e) => e.id);

export const HUMAN_ENEMY_IDS: string[] = Object.values(ENEMIES)
  .filter((e) => e.family === 'human')
  .map((e) => e.id);

export const ENEMY_LIST: EnemyDef[] = Object.values(ENEMIES);
