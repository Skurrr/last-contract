/**
 * The game's colour language. One palette file so the whole product — sprites, tiles, UI
 * chrome, damage numbers — reads as a single art direction: military surplus under a grey
 * sky, with a few high-saturation accents reserved for things the player must not miss.
 */
import { hex, type RGBA } from './forge';

export const PAL = {
  // structural
  ink: hex('#12140f'),
  inkSoft: hex('#1d2118'),
  steel: hex('#4a5250'),
  steelLight: hex('#6e7874'),
  gunmetal: hex('#33383a'),
  bone: hex('#d8d3bd'),
  ash: hex('#8d8b7e'),

  // military cloth
  olive: hex('#4a5535'),
  oliveLight: hex('#68764a'),
  oliveDark: hex('#333c25'),
  khaki: hex('#8a7f56'),
  coyote: hex('#9a7a4f'),
  navy: hex('#2c3a4d'),
  charcoal: hex('#2a2c2b'),
  woodland: hex('#3d4a30'),

  // flesh
  skin1: hex('#e8b98f'),
  skin2: hex('#c68d63'),
  skin3: hex('#8f5f3d'),
  skin4: hex('#5e3b28'),
  skinPale: hex('#f0d2b0'),

  // the dead
  rot: hex('#7d8f63'),
  rotDark: hex('#54633f'),
  rotPale: hex('#a3ab8c'),
  bloatGreen: hex('#8fae52'),

  // signals — reserved, never decorative
  blood: hex('#8e1c1c'),
  bloodBright: hex('#c62828'),
  rust: hex('#b4571f'),
  amber: hex('#e8a33d'),
  gold: hex('#f2c94c'),
  lime: hex('#7ed957'),
  cyan: hex('#4fc3e8'),
  violet: hex('#9b6fd6'),
  white: hex('#f5f2e8'),

  // ground
  grass: hex('#4d6b3a'),
  grassDark: hex('#3a5230'),
  dirt: hex('#6b5842'),
  dirtDark: hex('#544433'),
  road: hex('#4c4c4a'),
  roadDark: hex('#3b3b39'),
  water: hex('#2f5568'),
  concrete: hex('#736f63'),
  wood: hex('#6b4c32'),
} as const;

export type PaletteKey = keyof typeof PAL;

export const SKIN_TONES: readonly RGBA[] = [
  PAL.skinPale, PAL.skin1, PAL.skin2, PAL.skin3, PAL.skin4,
];

export const HAIR_TONES: readonly RGBA[] = [
  hex('#2b2118'), hex('#4a3524'), hex('#8a6234'), hex('#c2a15a'),
  hex('#9a9a95'), hex('#d9d5c8'), hex('#5a2f22'), hex('#1a1a1c'),
];

export const CLOTH_TONES: readonly RGBA[] = [
  PAL.olive, PAL.oliveDark, PAL.khaki, PAL.coyote,
  PAL.navy, PAL.charcoal, PAL.woodland, PAL.steel,
];

/** Team tints applied to the outline so allegiance reads instantly at a glance. */
export const TEAM_OUTLINE = {
  player: hex('#5fd3e8'),
  ally: hex('#7ed957'),
  enemy: hex('#e05a3a'),
  zombie: hex('#8a5fa8'),
} as const;

/** Faction identity colours, mirrored in `src/data/factions.ts`. */
export const FACTION_COLORS: Record<string, string> = {
  havenhold: '#6aa84f',
  rust_kings: '#c1571f',
  ash_order: '#8e6bb5',
  remnant: '#3f6f9e',
  free_traders: '#d4a441',
  neutral: '#6b6b63',
};

/** Damage number colours, keyed by how much it hurt as a fraction of max HP. */
export function damageColor(fraction: number, crit: boolean): string {
  if (crit) return '#ffd23d';
  if (fraction > 0.4) return '#ff4d3d';
  if (fraction > 0.2) return '#ff8a3d';
  if (fraction > 0.08) return '#ffd08a';
  return '#e8e4d5';
}
