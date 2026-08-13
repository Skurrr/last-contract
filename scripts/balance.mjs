/**
 * Headless balance harness.
 *
 * Runs a large number of complete battles with the AI driving both sides and reports the
 * distributions that decide whether the game is fair: win rate by threat level, turns to
 * resolve, time-to-kill, merc casualties, ammunition burn, and which weapons and enemies
 * actually pull their weight.
 *
 * This exists because balance is a property of thousands of fights, not of the one you just
 * watched. Run with:  npx tsx scripts/balance.mjs [battlesPerThreat]
 */
import { deploy } from '../src/game/deploy.ts';
import { advancePhase, checkOutcome } from '../src/sim/battle.ts';
import { takeAiAction } from '../src/sim/ai.ts';
import { EventSink } from '../src/sim/events.ts';
import { createMercState } from '../src/sim/spawn.ts';
import { SECTORS } from '../src/data/sectors.ts';
import { MERCS } from '../src/data/mercs.ts';
import { activeWeapon } from '../src/sim/combat.ts';

const PER_THREAT = Number(process.argv[2] ?? 40);
const MAX_TURNS = 60;
const SQUAD = ['nine', 'maggie', 'vy', 'steroid', 'twitch', 'chainlink'];

/** Play one battle to completion with the AI acting for the player squad too. */
function runBattle(seed, sector) {
  const squad = SQUAD.map((id) => createMercState(id));
  const dep = deploy({ seed, sector, squad, opposition: sector.owner ?? null });
  const b = dep.battle;

  const stats = {
    turns: 0,
    // Rounds, not trigger pulls: one burst emits a single 'shot' event but a hit or miss
    // event per round, so accuracy must be measured against hits + misses.
    rounds: 0,
    hits: 0,
    damage: 0,
    killsByPlayer: 0,
    mercDeaths: 0,
    mercDowns: 0,
    startingHostiles: b.units.filter((u) => u.team !== 'player').length,
  };

  const sink = new EventSink();

  while (b.outcome === 'ongoing' && b.turn <= MAX_TURNS) {
    for (const u of b.units.filter((x) => x.alive && !x.critical && x.team === b.phase)) {
      let guard = 0;
      while (u.alive && !u.critical && u.ap > 0 && guard++ < 12) {
        if (!takeAiAction(b, u, sink)) break;
      }
    }

    for (const e of sink.drain()) {
      if (e.t === 'hit') {
        stats.hits += 1;
        stats.rounds += 1;
        stats.damage += e.damage;
      } else if (e.t === 'miss') {
        stats.rounds += 1;
      } else if (e.t === 'kill') {
        const victim = b.units.find((u) => u.id === e.unitId);
        if (victim?.team === 'player') stats.mercDeaths += 1;
        else stats.killsByPlayer += 1;
      } else if (e.t === 'critical') stats.mercDowns += 1;
    }

    checkOutcome(b, sink);
    if (b.outcome !== 'ongoing') break;
    advancePhase(b, sink);
    stats.turns = b.turn;
  }

  stats.outcome = b.outcome === 'ongoing' ? 'timeout' : b.outcome;
  stats.ammoLeft = dep.squad
    .filter((u) => u.alive)
    .reduce((n, u) => n + (activeWeapon(u)?.inst.loaded ?? 0), 0);
  stats.squadHpFrac =
    dep.squad.reduce((n, u) => n + (u.alive ? u.hp / u.maxHp : 0), 0) / dep.squad.length;
  return stats;
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

console.log(`Running ${PER_THREAT} battles per threat level (1-5)...\n`);

const rows = [];
let totalTimeouts = 0;

for (let threat = 1; threat <= 5; threat++) {
  const pool = SECTORS.filter((s) => s.threat === threat);
  if (pool.length === 0) continue;

  const runs = [];
  for (let i = 0; i < PER_THREAT; i++) {
    const sector = pool[i % pool.length];
    runs.push(runBattle(1000 + threat * 7919 + i * 104729, sector));
  }

  const wins = runs.filter((r) => r.outcome === 'victory').length;
  const timeouts = runs.filter((r) => r.outcome === 'timeout').length;
  totalTimeouts += timeouts;

  rows.push({
    threat,
    winRate: wins / runs.length,
    timeoutRate: timeouts / runs.length,
    turns: median(runs.map((r) => r.turns)),
    accuracy: mean(runs.map((r) => (r.rounds ? r.hits / r.rounds : 0))),
    dmgPerHit: mean(runs.map((r) => (r.hits ? r.damage / r.hits : 0))),
    kills: mean(runs.map((r) => r.killsByPlayer)),
    hostiles: mean(runs.map((r) => r.startingHostiles)),
    deaths: mean(runs.map((r) => r.mercDeaths)),
    downs: mean(runs.map((r) => r.mercDowns)),
    hpLeft: mean(runs.map((r) => r.squadHpFrac)),
  });
}

console.log(
  'threat | win    | timeout | turns | acc    | dmg/hit | kills/hostiles | deaths | downs | squad HP',
);
console.log('-'.repeat(96));
for (const r of rows) {
  console.log(
    `   ${r.threat}   | ${pct(r.winRate).padStart(6)} | ${pct(r.timeoutRate).padStart(7)} | ` +
      `${String(r.turns).padStart(5)} | ${pct(r.accuracy).padStart(6)} | ` +
      `${r.dmgPerHit.toFixed(1).padStart(7)} | ` +
      `${`${r.kills.toFixed(1)}/${r.hostiles.toFixed(1)}`.padStart(14)} | ` +
      `${r.deaths.toFixed(2).padStart(6)} | ${r.downs.toFixed(2).padStart(5)} | ${pct(r.hpLeft)}`,
  );
}

// ── the judgement, stated explicitly rather than left to the reader ──
console.log('\n=== VERDICT ===');
const problems = [];

const t1 = rows.find((r) => r.threat === 1);
const t5 = rows.find((r) => r.threat === 5);
if (t1 && t1.winRate < 0.75) problems.push(`Threat 1 win rate ${pct(t1.winRate)} — the tutorial tier is too punishing.`);
if (t5 && t5.winRate > 0.75) problems.push(`Threat 5 win rate ${pct(t5.winRate)} — the hardest tier is not hard.`);
if (t5 && t5.winRate < 0.15) problems.push(`Threat 5 win rate ${pct(t5.winRate)} — the hardest tier is unwinnable.`);

for (let i = 1; i < rows.length; i++) {
  if (rows[i].winRate > rows[i - 1].winRate + 0.1) {
    problems.push(`Threat ${rows[i].threat} is EASIER than threat ${rows[i - 1].threat} — the curve is not monotonic.`);
  }
}
if (totalTimeouts / (PER_THREAT * rows.length) > 0.15) {
  problems.push(`${pct(totalTimeouts / (PER_THREAT * rows.length))} of battles hit the ${MAX_TURNS}-turn cap — fights drag.`);
}
for (const r of rows) {
  if (r.accuracy < 0.2) problems.push(`Threat ${r.threat} accuracy ${pct(r.accuracy)} — shooting feels like a coin flip.`);
  if (r.accuracy > 0.85) problems.push(`Threat ${r.threat} accuracy ${pct(r.accuracy)} — cover and range are not mattering.`);
  if (r.turns < 4) problems.push(`Threat ${r.threat} resolves in ${r.turns} turns — no room for tactics.`);
}

if (problems.length === 0) {
  console.log('No balance problems detected.');
} else {
  for (const p of problems) console.log(`  ! ${p}`);
}
console.log(`\nRoster: ${SQUAD.map((id) => MERCS[id]?.callsign ?? id).join(', ')}`);
process.exit(0);
