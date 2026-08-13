/**
 * Traits — chosen once at hire and permanent, Project Zomboid style.
 *
 * A merc has a fixed trait budget. Positive traits have `cost > 0` and spend it; negative
 * traits have `cost < 0` and refund it, which is how you afford the good stuff. `excludes`
 * blocks contradictory pairs in both directions (the pairs below are symmetric).
 *
 * Same `mods` convention as perks: `*Mul` defaults to 1, everything else to 0, `accuracy`
 * is percentage points. Traits whose effect is situational set `special`; the ids in use are
 * exported as `TRAIT_SPECIALS`.
 */
import type { TraitDef } from '@/sim/progression';

const defs: TraitDef[] = [
  // ──────────────────────────────────────────────────────────── positive (14)

  {
    id: 'lucky',
    name: 'Lucky',
    desc: 'The round that should have killed you hit the radio instead, and it has been like that your whole life.',
    cost: 6,
    mods: { critChance: 0.05, lootMul: 1.2 },
    excludes: ['cursed'],
  },
  {
    id: 'iron_gut',
    name: 'Iron Gut',
    desc: 'You have eaten things that made a doctor cry and gone to work the next morning.',
    cost: 3,
    mods: { hp: 5, staminaRegen: 0.02 },
    special: 'iron_gut',
    excludes: ['weak_stomach'],
  },
  {
    id: 'night_owl',
    name: 'Night Owl',
    desc: 'Your eyes were built for three in the morning, and everyone else is fumbling around in a dark you can read a map in.',
    cost: 4,
    mods: { sightRange: 3 },
    special: 'night_owl',
  },
  {
    id: 'deaf_to_fear',
    name: 'Deaf to Fear',
    desc: 'A screamer went off eight feet from your head once and you finished reloading first.',
    cost: 5,
    mods: { suppressionResist: 0.5, moraleRegen: 3, stunResist: 0.1 },
    excludes: ['nervous_wreck'],
  },
  {
    id: 'athletic',
    name: 'Athletic',
    desc: 'You ran before the world ended, for fun, which everybody found strange then and finds very convenient now.',
    cost: 5,
    mods: { stamina: 20, staminaCostMul: 0.9, moveCostMul: 0.95 },
    excludes: ['asthmatic'],
  },
  {
    id: 'packhorse',
    name: 'Packhorse',
    desc: 'You carry the ammo, the medkit, the spare barrel, and somebody else’s rifle, and you do not complain about it.',
    cost: 4,
    mods: { staminaCostMul: 0.9 },
    special: 'carry_capacity',
    excludes: ['bad_back'],
  },
  {
    id: 'eagle_eyed',
    name: 'Eagle Eyed',
    desc: 'You spotted the sniper by the shine on his optic, from four hundred metres, in the rain.',
    cost: 5,
    mods: { accuracy: 4, longRangeAccuracy: 6, sightRange: 2 },
    excludes: ['short_sighted'],
  },
  {
    id: 'light_footed',
    name: 'Light Footed',
    desc: 'Whatever it is that makes floorboards complain, you simply do not have it.',
    cost: 4,
    mods: { noiseMul: 0.75 },
    excludes: ['loud_breather'],
  },
  {
    id: 'fast_healer',
    name: 'Fast Healer',
    desc: 'Your wounds scab over while other people are still looking for the bandages.',
    cost: 4,
    mods: { bleedResist: 0.2, hp: 5 },
    excludes: ['hemophiliac'],
  },
  {
    id: 'quick_learner',
    name: 'Quick Learner',
    desc: 'You only need to be shot at from one particular angle once to never stand there again.',
    cost: 6,
    mods: { xpMul: 1.25 },
    excludes: ['slow_learner'],
  },
  {
    id: 'thick_hide',
    name: 'Thick Hide',
    desc: 'Somewhere under the scar tissue there is presumably a person, but nothing has managed to reach them yet.',
    cost: 4,
    mods: { armour: 2, hp: 6 },
    excludes: ['glass_jaw'],
  },
  {
    id: 'cheap_date',
    name: 'Cheap Date',
    desc: 'You want a bunk, hot food, and something to shoot at, and you consider the rest of it negotiable.',
    cost: 3,
    mods: { salaryMul: 0.75 },
    excludes: ['prima_donna'],
  },
  {
    id: 'steady_nerves',
    name: 'Steady Nerves',
    desc: 'Your hands were shaking before the shooting started and went perfectly still the moment it did.',
    cost: 4,
    mods: { recoilMul: 0.85, accuracyMul: 1.05, interruptChance: 0.05 },
    excludes: ['shaky_hands'],
  },
  {
    id: 'magpie',
    name: 'Magpie',
    desc: 'You cannot walk past an open drawer, and roughly one time in four the company is glad of it.',
    cost: 3,
    mods: { scavengeMul: 1.25, lootMul: 1.1 },
  },

  // ──────────────────────────────────────────────────────────── negative (12)

  {
    id: 'hemophiliac',
    name: 'Hemophiliac',
    desc: 'A graze that would inconvenience anyone else will empty you onto the floor in under a minute.',
    cost: -6,
    mods: { bleedResist: -0.25 },
    excludes: ['fast_healer'],
  },
  {
    id: 'asthmatic',
    name: 'Asthmatic',
    desc: 'Dust, smoke, cold air, and stress all do the same thing to you, and battles are made of all four.',
    cost: -5,
    mods: { staminaMul: 0.8, staminaRegen: -0.04, noiseMul: 1.15 },
    excludes: ['athletic'],
  },
  {
    id: 'claustrophobic',
    name: 'Claustrophobic',
    desc: 'Cellars, crawlspaces and windowless rooms take something out of you that the medkit cannot put back.',
    cost: -4,
    mods: { moraleRegen: -1 },
    special: 'claustrophobic',
  },
  {
    id: 'loud_breather',
    name: 'Loud Breather',
    desc: 'A deviated septum and eight years of bad air mean the dead find you long before they see you.',
    cost: -3,
    mods: { noiseMul: 1.3 },
    excludes: ['light_footed'],
  },
  {
    id: 'bad_back',
    name: 'Bad Back',
    desc: 'One bad lift in a warehouse in 2019 is still, somehow, the most consequential injury of your life.',
    cost: -4,
    mods: { staminaCostMul: 1.2, moveCostMul: 1.1 },
    excludes: ['packhorse'],
  },
  {
    id: 'cursed',
    name: 'Cursed',
    desc: 'The gun jams, the strap breaks, the floor gives way — the squad has stopped calling it coincidence.',
    cost: -5,
    mods: { critChance: -0.03, lootMul: 0.85 },
    excludes: ['lucky'],
  },
  {
    id: 'slow_learner',
    name: 'Slow Learner',
    desc: 'You get there in the end, and everyone else has been waiting there for a while.',
    cost: -5,
    mods: { xpMul: 0.75 },
    excludes: ['quick_learner'],
  },
  {
    id: 'short_sighted',
    name: 'Short Sighted',
    desc: 'Past forty metres the world is a rumour, and your last pair of glasses died with a shambler on top of them.',
    cost: -4,
    mods: { longRangeAccuracy: -10, sightRange: -2 },
    excludes: ['eagle_eyed'],
  },
  {
    id: 'shaky_hands',
    name: 'Shaky Hands',
    desc: 'Too much coffee, too little sleep, and a tremor that only ever shows up when it matters.',
    cost: -5,
    mods: { accuracy: -5, recoilMul: 1.25, aimApCost: 1 },
    excludes: ['steady_nerves'],
  },
  {
    id: 'nervous_wreck',
    name: 'Nervous Wreck',
    desc: 'Incoming fire does not pin you down so much as unmake you where you stand.',
    cost: -5,
    mods: { suppressionResist: -0.3, moraleRegen: -3 },
    excludes: ['deaf_to_fear'],
  },
  {
    id: 'weak_stomach',
    name: 'Weak Stomach',
    desc: 'Bad water, bloater gas, or simply what is left of a man after a shotgun — any of them will put you on your knees.',
    cost: -3,
    mods: { hp: -3, staminaCostMul: 1.1 },
    special: 'weak_stomach',
    excludes: ['iron_gut'],
  },
  {
    id: 'prima_donna',
    name: 'Prima Donna',
    desc: 'You are worth every cent you charge and you will explain exactly why, at length, in front of the client.',
    cost: -4,
    mods: { salaryMul: 1.35, moraleRegen: -1 },
    excludes: ['cheap_date'],
  },
  {
    id: 'glass_jaw',
    name: 'Glass Jaw',
    desc: 'You have been knocked cold by a door, a rifle butt, and once by a falling shelf of paint tins.',
    cost: -4,
    mods: { stunResist: -0.25, hpMul: 0.9 },
    excludes: ['thick_hide'],
  },
];

export const TRAITS: Record<string, TraitDef> = Object.fromEntries(defs.map((t) => [t.id, t]));

export const TRAIT_LIST: TraitDef[] = defs;

export const POSITIVE_TRAITS: TraitDef[] = defs.filter((t) => t.cost > 0);

export const NEGATIVE_TRAITS: TraitDef[] = defs.filter((t) => t.cost < 0);

/** Every `special` id used by a trait — the sim must handle each of these. */
export const TRAIT_SPECIALS: readonly string[] = [
  'iron_gut',
  'night_owl',
  'carry_capacity',
  'claustrophobic',
  'weak_stomach',
];
