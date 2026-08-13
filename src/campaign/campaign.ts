/**
 * The strategy layer: time, money, people, politics.
 *
 * The shape of a campaign day is one function — `dawn()`. Salaries come out, the wounded
 * mend a little, the bench delivers, the horde clock breathes out, dead contracts fall off
 * the board and fresh ones arrive. Everything else the player does costs hours, and hours
 * are what push the day forward.
 *
 * Money is meant to be tight. Starting cash is about three days of payroll for a working
 * squad, and a contract is worth roughly three days of that squad's wages — so the company
 * lives or dies on how often it can close a job, not on how well it trades.
 */
import { Rng } from '@/core/rng';
import { RECIPES } from '@/data/crafting';
import { FACTIONS } from '@/data/factions';
import { MERCS } from '@/data/mercs';
import { MAP_H, SECTORS, type SectorDef } from '@/data/sectors';
import { createMercState, type MercState } from '@/sim/spawn';
import { maxHpFor } from '@/sim/progression';
import type { MaterialId, Materials } from '@/sim/types';
import { CONTRACT_BOARD_SIZE, enemiesOf, generateContracts, sectorName } from './contracts';
import { finishCraftJob, findMerc, isBusy, mercMods } from './economy';
import {
  FAIL,
  OK,
  SQUAD_MAX,
  addMaterials,
  clamp,
  nextId,
  stanceFromRep,
  withRng,
  type ActionResult,
  type CampaignState,
  type Contract,
  type CraftJob,
  type FactionStance,
  type LogTone,
} from './types';

// ─────────────────────────────────────────────────────────────── tuning knobs

export const START_CASH = 4000;
/** Below this you cannot put anybody in the field again — see `checkFailState`. */
export const MIN_REHIRE_COST = 300;
/** Daily stipend per sector held, paid only by factions you are formally allied with. */
export const ALLY_TRIBUTE_PER_SECTOR = 12;
/** Sectors past this earn an ally nothing extra — a retainer, not a tax farm. */
export const ALLY_TRIBUTE_SECTOR_CAP = 8;
/** Ammunition, medicine and fuel burned per merc on a contract, plus this much per threat. */
export const FIELD_COST_PER_MERC = 40;
export const FIELD_COST_PER_THREAT = 15;
/** Horde pressure bled off per day of quiet. */
export const HORDE_DECAY_PER_DAY = 2.5;
/** Days between refills of the contract board. */
export const BOARD_REFRESH_DAYS = 2;
/** Days between a new face showing up on the hire board. */
export const HIRE_BOARD_DAYS = 12;
/** Hours a contract in the field costs, before travel. */
export const CONTRACT_HOURS = 8;

const STARTING_AVAILABLE = ['hoyt', 'twitch', 'chainlink', 'coyote', 'oldmill'];
const STARTING_LOCATION = 'b5';
const STARTING_MATERIALS: Materials = { scrap: 24, steel: 6, polymer: 4, tape: 10, springs: 3 };

// ─────────────────────────────────────────────────────────────── setup

export function createCampaign(seed: number): CampaignState {
  const reputation: Record<string, number> = {};
  for (const f of Object.values(FACTIONS)) reputation[f.id] = f.startingRep;

  const sectorControl: Record<string, string | null> = {};
  const sectorCleared: Record<string, boolean> = {};
  for (const s of SECTORS) {
    sectorControl[s.id] = s.owner;
    sectorCleared[s.id] = false;
  }

  const c: CampaignState = {
    seed,
    rngState: new Rng(seed).state,
    day: 1,
    hour: 6,
    cash: START_CASH,
    reputation,
    sectorControl,
    sectorCleared,
    roster: [],
    available: [...STARTING_AVAILABLE],
    unpaidDays: {},
    materials: { ...STARTING_MATERIALS },
    stash: { weapons: [], attachments: [], consumables: { bandage: 4, medkit: 1 } },
    // Recipes without a `learnedFrom` are common knowledge; the rest must be found or bought.
    knownRecipes: Object.values(RECIPES)
      .filter((r) => r.learnedFrom === undefined)
      .map((r) => r.id),
    craftJobs: [],
    contracts: [],
    activeContractId: null,
    hordeClock: 10,
    location: STARTING_LOCATION,
    squad: [],
    log: [],
    gameOver: 'none',
    nextId: 0,
    stats: { contractsOffered: 0, contractsCompleted: 0, contractsFailed: 0 },
  };

  const nine = adopt(c, createMercState('nine'));
  c.roster.push(nine);
  c.unpaidDays[nine.id] = 0;
  c.squad = [nine.id];

  log(c, 'Vulture Company opens its books. One merc, one rifle, and a month of rent.', 'info');
  refreshBoard(c);
  return c;
}

/** Weapon uids must come from the campaign counter, not the module-global one, or two
 *  campaigns from the same seed would serialise differently depending on process order. */
function adopt(c: CampaignState, m: MercState): MercState {
  if (m.weapon) m.weapon.uid = nextId(c, 'w');
  if (m.sidearm) m.sidearm.uid = nextId(c, 'w');
  return m;
}

export function log(c: CampaignState, text: string, tone: LogTone = 'info'): void {
  c.log.push({ day: c.day, hour: c.hour, text, tone });
}

const nameOf = (m: MercState): string => MERCS[m.defId]?.callsign ?? m.defId;
const sectorById = (id: string): SectorDef | undefined => SECTORS.find((s) => s.id === id);

// ─────────────────────────────────────────────────────────────── money

/**
 * Company-wide salary multiplier: the best haggler on the roster works for everybody. This
 * is Old Mill's whole reason to exist (`quartermaster` → salaryMul 0.9), and it applies to
 * his own bill too, which he would tell you is only fair.
 */
export function companySalaryMul(c: CampaignState): number {
  let best = 1;
  for (const m of c.roster) best = Math.min(best, mercMods(m).salaryMul);
  return best;
}

/** What this merc costs the company today, after their own traits and the company haggler. */
export function salaryFor(c: CampaignState, m: MercState): number {
  const base = MERCS[m.defId]?.salary ?? 0;
  return Math.round(base * mercMods(m).salaryMul * companySalaryMul(c));
}

export function dailyPayroll(c: CampaignState): number {
  return c.roster.reduce((sum, m) => sum + salaryFor(c, m), 0);
}

/**
 * Salary drain. Mercs are paid in roster order out of whatever cash there is; anyone who
 * goes unpaid loses morale, and two dawns running they pack up and walk.
 */
export function payday(c: CampaignState): void {
  if (c.roster.length === 0) return;
  let paid = 0;
  const quitters: MercState[] = [];

  for (const m of c.roster) {
    const due = salaryFor(c, m);
    if (c.cash >= due) {
      c.cash -= due;
      paid += due;
      c.unpaidDays[m.id] = 0;
      m.morale = clamp(m.morale + 2, 0, 100);
      m.daysHired += 1;
      continue;
    }
    const owed = (c.unpaidDays[m.id] ?? 0) + 1;
    c.unpaidDays[m.id] = owed;
    m.morale = clamp(m.morale - 14, 0, 100);
    if (owed >= 2) quitters.push(m);
    else log(c, `${nameOf(m)} was not paid. They mentioned it. Twice.`, 'bad');
  }

  if (paid > 0) log(c, `Payroll: $${paid}.`, 'money');
  for (const m of quitters) {
    removeMerc(c, m.id);
    log(c, `${nameOf(m)} walked. Two days without pay is two days too many.`, 'bad');
  }
  if (quitters.length > 0) checkFailState(c, 'bankrupt');
}

/** Allies pay a standing retainer on the ground they hold. Held sectors are worth having. */
function collectTribute(c: CampaignState): void {
  let total = 0;
  for (const id of Object.keys(FACTIONS)) {
    if (factionStance(c, id) !== 'allied') continue;
    const held = SECTORS.filter((s) => c.sectorControl[s.id] === id).length;
    total += Math.min(held, ALLY_TRIBUTE_SECTOR_CAP) * ALLY_TRIBUTE_PER_SECTOR;
  }
  if (total <= 0) return;
  c.cash += total;
  log(c, `Allied retainers paid $${total}.`, 'money');
}

// ─────────────────────────────────────────────────────────────── time

/** Advance the clock, resolving each dawn crossed. Hours are the campaign's only currency
 *  besides cash — travel, crafting and contracts all spend them. */
export function advanceTime(c: CampaignState, hours: number): void {
  if (c.gameOver !== 'none' || hours <= 0) return;
  let left = Math.round(hours);
  while (left > 0 && c.gameOver === 'none') {
    const step = Math.min(left, 24 - c.hour);
    c.hour += step;
    left -= step;
    if (c.hour >= 24) {
      c.hour = 0;
      c.day += 1;
      dawn(c);
    }
  }
}

function dawn(c: CampaignState): void {
  payday(c);
  if (c.gameOver !== 'none') return;
  collectTribute(c);
  restAndMend(c);
  tickCraftJobs(c);
  tickHordeClock(c, -HORDE_DECAY_PER_DAY);
  expireContracts(c);

  if (c.day % BOARD_REFRESH_DAYS === 0) refreshBoard(c);
  if (c.day % HIRE_BOARD_DAYS === 0) offerNewHire(c);
  checkFailState(c, 'bankrupt');
}

/** Wounds close slowly on their own; a medic on the roster roughly doubles that. */
function restAndMend(c: CampaignState): void {
  const medic = c.roster.reduce((best, m) => Math.max(best, m.attrs.medical), 0);
  const heal = 5 + Math.floor(medic / 2);
  for (const m of c.roster) {
    if (isBusy(c, m.id)) continue;
    const cap = maxHpFor(m.attrs, m.level, mercMods(m));
    if (m.hp > 0 && m.hp < cap) m.hp = Math.min(cap, m.hp + heal);
    m.morale = clamp(m.morale + 1, 0, 100);
  }
}

function tickCraftJobs(c: CampaignState): void {
  if (c.craftJobs.length === 0) return;
  const done: CraftJob[] = [];
  for (const job of c.craftJobs) {
    job.daysLeft -= 1;
    if (job.daysLeft <= 0) done.push(job);
  }
  if (done.length === 0) return;
  c.craftJobs = c.craftJobs.filter((j) => !done.includes(j));
  // `finishCraftJob` lives in economy.ts — it is the module that knows recipes and quality.
  for (const job of done) finishCraftJob(c, job);
}

function offerNewHire(c: CampaignState): void {
  const hired = new Set(c.roster.map((m) => m.defId));
  const pool = Object.keys(MERCS).filter(
    (id) => !hired.has(id) && !c.available.includes(id) && id !== 'nine',
  );
  if (pool.length === 0) return;
  const pick = withRng(c, (rng) => rng.pick(pool));
  c.available.push(pick);
  log(c, `${MERCS[pick]?.callsign ?? pick} is asking after work.`, 'info');
}

// ─────────────────────────────────────────────────────────────── travel

/** Base hours to cross the Basin from one sector to another. Swamp is slow on both ends. */
export function travelTime(from: string, to: string): number {
  const a = sectorById(from);
  const b = sectorById(to);
  if (!a || !b || a.id === b.id) return 0;
  const dist = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  let hours = dist * 4;
  if (a.terrain === 'swamp') hours += 2;
  if (b.terrain === 'swamp') hours += 2;
  return Math.max(2, hours);
}

/** Move the company. Rust King allies wave you through the tolls, which halves the trip. */
export function travelTo(c: CampaignState, sectorId: string): ActionResult {
  if (c.gameOver !== 'none') return FAIL('the company is finished');
  const dest = sectorById(sectorId);
  if (!dest) return FAIL('no such sector');
  if (c.location === sectorId) return OK;

  let hours = travelTime(c.location, sectorId);
  if (factionStance(c, 'rust-kings') === 'allied') hours = Math.max(2, Math.round(hours / 2));

  advanceTime(c, hours);
  c.location = sectorId;
  log(c, `Moved to ${dest.name} (${hours}h).`, 'info');
  return OK;
}

// ─────────────────────────────────────────────────────────────── hiring

export function hireMerc(c: CampaignState, defId: string): ActionResult {
  const def = MERCS[defId];
  if (!def) return FAIL('no such merc');
  if (!c.available.includes(defId)) return FAIL(`${def.callsign} is not taking work`);
  if (c.roster.some((m) => m.defId === defId)) return FAIL(`${def.callsign} already works here`);
  if (c.cash < def.hireCost) return FAIL('not enough cash for the signing fee');

  c.cash -= def.hireCost;
  const m = adopt(c, createMercState(defId));
  c.roster.push(m);
  c.unpaidDays[m.id] = 0;
  c.available = c.available.filter((id) => id !== defId);
  // A new face is a good day for everyone except whoever they cannot stand.
  for (const other of c.roster) {
    if (other.id === m.id) continue;
    const otherDef = MERCS[other.defId];
    if (otherDef?.dislikes.includes(defId)) other.morale = clamp(other.morale - 8, 0, 100);
    else if (otherDef?.likes.includes(defId)) other.morale = clamp(other.morale + 6, 0, 100);
  }
  log(c, `Signed ${def.callsign} for $${def.hireCost}. ${def.salary}/day from tomorrow.`, 'money');
  return OK;
}

export function fireMerc(c: CampaignState, mercId: string): ActionResult {
  const m = findMerc(c, mercId);
  if (!m) return FAIL('not on the roster');
  removeMerc(c, mercId);
  c.available.push(m.defId);
  for (const other of c.roster) other.morale = clamp(other.morale - 5, 0, 100);
  log(c, `${nameOf(m)} was let go. Nobody says anything at supper.`, 'bad');
  checkFailState(c, 'bankrupt');
  return OK;
}

/** A merc dies in the field. Permanent — mercs are not respawnable. */
export function mercDied(c: CampaignState, mercId: string): void {
  const m = findMerc(c, mercId);
  if (!m) return;
  removeMerc(c, mercId);
  for (const other of c.roster) other.morale = clamp(other.morale - 12, 0, 100);
  log(c, `${nameOf(m)} did not come back.`, 'bad');
  checkFailState(c, 'wiped');
}

function removeMerc(c: CampaignState, mercId: string): void {
  c.roster = c.roster.filter((m) => m.id !== mercId);
  c.squad = c.squad.filter((id) => id !== mercId);
  c.craftJobs = c.craftJobs.filter((j) => j.mercId !== mercId);
  delete c.unpaidDays[mercId];
}

/** Set the deployment list for the next battle. */
export function setSquad(c: CampaignState, mercIds: string[]): ActionResult {
  if (mercIds.length > SQUAD_MAX) return FAIL(`no more than ${SQUAD_MAX} in the field`);
  const seen = new Set<string>();
  for (const id of mercIds) {
    if (seen.has(id)) return FAIL('duplicate merc in the squad');
    seen.add(id);
    const m = findMerc(c, id);
    if (!m) return FAIL('not on the roster');
    if (isBusy(c, id)) return FAIL(`${nameOf(m)} is at the bench`);
  }
  c.squad = [...mercIds];
  return OK;
}

function checkFailState(c: CampaignState, cause: 'bankrupt' | 'wiped'): void {
  if (c.gameOver !== 'none') return;
  if (c.roster.length === 0 && c.cash < MIN_REHIRE_COST) {
    c.gameOver = cause;
    log(
      c,
      cause === 'wiped'
        ? 'The last of the company is dead and there is no money to raise another.'
        : 'No mercs, no cash, no company. Vulture Company is struck off.',
      'bad',
    );
  }
}

// ─────────────────────────────────────────────────────────────── politics

export function factionStance(c: CampaignState, factionId: string): FactionStance {
  return stanceFromRep(c.reputation[factionId] ?? 0);
}

/**
 * Move a faction's opinion of you — and, by the same act, its enemies' opinion the other
 * way. There is no path where everyone loves you: `hostileTo` is read in both directions,
 * so every favour you do Havenhold is an insult to the Rust Kings at half weight.
 *
 * Crossing an alliance or war threshold is logged as the political event it is.
 */
export function adjustReputation(c: CampaignState, factionId: string, delta: number): void {
  if (delta === 0 || !FACTIONS[factionId]) return;

  const before: Record<string, FactionStance> = {};
  for (const id of Object.keys(FACTIONS)) before[id] = factionStance(c, id);

  applyRep(c, factionId, delta);
  for (const enemy of enemiesOf(factionId)) {
    applyRep(c, enemy, -Math.round(delta * 0.5));
  }

  for (const id of Object.keys(FACTIONS)) {
    const now = factionStance(c, id);
    const was = before[id];
    if (was === now) continue;
    const def = FACTIONS[id];
    if (!def) continue;
    if (now === 'allied') log(c, `${def.name} declares an alliance. ${def.allianceReward}`, 'politics');
    else if (now === 'war') log(c, `${def.name} declares war. ${def.warPenalty}`, 'politics');
    else if (was === 'allied') log(c, `${def.name} quietly withdraws from the alliance.`, 'politics');
    else if (was === 'war') log(c, `${def.name} stops shooting at you on sight.`, 'politics');
  }
}

function applyRep(c: CampaignState, factionId: string, delta: number): void {
  if (delta === 0) return;
  c.reputation[factionId] = clamp((c.reputation[factionId] ?? 0) + delta, -100, 100);
}

// ─────────────────────────────────────────────────────────────── contracts

export function findContract(c: CampaignState, id: string): Contract | undefined {
  return c.contracts.find((ct) => ct.id === id);
}

/** Top the board back up to `CONTRACT_BOARD_SIZE`. Contracts arise from faction state. */
export function refreshBoard(c: CampaignState): void {
  const missing = CONTRACT_BOARD_SIZE - c.contracts.length;
  if (missing <= 0) return;
  const fresh = generateContracts(c, missing);
  c.contracts.push(...fresh);
  c.stats.contractsOffered += fresh.length;
}

function expireContracts(c: CampaignState): void {
  const active = c.activeContractId;
  const dead = c.contracts.filter((ct) => ct.deadlineDay < c.day);
  for (const ct of dead) {
    if (ct.id === active) {
      log(c, `The ${FACTIONS[ct.employer]?.name ?? ct.employer} job ran past its deadline.`, 'bad');
      completeContract(c, ct.id, false);
    }
  }
  c.contracts = c.contracts.filter((ct) => ct.deadlineDay >= c.day || ct.id === c.activeContractId);
}

export function acceptContract(c: CampaignState, contractId: string): ActionResult {
  if (c.gameOver !== 'none') return FAIL('the company is finished');
  const ct = findContract(c, contractId);
  if (!ct) return FAIL('no such contract');
  if (c.activeContractId) return FAIL('a contract is already running');
  if (factionStance(c, ct.employer) === 'war') return FAIL('that employer wants you dead');
  if (c.squad.length === 0) return FAIL('nobody is deployed');

  c.activeContractId = contractId;
  log(
    c,
    `Signed with ${FACTIONS[ct.employer]?.name ?? ct.employer}: ${ct.kind} at ` +
      `${sectorName(ct.targetSector)} for $${ct.payment}, by day ${ct.deadlineDay}.`,
    'money',
  );
  return OK;
}

/**
 * Settle a contract: pay out, swing the political board, flip the ground, and add to the
 * noise everyone in the Basin is trying not to make.
 */
export function completeContract(c: CampaignState, contractId: string, success: boolean): ActionResult {
  const ct = findContract(c, contractId);
  if (!ct) return FAIL('no such contract');

  const employer = FACTIONS[ct.employer]?.name ?? ct.employer;
  const where = sectorName(ct.targetSector);

  // Putting people in the field costs money whether or not the job comes off. This is what
  // makes a large roster genuinely expensive rather than strictly better.
  const fieldCost = Math.min(
    c.cash,
    c.squad.length * (FIELD_COST_PER_MERC + FIELD_COST_PER_THREAT * ct.threat),
  );
  if (fieldCost > 0) {
    c.cash -= fieldCost;
    log(c, `Ammunition, medical and fuel for ${where}: $${fieldCost}.`, 'money');
  }

  if (success) {
    c.cash += ct.payment;
    c.stats.contractsCompleted += 1;
    for (const [fid, delta] of Object.entries(ct.repSuccess)) adjustReputation(c, fid, delta);

    c.sectorCleared[ct.targetSector] = true;
    // Ground changes hands when the job was aimed at whoever was holding it.
    const holder = c.sectorControl[ct.targetSector] ?? null;
    if (ct.against && holder === ct.against) {
      c.sectorControl[ct.targetSector] = ct.employer;
      log(c, `${employer} takes ${where}.`, 'politics');
    } else if (holder === null && (ct.kind === 'clear' || ct.kind === 'defend')) {
      c.sectorControl[ct.targetSector] = ct.employer;
      log(c, `${employer} moves into ${where} behind you.`, 'politics');
    }

    addMaterials(c.materials, takeSalvage(c, ct));
    log(c, `Contract closed at ${where}. ${employer} paid $${ct.payment}.`, 'good');
  } else {
    c.stats.contractsFailed += 1;
    for (const [fid, delta] of Object.entries(ct.repFailure)) adjustReputation(c, fid, delta);
    for (const id of c.squad) {
      const m = findMerc(c, id);
      if (m) m.morale = clamp(m.morale - 8, 0, 100);
    }
    log(c, `The ${employer} job at ${where} came apart. No payment.`, 'bad');
  }

  // Every contract is loud, and success is louder than failure.
  tickHordeClock(c, (success ? 7 : 4) + ct.threat * 2);

  c.contracts = c.contracts.filter((x) => x.id !== ct.id);
  if (c.activeContractId === ct.id) c.activeContractId = null;
  checkFailState(c, 'bankrupt');
  return OK;
}

/**
 * What the squad picks up off the ground: materials returned, and any cash taken off bodies
 * credited directly (only human enemies carry money — the dead carry nothing worth taking).
 */
function takeSalvage(c: CampaignState, ct: Contract): Materials {
  const sector = sectorById(ct.targetSector);
  if (!sector) return {};
  const out: Materials = {};
  for (const [k, w] of Object.entries(sector.scavengeTable) as [MaterialId, number | undefined][]) {
    if (!w) continue;
    out[k] = withRng(c, (rng) => rng.int(1, w + 1));
  }
  if (ct.against) {
    const purse = withRng(c, (rng) => rng.int(30, 90)) * ct.threat;
    c.cash += purse;
    log(c, `Stripped the field for $${purse}.`, 'money');
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── the horde

export function tickHordeClock(c: CampaignState, amount: number): void {
  c.hordeClock = clamp(c.hordeClock + amount, 0, 100);
  if (c.hordeClock >= 100) triggerHordeEvent(c);
}

/**
 * The clock filled. A horde walks one row of the Basin end to end: sectors change hands to
 * nobody, the board of contracts is torn up, and the company pays for barricades it will
 * abandon in a week. Everyone loses, which is the point of a pressure meter.
 */
export function triggerHordeEvent(c: CampaignState): void {
  const row = withRng(c, (rng) => rng.int(0, MAP_H - 1));
  const overrun: string[] = [];

  for (const s of SECTORS) {
    if (s.y !== row) continue;
    c.sectorCleared[s.id] = false;
    const holder = c.sectorControl[s.id] ?? null;
    if (holder === null) continue;
    if (withRng(c, (rng) => rng.chance(0.45))) {
      c.sectorControl[s.id] = null;
      overrun.push(`${s.name} (${FACTIONS[holder]?.name ?? holder})`);
    }
  }

  const bill = Math.min(c.cash, 300);
  c.cash -= bill;
  for (const m of c.roster) m.morale = clamp(m.morale - 8, 0, 100);
  // Nobody is hiring the day after. The board is torn up except for work already signed.
  c.contracts = c.contracts.filter((ct) => ct.id === c.activeContractId);
  c.hordeClock = 12;

  log(c, `A horde sweeps row ${row + 1} of the Basin.`, 'bad');
  if (overrun.length > 0) log(c, `Overrun: ${overrun.join(', ')}.`, 'bad');
  log(c, `Barricades and ammunition cost the company $${bill}.`, 'money');
  checkFailState(c, 'bankrupt');
}

// ─────────────────────────────────────────────────────────────── field resolution

/**
 * Rough odds the deployed squad closes this contract. Pure — the UI shows it as a threat
 * assessment before you sign, and `resolveContractOffline` rolls against it.
 */
export function estimateSuccessChance(c: CampaignState, ct: Contract): number {
  let power = 0;
  for (const id of c.squad) {
    const m = findMerc(c, id);
    if (!m) continue;
    const a = m.attrs;
    const core = (a.marksmanship + a.agility + a.strength + a.vitality) / 8;
    const cap = maxHpFor(m.attrs, m.level, mercMods(m));
    const condition = clamp(m.hp / Math.max(1, cap), 0.3, 1) * (0.6 + m.morale / 250);
    power += (m.level * 0.5 + core) * condition;
  }
  const opposition = ct.threat + (ct.against ? 0.7 : 0);
  if (power <= 0) return 0;
  // Floor of 0.2 because a competent merc can salvage almost anything; ceiling of 0.92
  // because the Basin always gets a vote. Squad size is the dominant term by design.
  return clamp(0.2 + 0.72 * (power / (power + opposition)), 0.1, 0.92);
}

/**
 * Auto-resolve. Stands in for the tactical layer so the strategy loop can be played, tested
 * and balanced on its own; when a battle is actually fought, call `completeContract`
 * directly with the real outcome instead.
 */
export function resolveContractOffline(c: CampaignState, contractId: string): ActionResult {
  const ct = findContract(c, contractId);
  if (!ct) return FAIL('no such contract');
  if (c.activeContractId !== ct.id) return FAIL('that contract is not running');
  if (c.squad.length === 0) return FAIL('nobody is deployed');

  const chance = estimateSuccessChance(c, ct);
  advanceTime(c, CONTRACT_HOURS);
  if (c.gameOver !== 'none') return FAIL('the company is finished');

  const success = withRng(c, (rng) => rng.chance(chance));
  const casualties = c.squad.slice();

  for (const id of casualties) {
    const m = findMerc(c, id);
    if (!m) continue;
    const wound = Math.round(withRng(c, (rng) => rng.int(2, 7)) * ct.threat * (success ? 1 : 1.8));
    m.hp = Math.max(1, m.hp - wound);
    m.morale = clamp(m.morale + (success ? 6 : -4), 0, 100);
    m.missions += 1;
    if (m.weapon) m.weapon.condition = clamp(m.weapon.condition - ct.threat * 2, 0, 100);
    // Losing badly gets people killed. Winning rarely does. Deaths are permanent, so these
    // stay low — a bad run should cost you a merc every few contracts, not every contract.
    const deathOdds = (success ? 0.003 : 0.015) * ct.threat;
    if (withRng(c, (rng) => rng.chance(deathOdds))) mercDied(c, id);
  }

  if (c.gameOver !== 'none') return OK;
  return completeContract(c, ct.id, success);
}
