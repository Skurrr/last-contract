/* THROWAWAY harness: synthetic battles, 20 AI turns, determinism + liveness checks. */
import { createBattle, startBattle, advancePhase, livingUnits } from '@/sim/battle';
import { setTerrain, emitNoise } from '@/sim/field';
import { spawnEnemy, spawnMerc, createMercState, makeWeapon, resetUidCounter } from '@/sim/spawn';
import { EventSink } from '@/sim/events';
import { runAiTurn, takeAiAction, bloaterDeathExplosion } from '@/sim/ai';
import { chebyshev } from '@/core/grid';
import type { BattleState, Unit } from '@/sim/types';

const problems: string[] = [];
const note = (s: string): void => { problems.push(s); };

function build(seed: number): BattleState {
  resetUidCounter();
  const b = createBattle({ seed, w: 32, h: 24, light: 1 });

  for (let y = 4; y < 20; y++) if (y !== 12) setTerrain(b, 16, y, 'wall');
  for (const [x, y] of [[10, 8], [11, 14], [20, 9], [21, 15], [8, 12], [24, 12]] as const) {
    setTerrain(b, x, y, 'sandbag');
  }
  setTerrain(b, 13, 6, 'crate');
  setTerrain(b, 19, 18, 'car');

  const m1 = spawnMerc(createMercState('nine'), { x: 4, y: 10 });
  const m2 = spawnMerc(createMercState('hoyt'), { x: 4, y: 14 });
  b.units.push(m1, m2);

  // enemies.ts still names weapon ids weapons.ts does not have, so re-equip with real guns.
  const guns = ['kalash7', 'homesteader', 'longshot', 'chatterbox'];
  const spots = [[26, 6], [27, 12], [25, 17], [22, 4]] as const;
  const defs = ['raider', 'militia', 'remnant_marksman', 'remnant_trooper'];
  defs.forEach((d, i) => {
    const u = spawnEnemy(d, { x: spots[i]![0], y: spots[i]![1] }, seed + i);
    u.weapon = makeWeapon(guns[i]!);
    b.units.push(u);
  });
  const cult = spawnEnemy('cultist', { x: 24, y: 20 }, seed + 9);
  cult.weapon = makeWeapon('machete');
  b.units.push(cult);

  const zeds: [string, number, number][] = [
    ['shambler', 12, 3], ['runner', 14, 21], ['bloater', 6, 3],
    ['armoured', 29, 21], ['screamer', 12, 19], ['crawler', 7, 20],
  ];
  for (const [id, x, y] of zeds) b.units.push(spawnEnemy(id, { x, y }, seed + x + y));

  startBattle(b);
  return b;
}

function run(seed: number, verbose: boolean): string {
  const b = build(seed);
  let events = 0;
  emitNoise(b, { x: 6, y: 12 }, 22); // an opening gunshot for the dead to chase

  for (let i = 0; i < 20; i++) {
    const sink = new EventSink();
    const phase = b.phase;
    const before = new Map(b.units.map((u) => [u.id, { ...u.pos }]));
    const t0 = Date.now();
    runAiTurn(b, sink);
    const ms = Date.now() - t0;
    if (ms > 750) note(`SLOW ${phase} t${b.turn}: ${ms}ms`);
    events += sink.events.length;

    const stuck = b.units.filter((u) => u.alive && !u.critical && u.team === phase && u.ap > 0);
    if (stuck.length > 0) note(`AP LEFT ${phase} t${b.turn}: ${stuck.map((u) => `${u.name}:${u.ap}`).join()}`);

    if (verbose) {
      const moved = b.units
        .filter((u) => u.alive && u.team === phase)
        .map((u) => `${u.name.split(' ')[0]}${chebyshev(before.get(u.id) ?? u.pos, u.pos)}`)
        .join(' ');
      console.log(
        `t${b.turn} ${phase.padEnd(6)} ev=${String(sink.events.length).padStart(3)} ` +
        `P${livingUnits(b, 'player').length} E${livingUnits(b, 'enemy').length} Z${livingUnits(b, 'zombie').length}  moved: ${moved}`,
      );
    }
    if (b.outcome !== 'ongoing') { if (verbose) console.log(`outcome=${b.outcome} t${b.turn}`); break; }
    advancePhase(b, sink);
  }

  for (const u of b.units) {
    if (u.inventory.filter((s) => s === '__screamed').length > 1) note(`SCREAMED TWICE: ${u.name}`);
  }
  return b.units.map((u) => `${u.defId}@${u.pos.x},${u.pos.y},${u.hp},${u.alive ? 1 : 0}`).join('|') +
    `#${b.rngState}#${events}`;
}

console.log('── mixed battle, 20 AI turns');
const a = run(1234, true);
const b2 = run(1234, false);
console.log('deterministic (same seed → same digest):', a === b2);
console.log('seed sensitive:', a !== run(99, false));

// ── zombies alone: noise chasing then wandering
console.log('\n── zombies vs a noise source, no living targets');
{
  resetUidCounter();
  const b = createBattle({ seed: 77, w: 32, h: 24, light: 1 });
  const zeds = ['shambler', 'runner', 'screamer', 'armoured', 'bloater', 'crawler'];
  zeds.forEach((id, i) => b.units.push(spawnEnemy(id, { x: 28, y: 3 + i * 3 }, 500 + i)));
  b.units.push(spawnMerc(createMercState('nine'), { x: 1, y: 12 })); // far away, out of sight
  startBattle(b);
  emitNoise(b, { x: 4, y: 12 }, 26);
  const start = new Map(b.units.map((u) => [u.id, { ...u.pos }]));
  for (let i = 0; i < 20; i++) {
    const sink = new EventSink();
    runAiTurn(b, sink);
    advancePhase(b, sink);
  }
  for (const u of b.units) {
    if (u.kind !== 'zombie') continue;
    const s = start.get(u.id)!;
    console.log(
      `${u.defId.padEnd(9)} ap=${u.maxAp} ${s.x},${s.y} -> ${u.pos.x},${u.pos.y} ` +
      `(distance to noise ${chebyshev(s, { x: 4, y: 12 })} -> ${chebyshev(u.pos, { x: 4, y: 12 })})`,
    );
  }
}

// ── screamer sees a merc: horde call once, then normal behaviour
console.log('\n── screamer horde call');
{
  resetUidCounter();
  const b = createBattle({ seed: 3, w: 24, h: 16, light: 1 });
  const m = spawnMerc(createMercState('nine'), { x: 4, y: 8 });
  b.units.push(m);
  const s = spawnEnemy('screamer', { x: 14, y: 8 }, 11);
  b.units.push(s);
  startBattle(b);
  for (let turn = 0; turn < 3; turn++) {
    const sink = new EventSink();
    advancePhase(b, sink); // -> zombie phase
    const zs = new EventSink();
    runAiTurn(b, zs);
    console.log(`turn ${turn}: ${zs.events.map((e) => e.t).join(',') || '(nothing)'} pos=${s.pos.x},${s.pos.y}`);
  }
}

// ── bloater helper
console.log('\n── bloater death gas');
{
  const b = build(7);
  const bloater = b.units.find((u) => u.defId === 'bloater')!;
  const victim = b.units.find((u) => u.team === 'player')! as Unit;
  victim.pos = { x: bloater.pos.x + 1, y: bloater.pos.y };
  const hp0 = victim.hp;
  const sink = new EventSink();
  bloaterDeathExplosion(b, bloater, sink);
  console.log('damage:', hp0 - victim.hp, 'poisoned:', victim.statuses.some((x) => x.kind === 'poisoned'),
    'events:', sink.events.map((e) => e.t).join(','));
  const zed = b.units.find((u) => u.kind === 'zombie' && u.id !== bloater.id && chebyshev(u.pos, bloater.pos) <= 3);
  console.log('other dead nearby unharmed:', zed ? zed.hp === zed.maxHp : 'n/a');
}

// ── single-unit entry point (how battleController drives it)
console.log('\n── takeAiAction banks leftover AP');
{
  const b = build(42);
  const sink = new EventSink();
  advancePhase(b, sink); // -> enemy phase
  const left: string[] = [];
  for (const u of b.units.filter((x) => x.alive && x.team === b.phase)) {
    takeAiAction(b, u, sink);
    if (u.ap > 0) left.push(`${u.name}:${u.ap}`);
  }
  console.log('units with unspent AP:', left.length === 0 ? 'none' : left.join());
}

console.log('\nPROBLEMS:', problems.length === 0 ? 'none' : '\n' + problems.join('\n'));

// ── screamer, uninterrupted: exactly one call, then it closes and bites
console.log('\n── screamer, unarmed merc');
{
  resetUidCounter();
  const b = createBattle({ seed: 3, w: 24, h: 16, light: 1 });
  const m = spawnMerc(createMercState('nine'), { x: 4, y: 8 });
  m.weapon = null; m.sidearm = null;
  b.units.push(m);
  const s = spawnEnemy('screamer', { x: 14, y: 8 }, 11);
  b.units.push(s);
  startBattle(b);
  let calls = 0;
  for (let turn = 0; turn < 8; turn++) {
    const sink = new EventSink();
    advancePhase(b, sink);
    if (b.phase !== 'zombie') continue;
    const zs = new EventSink();
    runAiTurn(b, zs);
    calls += zs.events.filter((e) => e.t === 'noise' && e.radius === 30).length;
    console.log(`zombie phase: ${zs.events.map((e) => e.t).join(',') || '(nothing)'} pos=${s.pos.x},${s.pos.y} mercHp=${m.hp}`);
  }
  console.log('horde calls:', calls, calls === 1 ? 'OK' : 'BAD');
}

// ── human action mix + morale break
console.log('\n── human action mix over 12 enemy phases');
{
  const b = build(2024);
  const counts: Record<string, number> = {};
  for (let i = 0; i < 24; i++) {
    const sink = new EventSink();
    if (b.phase === 'enemy') {
      runAiTurn(b, sink);
      for (const e of sink.events) { const k = e.t === 'status' ? `status:${e.kind}` : e.t; counts[k] = (counts[k] ?? 0) + 1; }
    } else if (b.phase !== 'player') {
      runAiTurn(b, sink);
    } else {
      for (const u of b.units.filter((x) => x.alive && !x.critical && x.team === 'player')) takeAiAction(b, u, sink);
    }
    if (b.outcome !== 'ongoing') break;
    advancePhase(b, sink);
  }
  console.log(counts);
}

console.log('\n── morale break: one wounded raider, three healthy mercs');
{
  resetUidCounter();
  const b = createBattle({ seed: 8, w: 24, h: 16, light: 1 });
  for (let y = 2; y < 14; y += 3) setTerrain(b, 18, y, 'sandbag');
  const raider = spawnEnemy('raider', { x: 10, y: 8 }, 4);
  raider.weapon = makeWeapon('kalash7');
  raider.morale = 10;
  const dead = spawnEnemy('raider', { x: 21, y: 8 }, 5);
  dead.alive = false;
  b.units.push(raider, dead);
  ['nine', 'hoyt'].forEach((id, i) => b.units.push(spawnMerc(createMercState(id), { x: 3, y: 6 + i * 3 })));
  startBattle(b);
  const d0 = Math.min(...b.units.filter((u) => u.team === 'player').map((u) => chebyshev(u.pos, raider.pos)));
  const sink = new EventSink();
  advancePhase(b, sink);
  runAiTurn(b, sink);
  const d1 = Math.min(...b.units.filter((u) => u.team === 'player').map((u) => chebyshev(u.pos, raider.pos)));
  console.log(`broken raider: distance to nearest merc ${d0} -> ${d1}`, d1 > d0 ? 'RETREATED' : 'did not retreat',
    'stance', raider.stance, 'events', sink.events.map((e) => e.t).join(','));
}
