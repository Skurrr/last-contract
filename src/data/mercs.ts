/**
 * The roster. Thirteen hand-written people, not statblocks.
 *
 * Every merc here should pass the "Steroid test": one sentence, and a stranger remembers them.
 * Attributes are 1–10 and are written to match the person, not to balance a spreadsheet —
 * Steroid genuinely cannot shoot, Grandma Vy genuinely cannot run.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * EXTERNAL IDS REFERENCED HERE (owned by other files — reconcile before wiring up):
 *
 * weapons.ts — startingWeapon / startingSidearm
 *   pistols:      glock-17, m1911, makarov
 *   smg:          mp5, uzi
 *   rifle:        ak-74, m4-carbine, sks
 *   battlerifle:  fn-fal, mosin-nagant
 *   sniper:       remington-700
 *   shotgun:      mossberg-590, sawn-off
 *   lmg:          rpk-lmg
 *   melee:        combat-knife, machete, sledgehammer
 *
 * perks.ts — startingPerks
 *   ammo-sense, called-shot-specialist, cat-fall, cold-blooded, demolitionist, field-surgeon,
 *   ghost, gunsmith-1, inspiring, interrupt-reflex, iron-lungs, low-profile, marksman-1,
 *   quartermaster, scrapper, scrounger, spotter, sprinter, steady-hands, suppressive-fire,
 *   trap-layer, triage, trigger-discipline
 *
 * traits.ts — startingTraits
 *   adrenaline-junkie(−/+), bad-back(−), claustrophobic(−), consecrated(+), deaf-to-fear(+),
 *   eagle-eyed(+), fast-learner(+), frail(−), gearhead(+), graceful(+), green(−), grudge-remnant(−),
 *   haggler(+), hard-of-hearing(−), hemophiliac(−), iron-gut(+), jittery(−), loud-breather(−),
 *   lucky(+), mute(−), pacifist(−), pathfinder(+), steady-nerves(+), strong-back(+),
 *   thin-skinned(−), vain(−)
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import type { Attributes, WeaponClass } from '@/sim/types';

/** Four hex colours the art forge uses to composite a merc's portrait and battle sprite. */
export interface MercPalette {
  skin: string;
  hair: string;
  cloth: string;
  accent: string;
}

export interface MercDef {
  id: string;
  callsign: string;
  realName: string;
  age: number;
  /** Two or three sentences. Shown on the hire screen and the character sheet. */
  bio: string;
  /** One line. The mechanical-or-personality hook that makes them memorable. */
  quirk: string;
  attrs: Attributes;
  /** Dollars per in-game day, drawn from company cash at dawn. */
  salary: number;
  /** One-off signing fee. Roughly salary × 4, adjusted for how badly they want the work. */
  hireCost: number;
  /** Perk ids (perks.ts) they start with, on top of their level-1 pick. */
  startingPerks: string[];
  /** Trait ids (traits.ts). Permanent — these are the person, not a build. */
  startingTraits: string[];
  /** Weapon id (weapons.ts) they bring to their first contract. */
  startingWeapon: string;
  startingSidearm?: string;
  /** Deterministic seed for the procedural portrait/sprite. Never reuse one. */
  portraitSeed: number;
  palette: MercPalette;
  /** Merc ids. Sharing a squad with a `like` gains morale; with a `dislike`, loses it. */
  likes: string[];
  dislikes: string[];
  /** Bark set id in barks.ts. Always equal to `id` for the launch roster. */
  voice: string;
  /** Weapon classes they will actually carry — drives auto-equip and perk offers. */
  preferredClasses: WeaponClass[];
}

export const MERCS: Record<string, MercDef> = {
  // ───────────────────────────────────────────────────────────────────────── the control group
  nine: {
    id: 'nine',
    callsign: 'Nine',
    realName: 'unrecorded',
    age: 34,
    bio: 'The ninth person you asked and the first who said yes. Nine has never volunteered a surname, a hometown, or an opinion about the Fever, and answers questions about the past with "before". Average height, average aim, average everything — and the only merc who has never once failed to be where they said they would be.',
    quirk: 'Baseline. Every other merc on this roster is measured against Nine, and Nine knows it.',
    attrs: {
      marksmanship: 5, agility: 5, strength: 5, vitality: 5, endurance: 5,
      wisdom: 5, leadership: 5, mechanical: 5, medical: 5, explosives: 5,
    },
    salary: 200,
    hireCost: 0,
    startingPerks: ['trigger-discipline'],
    startingTraits: ['steady-nerves'],
    startingWeapon: 'ak-74',
    startingSidearm: 'glock-17',
    portraitSeed: 1009,
    palette: { skin: '#c99a72', hair: '#3a3128', cloth: '#5d6350', accent: '#8e9482' },
    likes: ['hoyt', 'maggie', 'oldmill'],
    dislikes: [],
    voice: 'nine',
    preferredClasses: ['rifle', 'smg', 'pistol'],
  },

  // ───────────────────────────────────────────────────────────────────────── the homage
  steroid: {
    id: 'steroid',
    callsign: 'Steroid',
    realName: 'Ivan Dolvich',
    age: 41,
    bio: 'Two-time regional champion of a country that no longer exists, and the last man alive who still trains legs on a schedule. He carries a squad automatic the way other men carry a wallet, and treats every contract as a chance to move heavy objects in front of an audience. He has buried more of the dead by hand than anyone in the Basin and has never once mentioned it.',
    quirk: 'Lifts corpses "for cardio". Enormous strength, cannot hit a barn, will not stop talking about protein.',
    attrs: {
      marksmanship: 3, agility: 4, strength: 10, vitality: 9, endurance: 8,
      wisdom: 3, leadership: 4, mechanical: 5, medical: 2, explosives: 3,
    },
    salary: 340,
    hireCost: 1200,
    startingPerks: ['iron-lungs', 'suppressive-fire'],
    startingTraits: ['strong-back', 'iron-gut', 'vain'],
    startingWeapon: 'rpk-lmg',
    startingSidearm: 'makarov',
    portraitSeed: 2201,
    palette: { skin: '#e0b08a', hair: '#d8c47a', cloth: '#7a5f3a', accent: '#c8452f' },
    likes: ['hoyt', 'chainlink'],
    dislikes: ['deadline', 'sable'],
    voice: 'steroid',
    preferredClasses: ['lmg', 'shotgun', 'melee'],
  },

  // ───────────────────────────────────────────────────────────────────────── the medic
  maggie: {
    id: 'maggie',
    callsign: 'Sister Maggie',
    realName: 'Magdalena Reyes',
    age: 48,
    bio: 'Twenty-two years of hospice nursing before the Fever, and she has not changed her job description since — she still sits with people while they go. She is the finest field surgeon left standing in the Basin and will work on anyone, including whoever just shot at her. The "Sister" is not an order; it is what her patients started calling her and she never corrected them.',
    quirk: 'Will not fire the first shot. She shoots only after someone has already shot at your squad.',
    attrs: {
      marksmanship: 5, agility: 4, strength: 4, vitality: 5, endurance: 6,
      wisdom: 7, leadership: 7, mechanical: 3, medical: 10, explosives: 1,
    },
    salary: 520,
    hireCost: 2100,
    startingPerks: ['field-surgeon', 'triage'],
    startingTraits: ['pacifist', 'steady-nerves', 'thin-skinned'],
    startingWeapon: 'glock-17',
    portraitSeed: 3307,
    palette: { skin: '#a9744f', hair: '#2a2320', cloth: '#dcd7c8', accent: '#7fa8c0' },
    likes: ['padre', 'nine', 'hoyt'],
    dislikes: ['bricks', 'sable'],
    voice: 'maggie',
    preferredClasses: ['pistol', 'smg'],
  },

  // ───────────────────────────────────────────────────────────────────────── the correspondent
  deadline: {
    id: 'deadline',
    callsign: 'Deadline',
    realName: 'Yusuf Adeyemi',
    age: 44,
    bio: 'Filed from four wars before the Fever and has not stopped filing since, despite there being no paper, no wire, and no editor. He learned to shoot in the second war because his photographer would not carry a rifle and someone had to. He keeps a notebook of every engagement your company has fought and reads the good bits aloud at camp, which is why everyone learns faster with him around.',
    quirk: 'Narrates the battle like he is filing copy. His "coverage" grants bonus XP to the whole squad.',
    attrs: {
      marksmanship: 8, agility: 6, strength: 4, vitality: 4, endurance: 5,
      wisdom: 8, leadership: 8, mechanical: 3, medical: 4, explosives: 2,
    },
    salary: 610,
    hireCost: 2600,
    startingPerks: ['spotter', 'marksman-1'],
    startingTraits: ['eagle-eyed', 'bad-back'],
    startingWeapon: 'm4-carbine',
    startingSidearm: 'glock-17',
    portraitSeed: 4111,
    palette: { skin: '#8a5a3b', hair: '#1c1a18', cloth: '#4a5a4a', accent: '#d8b24a' },
    likes: ['coyote', 'maggie'],
    dislikes: ['steroid', 'padre'],
    voice: 'deadline',
    preferredClasses: ['rifle', 'battlerifle', 'sniper'],
  },

  // ───────────────────────────────────────────────────────────────────────── the shooter
  vy: {
    id: 'vy',
    callsign: 'Grandma Vy',
    realName: 'Vy Nguyen',
    age: 71,
    bio: 'Forty years of smallbore competition, three national medals, and a husband who used to hold the spotting scope until the Fever took him outside a pharmacy in the second winter. She walks with a stick, cannot climb a fence, and is the single most dangerous unit in the Basin from three hundred metres. She hires out to pay for a plot next to Duc.',
    quirk: 'The slowest thing on the map. Spends four AP on a called headshot and it simply lands.',
    attrs: {
      marksmanship: 10, agility: 2, strength: 3, vitality: 3, endurance: 2,
      wisdom: 6, leadership: 5, mechanical: 6, medical: 3, explosives: 1,
    },
    salary: 700,
    hireCost: 3000,
    startingPerks: ['called-shot-specialist', 'steady-hands'],
    startingTraits: ['hard-of-hearing', 'frail', 'lucky'],
    startingWeapon: 'remington-700',
    startingSidearm: 'glock-17',
    portraitSeed: 5023,
    palette: { skin: '#d3a882', hair: '#cfd0cc', cloth: '#6b6f78', accent: '#a03c4a' },
    likes: ['oldmill', 'sable'],
    dislikes: ['twitch', 'hoyt'],
    voice: 'vy',
    preferredClasses: ['sniper', 'rifle', 'pistol'],
  },

  // ───────────────────────────────────────────────────────────────────────── the builder
  chainlink: {
    id: 'chainlink',
    callsign: 'Chainlink',
    realName: 'Marcus Boyd',
    age: 38,
    bio: 'Nine years in Ellsworth for something he still says was the other guy, and a certified structural welding ticket earned inside it. He can turn a wrecked car and forty seconds into cover that will stop a rifle round. Prison taught him that a wall is just a decision somebody made, and he has been making better ones ever since.',
    quirk: 'Builds barricades mid-battle out of whatever is lying on the tile. Best crafter in the roster.',
    attrs: {
      marksmanship: 5, agility: 4, strength: 8, vitality: 7, endurance: 7,
      wisdom: 5, leadership: 4, mechanical: 10, medical: 3, explosives: 5,
    },
    salary: 450,
    hireCost: 1700,
    startingPerks: ['gunsmith-1', 'scrapper'],
    startingTraits: ['gearhead', 'strong-back', 'loud-breather'],
    startingWeapon: 'sawn-off',
    startingSidearm: 'sledgehammer',
    portraitSeed: 6317,
    palette: { skin: '#6f4630', hair: '#171514', cloth: '#3f4a55', accent: '#e08a2c' },
    likes: ['bricks', 'steroid'],
    dislikes: ['oldmill'],
    voice: 'chainlink',
    preferredClasses: ['shotgun', 'melee', 'smg'],
  },

  // ───────────────────────────────────────────────────────────────────────── the scout
  twitch: {
    id: 'twitch',
    callsign: 'Twitch',
    realName: 'Elena Sokolova',
    age: 27,
    bio: 'Ran pharmacy salvage for two years and paid herself in the stock, which is how she can cross a sector faster than anyone alive and cannot sit still through a briefing. She sees things forty seconds before the rest of the squad does and says all of them out loud at once. She has not slept a full night since she was twenty-three.',
    quirk: 'Highest AP in the game and the thinnest nerve. If a squadmate goes Critical she panics.',
    attrs: {
      marksmanship: 6, agility: 10, strength: 3, vitality: 3, endurance: 9,
      wisdom: 6, leadership: 2, mechanical: 4, medical: 3, explosives: 3,
    },
    salary: 380,
    hireCost: 1400,
    startingPerks: ['sprinter', 'interrupt-reflex'],
    startingTraits: ['jittery', 'night-owl', 'adrenaline-junkie'],
    startingWeapon: 'uzi',
    startingSidearm: 'makarov',
    portraitSeed: 7229,
    palette: { skin: '#e8c3a4', hair: '#c05a2a', cloth: '#41474f', accent: '#4fd6c0' },
    likes: ['coyote', 'hoyt'],
    dislikes: ['vy', 'padre'],
    voice: 'twitch',
    preferredClasses: ['smg', 'pistol', 'shotgun'],
  },

  // ───────────────────────────────────────────────────────────────────────── the priest
  padre: {
    id: 'padre',
    callsign: 'Padre',
    realName: 'Tomás Iglesias',
    age: 53,
    bio: 'Ordained at twenty-six, laicised at thirty-nine over something he will not discuss, and wearing Ash Order grey by the third year of the Fever because they were the only people still holding services. He walked out of the Order the night they burned a farmhouse with the family still inside. He kept the book, the oil, and the habit of finishing what he starts.',
    quirk: 'Gives last rites to every zombie he puts down. Ash Order gunmen will not fire on him.',
    attrs: {
      marksmanship: 6, agility: 4, strength: 6, vitality: 6, endurance: 5,
      wisdom: 7, leadership: 9, mechanical: 3, medical: 6, explosives: 2,
    },
    salary: 490,
    hireCost: 1900,
    startingPerks: ['inspiring', 'cold-blooded'],
    startingTraits: ['consecrated', 'deaf-to-fear'],
    startingWeapon: 'mosin-nagant',
    startingSidearm: 'm1911',
    portraitSeed: 8443,
    palette: { skin: '#b9805a', hair: '#585149', cloth: '#2e2e33', accent: '#c9c3b0' },
    likes: ['maggie', 'nine'],
    dislikes: ['deadline', 'twitch'],
    voice: 'padre',
    preferredClasses: ['battlerifle', 'rifle', 'pistol'],
  },

  // ───────────────────────────────────────────────────────────────────────── the kid
  hoyt: {
    id: 'hoyt',
    callsign: 'Hoyt',
    realName: 'Danny Hoyt',
    age: 19,
    bio: 'Told your recruiter he was twenty-four and produced a laminated card belonging to his older brother, who did not make it out of Marrow Ridge. He has been shooting at the dead since he was eleven and has no memory of a world with electricity in it. He picks the squad\'s best killer each contract and copies everything they do, including the mistakes.',
    quirk: 'Nineteen and lying about it. Cheap, fragile, and levels absurdly fast.',
    attrs: {
      marksmanship: 4, agility: 5, strength: 4, vitality: 3, endurance: 5,
      wisdom: 9, leadership: 2, mechanical: 4, medical: 3, explosives: 3,
    },
    salary: 150,
    hireCost: 300,
    startingPerks: ['scrounger'],
    startingTraits: ['fast-learner', 'green', 'hemophiliac'],
    startingWeapon: 'sks',
    startingSidearm: 'makarov',
    portraitSeed: 9151,
    palette: { skin: '#e3b892', hair: '#7a5a30', cloth: '#6a6a52', accent: '#5f9ad8' },
    likes: ['steroid', 'nine', 'sable'],
    dislikes: ['oldmill'],
    voice: 'hoyt',
    preferredClasses: ['rifle', 'shotgun', 'pistol'],
  },

  // ───────────────────────────────────────────────────────────────────────── the knife
  sable: {
    id: 'sable',
    callsign: 'Sable',
    realName: 'unknown',
    age: 30,
    bio: 'No file. No faction claims her, no settlement remembers her arriving, and the Free Traders who pass her name along will not say who first gave it to them. She has never spoken in front of your company; she negotiated her contract by writing a number on the back of Old Mill\'s ledger and waiting. Everything else about her is inference.',
    quirk: 'Never speaks. Will not carry a firearm. Kills more things than the rest of the squad combined.',
    attrs: {
      marksmanship: 2, agility: 10, strength: 7, vitality: 6, endurance: 8,
      wisdom: 6, leadership: 3, mechanical: 4, medical: 4, explosives: 2,
    },
    salary: 580,
    hireCost: 2400,
    startingPerks: ['ghost', 'low-profile'],
    startingTraits: ['mute', 'graceful'],
    startingWeapon: 'combat-knife',
    startingSidearm: 'machete',
    portraitSeed: 10267,
    palette: { skin: '#8f6a52', hair: '#0f0e10', cloth: '#22262b', accent: '#7d8fa0' },
    likes: ['vy', 'nine'],
    dislikes: ['deadline'],
    voice: 'sable',
    preferredClasses: ['melee', 'thrown'],
  },

  // ───────────────────────────────────────────────────────────────────────── the demolitions
  bricks: {
    id: 'bricks',
    callsign: 'Bricks',
    realName: 'Aisha Bello',
    age: 33,
    bio: 'Quarry blasting, then tunnel work, then eleven months under a collapsed service duct outside Lagos before the Fever ever reached her. She came up out of that hole with a permanent view that the correct answer to a locked building is a new entrance. Her charges are immaculate, her maths is faster than a calculator, and she will not go into a basement for any amount of money.',
    quirk: 'Every problem is a doorway problem. Will not enter enclosed spaces — claustrophobia is a hard rule.',
    attrs: {
      marksmanship: 5, agility: 5, strength: 6, vitality: 5, endurance: 5,
      wisdom: 5, leadership: 4, mechanical: 7, medical: 2, explosives: 10,
    },
    salary: 560,
    hireCost: 2300,
    startingPerks: ['demolitionist', 'trap-layer'],
    startingTraits: ['claustrophobic', 'iron-gut', 'lucky'],
    startingWeapon: 'mossberg-590',
    startingSidearm: 'm1911',
    portraitSeed: 11383,
    palette: { skin: '#5e3b28', hair: '#231d1a', cloth: '#5a4632', accent: '#f0a63c' },
    likes: ['chainlink', 'twitch'],
    dislikes: ['maggie', 'padre'],
    voice: 'bricks',
    preferredClasses: ['thrown', 'shotgun', 'smg'],
  },

  // ───────────────────────────────────────────────────────────────────────── the quartermaster
  oldmill: {
    id: 'oldmill',
    callsign: 'Old Mill',
    realName: 'Walter Millard',
    age: 62,
    bio: 'Thirty-one years supplying the National Guard and four more supplying whatever the Remnant decided it was, until they audited him and he audited himself right out the gate. He can price a dead man\'s boots from across a field and will tell you the figure whether or not you asked. Every merc who has worked with him hates him and every merc who has worked with him gets paid on time.',
    quirk: 'An insufferable haggler. Being on the roster cuts the whole squad\'s salary bill.',
    attrs: {
      marksmanship: 6, agility: 3, strength: 5, vitality: 5, endurance: 4,
      wisdom: 4, leadership: 7, mechanical: 8, medical: 4, explosives: 4,
    },
    salary: 410,
    hireCost: 1500,
    startingPerks: ['quartermaster', 'ammo-sense'],
    startingTraits: ['haggler', 'bad-back', 'night-owl'],
    startingWeapon: 'fn-fal',
    startingSidearm: 'm1911',
    portraitSeed: 12497,
    palette: { skin: '#d8b294', hair: '#b8b2a4', cloth: '#4c4f3e', accent: '#9c7c3e' },
    likes: ['vy', 'nine'],
    dislikes: ['chainlink', 'hoyt'],
    voice: 'oldmill',
    preferredClasses: ['battlerifle', 'rifle', 'pistol'],
  },

  // ───────────────────────────────────────────────────────────────────────── the smuggler
  coyote: {
    id: 'coyote',
    callsign: 'Coyote',
    realName: 'Rosa Vidal',
    age: 35,
    bio: 'Ran fuel and antibiotics up the reservoir highway for six years, which means she has driven every road in the Basin at night with the lights off. The Remnant took her truck, her cargo, and her cousin at a checkpoint outside Kettle Row and issued her a receipt for it. She has kept the receipt.',
    quirk: 'Knows every sector before you get there — reveals map intel. Will not work a contract for The Remnant.',
    attrs: {
      marksmanship: 7, agility: 8, strength: 4, vitality: 5, endurance: 8,
      wisdom: 6, leadership: 5, mechanical: 6, medical: 3, explosives: 4,
    },
    salary: 470,
    hireCost: 1800,
    startingPerks: ['scrounger', 'cat-fall'],
    startingTraits: ['pathfinder', 'grudge-remnant', 'night-owl'],
    startingWeapon: 'mp5',
    startingSidearm: 'glock-17',
    portraitSeed: 13591,
    palette: { skin: '#b07a52', hair: '#2b2118', cloth: '#7a4a3a', accent: '#3fa87a' },
    likes: ['twitch', 'deadline'],
    dislikes: ['oldmill'],
    voice: 'coyote',
    preferredClasses: ['smg', 'rifle', 'pistol'],
  },
};

/** Stable display order: the merc you start with, then the hire list by salary. */
export const MERC_LIST: MercDef[] = Object.values(MERCS);

export const STARTING_MERC = 'nine';
