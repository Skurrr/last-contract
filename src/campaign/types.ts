/**
 * The grand-strategy state model.
 *
 * `CampaignState` is a plain value: no class instances, no functions, no Maps — everything
 * here survives `JSON.stringify` unchanged, which is what makes `save.ts` a one-liner and
 * makes two campaigns from the same seed comparable byte-for-byte.
 *
 * Randomness discipline: the campaign carries `rngState`, never an `Rng` object. Every
 * random decision goes through `withRng`, which restores the stream, runs the roll, and
 * writes the advanced state back. Nothing in `src/campaign` calls `Math.random`.
 */
import type { ContractKind } from '@/data/factions';
import { ALLIANCE_THRESHOLD, WAR_THRESHOLD } from '@/data/factions';
import { Rng } from '@/core/rng';
import type { MercState } from '@/sim/spawn';
import type { Materials, MaterialId, WeaponInstance } from '@/sim/types';

// ─────────────────────────────────────────────────────────────── contracts

/** A job on the board. Generated from faction state — see `contracts.ts`. */
export interface Contract {
  id: string;
  kind: ContractKind;
  /** Faction id paying the bill. */
  employer: string;
  /** Sector id the work happens in. */
  targetSector: string;
  /** Faction id this job is aimed at, or null when the only enemy is the dead. */
  against: string | null;
  payment: number;
  /** Campaign day the job is void after. */
  deadlineDay: number;
  /** Written in the employer's voice. Shown on the contract card. */
  description: string;
  /** One line of what "done" means, for the briefing panel. */
  objectives: string;
  /** 1..5, inherited from the sector and nudged by who is defending it. */
  threat: number;
  /** faction id -> reputation delta applied on success. */
  repSuccess: Record<string, number>;
  /** faction id -> reputation delta applied on failure (or on missing the deadline). */
  repFailure: Record<string, number>;
}

export type LogTone = 'info' | 'good' | 'bad' | 'money' | 'politics';

export interface CampaignLogEntry {
  day: number;
  hour: number;
  text: string;
  tone: LogTone;
}

/** A merc occupied at the workbench. Ticked once per dawn. */
export type CraftJob =
  | { id: string; kind: 'recipe'; recipeId: string; mercId: string; daysLeft: number }
  | { id: string; kind: 'improvised'; mercId: string; daysLeft: number; spent: Materials };

export type FactionStance = 'war' | 'hostile' | 'neutral' | 'friendly' | 'allied';

export type GameOver = 'none' | 'bankrupt' | 'wiped' | 'victory';

// ─────────────────────────────────────────────────────────────── the state

export interface CampaignState {
  seed: number;
  rngState: number;

  /** Time advances in hours; the day rolls over at hour 24 and dawn resolves. */
  day: number;
  hour: number;

  cash: number;
  /** faction id -> -100..100. */
  reputation: Record<string, number>;
  /** sector id -> faction id, or null for contested ground. */
  sectorControl: Record<string, string | null>;
  sectorCleared: Record<string, boolean>;

  roster: MercState[];
  /** MercDef ids currently on the hire board. */
  available: string[];
  /** Consecutive dawns a merc has gone unpaid. Two and they walk. */
  unpaidDays: Record<string, number>;

  materials: Materials;
  stash: { weapons: WeaponInstance[]; attachments: string[]; consumables: Record<string, number> };
  knownRecipes: string[];
  craftJobs: CraftJob[];

  contracts: Contract[];
  activeContractId: string | null;

  /** 0..100. Loud work raises it; when it fills a horde sweeps a row of the map. */
  hordeClock: number;

  /** Sector id the company is standing in. */
  location: string;
  /** Merc ids deployed on the next battle. Max `SQUAD_MAX`. */
  squad: string[];

  log: CampaignLogEntry[];
  gameOver: GameOver;

  /** Monotonic counters, so ids are a function of the campaign and not of process order. */
  nextId: number;
  /** Running totals for the after-campaign summary. */
  stats: { contractsOffered: number; contractsCompleted: number; contractsFailed: number };
}

export const SQUAD_MAX = 6;

/** Every player-facing campaign action returns one of these — refusals carry a reason. */
export type ActionResult = { ok: true } | { ok: false; reason: string };

export const FAIL = (reason: string): ActionResult => ({ ok: false, reason });
export const OK: ActionResult = { ok: true };

// ─────────────────────────────────────────────────────────────── shared helpers

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The one place randomness enters the strategy layer. Restores the stream from the state,
 * runs `fn`, writes the advanced state back.
 */
export function withRng<T>(c: Pick<CampaignState, 'rngState'>, fn: (rng: Rng) => T): T {
  const rng = Rng.restore(c.rngState);
  const out = fn(rng);
  c.rngState = rng.state;
  return out;
}

/** Sequential, campaign-scoped id. Never uses a module-level counter — that would desync. */
export function nextId(c: Pick<CampaignState, 'nextId'>, prefix: string): string {
  c.nextId += 1;
  return `${prefix}${c.nextId}`;
}

export function stanceFromRep(rep: number): FactionStance {
  if (rep >= ALLIANCE_THRESHOLD) return 'allied';
  if (rep <= WAR_THRESHOLD) return 'war';
  if (rep >= 25) return 'friendly';
  if (rep <= -25) return 'hostile';
  return 'neutral';
}

// ─────────────────────────────────────────────────────────────── material bags

export function addMaterials(into: Materials, add: Materials): void {
  for (const [k, v] of Object.entries(add) as [MaterialId, number | undefined][]) {
    if (v === undefined || v === 0) continue;
    const total = (into[k] ?? 0) + v;
    if (total <= 0) delete into[k];
    else into[k] = total;
  }
}

export function hasMaterials(have: Materials, cost: Materials): boolean {
  for (const [k, v] of Object.entries(cost) as [MaterialId, number | undefined][]) {
    if ((have[k] ?? 0) < (v ?? 0)) return false;
  }
  return true;
}

/** Deducts `cost` if it is all there. Returns false and changes nothing otherwise. */
export function takeMaterials(have: Materials, cost: Materials): boolean {
  if (!hasMaterials(have, cost)) return false;
  for (const [k, v] of Object.entries(cost) as [MaterialId, number | undefined][]) {
    if (v === undefined || v === 0) continue;
    const left = (have[k] ?? 0) - v;
    if (left <= 0) delete have[k];
    else have[k] = left;
  }
  return true;
}
