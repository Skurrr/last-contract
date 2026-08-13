import { createBattle, startBattle, advancePhase } from '@/sim/battle';
import { emitNoise, noiseAt, findPath, isPassable } from '@/sim/field';
import { spawnEnemy, spawnMerc, createMercState } from '@/sim/spawn';
import { EventSink } from '@/sim/events';
import { takeAiAction } from '@/sim/ai';

const b = createBattle({ seed: 5, w: 32, h: 24, light: 1 });
const m = spawnMerc(createMercState('nine'), { x: 4, y: 14 });
b.units.push(m);
const c = spawnEnemy('crawler', { x: 7, y: 20 }, 3);
b.units.push(c);
startBattle(b);
emitNoise(b, { x: 6, y: 12 }, 22);
advancePhase(b); advancePhase(b); advancePhase(b); // -> zombie phase
console.log('phase', b.phase, 'ap', c.ap, 'stance', c.stance, 'alive', c.alive, 'noise here', noiseAt(b, 7, 20));
const path = findPath(b, c, { x: 5, y: 14 });
console.log('path len', path.tiles.length, 'cost', path.cost, 'first', path.tiles[0]);
const sink = new EventSink();
const did = takeAiAction(b, c, sink);
console.log('did', did, 'ap', c.ap, 'pos', c.pos, sink.events.map(e => e.t));
console.log('maxAp', c.maxAp, 'stamina', c.stamina, '/', c.maxStamina, 'statuses', c.statuses, 'attrs', c.attrs.agility, 'turn', b.turn);
import { maxApFor } from '@/sim/progression';
import { unitMods } from '@/sim/combat';
console.log('maxApFor=', maxApFor(c.attrs, unitMods(c)), 'mods.ap', unitMods(c).ap, unitMods(c).apMul);
