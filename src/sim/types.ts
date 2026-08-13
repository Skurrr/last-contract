/**
 * The tactical domain model. Everything here is plain serialisable data — the battle state
 * is a value, which is what lets us snapshot it for saves, replays, and the balance harness.
 */
import type { Vec2, Facing } from '@/core/grid';

// ─────────────────────────────────────────────────────────────── attributes & body

export const ATTRIBUTES = [
  'marksmanship',
  'agility',
  'strength',
  'vitality',
  'endurance',
  'wisdom',
  'leadership',
  'mechanical',
  'medical',
  'explosives',
] as const;
export type Attribute = (typeof ATTRIBUTES)[number];
export type Attributes = Record<Attribute, number>;

export const BODY_PARTS = ['head', 'torso', 'arms', 'legs'] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

/** to-hit multiplier, damage multiplier, and the status a solid hit inflicts. */
export const BODY_PART_TABLE: Record<
  BodyPart,
  { hit: number; damage: number; inflicts?: StatusKind; label: string }
> = {
  head: { hit: 0.45, damage: 2.5, inflicts: 'stunned', label: 'Head' },
  torso: { hit: 1.0, damage: 1.0, label: 'Torso' },
  arms: { hit: 0.65, damage: 0.7, inflicts: 'shaky', label: 'Arms' },
  legs: { hit: 0.7, damage: 0.8, inflicts: 'hobbled', label: 'Legs' },
};

export const STANCES = ['standing', 'crouched', 'prone'] as const;
export type Stance = (typeof STANCES)[number];

export const STANCE_TABLE: Record<
  Stance,
  { moveMul: number; hitTaken: number; hitGiven: number; changeAP: number; label: string }
> = {
  standing: { moveMul: 1.0, hitTaken: 1.0, hitGiven: 1.0, changeAP: 0, label: 'Standing' },
  crouched: { moveMul: 1.5, hitTaken: 0.75, hitGiven: 1.1, changeAP: 2, label: 'Crouched' },
  prone: { moveMul: 3.0, hitTaken: 0.5, hitGiven: 1.2, changeAP: 3, label: 'Prone' },
};

// ─────────────────────────────────────────────────────────────── statuses

export type StatusKind =
  | 'bleeding'
  | 'stunned'
  | 'shaky'
  | 'hobbled'
  | 'suppressed'
  | 'poisoned'
  | 'adrenaline'
  | 'panicked'
  | 'inspired'
  | 'overwatch';

export interface Status {
  kind: StatusKind;
  /** Turns remaining. -1 means it persists until explicitly cleared (e.g. bleeding). */
  turns: number;
  /** Stack count — bleeding uses this for damage-per-turn. */
  stacks: number;
}

export const STATUS_INFO: Record<
  StatusKind,
  { label: string; good: boolean; desc: string }
> = {
  bleeding: { label: 'Bleeding', good: false, desc: '2 HP lost per stack each turn until bandaged.' },
  stunned: { label: 'Stunned', good: false, desc: 'Loses half its AP next turn.' },
  shaky: { label: 'Shaky', good: false, desc: 'Arm wound: −25% to-hit.' },
  hobbled: { label: 'Hobbled', good: false, desc: 'Leg wound: movement costs double.' },
  suppressed: { label: 'Suppressed', good: false, desc: 'Pinned by fire: −30% to-hit, cannot dash.' },
  poisoned: { label: 'Poisoned', good: false, desc: 'Bloater gas: loses stamina and 3 HP per turn.' },
  adrenaline: { label: 'Adrenaline', good: true, desc: '+2 AP and no stamina penalty.' },
  panicked: { label: 'Panicked', good: false, desc: 'May act on its own and flee.' },
  inspired: { label: 'Inspired', good: true, desc: '+15% to-hit and +1 AP.' },
  overwatch: { label: 'Overwatch', good: true, desc: 'Will fire on the first enemy entering its cone.' },
};

// ─────────────────────────────────────────────────────────────── weapons & gear

export type WeaponClass =
  | 'pistol'
  | 'smg'
  | 'rifle'
  | 'battlerifle'
  | 'sniper'
  | 'shotgun'
  | 'lmg'
  | 'melee'
  | 'thrown';

export type AmmoType = '9mm' | '45acp' | '556' | '762' | '12ga' | '338' | 'bolt' | 'none';

export type AttachmentSlot =
  | 'optic'
  | 'barrel'
  | 'underbarrel'
  | 'magazine'
  | 'stock'
  | 'internal';

export type FireMode = 'single' | 'burst' | 'auto';

/** Additive/multiplicative deltas an attachment applies. All fields optional. */
export interface StatDelta {
  accuracy?: number;      // additive, percentage points on base hit chance
  recoil?: number;        // multiplicative
  noise?: number;         // multiplicative
  damage?: number;        // multiplicative
  apCost?: number;        // additive AP
  magSize?: number;       // additive rounds
  rangeOptimal?: number;  // additive tiles
  rangeMax?: number;      // additive tiles
  weight?: number;        // additive
  /** Accuracy bonus that only applies beyond `optimal` range (scopes). */
  longRangeAccuracy?: number;
  /** Accuracy penalty applied within 4 tiles (scopes). */
  closeRangePenalty?: number;
  /** Accuracy bonus that only applies while prone (bipod). */
  proneAccuracy?: number;
  /** Additive armour penetration — how AP ammo and hardened penetrators are expressed. */
  penetration?: number;
}

export interface AttachmentDef {
  id: string;
  name: string;
  slot: AttachmentSlot;
  desc: string;
  /** Weapon classes this fits. Empty = fits all. */
  fits: readonly WeaponClass[];
  delta: StatDelta;
  value: number;
  rarity: Rarity;
  /** Drawn onto the weapon sprite by the art forge. */
  sprite: string;
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'exotic';

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#9aa39a',
  uncommon: '#5fd35f',
  rare: '#54a8ff',
  exotic: '#ff9d3d',
};

export interface WeaponDef {
  id: string;
  name: string;
  cls: WeaponClass;
  desc: string;
  damage: number;
  ammo: AmmoType;
  magSize: number;
  /** AP for one single shot. Burst/auto add per extra round. */
  apCost: number;
  /** Base hit chance at optimal range, 0..1 before all modifiers. */
  accuracy: number;
  /** Beyond `optimal`, accuracy falls off linearly to zero at `max`. */
  rangeOptimal: number;
  rangeMax: number;
  /** Per-extra-round accuracy penalty inside a burst. */
  recoil: number;
  /** Tiles the shot is heard across. */
  noise: number;
  weight: number;
  modes: readonly FireMode[];
  /** Rounds fired by a burst. Auto uses the whole remaining mag up to autoRounds. */
  burstRounds: number;
  autoRounds: number;
  slots: readonly AttachmentSlot[];
  value: number;
  rarity: Rarity;
  /** Armour ignored, flat. Shotguns low, rifles high. */
  penetration: number;
  sprite: string;
  /** Melee only: stamina cost per swing. */
  staminaCost?: number;
}

/** A concrete weapon instance in the world, with wear and fitted attachments. */
export interface WeaponInstance {
  uid: string;
  defId: string;
  /** 0..100. Below 40 jams get likely. */
  condition: number;
  attachments: Partial<Record<AttachmentSlot, string>>;
  loaded: number;
  mode: FireMode;
  /** Set for crafted one-offs. */
  customName?: string;
}

export type MaterialId =
  | 'scrap'
  | 'steel'
  | 'polymer'
  | 'springs'
  | 'optics'
  | 'powder'
  | 'electronics'
  | 'tape';

export type Materials = Partial<Record<MaterialId, number>>;

// ─────────────────────────────────────────────────────────────── units

export type Team = 'player' | 'ally' | 'enemy' | 'zombie';

export type UnitKind = 'merc' | 'human' | 'zombie';

export interface Unit {
  id: string;
  /** Points at a MercDef for player mercs, or an EnemyDef otherwise. */
  defId: string;
  name: string;
  team: Team;
  kind: UnitKind;
  pos: Vec2;
  facing: Facing;
  stance: Stance;

  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  ap: number;
  maxAp: number;
  /** AP carried into the enemy turn for interrupts. */
  reserve: number;

  attrs: Attributes;
  armour: Record<BodyPart, number>;
  statuses: Status[];

  weapon: WeaponInstance | null;
  sidearm: WeaponInstance | null;
  /** Consumables and materials carried into the field. */
  inventory: string[];

  perks: string[];
  traits: string[];
  level: number;
  xp: number;

  morale: number;
  /** Turns since this unit last took damage — drives the AI's aggression. */
  calm: number;
  /** Deterministic seed for the art forge. */
  spriteSeed: number;

  alive: boolean;
  /** Downed mercs are alive but Critical; they die if not stabilised. */
  critical: boolean;
  criticalTurns: number;
  /** Zombie AI: the noise source it is currently walking toward. */
  target?: Vec2;
  /**
   * This unit has no legs to stand on — crawling is its natural gait, not a stance penalty.
   * Without this a crawler's 4 AP could never pay the 6 AP a prone step costs, and it would
   * be a statue that bites whatever wandered into reach.
   */
  naturalProne?: boolean;
  /** Set once a death explosion has fired, so a chain of bloaters cannot recurse. */
  detonated?: boolean;
}

// ─────────────────────────────────────────────────────────────── terrain

export type TerrainKind =
  | 'floor'
  | 'grass'
  | 'road'
  | 'dirt'
  | 'water'
  | 'wall'
  | 'window'
  | 'door'
  | 'crate'
  | 'sandbag'
  | 'fence'
  | 'tree'
  | 'rubble'
  | 'car';

export interface TerrainInfo {
  label: string;
  /** false = cannot be entered. */
  walkable: boolean;
  /** Blocks line of sight entirely. */
  blocksSight: boolean;
  /** 0 = none, 1 = low (−25%), 2 = high (−45%). */
  cover: 0 | 1 | 2;
  /** Extra AP to enter, on top of the base 2/3. */
  moveCost: number;
  /** HP before it is destroyed; 0 = indestructible. */
  integrity: number;
  /** Noise emitted when destroyed. */
  breakNoise: number;
}

export const TERRAIN: Record<TerrainKind, TerrainInfo> = {
  floor:   { label: 'Floor',   walkable: true,  blocksSight: false, cover: 0, moveCost: 0, integrity: 0,  breakNoise: 0 },
  grass:   { label: 'Grass',   walkable: true,  blocksSight: false, cover: 0, moveCost: 0, integrity: 0,  breakNoise: 0 },
  road:    { label: 'Road',    walkable: true,  blocksSight: false, cover: 0, moveCost: 0, integrity: 0,  breakNoise: 0 },
  dirt:    { label: 'Dirt',    walkable: true,  blocksSight: false, cover: 0, moveCost: 0, integrity: 0,  breakNoise: 0 },
  water:   { label: 'Water',   walkable: true,  blocksSight: false, cover: 0, moveCost: 2, integrity: 0,  breakNoise: 4 },
  wall:    { label: 'Wall',    walkable: false, blocksSight: true,  cover: 2, moveCost: 0, integrity: 120, breakNoise: 18 },
  window:  { label: 'Window',  walkable: false, blocksSight: false, cover: 1, moveCost: 0, integrity: 8,   breakNoise: 10 },
  door:    { label: 'Door',    walkable: true,  blocksSight: true,  cover: 1, moveCost: 1, integrity: 40,  breakNoise: 12 },
  crate:   { label: 'Crate',   walkable: false, blocksSight: false, cover: 1, moveCost: 0, integrity: 30,  breakNoise: 8 },
  sandbag: { label: 'Sandbags',walkable: false, blocksSight: false, cover: 1, moveCost: 0, integrity: 60,  breakNoise: 4 },
  fence:   { label: 'Fence',   walkable: false, blocksSight: false, cover: 1, moveCost: 0, integrity: 15,  breakNoise: 9 },
  tree:    { label: 'Tree',    walkable: false, blocksSight: true,  cover: 2, moveCost: 0, integrity: 80,  breakNoise: 6 },
  rubble:  { label: 'Rubble',  walkable: true,  blocksSight: false, cover: 1, moveCost: 2, integrity: 0,   breakNoise: 0 },
  car:     { label: 'Wreck',   walkable: false, blocksSight: true,  cover: 2, moveCost: 0, integrity: 90,  breakNoise: 14 },
};

export const TERRAIN_KINDS = Object.keys(TERRAIN) as TerrainKind[];
export const terrainIndex = (k: TerrainKind): number => TERRAIN_KINDS.indexOf(k);

// ─────────────────────────────────────────────────────────────── battle state

export type Phase = 'player' | 'ally' | 'enemy' | 'zombie';

export interface LootDrop {
  pos: Vec2;
  weapons: WeaponInstance[];
  attachments: string[];
  materials: Materials;
  cash: number;
}

export type ObjectiveKind = 'eliminate' | 'survive' | 'reach' | 'retrieve' | 'protect';

export interface Objective {
  kind: ObjectiveKind;
  label: string;
  done: boolean;
  failed: boolean;
  /** For `survive`: turns remaining. For `reach`: the goal tile. */
  turns?: number;
  at?: Vec2;
  /** For `protect`: the unit that must live. */
  unitId?: string;
}

export interface BattleState {
  seed: number;
  rngState: number;
  w: number;
  h: number;
  /** Terrain index per tile, indexed into TERRAIN_KINDS. */
  terrain: Uint8Array;
  /** Remaining integrity per tile; 0 for indestructible or already destroyed. */
  integrity: Int16Array;
  /** Blood/scorch decals, purely cosmetic, 0..255 intensity. */
  decals: Uint8Array;

  units: Unit[];
  loot: LootDrop[];
  objectives: Objective[];

  phase: Phase;
  turn: number;
  /** Index into the current phase's unit list. */
  activeUnitId: string | null;

  /** Decaying noise per tile — what zombies actually chase. */
  noise: Float32Array;

  /** 0 = pitch dark, 1 = full daylight. Affects to-hit and sight range. */
  light: number;

  outcome: 'ongoing' | 'victory' | 'defeat';
  /** Append-only record of what happened, for the after-action report. */
  log: LogEntry[];
}

export interface LogEntry {
  turn: number;
  text: string;
  tone: 'info' | 'good' | 'bad' | 'crit';
}
