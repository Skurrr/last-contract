import { deploy } from '@/game/deploy';
import { advancePhase, checkOutcome } from '@/sim/battle';
import { takeAiAction } from '@/sim/ai';
import { EventSink } from '@/sim/events';
import { createMercState, senseRadiusOf } from '@/sim/spawn';
import { SECTORS } from '@/data/sectors';
import { sightRange, traceSight, noiseAt, coverAgainst } from '@/sim/field';
import { activeWeapon, hasStatus, estimateShot } from '@/sim/combat';
import { chebyshev } from '@/core/grid';
import type { BattleState, Unit } from '@/sim/types';

const SQUAD = ['nine', 'maggie', 'vy', 'steroid', 'twitch', 'chainlink'];
const MAX_TURNS = 60;

function run(seed: number, sector: any): { b: BattleState; outcome: string } {
  const squad = SQUAD.map((id) => createMercState(id));
  const dep = deploy({ seed, sector, squad, opposition: sector.owner ?? null });
  const b = dep.battle;
  const sink = new EventSink();
  while (b.outcome === 'ongoing' && b.turn <= MAX_TURNS) {
    for (const u of b.units.filter((x) => x.alive && !x.critical && x.team === b.phase)) {
      let g = 0;
      while (u.alive && !u.critical && u.ap > 0 && g++ < 12) if (!takeAiAction(b, u, sink)) break;
    }
    sink.drain();
    checkOutcome(b, sink);
    if (b.outcome !== 'ongoing') break;
    advancePhase(b, sink);
  }
  return { b, outcome: b.outcome === 'ongoing' ? 'timeout' : b.outcome };
}

function describe(b: BattleState, u: Unit): string {
  const w = activeWeapon(u);
  const sight = sightRange(b, u);
  const hostiles = b.units.filter((t) => t.alive && !t.critical && (t.team === 'player' ? u.team !== 'player' : u.team === 'player'));
  const visible = hostiles.filter((t) => chebyshev(u.pos, t.pos) <= sight && traceSight(b, u.pos, t.pos).clear);
  const near = hostiles.map((t) => chebyshev(u.pos, t.pos)).sort((a, c) => a - c)[0] ?? -1;
  const side = b.units.filter((t) => t.team === u.team);
  const down = side.filter((t) => !t.alive || t.critical).length;
  const best = visible.length ? Math.max(...visible.map((t) => estimateShot(b, u, t).chance)) : 0;
  return `${u.team.padEnd(6)} ${u.defId.padEnd(16)} pos ${String(u.pos.x).padStart(2)},${String(u.pos.y).padStart(2)} ap${u.ap}/${u.maxAp} ${u.stance.padEnd(8)} ` +
    `morale${String(u.morale).padStart(3)} side ${down}/${side.length} down | sight${sight} sense${senseRadiusOf(u)} minDist${String(near).padStart(2)} vis${visible.length} bestChance${best.toFixed(2)} ` +
    `| target=${u.target ? `${u.target.x},${u.target.y}` : 'none'} loaded=${w?.inst.loaded ?? '-'} ow=${hasStatus(u, 'overwatch')} noiseHere=${noiseAt(b, u.pos.x, u.pos.y).toFixed(3)} cover=${u.team !== 'player' ? '' : ''}`;
}

let found = 0;
for (let threat = 1; threat <= 5 && found < 4; threat++) {
  const pool = SECTORS.filter((s) => s.threat === threat);
  for (let i = 0; i < 25 && found < 4; i++) {
    const sector = pool[i % pool.length];
    const { b, outcome } = run(1000 + threat * 7919 + i * 104729, sector);
    if (outcome !== 'timeout') continue;
    found++;
    console.log(`\n=== STALL threat ${threat} #${i} sector ${sector.id} turn ${b.turn} map ${b.w}x${b.h} ===`);
    for (const u of b.units.filter((x) => x.alive && !x.critical)) console.log('  ' + describe(b, u));
  }
}
console.log('\nstalls dumped:', found);
