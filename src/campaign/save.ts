/**
 * Save and load.
 *
 * `CampaignState` is deliberately plain JSON-shaped data, so the save format is the state
 * plus a version stamp. `deserialize` never throws: a truncated file, a save from an older
 * build, or a string that was never a save at all all come back as `null`, and the caller
 * shows "could not read that save" instead of a stack trace.
 */
import type { CampaignState } from './types';

export const SAVE_VERSION = 1;

interface SaveFile {
  v: number;
  state: CampaignState;
}

export function serialize(c: CampaignState): string {
  const file: SaveFile = { v: SAVE_VERSION, state: c };
  return JSON.stringify(file);
}

/** Returns null for anything that is not a save of the current version. Never throws. */
export function deserialize(s: string): CampaignState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed['v'] !== SAVE_VERSION) return null;
  const state = parsed['state'];
  if (!isCampaignState(state)) return null;
  return state;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Structural check over the fields the rest of the campaign assumes exist. This is a guard
 * against old and corrupt saves, not a schema validator — a save that passes this and is
 * still internally nonsense is a bug we would rather see than silently paper over.
 */
function isCampaignState(v: unknown): v is CampaignState {
  if (!isRecord(v)) return false;

  const numbers = ['seed', 'rngState', 'day', 'hour', 'cash', 'hordeClock', 'nextId'];
  for (const k of numbers) {
    if (typeof v[k] !== 'number' || !Number.isFinite(v[k])) return false;
  }

  const records = ['reputation', 'sectorControl', 'sectorCleared', 'unpaidDays', 'materials'];
  for (const k of records) {
    if (!isRecord(v[k])) return false;
  }

  const arrays = ['roster', 'available', 'knownRecipes', 'craftJobs', 'contracts', 'squad', 'log'];
  for (const k of arrays) {
    if (!Array.isArray(v[k])) return false;
  }

  if (typeof v['location'] !== 'string') return false;
  if (v['activeContractId'] !== null && typeof v['activeContractId'] !== 'string') return false;

  const stash = v['stash'];
  if (!isRecord(stash)) return false;
  if (!Array.isArray(stash['weapons']) || !Array.isArray(stash['attachments'])) return false;
  if (!isRecord(stash['consumables'])) return false;

  const stats = v['stats'];
  if (!isRecord(stats)) return false;
  for (const k of ['contractsOffered', 'contractsCompleted', 'contractsFailed']) {
    if (typeof stats[k] !== 'number') return false;
  }

  const over = v['gameOver'];
  if (over !== 'none' && over !== 'bankrupt' && over !== 'wiped' && over !== 'victory') return false;

  return true;
}
