/**
 * The five powers of the Basin.
 *
 * Reputation runs -100..+100 per faction. Helping one against another moves both bars,
 * so the map is a zero-sum political board rather than a checklist of allies.
 *
 * External ids referenced here (owned by other data modules):
 *   enemyRoster -> keys of ENEMIES in src/data/enemies.ts. The dead belong to nobody, so no
 *   zombie appears in any roster.
 */

export type TradeCategory =
  | 'food'
  | 'medicine'
  | 'ammo'
  | 'weapons'
  | 'attachments'
  | 'armour'
  | 'materials'
  | 'chems'
  | 'fuel'
  | 'intel'
  | 'recipes';

export type ContractKind =
  | 'clear'
  | 'defend'
  | 'escort'
  | 'assassinate'
  | 'retrieve'
  | 'sabotage';

export interface FactionDef {
  id: string;
  name: string;
  /** Two or three sentences of world voice — shown on the faction dossier screen. */
  blurb: string;
  leader: { name: string; desc: string };
  /** Map ownership tint and dossier accent. */
  color: string;
  /** Key the art forge uses to composite the faction banner. */
  banner: string;
  /** Faction ids this one is at standing war with — helping either swings both bars. */
  hostileTo: string[];
  /**
   * What their market stocks, and the multiplier on base value.
   * < 1 means they are the cheap source for that category; > 1 means you are paying a
   * tax for the convenience. A category absent here simply is not for sale.
   */
  tradeGoods: Partial<Record<TradeCategory, number>>;
  startingRep: number;
  contractTypes: ContractKind[];
  /** Enemy def ids this faction fields when you fight them. */
  enemyRoster: string[];
  allianceReward: string;
  warPenalty: string;
}

export const ALLIANCE_THRESHOLD = 60;
export const WAR_THRESHOLD = -60;

export const FACTIONS: Record<string, FactionDef> = {
  havenhold: {
    id: 'havenhold',
    name: 'Havenhold',
    blurb:
      'A farm co-op that survived because the county extension office kept a seed bank in a ' +
      'root cellar, and because somebody had the sense to wall the town before the second ' +
      'winter. They vote on everything — rations, marriages, whether to hire you — and the ' +
      'minutes are read aloud each Sunday. They are the only people in the Basin who still ' +
      'plant things they will not live to harvest.',
    leader: {
      name: 'Mayor Ruth Vance',
      desc: 'Calls council to order with a school bell and has never once broken quorum, even the night the wall fell.',
    },
    color: '#6ea84f',
    banner: 'banner-havenhold',
    hostileTo: ['rust-kings'],
    tradeGoods: { food: 0.8, medicine: 1.0, materials: 1.15, ammo: 1.4, intel: 1.1 },
    startingRep: 15,
    contractTypes: ['defend', 'clear', 'escort', 'retrieve'],
    enemyRoster: ['militia'],
    allianceReward:
      'Free bunks and hot food between contracts — squad morale recovers twice as fast — ' +
      'and the militia mans your flank on any battle inside Havenhold territory.',
    warPenalty:
      'The gates shut. No food, no beds, no healing in the south-west, and their patrols ' +
      'shoot on sight anywhere below the Mill Road.',
  },

  'rust-kings': {
    id: 'rust-kings',
    name: 'Rust Kings',
    blurb:
      'They own the highway, which in a valley with one road means they own everything that ' +
      'moves. Every overpass is a toll gate, every wreck on the median is a firing position, ' +
      'and the price is whatever they decide your cargo is worth today. They do not farm, ' +
      'they do not build, and they have not yet run out of things to take.',
    leader: {
      name: 'Barrow King Dessie Kloss',
      desc: 'Took the interstate with a tow truck and a cutting torch; wears the teeth of the last three claimants on a wire at her throat.',
    },
    color: '#c2622a',
    banner: 'banner-rust-kings',
    hostileTo: ['havenhold', 'ash-order'],
    tradeGoods: { ammo: 0.75, materials: 0.8, attachments: 1.0, weapons: 1.1, fuel: 0.9 },
    startingRep: -10,
    contractTypes: ['assassinate', 'sabotage', 'retrieve', 'clear'],
    enemyRoster: ['raider', 'raider_veteran'],
    allianceReward:
      'Free passage on the highway — travel between sectors costs half the hours — and their ' +
      'chop shops sell you salvage at cost.',
    warPenalty:
      'Toll crews ambush your squad in transit through any highway sector, and there is a ' +
      'standing bounty on every merc on your payroll, paid in ammunition.',
  },

  'ash-order': {
    id: 'ash-order',
    name: 'Ash Order',
    blurb:
      'They preach that the Fever was not a disease but a draining — that the world was ' +
      'emptied on purpose, the way a valley is emptied to build a dam, and that the ones ' +
      'left standing were chosen to walk the mud. They keep the dead unburned and unburied ' +
      'because the dead are the congregation. They make very good chemistry, for people who ' +
      'believe medicine is a sin.',
    leader: {
      name: 'The Ashfather (Elias Crane)',
      desc: 'The reservoir engineer who opened the sluice gates in the first year and has been explaining why ever since.',
    },
    color: '#9a8fb5',
    banner: 'banner-ash-order',
    hostileTo: ['rust-kings'],
    tradeGoods: { chems: 0.7, medicine: 1.6, recipes: 1.2, materials: 1.1, food: 1.8 },
    startingRep: 0,
    contractTypes: ['retrieve', 'assassinate', 'escort', 'sabotage'],
    enemyRoster: ['cultist', 'cult_zealot'],
    allianceReward:
      'The censer-bearers walk your squad through the reservoir ruins unmolested by the ' +
      'dead, and the Order sells you the chem recipes nobody else will write down.',
    warPenalty:
      'Screamers are herded onto your position — the Horde clock rises faster on every ' +
      'mission — and their flensers hunt any merc who sleeps outside a wall.',
  },

  remnant: {
    id: 'remnant',
    name: 'The Remnant',
    blurb:
      'Forty-one people in a depot built for four thousand, still standing morning formation ' +
      'under a flag for a government that stopped answering the radio in year one. They have ' +
      'the only working armoury in the Basin and the discipline to keep it locked. What they ' +
      'do not have is anyone left to relieve them.',
    leader: {
      name: 'Master Sergeant Colton Ruiz',
      desc: 'Ranking NCO of a battalion that no longer exists; runs PT at 0530 for forty-one people and calls the roll of the dead first.',
    },
    color: '#5b7fa6',
    banner: 'banner-remnant',
    hostileTo: [],
    tradeGoods: { weapons: 0.85, armour: 0.8, attachments: 0.85, ammo: 1.0, medicine: 1.2 },
    startingRep: 5,
    contractTypes: ['clear', 'defend', 'sabotage', 'assassinate'],
    enemyRoster: ['remnant_trooper', 'remnant_marksman'],
    allianceReward:
      'Armoury access at issue price, mil-spec attachments off the shelf, and a two-man ' +
      'fire team attached to your squad on any contract north of the reservoir.',
    warPenalty:
      'Their marksmen take the roofs before you arrive — every battle in the north-east ' +
      'starts with you already in someone’s scope — and the armoury is closed for good.',
  },

  'free-traders': {
    id: 'free-traders',
    name: 'Free Traders',
    blurb:
      'Not a faction so much as a debt ledger with wheels. They run the caravan circuit ' +
      'between everyone who is currently shooting at everyone else, and they sell to all of ' +
      'them at a markup nobody enjoys and nobody refuses. Rob a caravan once and you will ' +
      'find every door in the Basin priced against you.',
    leader: {
      name: 'Factor Nadia Whitlock',
      desc: 'Has never fired a gun and has never had to; keeps the only complete map of the Basin in a ledger she does not let out of her hands.',
    },
    color: '#d8b24a',
    banner: 'banner-free-traders',
    hostileTo: [],
    tradeGoods: {
      food: 1.3,
      medicine: 1.3,
      ammo: 1.25,
      weapons: 1.35,
      attachments: 1.35,
      armour: 1.3,
      materials: 1.2,
      chems: 1.4,
      fuel: 1.2,
      intel: 0.9,
      recipes: 1.15,
    },
    startingRep: 20,
    contractTypes: ['escort', 'retrieve', 'clear', 'defend'],
    enemyRoster: ['trader_guard'],
    allianceReward:
      'The markup drops to nothing, caravans buy your scrap at full value, and Whitlock ' +
      'sells you sector intel before the contracts are posted.',
    warPenalty:
      'Every market in the Basin refuses you, prices elsewhere rise, and the outriders ' +
      'sell your squad’s position to whoever is currently angriest with you.',
  },
};

export const FACTION_IDS = Object.keys(FACTIONS);
