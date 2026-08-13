/**
 * Bridge between the content vocabulary and the art vocabulary.
 *
 * Content files name sprites for what a thing *is* ('rifle-battle', 'att-scope-4x'); the
 * forge names them for how they are *drawn* ('battlerifle', 'optic-scope'). Keeping the two
 * vocabularies separate means adding a weapon never requires touching the renderer — an
 * unmapped key falls back to a sensible shape for its class instead of crashing.
 */
import type { AttachmentSlot, WeaponClass } from '@/sim/types';
import type { AttachSpriteKey, WeaponSpriteKey } from './weapons';

const WEAPON_BODY: Record<string, WeaponSpriteKey> = {
  // canonical forge keys map to themselves
  'pistol-light': 'pistol-light',
  'pistol-heavy': 'pistol-heavy',
  revolver: 'revolver',
  'smg-compact': 'smg-compact',
  'smg-long': 'smg-long',
  'rifle-assault': 'rifle-assault',
  'rifle-bullpup': 'rifle-bullpup',
  'rifle-hunting': 'rifle-hunting',
  battlerifle: 'battlerifle',
  'sniper-bolt': 'sniper-bolt',
  'sniper-heavy': 'sniper-heavy',
  'shotgun-pump': 'shotgun-pump',
  'shotgun-sawn': 'shotgun-sawn',
  'lmg-belt': 'lmg-belt',
  'melee-knife': 'melee-knife',
  'melee-machete': 'melee-machete',
  'melee-axe': 'melee-axe',
  'melee-blunt': 'melee-blunt',
  'melee-spear': 'melee-spear',
  'thrown-grenade': 'thrown-grenade',
  'thrown-bottle': 'thrown-bottle',
  'thrown-pipe': 'thrown-pipe',
  'improv-pipe': 'improv-pipe',
  'improv-nailgun': 'improv-nailgun',
  'improv-bolt': 'improv-bolt',

  // content aliases
  'rifle-battle': 'battlerifle',
  'melee-polearm': 'melee-spear',
  'melee-blade': 'melee-machete',
  'sniper-amr': 'sniper-heavy',
  'shotgun-double': 'shotgun-sawn',
  'shotgun-auto': 'shotgun-pump',
  'lmg-drum': 'lmg-belt',
  crossbow: 'improv-bolt',
  'thrown-smoke': 'thrown-pipe',
  'thrown-can': 'thrown-pipe',
};

const FALLBACK_BY_CLASS: Record<WeaponClass, WeaponSpriteKey> = {
  pistol: 'pistol-light',
  smg: 'smg-compact',
  rifle: 'rifle-assault',
  battlerifle: 'battlerifle',
  sniper: 'sniper-bolt',
  shotgun: 'shotgun-pump',
  lmg: 'lmg-belt',
  melee: 'melee-knife',
  thrown: 'thrown-grenade',
};

export function weaponBodyKey(sprite: string, cls: WeaponClass): WeaponSpriteKey {
  return WEAPON_BODY[sprite] ?? FALLBACK_BY_CLASS[cls];
}

const ATTACH: Record<string, AttachSpriteKey> = {
  // canonical
  'optic-reddot': 'optic-reddot',
  'optic-scope': 'optic-scope',
  'optic-thermal': 'optic-thermal',
  'optic-iron': 'optic-iron',
  'optic-junk': 'optic-junk',
  'barrel-suppressor': 'barrel-suppressor',
  'barrel-brake': 'barrel-brake',
  'barrel-heavy': 'barrel-heavy',
  'barrel-junk': 'barrel-junk',
  'under-grip': 'under-grip',
  'under-bipod': 'under-bipod',
  'under-laser': 'under-laser',
  'under-bayonet': 'under-bayonet',
  'under-launcher': 'under-launcher',
  'mag-extended': 'mag-extended',
  'mag-drum': 'mag-drum',
  'mag-quick': 'mag-quick',
  'stock-fixed': 'stock-fixed',
  'stock-folding': 'stock-folding',
  'stock-precision': 'stock-precision',
  'internal-trigger': 'internal-trigger',
  'internal-spring': 'internal-spring',
  'internal-bumpfire': 'internal-bumpfire',

  // content 'att-*' namespace
  'att-dot': 'optic-reddot',
  'att-reflex': 'optic-reddot',
  'att-scope-4x': 'optic-scope',
  'att-scope-6x': 'optic-scope',
  'att-scope': 'optic-scope',
  'att-thermal': 'optic-thermal',
  'att-nv': 'optic-thermal',
  'att-irons': 'optic-iron',
  'att-taped-reflector': 'optic-junk',
  'att-spotting-kludge': 'optic-junk',
  'att-can': 'barrel-suppressor',
  'att-suppressor': 'barrel-suppressor',
  'att-oil-filter': 'barrel-junk',
  'att-brake': 'barrel-brake',
  'att-heavy-barrel': 'barrel-heavy',
  'att-grip': 'under-grip',
  'att-broom-grip': 'under-grip',
  'att-bipod': 'under-bipod',
  'att-wire-bipod': 'under-bipod',
  'att-laser': 'under-laser',
  'att-bayonet': 'under-bayonet',
  'att-launcher': 'under-launcher',
  'att-mag-ext': 'mag-extended',
  'att-mag-drum': 'mag-drum',
  'att-mag-quick': 'mag-quick',
  'att-taped-mags': 'mag-quick',
  'att-belt-box': 'mag-drum',
  'att-stock': 'stock-fixed',
  'att-folding-stock': 'stock-folding',
  'att-precision-stock': 'stock-precision',
  'att-brace': 'stock-folding',
  'att-trigger': 'internal-trigger',
  'att-spring': 'internal-spring',
  'att-bumpfire': 'internal-bumpfire',
  'att-handload': 'internal-spring',
  'att-shim': 'internal-spring',
};

const FALLBACK_BY_SLOT: Record<AttachmentSlot, AttachSpriteKey> = {
  optic: 'optic-reddot',
  barrel: 'barrel-brake',
  underbarrel: 'under-grip',
  magazine: 'mag-extended',
  stock: 'stock-fixed',
  internal: 'internal-trigger',
};

export function attachmentKey(sprite: string, slot: AttachmentSlot): AttachSpriteKey {
  return ATTACH[sprite] ?? FALLBACK_BY_SLOT[slot];
}
