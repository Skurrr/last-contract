/**
 * Materials, recipes, scrapping and improvisation.
 *
 * Crafting happens between missions. A recipe occupies one merc for `days` and needs a
 * `mechanical` rating to attempt at all. Recipe output is deterministic; improvisation
 * (see `improvisedQuality`) is not, which is where the named one-off guns come from.
 *
 * ── EXTERNAL IDS REFERENCED HERE (reconciled against the real catalogues) ──
 *
 * weapons (src/data/weapons.ts) — every improvised recipe builds a real catalogue gun:
 *   pipecarbine, widowscoach, chatterbox, quietus, nailgun, machete, crowbar
 *
 * attachments (src/data/attachments.ts) — the junk-tier half of the attachment list:
 *   bar_oilcan, opt_kludge, ub_broomgrip, ub_wirebipod, mag_jungleclip, mag_extended,
 *   ub_lamp, ub_bayonet, stk_recoilpad, int_matchtrigger
 *
 * consumables (src/data/consumables.ts — items that live in Unit.inventory):
 *   bandage, medkit, trauma-kit, molotov, pipe-bomb, nail-bomb, noisemaker,
 *   road-flare, smoke-pot, adrenaline-shot, antibiotics, repair-kit, armour-patch,
 *   ammo-9mm, ammo-45acp, ammo-556, ammo-762, ammo-12ga, ammo-338
 *
 * `learnedFrom` values are faction ids from src/data/factions.ts, or a sector landmark.
 */
import type { MaterialId, Materials, Rarity } from '@/sim/types';

export const MATERIAL_INFO: Record<
  MaterialId,
  { label: string; desc: string; color: string; baseValue: number }
> = {
  scrap: {
    label: 'Scrap',
    desc: 'Bent sheet, broken castings, wire and nails. Every ruin has it and nobody guards it.',
    color: '#8a7f6d',
    baseValue: 2,
  },
  steel: {
    label: 'Steel Stock',
    desc: 'Bar, tube and plate worth machining. Refined from scrap or cut out of something that used to hold weight.',
    color: '#9fa8b0',
    baseValue: 8,
  },
  polymer: {
    label: 'Polymer',
    desc: 'Reclaimed thermoplastic — pipe, boat hull, seat backs. Melts into grips, stocks and magazine bodies.',
    color: '#4f7f6a',
    baseValue: 6,
  },
  springs: {
    label: 'Springs & Pins',
    desc: 'The small fiddly parts that decide whether a gun cycles. Never enough of them.',
    color: '#c8b06a',
    baseValue: 12,
  },
  optics: {
    label: 'Optics Glass',
    desc: 'Ground lenses out of scopes, binoculars, solar trackers and camera bodies. Chipped glass is worthless.',
    color: '#7fc4d8',
    baseValue: 18,
  },
  powder: {
    label: 'Powder',
    desc: 'Propellant and pulled fertiliser. Keeps badly, kills whole workshops when it does.',
    color: '#b8563c',
    baseValue: 14,
  },
  electronics: {
    label: 'Electronics',
    desc: 'Boards, cells, emitters and copper. The one material the Basin cannot make more of.',
    color: '#6f8fd8',
    baseValue: 22,
  },
  tape: {
    label: 'Duct Tape',
    desc: 'Eight years in and it is still currency. Half the guns in the valley are held together with it.',
    color: '#5c6068',
    baseValue: 3,
  },
};

export interface RecipeDef {
  id: string;
  name: string;
  desc: string;
  output: {
    kind: 'weapon' | 'attachment' | 'consumable' | 'material';
    /** WeaponDef / AttachmentDef / consumable id, or a MaterialId when kind is 'material'. */
    id: string;
    qty: number;
  };
  cost: Materials;
  /** Minimum `mechanical` on the crafting merc. Below this the recipe is greyed out. */
  requiresMechanical: number;
  /** In-game days the merc is occupied. */
  days: number;
  /** Where the blueprint comes from. Omitted = known from the start. */
  learnedFrom?: string;
}

export const RECIPES: Record<string, RecipeDef> = {
  // ── refining: turning junk into stock ──────────────────────────────────────
  'refine-steel': {
    id: 'refine-steel',
    name: 'Refine Steel Stock',
    desc: 'Sort, cut and re-forge scrap into bar and plate you can actually machine.',
    output: { kind: 'material', id: 'steel', qty: 2 },
    cost: { scrap: 8 },
    requiresMechanical: 3,
    days: 1,
  },
  'draw-springs': {
    id: 'draw-springs',
    name: 'Draw Springs',
    desc: 'Wind music wire over a mandrel and temper it in a coffee can. Tedious, and the only source that never dries up.',
    output: { kind: 'material', id: 'springs', qty: 3 },
    cost: { steel: 2, scrap: 2 },
    requiresMechanical: 4,
    days: 1,
  },
  'mould-polymer': {
    id: 'mould-polymer',
    name: 'Mould Polymer',
    desc: 'Shred boat hull and pipe, melt it in a kiln pot, press it into billets.',
    output: { kind: 'material', id: 'polymer', qty: 3 },
    cost: { scrap: 4, tape: 1 },
    requiresMechanical: 3,
    days: 1,
  },
  'grind-optics': {
    id: 'grind-optics',
    name: 'Grind Lenses',
    desc: 'Pull glass out of camera bodies and solar trackers and polish it true. Three blanks crack for every one that does not.',
    output: { kind: 'material', id: 'optics', qty: 2 },
    cost: { scrap: 3, polymer: 1 },
    requiresMechanical: 5,
    days: 2,
  },
  'salvage-electronics': {
    id: 'salvage-electronics',
    name: 'Salvage Electronics',
    desc: 'Desolder anything that still has a board in it and sort the survivors by whether they smell burnt.',
    output: { kind: 'material', id: 'electronics', qty: 2 },
    cost: { scrap: 6, tape: 2 },
    requiresMechanical: 6,
    days: 2,
  },
  'cook-powder': {
    id: 'cook-powder',
    name: 'Cook Powder',
    desc: 'Fertiliser, charcoal and patience. Do this outdoors, downwind, and not on a day anyone is sleeping nearby.',
    output: { kind: 'material', id: 'powder', qty: 3 },
    cost: { scrap: 4, polymer: 1 },
    requiresMechanical: 5,
    days: 2,
    learnedFrom: 'ash-order',
  },

  // ── handloading ────────────────────────────────────────────────────────────
  'handload-9mm': {
    id: 'handload-9mm',
    name: 'Handload 9mm',
    desc: 'Resize brass, seat cast bullets, hope the primers you found still go bang.',
    output: { kind: 'consumable', id: 'ammo-9mm', qty: 30 },
    cost: { powder: 2, scrap: 2, steel: 1 },
    requiresMechanical: 3,
    days: 1,
  },
  'handload-45acp': {
    id: 'handload-45acp',
    name: 'Handload .45 ACP',
    desc: 'Fat, slow, and forgiving of a sloppy load — the beginner’s calibre for a reason.',
    output: { kind: 'consumable', id: 'ammo-45acp', qty: 20 },
    cost: { powder: 2, scrap: 2, steel: 1 },
    requiresMechanical: 3,
    days: 1,
  },
  'handload-556': {
    id: 'handload-556',
    name: 'Handload 5.56',
    desc: 'Bottleneck brass needs trimming every reload; skip it and you will glue a case in somebody’s chamber.',
    output: { kind: 'consumable', id: 'ammo-556', qty: 30 },
    cost: { powder: 3, steel: 2, springs: 1 },
    requiresMechanical: 5,
    days: 1,
  },
  'handload-762': {
    id: 'handload-762',
    name: 'Handload 7.62',
    desc: 'Heavy charges, thick brass, and a press that groans. Worth it for what it does to an armoured.',
    output: { kind: 'consumable', id: 'ammo-762', qty: 20 },
    cost: { powder: 4, steel: 2, springs: 1 },
    requiresMechanical: 5,
    days: 1,
  },
  'reload-12ga': {
    id: 'reload-12ga',
    name: 'Reload 12 Gauge',
    desc: 'Plastic hulls, wads cut from boat foam, and shot poured from wheel weights.',
    output: { kind: 'consumable', id: 'ammo-12ga', qty: 16 },
    cost: { powder: 2, polymer: 2, scrap: 2 },
    requiresMechanical: 3,
    days: 1,
  },
  'handload-338': {
    id: 'handload-338',
    name: 'Match .338',
    desc: 'Weighed to the tenth of a grain, seated to the lands, ten at a time. Grandma Vy will not shoot anything else.',
    output: { kind: 'consumable', id: 'ammo-338', qty: 10 },
    cost: { powder: 5, steel: 3, springs: 2, optics: 1 },
    requiresMechanical: 7,
    days: 2,
    learnedFrom: 'remnant',
  },

  // ── medical & field consumables ────────────────────────────────────────────
  'roll-bandages': {
    id: 'roll-bandages',
    name: 'Roll Bandages',
    desc: 'Boiled sheet cut into strips. Stops a bleed stack; will not close anything serious.',
    output: { kind: 'consumable', id: 'bandage', qty: 3 },
    cost: { tape: 2, polymer: 1 },
    requiresMechanical: 1,
    days: 1,
  },
  'assemble-medkit': {
    id: 'assemble-medkit',
    name: 'Assemble Medkit',
    desc: 'Bandage, clotting powder, a saline bag and a pair of shears in a taped-up lunchbox.',
    output: { kind: 'consumable', id: 'medkit', qty: 1 },
    cost: { tape: 3, polymer: 2, powder: 1 },
    requiresMechanical: 3,
    days: 1,
  },
  'assemble-trauma-kit': {
    id: 'assemble-trauma-kit',
    name: 'Assemble Trauma Kit',
    desc: 'Tourniquet, chest seal, needle decompression kit. The difference between Critical and buried.',
    output: { kind: 'consumable', id: 'trauma-kit', qty: 1 },
    cost: { tape: 4, polymer: 3, electronics: 1, powder: 1 },
    requiresMechanical: 5,
    days: 2,
    learnedFrom: 'havenhold',
  },
  'brew-antibiotics': {
    id: 'brew-antibiotics',
    name: 'Brew Antibiotics',
    desc: 'Bread mould, a warm cupboard and a filtration rig. Roughly as reliable as it sounds.',
    output: { kind: 'consumable', id: 'antibiotics', qty: 2 },
    cost: { polymer: 2, electronics: 1, tape: 1 },
    requiresMechanical: 6,
    days: 3,
    learnedFrom: 'havenhold',
  },
  'cut-adrenaline': {
    id: 'cut-adrenaline',
    name: 'Cut Adrenaline Shots',
    desc: 'The Order’s recipe. Two of these will get a man off the ground; a third will stop his heart.',
    output: { kind: 'consumable', id: 'adrenaline-shot', qty: 1 },
    cost: { powder: 2, polymer: 2, electronics: 1 },
    requiresMechanical: 6,
    days: 2,
    learnedFrom: 'ash-order',
  },

  // ── throwables & noise ─────────────────────────────────────────────────────
  molotov: {
    id: 'molotov',
    name: 'Molotov',
    desc: 'Bottle, fuel, motor oil to make it stick, and a rag. Burns cover away as happily as it burns the dead.',
    output: { kind: 'consumable', id: 'molotov', qty: 2 },
    cost: { polymer: 1, tape: 1, powder: 1 },
    requiresMechanical: 2,
    days: 1,
  },
  'pipe-bomb': {
    id: 'pipe-bomb',
    name: 'Pipe Bomb',
    desc: 'Threaded pipe, end caps, powder and a fuse cut by eye. Loud enough to bring the whole sector.',
    output: { kind: 'consumable', id: 'pipe-bomb', qty: 2 },
    cost: { steel: 2, powder: 3, tape: 1 },
    requiresMechanical: 4,
    days: 1,
  },
  'nail-bomb': {
    id: 'nail-bomb',
    name: 'Nail Bomb',
    desc: 'A pipe bomb wrapped in a pound of roofing nails. Bricks builds these and will not let anyone else carry them.',
    output: { kind: 'consumable', id: 'nail-bomb', qty: 1 },
    cost: { steel: 2, powder: 4, scrap: 4, tape: 2 },
    requiresMechanical: 6,
    days: 1,
  },
  noisemaker: {
    id: 'noisemaker',
    name: 'Noisemaker',
    desc: 'A wind-up alarm clock bolted to a sheet-metal drum. Throw it, walk the other way, let the dead have the argument.',
    output: { kind: 'consumable', id: 'noisemaker', qty: 2 },
    cost: { springs: 2, scrap: 2, tape: 1 },
    requiresMechanical: 3,
    days: 1,
  },
  'road-flare': {
    id: 'road-flare',
    name: 'Pack Road Flares',
    desc: 'Strontium and binder in a paper tube. Lights a tile for the whole battle and can be thrown.',
    output: { kind: 'consumable', id: 'road-flare', qty: 3 },
    cost: { powder: 2, polymer: 1, tape: 1 },
    requiresMechanical: 3,
    days: 1,
  },
  'smoke-pot': {
    id: 'smoke-pot',
    name: 'Smoke Pot',
    desc: 'Sugar and saltpetre in a paint can. Breaks line of sight across half a street and smells like burnt caramel.',
    output: { kind: 'consumable', id: 'smoke-pot', qty: 2 },
    cost: { powder: 3, scrap: 2, tape: 1 },
    requiresMechanical: 4,
    days: 1,
  },

  // ── maintenance ────────────────────────────────────────────────────────────
  'repair-kit': {
    id: 'repair-kit',
    name: 'Weapon Repair Kit',
    desc: 'Spare pins, springs, a lapping stone and solvent. Restores condition in the field, once.',
    output: { kind: 'consumable', id: 'repair-kit', qty: 1 },
    cost: { springs: 2, steel: 1, tape: 2 },
    requiresMechanical: 4,
    days: 1,
  },
  'armour-patch': {
    id: 'armour-patch',
    name: 'Armour Patch',
    desc: 'Cut plate, drilled and laced into a carrier over the hole the last one left.',
    output: { kind: 'consumable', id: 'armour-patch', qty: 2 },
    cost: { steel: 3, polymer: 2, tape: 2 },
    requiresMechanical: 4,
    days: 1,
  },

  // ── improvised weapons ─────────────────────────────────────────────────────
  // Every recipe here builds a gun that already exists in weapons.ts — the improvised
  // tier of the catalogue is exactly what a bench in a barn can produce.
  'pipe-carbine': {
    id: 'pipe-carbine',
    name: "Pipe Carbine 'Cough'",
    desc: 'Two lengths of water pipe, a nail, and one hand-filed sear. It fires nine times out of ten and that is the pitch.',
    output: { kind: 'weapon', id: 'pipecarbine', qty: 1 },
    cost: { steel: 3, springs: 2, polymer: 1, tape: 2 },
    requiresMechanical: 3,
    days: 2,
  },
  'coach-gun': {
    id: 'coach-gun',
    name: 'Cut-Down Coach Gun',
    desc: 'Both barrels off a farmhouse wall gun, hacksawed to the wood and the triggers wired together. No finesse — one very loud second.',
    output: { kind: 'weapon', id: 'widowscoach', qty: 1 },
    cost: { steel: 4, scrap: 3, tape: 3 },
    requiresMechanical: 2,
    days: 2,
  },
  chatterbox: {
    id: 'chatterbox',
    name: 'Chatterbox',
    desc: 'Open bolt, blowback, a bicycle-brake trigger and a magazine well filed to fit whatever you have. Cycles fast, hits like a slap.',
    output: { kind: 'weapon', id: 'chatterbox', qty: 1 },
    cost: { steel: 5, springs: 4, polymer: 2, tape: 3 },
    requiresMechanical: 6,
    days: 3,
    learnedFrom: 'rust-kings',
  },
  'bolt-thrower': {
    id: 'bolt-thrower',
    name: 'Quietus Bolt Thrower',
    desc: 'Leaf-spring prod on a laminated stock. Slow to load, quiet enough that the dead never look up.',
    output: { kind: 'weapon', id: 'quietus', qty: 1 },
    cost: { steel: 3, springs: 3, polymer: 2, tape: 1 },
    requiresMechanical: 5,
    days: 3,
  },
  nailgun: {
    id: 'nailgun',
    name: "Roofer's Regret",
    desc: 'A powder-actuated nailer with the safety nose ground off and the charge doubled. Point blank, and the head comes off clean.',
    output: { kind: 'weapon', id: 'nailgun', qty: 1 },
    cost: { steel: 2, springs: 2, powder: 2, scrap: 3, tape: 2 },
    requiresMechanical: 5,
    days: 2,
    learnedFrom: 'rust-kings',
  },
  machete: {
    id: 'machete',
    name: 'Field Machete',
    desc: 'Leaf spring ground to an edge, wrapped in hose. Chainlink makes a dozen a week and gives most of them away.',
    output: { kind: 'weapon', id: 'machete', qty: 1 },
    cost: { steel: 2, scrap: 2, tape: 2 },
    requiresMechanical: 2,
    days: 1,
  },
  'pry-bar': {
    id: 'pry-bar',
    name: 'Pry Bar',
    desc: 'Four feet of pipe with a hydrant wrench welded on. Heavy, silent, and it opens doors as well as skulls.',
    output: { kind: 'weapon', id: 'crowbar', qty: 1 },
    cost: { steel: 4, scrap: 2, tape: 1 },
    requiresMechanical: 3,
    days: 1,
  },

  // ── duct-taped attachments ─────────────────────────────────────────────────
  'oil-filter-can': {
    id: 'oil-filter-can',
    name: 'Oil-Filter Can',
    desc: 'An automotive filter on a hand-cut thread adapter, packed with steel wool. Good for maybe forty rounds.',
    output: { kind: 'attachment', id: 'bar_oilcan', qty: 1 },
    cost: { steel: 3, scrap: 3, polymer: 1, tape: 2 },
    requiresMechanical: 5,
    days: 2,
  },
  'scope-kludge': {
    id: 'scope-kludge',
    name: 'Spotting-Scope Kludge',
    desc: 'A spotting-scope objective in a pipe tube, zeroed with shims and held on with hose clamps. It holds zero until it does not.',
    output: { kind: 'attachment', id: 'opt_kludge', qty: 1 },
    cost: { optics: 2, steel: 2, tape: 3 },
    requiresMechanical: 5,
    days: 2,
  },
  'broom-grip': {
    id: 'broom-grip',
    name: 'Taped Broom Grip',
    desc: 'Ten centimetres of broom handle, shaped, and four wraps of tape. Ugly, effective, universally mocked.',
    output: { kind: 'attachment', id: 'ub_broomgrip', qty: 1 },
    cost: { polymer: 2, tape: 2 },
    requiresMechanical: 2,
    days: 1,
  },
  'wire-bipod': {
    id: 'wire-bipod',
    name: 'Wire Bipod',
    desc: 'Coat-hanger legs bent over a knee and taped at the collar. Turns any rifle into a passable prone rifle.',
    output: { kind: 'attachment', id: 'ub_wirebipod', qty: 1 },
    cost: { steel: 2, springs: 2, tape: 1 },
    requiresMechanical: 4,
    days: 1,
  },
  'jungle-clip': {
    id: 'jungle-clip',
    name: 'Jungle-Taped Pair',
    desc: 'Two magazines taped jaw to jaw. Halves your reload and doubles the chance of a lipful of mud.',
    output: { kind: 'attachment', id: 'mag_jungleclip', qty: 1 },
    cost: { tape: 3, polymer: 1 },
    requiresMechanical: 1,
    days: 1,
  },
  'extended-mag': {
    id: 'extended-mag',
    name: 'Extended Magazine',
    desc: 'A magazine body cut and welded onto another, with a longer spring drawn to suit.',
    output: { kind: 'attachment', id: 'mag_extended', qty: 1 },
    cost: { steel: 2, springs: 3, polymer: 1, tape: 1 },
    requiresMechanical: 5,
    days: 1,
  },
  'barrel-lamp': {
    id: 'barrel-lamp',
    name: 'Barrel Lamp',
    desc: 'A salvaged LED torch and a pressure switch clamped under the handguard. Lights the room and tells the room where you are.',
    output: { kind: 'attachment', id: 'ub_lamp', qty: 1 },
    cost: { electronics: 2, polymer: 1, tape: 2 },
    requiresMechanical: 4,
    days: 1,
  },
  'bayonet-lug': {
    id: 'bayonet-lug',
    name: 'Bayonet Lug & Blade',
    desc: 'A cut-down kitchen knife on a lug brazed under the barrel. Sable thinks this is funny; Sable is usually right.',
    output: { kind: 'attachment', id: 'ub_bayonet', qty: 1 },
    cost: { steel: 2, scrap: 1, tape: 2 },
    requiresMechanical: 2,
    days: 1,
  },
  'recoil-pad': {
    id: 'recoil-pad',
    name: 'Recoil Pad',
    desc: 'Boat foam and inner tube over a slab cut from a tractor seat. Costs nothing, and your shoulder stops flinching by round three.',
    output: { kind: 'attachment', id: 'stk_recoilpad', qty: 1 },
    cost: { polymer: 3, tape: 2 },
    requiresMechanical: 3,
    days: 1,
  },
  'trigger-job': {
    id: 'trigger-job',
    name: 'Match Trigger Group',
    desc: 'Stone the sear, lighten the spring, polish the engagement. An armourer’s trick, and the Remnant do not teach it cheaply.',
    output: { kind: 'attachment', id: 'int_matchtrigger', qty: 1 },
    cost: { springs: 4, steel: 2, optics: 1 },
    requiresMechanical: 8,
    days: 3,
    learnedFrom: 'remnant',
  },
};

/**
 * What breaking a weapon down on the bench returns. Better guns are made of better parts —
 * scrapping an exotic is a genuine alternative to selling it.
 */
export const SCRAP_YIELD: Record<Rarity, Materials> = {
  common: { scrap: 4, steel: 1, tape: 1 },
  uncommon: { scrap: 6, steel: 2, springs: 1, polymer: 1 },
  rare: { scrap: 8, steel: 4, springs: 3, polymer: 2, optics: 1 },
  exotic: { scrap: 10, steel: 6, springs: 4, polymer: 3, optics: 2, electronics: 2 },
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Quality of an improvised (recipe-less) craft.
 *
 * @param mechanical the crafting merc's mechanical attribute, 1..10
 * @param roll       uniform 0..1 from the run's RNG
 * @returns `condition` — starting condition 15..100, so improvised gear is never pristine —
 *          and `bonus`, flat accuracy percentage points folded into the item. A poor
 *          mechanic on a bad roll produces a genuinely worse-than-stock weapon.
 */
export function improvisedQuality(
  mechanical: number,
  roll: number,
): { condition: number; bonus: number } {
  const skill = clamp(mechanical, 1, 10);
  const r = clamp(roll, 0, 1);
  return {
    condition: clamp(Math.round(28 + skill * 4.5 + (r - 0.5) * 24), 15, 100),
    bonus: clamp(Math.round((skill - 5) * 1.2 + (r - 0.5) * 10), -8, 12),
  };
}
