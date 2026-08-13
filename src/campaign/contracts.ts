/**
 * Contract generation.
 *
 * Contracts are not a random table with a faction stapled on — they are a readout of the
 * political board. Who offers work, who it is aimed at, where it happens and what it pays
 * all fall out of `reputation` and `sectorControl`:
 *
 *   - a faction at war with you offers nothing at all;
 *   - an ally offers its dangerous, well-paid work (and picks the nastier sector of two);
 *   - a faction with an enemy offers work aimed at that enemy, in ground that enemy holds;
 *   - a faction that merely tolerates you offers cleanup in its own back yard.
 *
 * Every description is written in the employer's voice and names the real sector.
 */
import { FACTIONS, type ContractKind } from '@/data/factions';
import { SECTORS, type SectorDef } from '@/data/sectors';
import type { Rng } from '@/core/rng';
import {
  clamp,
  nextId,
  stanceFromRep,
  withRng,
  type CampaignState,
  type Contract,
  type FactionStance,
} from './types';

// ─────────────────────────────────────────────────────────────── tuning

/** Base fee per contract kind, before threat, stance and jitter. */
const BASE_PAY: Record<ContractKind, number> = {
  clear: 1500,
  defend: 1700,
  escort: 1400,
  assassinate: 2200,
  retrieve: 1600,
  sabotage: 1950,
};

/** What the employer's opinion of you is worth on the invoice. */
const STANCE_PAY: Record<FactionStance, number> = {
  allied: 1.4,
  friendly: 1.15,
  neutral: 1.0,
  hostile: 0.85,
  war: 0,
};

/** How often each stance bothers to post work at all. */
const STANCE_WEIGHT: Record<FactionStance, number> = {
  allied: 3,
  friendly: 2,
  neutral: 1,
  hostile: 0.4,
  war: 0,
};

/** Board size the generator refills toward. */
export const CONTRACT_BOARD_SIZE = 6;

// ─────────────────────────────────────────────────────────────── voice

/**
 * One line per faction per contract kind. `{sector}` is the real sector name, `{target}` the
 * faction being worked against (or "the dead" when there is nobody to name).
 */
const VOICE: Record<string, Record<ContractKind, string>> = {
  havenhold: {
    clear:
      'Council voted seven to two. {sector} needs walking end to end and clearing of {target}, ' +
      'and we would rather pay you than bury our own. Bring back the tags if there are tags.',
    defend:
      'They will come at {sector} inside the week — we can hear them staging. Stand the line with ' +
      'our militia and you will eat at our table for as long as you want to.',
    escort:
      'A wagon of seed and two of our people have to reach {sector} and come back. Ruth signed for it ' +
      'personally, which means if they do not come back she reads their names on Sunday.',
    assassinate:
      'This is not put to the vote and it is not in the minutes. Someone in {sector} has been pricing ' +
      'our children. End it, take the money, and never mention {target} to us again.',
    retrieve:
      'There is a pump and a crate of seed stock still sitting in {sector}. It is ours, it is written ' +
      'down as ours, and we cannot spare the bodies to go and argue about it.',
    sabotage:
      'We do not do this sort of thing, which is exactly why we are hiring someone who does. ' +
      'Whatever {target} is building in {sector}, we would like it to stop working.',
  },
  'rust-kings': {
    clear:
      'The road through {sector} is backed up with dead and nobody pays a toll they cannot drive to. ' +
      'Clear it. Kloss counts corpses, so do not get creative.',
    defend:
      '{sector} is ours and somebody has decided it is negotiable. Stand on it until they stop ' +
      'thinking that. We pay in cash and we pay on the day.',
    escort:
      'A load is moving through {sector} and it is not going to move itself. Ride with it. Anything ' +
      'that stops the wagon, you stop first.',
    assassinate:
      'There is a name in {sector} that {target} keeps saying like it matters. Go and make it ' +
      'stop mattering. Bring the teeth; the Barrow King likes teeth.',
    retrieve:
      'Something of ours ended up in {sector} on the wrong end of a bad trade. Get it back. We do not ' +
      'much mind what condition the current owner is in when you do.',
    sabotage:
      'Everything {target} runs out of {sector} runs on something. Find it, break it, walk away ' +
      'before it burns. Half up front because we are in a good mood.',
  },
  'ash-order': {
    clear:
      'The congregation in {sector} has grown loud and unquiet, and the Ashfather says loud is not ' +
      'holy. Still them. Do it gently if you can; do it anyway if you cannot.',
    defend:
      'They are coming to take {sector} from us and they will call it reason. Hold the ground. ' +
      'The Ashfather will remember the names of everyone who stood on it.',
    escort:
      'Censer-bearers must reach {sector} and the road does not love them. Walk with them. Do not ' +
      'interrupt the singing; it is the only part of this you need not understand.',
    assassinate:
      'A man in {sector} speaks for {target} and speaks against the draining. The Order does not ' +
      'murder — it merely stops arguing. Stop arguing on our behalf.',
    retrieve:
      'What was taken from the water at {sector} was never anyone\'s to take. Bring it back to ' +
      'Cinderhall unopened. We will know if it was opened.',
    sabotage:
      'What {target} keeps running in {sector} draws the chosen away from the mud and into the ' +
      'noise. Silence it. Payment is in chems, cash, and a blessing you may refuse.',
  },
  remnant: {
    clear:
      'Sector {sector} is a hazard to movement and we do not have the manpower to sweep it twice. ' +
      'Clear it of {target}, report the count, and stay off our comms while you work.',
    defend:
      'You will hold {sector} until relieved. There is no relief, so you will hold it until the ' +
      'contract expires. Rations and ammunition are issued at the gate.',
    escort:
      'Movement of matériel to {sector}. Two vehicles, no lights, no fires. If you cannot keep ' +
      'noise discipline for six hours, decline now and save us both the paperwork.',
    assassinate:
      'A {target} element in {sector} is running a command node. Master Sergeant Ruiz has authorised ' +
      'its removal by contractors, which is the only way this appears in no log anywhere.',
    retrieve:
      'Federal property sitting in {sector}. Serial numbers matter, condition matters, and we will ' +
      'be checking both. Bring it to the depot gate, not into the depot.',
    sabotage:
      'Deny {target} the use of {sector}. Demolition only — the armoury issues charges, and the ' +
      'armoury counts them back in. Fail to return one and the contract is void.',
  },
  'free-traders': {
    clear:
      'Nobody buys from a market they cannot reach. {sector} is thick with the dead and my caravans ' +
      'are routing three days around it. Clear it and the route pays for itself.',
    defend:
      'The circuit stops at {sector} and it needs to still be there next month. Sit on it. Whitlock ' +
      'has priced the alternative and does not like the figure.',
    escort:
      'Four wagons to {sector}, full both ways. Standard terms: you are paid for the cargo that ' +
      'arrives, which I find focuses everyone wonderfully.',
    assassinate:
      'I am going to say this once and then deny it. Someone flying {target} colours in {sector} has ' +
      'been taxing my drivers twice. Settle the ledger.',
    retrieve:
      'A consignment went missing between here and {sector}. I know what it is worth, I know who has ' +
      'it, and I would rather pay you than write it off.',
    sabotage:
      'While {target} holds {sector} they set the price and I do not. Make holding it expensive. ' +
      'Discreetly — I still have to sell them rope next spring.',
  },
};

const OBJECTIVES: Record<ContractKind, string> = {
  clear: 'Eliminate every hostile in the sector.',
  defend: 'Survive the assault; the sector must still be held at the end.',
  escort: 'Get the convoy across the sector with at least one wagon intact.',
  assassinate: 'Kill the named target. Anyone else is optional.',
  retrieve: 'Reach the cache, take it, and leave the sector.',
  sabotage: 'Destroy the objective and get clear before the sector reacts.',
};

// ─────────────────────────────────────────────────────────────── helpers

const sectorById = (id: string): SectorDef | undefined => SECTORS.find((s) => s.id === id);

/** Factions this one is at odds with, in both directions — hostility is symmetric here. */
export function enemiesOf(factionId: string): string[] {
  const def = FACTIONS[factionId];
  const out = new Set<string>(def?.hostileTo ?? []);
  for (const other of Object.values(FACTIONS)) {
    if (other.hostileTo.includes(factionId)) out.add(other.id);
  }
  return [...out];
}

/** Sectors currently held by `factionId` according to campaign state, not the static map. */
function sectorsHeldBy(c: CampaignState, factionId: string | null): SectorDef[] {
  return SECTORS.filter((s) => (c.sectorControl[s.id] ?? null) === factionId);
}

function pickSector(
  rng: Rng,
  c: CampaignState,
  employer: string,
  against: string | null,
  kind: ContractKind,
  stance: FactionStance,
): SectorDef {
  let pool: SectorDef[];
  if (against) pool = sectorsHeldBy(c, against);
  else if (kind === 'defend') pool = sectorsHeldBy(c, employer);
  else pool = sectorsHeldBy(c, null);

  if (pool.length === 0) pool = sectorsHeldBy(c, null);
  if (pool.length === 0) pool = SECTORS.slice();

  const first = rng.pick(pool);
  // Allies trust you with the bad ground: take the nastier of two draws.
  if (stance === 'allied') {
    const second = rng.pick(pool);
    return second.threat > first.threat ? second : first;
  }
  return first;
}

function describe(employer: string, kind: ContractKind, sector: SectorDef, against: string | null): string {
  const line = VOICE[employer]?.[kind] ?? '{sector}. {target}. The usual terms.';
  const targetName = against ? (FACTIONS[against]?.name ?? against) : 'the dead';
  return line.replaceAll('{sector}', sector.name).replaceAll('{target}', targetName);
}

// ─────────────────────────────────────────────────────────────── generation

/**
 * Roll `count` fresh contracts off the current political board.
 *
 * Mutates `c.rngState` and `c.nextId` (ids must be a function of the campaign, not of
 * process-global counters) but does NOT touch `c.contracts` — the caller decides what to
 * put on the board, so this stays testable in isolation.
 */
export function generateContracts(c: CampaignState, count: number): Contract[] {
  const employers: (readonly [string, number])[] = [];
  for (const id of Object.keys(FACTIONS)) {
    const stance = stanceFromRep(c.reputation[id] ?? 0);
    const w = STANCE_WEIGHT[stance];
    if (w > 0) employers.push([id, w] as const);
  }
  if (employers.length === 0) return [];

  const out: Contract[] = [];
  for (let i = 0; i < count; i++) {
    const contract = withRng(c, (rng) => rollOne(rng, c, employers));
    if (contract) out.push(contract);
  }
  return out;
}

function rollOne(
  rng: Rng,
  c: CampaignState,
  employers: (readonly [string, number])[],
): Contract | null {
  const employer = rng.weighted(employers);
  const def = FACTIONS[employer];
  if (!def || def.contractTypes.length === 0) return null;

  const stance = stanceFromRep(c.reputation[employer] ?? 0);
  const kind = rng.pick(def.contractTypes);

  // Who the job is aimed at. Offensive work needs a name; cleanup usually does not.
  const foes = enemiesOf(employer).filter((f) => sectorsHeldBy(c, f).length > 0);
  const offensive = kind === 'assassinate' || kind === 'sabotage';
  let against: string | null = null;
  if (foes.length > 0 && (offensive || rng.chance(0.25))) against = rng.pick(foes);
  // An offensive contract with nobody to aim it at is not a contract.
  if (offensive && !against) return null;

  const sector = pickSector(rng, c, employer, against, kind, stance);
  const threat = clamp(sector.threat + (against ? 1 : 0), 1, 5);

  const jitter = rng.float(0.9, 1.15);
  const raw = BASE_PAY[kind] * (0.6 + 0.35 * threat) * STANCE_PAY[stance] * jitter;
  const payment = Math.max(200, Math.round(raw / 50) * 50);

  const weight = Math.round(6 + threat * 1.6);
  const repSuccess: Record<string, number> = { [employer]: weight };
  const repFailure: Record<string, number> = { [employer]: -Math.round(weight * 0.7) };
  // Only name the victim explicitly when the employer's declared hostilities would not
  // already carry the swing — `adjustReputation` propagates through `hostileTo`.
  if (against && !enemiesOf(employer).includes(against)) {
    repSuccess[against] = -Math.round(weight * 0.6);
  }

  return {
    id: nextId(c, 'ct'),
    kind,
    employer,
    targetSector: sector.id,
    against,
    payment,
    deadlineDay: c.day + 3 + threat + rng.int(0, 3),
    description: describe(employer, kind, sector, against),
    objectives: OBJECTIVES[kind],
    threat,
    repSuccess,
    repFailure,
  };
}

/** Sector name for UI and log lines. Falls back to the raw id for unknown sectors. */
export function sectorName(id: string): string {
  return sectorById(id)?.name ?? id;
}
