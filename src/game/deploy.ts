/**
 * Turning a contract into a battle: generate the ground, populate it with the squad, the
 * garrison, and the dead, and hand back something the controller can drive.
 *
 * Enemy composition is derived from the sector's threat level and the employer's opposition,
 * so a threat-5 Rust Kings sector genuinely fields more and better than a threat-1 farm.
 */
import { Rng } from '@/core/rng';
import type { Vec2 } from '@/core/grid';
import { ORDNANCE, throwsAs } from '@/data/consumables';
import { ENEMIES, ZOMBIE_IDS } from '@/data/enemies';
import { FACTIONS } from '@/data/factions';
import { SECTORS, type SectorBiome, type SectorDef } from '@/data/sectors';
import { startBattle } from '@/sim/battle';
import { generateMap } from '@/sim/mapgen';
import { spawnEnemy, spawnMerc, type MercState } from '@/sim/spawn';
import type { BattleState, Objective, Unit } from '@/sim/types';

export interface DeployOptions {
  seed: number;
  sector: SectorDef;
  /** Mercs to deploy, already in campaign state. Capped at the number of spawn points. */
  squad: MercState[];
  /** Faction whose fighters garrison this battle, or null for a purely undead map. */
  opposition?: string | null;
  /** Extra pressure from the campaign's horde clock, 0..1. */
  hordePressure?: number;
  /**
   * Consumables the company actually holds, by id. Ordnance is drawn from here first so a
   * player who buys grenades deploys with them; mutated in place so the caller knows what
   * left the stash.
   */
  supplies?: Record<string, number>;
  objectives?: Objective[];
  light?: number;
}

export interface Deployment {
  battle: BattleState;
  squad: Unit[];
  sector: SectorDef;
}

/** How many hostiles a sector of each threat level fields, before horde pressure. */
const THREAT_TABLE: Record<number, { humans: number; zombies: number }> = {
  1: { humans: 0, zombies: 4 },
  2: { humans: 2, zombies: 6 },
  3: { humans: 4, zombies: 8 },
  4: { humans: 6, zombies: 10 },
  5: { humans: 8, zombies: 13 },
};

/**
 * Zombie mix by threat. Low-threat sectors are shamblers you can walk away from; high-threat
 * ones hold the variants that punish noise.
 */
function zombieMix(rng: Rng, threat: number): string {
  const pool: (readonly [string, number])[] = [
    ['shambler', 10],
    ['crawler', 2 + threat * 0.4],
    ['runner', threat * 1.4],
    ['screamer', threat * 0.5],
    ['bloater', threat * 0.6],
    ['armoured', Math.max(0, (threat - 2) * 0.9)],
  ];
  const valid = pool.filter(([id]) => ZOMBIE_IDS.includes(id) && ENEMIES[id]);
  return valid.length > 0 ? rng.weighted(valid) : 'shambler';
}

/** Pick a human from the opposing faction's roster, weighted toward its rank and file. */
function humanFrom(rng: Rng, factionId: string, threat: number): string | null {
  const roster = FACTIONS[factionId]?.enemyRoster ?? [];
  const valid = roster.filter((id) => ENEMIES[id]);
  if (valid.length === 0) return null;
  // Elites become more common as threat rises; xp cost stands in for "how elite".
  const weighted = valid.map((id) => {
    const xp = ENEMIES[id]?.xp ?? 10;
    const eliteness = xp / 30;
    return [id, Math.max(0.2, 1 + (threat - 3) * eliteness)] as const;
  });
  return rng.weighted(weighted);
}

export function deploy(opts: DeployOptions): Deployment {
  const rng = new Rng(opts.seed);
  const threat = Math.max(1, Math.min(5, opts.sector.threat));
  const pressure = opts.hordePressure ?? 0;

  const gen = generateMap({
    seed: opts.seed,
    biome: opts.sector.terrain,
    ...(opts.light !== undefined ? { light: opts.light } : {}),
  });
  const b = gen.battle;

  if (opts.objectives) b.objectives = opts.objectives;

  // ── the squad ────────────────────────────────────────────────
  const squad: Unit[] = [];
  const spawns = gen.playerSpawns;
  opts.squad.slice(0, spawns.length).forEach((state, i) => {
    const pos = spawns[i] ?? spawns[0]!;
    const u = spawnMerc(state, pos);
    issueThrowables(u, opts.supplies);
    b.units.push(u);
    squad.push(u);
  });

  // ── the opposition ───────────────────────────────────────────
  const counts = THREAT_TABLE[threat] ?? THREAT_TABLE[3]!;
  const humanCount = opts.opposition ? counts.humans : 0;
  // The horde clock adds pressure to the dead, not to the living.
  const zombieCount = Math.round(counts.zombies * (1 + pressure * 0.8));

  const enemySpawns = shuffled(rng, gen.enemySpawns);
  for (let i = 0; i < humanCount && i < enemySpawns.length; i++) {
    const id = opts.opposition ? humanFrom(rng, opts.opposition, threat) : null;
    if (!id) break;
    b.units.push(spawnEnemy(id, enemySpawns[i]!, rng.int(1, 1e9)));
  }

  const zombieSpawns = shuffled(rng, gen.zombieSpawns);
  for (let i = 0; i < zombieCount && i < zombieSpawns.length; i++) {
    b.units.push(spawnEnemy(zombieMix(rng, threat), zombieSpawns[i]!, rng.int(1, 1e9)));
  }

  // ── loot on the ground ───────────────────────────────────────
  for (const spot of gen.lootSpots.slice(0, 3 + threat)) {
    b.loot.push({
      pos: spot,
      weapons: [],
      attachments: [],
      materials: { scrap: rng.int(1, 3), tape: rng.int(0, 2) },
      cash: rng.int(20, 60) * threat,
    });
  }

  b.rngState = rng.state;
  startBattle(b);
  return { battle: b, squad, sector: opts.sector };
}

/** Consumable ids the company can issue as ordnance, best first. */
const ORDNANCE_PRIORITY: string[] = ORDNANCE.map((c) => c.id);

/**
 * Field issue of thrown ordnance.
 *
 * Anything the company has bought is handed out first, best to the merc most able to use it —
 * otherwise grenades sit in the stash forever and buying them does nothing. On top of that
 * every merc gets a standard issue scaled to their explosives skill, so Bricks deploys with a
 * bag of charges and Sister Maggie deploys with a smoke pot she would rather not use.
 *
 * A noisemaker always goes to everyone: it is the counterplay to the noise system, and a
 * player who never finds one never learns the system exists.
 */
function issueThrowables(u: Unit, supplies?: Record<string, number>): void {
  const skill = u.attrs.explosives;

  // Draw from the stash: a demolitions merc takes up to three, everyone else up to one.
  let allowance = skill >= 8 ? 3 : skill >= 5 ? 2 : 1;
  if (supplies) {
    for (const id of ORDNANCE_PRIORITY) {
      const weaponId = throwsAs(id);
      if (!weaponId) continue;
      while (allowance > 0 && (supplies[id] ?? 0) > 0) {
        supplies[id] = (supplies[id] ?? 0) - 1;
        // The shop sells a 'noisemaker'; a merc carries a 'chattercan'. This is the
        // translation that used to be missing, which is why bought ordnance never deployed.
        u.inventory.push(weaponId);
        allowance--;
      }
    }
  }

  const kit: string[] = ['chattercan'];
  if (skill >= 8) kit.push('frag', 'pipebomb', 'molotov');
  else if (skill >= 5) kit.push('frag', 'molotov');
  else if (skill >= 3) kit.push('molotov');
  else kit.push('smoke');
  u.inventory.push(...kit);
}

function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  return rng.shuffle([...arr]);
}

/** A quick skirmish for the main menu's "Skirmish" option and for manual testing. */
export function skirmish(seed: number, squad: MercState[], biome?: SectorBiome): Deployment {
  const rng = new Rng(seed);
  const sector = biome
    ? (SECTORS.find((s) => s.terrain === biome) ?? SECTORS[0]!)
    : rng.pick(SECTORS);
  return deploy({
    seed,
    sector,
    squad,
    opposition: sector.owner ?? null,
    objectives: [
      { kind: 'eliminate', label: 'Clear all hostiles', done: false, failed: false },
    ],
  });
}
