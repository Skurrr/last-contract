/**
 * Attachments. Six slots, one fitting per slot per weapon.
 *
 * Deltas are applied by `resolveWeapon` in src/sim/combat.ts:
 *  - `accuracy` is ADDITIVE in percentage points on the 0-100 scale (weapon 0.70 => 70).
 *  - `recoil`, `noise`, `damage` are MULTIPLICATIVE.
 *  - everything else is additive in its own unit.
 * `closeRangePenalty` is subtracted from accuracy within 4 tiles, so a NEGATIVE value there
 * is a close-range bonus (see the ghost ring and the laser).
 *
 * `fits: []` means it fits every weapon class. Nothing fits melee or thrown — a bayonet goes
 * on a rifle, not on a machete.
 *
 * Roughly half of this list is junk: duct-taped, hose-clamped, filed-by-lamplight versions of
 * the real thing. They are worse, and they cost a tenth as much, and they are craftable.
 */
import type { AttachmentDef, AttachmentSlot, WeaponClass } from '@/sim/types';

const GUNS: readonly WeaponClass[] = [
  'pistol',
  'smg',
  'rifle',
  'battlerifle',
  'sniper',
  'shotgun',
  'lmg',
];
const LONGARMS: readonly WeaponClass[] = ['rifle', 'battlerifle', 'sniper', 'lmg'];
const PRECISION: readonly WeaponClass[] = ['battlerifle', 'sniper'];

export const ATTACHMENTS: Record<string, AttachmentDef> = {
  // ───────────────────────────────────────────────────────────── optic

  opt_reflex: {
    id: 'opt_reflex',
    name: 'Reflex Dot',
    slot: 'optic',
    desc: 'A tritium dot that has been quietly glowing in a footlocker for eight years and has a few good ones left in it.',
    fits: GUNS,
    delta: { accuracy: 5, weight: 0.2 },
    value: 380,
    rarity: 'uncommon',
    sprite: 'att-dot',
  },

  opt_reflector: {
    id: 'opt_reflector',
    name: 'Taped Reflector Sight',
    slot: 'optic',
    desc: 'A bicycle reflector, a scrap of window glass and a great deal of tape. It is better than nothing, and only just.',
    fits: GUNS,
    delta: { accuracy: 2, weight: 0.3 },
    value: 60,
    rarity: 'common',
    sprite: 'att-dot',
  },

  opt_ghostring: {
    id: 'opt_ghostring',
    name: 'Ghost Ring Sights',
    slot: 'optic',
    desc: 'A big rear aperture you look through rather than at — made for the half-second when something comes round the corner.',
    fits: ['shotgun', 'rifle', 'smg'],
    delta: { accuracy: 2, closeRangePenalty: -4 },
    value: 110,
    rarity: 'common',
    sprite: 'att-irons',
  },

  opt_scope4x: {
    id: 'opt_scope4x',
    name: '4× Ranger Scope',
    slot: 'optic',
    desc: 'Chevron reticle, fixed power, issued by an army that no longer exists to soldiers who mostly do not either.',
    fits: LONGARMS,
    delta: { longRangeAccuracy: 14, closeRangePenalty: 10, rangeOptimal: 3, weight: 0.5 },
    value: 1000,
    rarity: 'rare',
    sprite: 'att-scope-4x',
  },

  opt_scope6x: {
    id: 'opt_scope6x',
    name: '6× Hunting Glass',
    slot: 'optic',
    desc: 'Clear as a winter morning at four hundred metres, and completely useless at four.',
    fits: PRECISION,
    delta: {
      longRangeAccuracy: 20,
      closeRangePenalty: 18,
      rangeOptimal: 5,
      rangeMax: 4,
      apCost: 1,
      weight: 0.7,
    },
    value: 1350,
    rarity: 'rare',
    sprite: 'att-scope-6x',
  },

  opt_kludge: {
    id: 'opt_kludge',
    name: 'Spotting-Scope Kludge',
    slot: 'optic',
    desc: 'Half a birdwatcher\'s scope hose-clamped to the receiver. It shifts zero every time you set the gun down.',
    fits: LONGARMS,
    delta: { accuracy: -2, longRangeAccuracy: 9, closeRangePenalty: 14, weight: 0.8 },
    value: 150,
    rarity: 'common',
    sprite: 'att-scope-4x',
  },

  opt_nightvision: {
    id: 'opt_nightvision',
    name: 'Green-Tube NV',
    slot: 'optic',
    desc: 'The tube is tired and the image swims, but at three in the morning a tired tube is still a miracle.',
    fits: GUNS,
    delta: { accuracy: 4, longRangeAccuracy: 6, closeRangePenalty: 3, weight: 0.6 },
    value: 1900,
    rarity: 'rare',
    sprite: 'att-nv',
  },

  opt_thermal: {
    id: 'opt_thermal',
    name: 'Remnant Thermal',
    slot: 'optic',
    desc: 'The dead run cold, so on this screen they are grey holes in a warm world — which is the only good news the Fever ever gave anyone.',
    fits: GUNS,
    delta: { accuracy: 8, longRangeAccuracy: 12, weight: 0.9 },
    value: 3600,
    rarity: 'exotic',
    sprite: 'att-thermal',
  },

  // ───────────────────────────────────────────────────────────── barrel

  bar_suppressor: {
    id: 'bar_suppressor',
    name: 'Milled Suppressor',
    slot: 'barrel',
    desc: 'Machined baffles, correct threads, no rattle — the difference between one dead raider and forty walking corpses.',
    fits: ['pistol', 'smg', 'rifle', 'battlerifle', 'sniper'],
    delta: { noise: 0.3, damage: 0.9, accuracy: 2, weight: 0.6 },
    value: 1600,
    rarity: 'rare',
    sprite: 'att-can',
  },

  bar_oilcan: {
    id: 'bar_oilcan',
    name: 'Oil-Filter Can',
    slot: 'barrel',
    desc: 'An engine filter packed with steel wool and taped on straight-ish. Good for about a magazine before it starts shaving bullets.',
    fits: ['pistol', 'smg', 'rifle', 'sniper'],
    delta: { noise: 0.45, damage: 0.85, accuracy: -3, weight: 0.9 },
    value: 190,
    rarity: 'common',
    sprite: 'att-can',
  },

  bar_compensator: {
    id: 'bar_compensator',
    name: 'Compensator',
    slot: 'barrel',
    desc: 'Ports cut in the top so the muzzle stops climbing; everything standing beside you will hear about it.',
    fits: GUNS,
    delta: { recoil: 0.8, noise: 1.15 },
    value: 420,
    rarity: 'uncommon',
    sprite: 'att-comp',
  },

  bar_brake: {
    id: 'bar_brake',
    name: 'Muzzle Brake',
    slot: 'barrel',
    desc: 'Redirects the blast sideways into the dirt, your spotter, and the next county.',
    fits: PRECISION.concat('lmg'),
    delta: { recoil: 0.7, noise: 1.3, weight: 0.3 },
    value: 520,
    rarity: 'uncommon',
    sprite: 'att-comp',
  },

  bar_heavy: {
    id: 'bar_heavy',
    name: 'Heavy Match Barrel',
    slot: 'barrel',
    desc: 'Thick, cold-hammered and pointless on a gun you plan to run with — a shooter\'s barrel for a shooter\'s war.',
    fits: LONGARMS,
    delta: { accuracy: 4, damage: 1.08, recoil: 0.9, rangeOptimal: 2, weight: 1.2 },
    value: 1300,
    rarity: 'rare',
    sprite: 'att-barrel-heavy',
  },

  bar_long: {
    id: 'bar_long',
    name: 'Long Barrel Kit',
    slot: 'barrel',
    desc: 'More barrel means more velocity, and the extra half-metre catches on every doorway in the Basin.',
    fits: ['rifle', 'battlerifle', 'shotgun', 'lmg'],
    delta: { rangeOptimal: 3, rangeMax: 5, damage: 1.05, apCost: 1, weight: 1.0 },
    value: 680,
    rarity: 'uncommon',
    sprite: 'att-barrel-long',
  },

  bar_chopped: {
    id: 'bar_chopped',
    name: 'Chopped Barrel',
    slot: 'barrel',
    desc: 'Somebody took a hacksaw to it in a stairwell. It handles like a pistol now and shoots like an apology.',
    fits: ['rifle', 'battlerifle', 'shotgun', 'sniper'],
    delta: {
      rangeOptimal: -3,
      rangeMax: -5,
      apCost: -1,
      noise: 1.2,
      recoil: 1.15,
      weight: -0.8,
    },
    value: 80,
    rarity: 'common',
    sprite: 'att-barrel-short',
  },

  bar_choke: {
    id: 'bar_choke',
    name: 'Full Choke Tube',
    slot: 'barrel',
    desc: 'Squeezes the pattern tight enough to matter at twenty metres, which is a whole extra second of your life.',
    fits: ['shotgun'],
    delta: { accuracy: 4, rangeOptimal: 3, rangeMax: 4 },
    value: 310,
    rarity: 'uncommon',
    sprite: 'att-choke',
  },

  // ───────────────────────────────────────────────────────────── underbarrel

  ub_foregrip: {
    id: 'ub_foregrip',
    name: 'Vertical Foregrip',
    slot: 'underbarrel',
    desc: 'A fistful of polymer that turns a burst from a suggestion into a group.',
    fits: ['smg', 'rifle', 'battlerifle', 'shotgun', 'lmg'],
    delta: { recoil: 0.7, weight: 0.3 },
    value: 300,
    rarity: 'uncommon',
    sprite: 'att-grip-vert',
  },

  ub_angled: {
    id: 'ub_angled',
    name: 'Angled Grip',
    slot: 'underbarrel',
    desc: 'Rolls the wrist forward so the gun comes onto target instead of past it. Costs nothing, changes everything.',
    fits: ['smg', 'rifle', 'battlerifle', 'shotgun'],
    delta: { accuracy: 3, recoil: 0.85, weight: 0.2 },
    value: 360,
    rarity: 'uncommon',
    sprite: 'att-grip-angled',
  },

  ub_broomgrip: {
    id: 'ub_broomgrip',
    name: 'Taped Broom Grip',
    slot: 'underbarrel',
    desc: 'Ten centimetres of broom handle and a roll of tape. Every merc in Vulture Company has made one; nobody admits it.',
    fits: ['smg', 'rifle', 'battlerifle', 'shotgun', 'lmg'],
    delta: { accuracy: -1, recoil: 0.88, weight: 0.2 },
    value: 45,
    rarity: 'common',
    sprite: 'att-grip-vert',
  },

  ub_bipod: {
    id: 'ub_bipod',
    name: 'Folding Bipod',
    slot: 'underbarrel',
    desc: 'Spring-loaded legs that snap down with a click. Lie down behind it and the rifle stops being yours and starts being furniture.',
    fits: LONGARMS,
    delta: { proneAccuracy: 15, recoil: 0.75, weight: 0.9 },
    value: 560,
    rarity: 'uncommon',
    sprite: 'att-bipod',
  },

  ub_wirebipod: {
    id: 'ub_wirebipod',
    name: 'Wire Bipod',
    slot: 'underbarrel',
    desc: 'Coat-hanger legs bent over a knee. It holds the muzzle off the mud, and on a good day it holds it still.',
    fits: LONGARMS,
    delta: { proneAccuracy: 8, weight: 0.6 },
    value: 120,
    rarity: 'common',
    sprite: 'att-bipod',
  },

  ub_laser: {
    id: 'ub_laser',
    name: 'Laser Module',
    slot: 'underbarrel',
    desc: 'A red dot on a man\'s chest ends more fights than the bullet behind it — and the battery is not replaceable.',
    fits: GUNS,
    delta: { accuracy: 6, closeRangePenalty: -3, weight: 0.2 },
    value: 980,
    rarity: 'rare',
    sprite: 'att-laser',
  },

  ub_lamp: {
    id: 'ub_lamp',
    name: 'Barrel Lamp',
    slot: 'underbarrel',
    desc: 'A hand torch clamped under the handguard. It shows you the cellar, and it shows the cellar you.',
    fits: GUNS,
    delta: { accuracy: 3, weight: 0.3 },
    value: 170,
    rarity: 'common',
    sprite: 'att-lamp',
  },

  ub_bayonet: {
    id: 'ub_bayonet',
    name: 'Bayonet Lug & Blade',
    slot: 'underbarrel',
    desc: 'For when the magazine runs dry and the thing in front of you has not noticed. Muzzle-heavy, morale-heavy.',
    fits: ['rifle', 'battlerifle', 'shotgun', 'sniper'],
    delta: { accuracy: -1, weight: 0.5 },
    value: 210,
    rarity: 'common',
    sprite: 'att-bayonet',
  },

  // ───────────────────────────────────────────────────────────── magazine

  mag_extended: {
    id: 'mag_extended',
    name: 'Extended Magazine',
    slot: 'magazine',
    desc: 'Ten more rounds hanging below the mag well, catching on every fence you climb.',
    fits: ['pistol', 'smg', 'rifle', 'battlerifle'],
    delta: { magSize: 10, weight: 0.4 },
    value: 280,
    rarity: 'uncommon',
    sprite: 'att-mag-ext',
  },

  mag_drum: {
    id: 'mag_drum',
    name: 'Drum Magazine',
    slot: 'magazine',
    desc: 'Forty-five extra rounds in a can the size of a dinner plate. It is heavy, it is slow, and it has never once been enough.',
    fits: ['smg', 'rifle', 'lmg'],
    delta: { magSize: 45, weight: 1.6, apCost: 1, accuracy: -2 },
    value: 950,
    rarity: 'rare',
    sprite: 'att-mag-drum',
  },

  mag_stickmag: {
    id: 'mag_stickmag',
    name: 'Pistol Stick Mag',
    slot: 'magazine',
    desc: 'Turns a sidearm into a very awkward carbine that you cannot holster and would not want to.',
    fits: ['pistol'],
    delta: { magSize: 12, accuracy: -2, weight: 0.5 },
    value: 320,
    rarity: 'uncommon',
    sprite: 'att-mag-ext',
  },

  mag_jungleclip: {
    id: 'mag_jungleclip',
    name: 'Jungle-Taped Pair',
    slot: 'magazine',
    desc: 'Two magazines taped nose to tail so the second one is already in your hand. The tape collects grit; the grit collects jams.',
    fits: ['smg', 'rifle', 'battlerifle'],
    delta: { magSize: 6, accuracy: -1, weight: 0.5 },
    value: 70,
    rarity: 'common',
    sprite: 'att-mag-taped',
  },

  mag_quickstrip: {
    id: 'mag_quickstrip',
    name: 'Quick-Strip Follower',
    slot: 'magazine',
    desc: 'A lighter spring and a cut-down follower: the gun cycles faster and runs dry sooner. Pick your regret.',
    fits: ['pistol', 'smg', 'rifle', 'battlerifle'],
    delta: { apCost: -1, magSize: -5 },
    value: 440,
    rarity: 'uncommon',
    sprite: 'att-mag-ext',
  },

  mag_matchfollower: {
    id: 'mag_matchfollower',
    name: 'Match-Grade Follower',
    slot: 'magazine',
    desc: 'Presents each round to the chamber at exactly the same angle, every time, forever — or until you drop it in a creek.',
    fits: ['rifle', 'battlerifle', 'sniper'],
    delta: { accuracy: 3, magSize: -2 },
    value: 400,
    rarity: 'uncommon',
    sprite: 'att-mag-ext',
  },

  mag_sidesaddle: {
    id: 'mag_sidesaddle',
    name: 'Side Saddle Shells',
    slot: 'magazine',
    desc: 'Six shells strapped to the receiver where your thumb already is; the noise they make walking is the price.',
    fits: ['shotgun'],
    delta: { magSize: 6, weight: 0.5 },
    value: 160,
    rarity: 'common',
    sprite: 'att-shellholder',
  },

  mag_beltbox: {
    id: 'mag_beltbox',
    name: 'Assault Belt Box',
    slot: 'magazine',
    desc: 'A hard box that keeps the belt out of the mud, which is the only thing that ever stops a machine gun.',
    fits: ['lmg'],
    delta: { magSize: 50, weight: 2.0, accuracy: -1 },
    value: 700,
    rarity: 'uncommon',
    sprite: 'att-mag-drum',
  },

  // ───────────────────────────────────────────────────────────── stock

  stk_folding: {
    id: 'stk_folding',
    name: 'Folding Stock',
    slot: 'stock',
    desc: 'Hinges left, locks with a slap, and lets a rifle ride in a truck cab. It will always wobble a little.',
    fits: ['smg', 'rifle', 'battlerifle', 'shotgun'],
    delta: { recoil: 1.12, closeRangePenalty: -3, weight: -0.7 },
    value: 240,
    rarity: 'common',
    sprite: 'att-stock-fold',
  },

  stk_target: {
    id: 'stk_target',
    name: 'Target Stock',
    slot: 'stock',
    desc: 'Adjustable comb, adjustable length, adjustable everything — built for a shooting bench in a world that no longer has one.',
    fits: PRECISION,
    delta: { accuracy: 6, proneAccuracy: 5, recoil: 0.85, weight: 1.0 },
    value: 1050,
    rarity: 'rare',
    sprite: 'att-stock-target',
  },

  stk_recoilpad: {
    id: 'stk_recoilpad',
    name: 'Recoil Pad',
    slot: 'stock',
    desc: 'A slab of rubber off a tractor seat. Your shoulder will thank you tomorrow, which is the point of tomorrow.',
    fits: ['rifle', 'battlerifle', 'sniper', 'shotgun', 'lmg'],
    delta: { recoil: 0.85, weight: 0.3 },
    value: 130,
    rarity: 'common',
    sprite: 'att-stock-pad',
  },

  stk_cheekriser: {
    id: 'stk_cheekriser',
    name: 'Cheek Riser',
    slot: 'stock',
    desc: 'Strapped-on foam that puts your eye behind the glass instead of under it. Nothing else in the shop is this cheap or this useful.',
    fits: LONGARMS,
    delta: { longRangeAccuracy: 6, weight: 0.2 },
    value: 280,
    rarity: 'uncommon',
    sprite: 'att-stock-cheek',
  },

  stk_tapebrace: {
    id: 'stk_tapebrace',
    name: 'Duct-Taped Brace',
    slot: 'stock',
    desc: 'A length of strapping and a folded blanket, wound until it stops moving. Ugly the way a splint is ugly.',
    fits: ['pistol', 'smg', 'rifle', 'shotgun'],
    delta: { accuracy: 1, recoil: 0.92, weight: 0.4 },
    value: 35,
    rarity: 'common',
    sprite: 'att-stock-tape',
  },

  stk_shoulderbrace: {
    id: 'stk_shoulderbrace',
    name: 'Shoulder Brace',
    slot: 'stock',
    desc: 'Bolts to the back of a pistol and turns it into something you can actually aim, at the cost of ever drawing it quickly again.',
    fits: ['pistol'],
    delta: { accuracy: 5, rangeOptimal: 2, apCost: 1, weight: 0.6 },
    value: 350,
    rarity: 'uncommon',
    sprite: 'att-stock-fold',
  },

  // ───────────────────────────────────────────────────────────── internal

  int_matchtrigger: {
    id: 'int_matchtrigger',
    name: 'Match Trigger Group',
    slot: 'internal',
    desc: 'Breaks like a glass rod at two pounds. A merc who has fired one never stops mentioning it.',
    fits: GUNS,
    delta: { accuracy: 5 },
    value: 880,
    rarity: 'rare',
    sprite: 'att-trigger',
  },

  int_polishedsear: {
    id: 'int_polishedsear',
    name: 'Polished Sear',
    slot: 'internal',
    desc: 'An afternoon with a stone and a steady hand: the gun resets faster, and it is now a little less certain about staying safe.',
    fits: GUNS,
    delta: { apCost: -1, recoil: 1.1 },
    value: 500,
    rarity: 'uncommon',
    sprite: 'att-trigger',
  },

  int_bumpfire: {
    id: 'int_bumpfire',
    name: 'Bump-Fire Kit',
    slot: 'internal',
    desc: 'Lets the whole gun slide under recoil so it fires as fast as it can shake. Accuracy is not the product being sold here.',
    fits: ['smg', 'rifle', 'battlerifle', 'shotgun'],
    delta: { recoil: 1.35, accuracy: -4 },
    value: 320,
    rarity: 'uncommon',
    sprite: 'att-bumpkit',
  },

  int_heavysprings: {
    id: 'int_heavysprings',
    name: 'Heavy Recoil Springs',
    slot: 'internal',
    desc: 'Stiffer than the factory ever intended. The bolt slams home like a cell door and the muzzle stays put.',
    fits: GUNS,
    delta: { recoil: 0.88, weight: 0.2 },
    value: 200,
    rarity: 'common',
    sprite: 'att-springs',
  },

  int_handload: {
    id: 'int_handload',
    name: 'Hand-Loaded Chamber',
    slot: 'internal',
    desc: 'Reamed a hair deep to take the hot loads a Free Trader sells by the handful. It hits harder and shortens the gun\'s life.',
    fits: LONGARMS.concat('pistol'),
    delta: { damage: 1.12, noise: 1.15, recoil: 1.15 },
    value: 460,
    rarity: 'uncommon',
    sprite: 'att-chamber',
  },

  int_gastune: {
    id: 'int_gastune',
    name: 'Tuned Gas Block',
    slot: 'internal',
    desc: 'Dialled down until the action cycles and not one gram more; the rifle stops fighting you and starts working with you.',
    fits: ['rifle', 'battlerifle', 'lmg'],
    delta: { recoil: 0.85, apCost: -1, damage: 0.97 },
    value: 1200,
    rarity: 'rare',
    sprite: 'att-gasblock',
  },

  int_shimfix: {
    id: 'int_shimfix',
    name: 'Shim-and-Prayer Fix',
    slot: 'internal',
    desc: 'Beer-can shim under the barrel nut, a smear of grease, and a promise to look at it properly after the contract.',
    fits: GUNS,
    delta: { accuracy: 2, recoil: 1.05 },
    value: 30,
    rarity: 'common',
    sprite: 'att-shim',
  },

  int_chromebore: {
    id: 'int_chromebore',
    name: 'Chrome-Lined Bore',
    slot: 'internal',
    desc: 'A mil-spec liner that shrugs off rain, mud and eight years of nobody cleaning anything properly.',
    fits: LONGARMS,
    delta: { accuracy: 2, damage: 1.03 },
    value: 620,
    rarity: 'uncommon',
    sprite: 'att-bore',
  },
};

export const ATTACHMENT_LIST: AttachmentDef[] = Object.values(ATTACHMENTS);

/** Everything in `slot` that will actually mount on a weapon of class `cls`. */
export function attachmentsForSlot(slot: AttachmentSlot, cls: WeaponClass): AttachmentDef[] {
  return ATTACHMENT_LIST.filter(
    (a) => a.slot === slot && (a.fits.length === 0 || a.fits.includes(cls)),
  );
}
