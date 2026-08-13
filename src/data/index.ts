/**
 * The content registry. One place the simulation looks things up, so adding content never
 * means touching engine code.
 */
import { WEAPONS } from './weapons';
import { NATURAL_WEAPONS } from './natural';
import type { WeaponDef } from '@/sim/types';

/**
 * Every weapon the simulation can resolve, including natural attacks. `WEAPONS` remains the
 * market/crafting catalogue — only this merged view includes claws and fists.
 */
export const ALL_WEAPONS: Record<string, WeaponDef> = { ...WEAPONS, ...NATURAL_WEAPONS };

export { WEAPONS, WEAPON_LIST, weaponsOfClass } from './weapons';
export { NATURAL_WEAPONS } from './natural';
export { ATTACHMENTS, ATTACHMENT_LIST, attachmentsForSlot } from './attachments';
export { PERKS, PERK_LIST, perksInTree } from './perks';
export { TRAITS, TRAIT_LIST, POSITIVE_TRAITS, NEGATIVE_TRAITS } from './traits';
export { MERCS, MERC_LIST, STARTING_MERC } from './mercs';
export { ENEMIES, ENEMY_LIST, ZOMBIE_IDS, HUMAN_ENEMY_IDS } from './enemies';
export { FACTIONS, FACTION_IDS, ALLIANCE_THRESHOLD, WAR_THRESHOLD } from './factions';
export { SECTORS, sectorAt, MAP_W, MAP_H } from './sectors';
export { RECIPES, MATERIAL_INFO, SCRAP_YIELD, improvisedQuality } from './crafting';

export type { MercDef, MercPalette } from './mercs';
export type { EnemyDef, EnemyFamily, EnemyFaction, LootHint } from './enemies';
export type { FactionDef } from './factions';
export type { SectorDef, SectorBiome } from './sectors';
export type { RecipeDef } from './crafting';
