/**
 * Events the simulation emits so the renderer can animate what happened. The sim never
 * touches the DOM or canvas; it returns a list of these and the presentation layer decides
 * how loud to be about each one. This is what keeps the sim testable and replayable.
 */
import type { Vec2 } from '@/core/grid';
import type { BodyPart, Rarity, WeaponInstance } from './types';

export type CombatEvent =
  | { t: 'shot'; from: Vec2; to: Vec2; unitId: string; hit: boolean; noise: number; tracer: boolean; cls: string }
  | { t: 'hit'; unitId: string; at: Vec2; damage: number; part: BodyPart; crit: boolean; overkill: boolean }
  | { t: 'miss'; unitId: string | null; at: Vec2 }
  | { t: 'melee'; unitId: string; targetId: string; damage: number; crit: boolean }
  | { t: 'kill'; unitId: string; at: Vec2; by: string; headshot: boolean }
  | { t: 'critical'; unitId: string; at: Vec2 }
  | { t: 'stabilised'; unitId: string; at: Vec2 }
  | { t: 'move'; unitId: string; path: Vec2[]; cost: number }
  | { t: 'stance'; unitId: string; stance: string }
  | { t: 'status'; unitId: string; at: Vec2; kind: string; applied: boolean }
  | { t: 'reload'; unitId: string; at: Vec2 }
  | { t: 'jam'; unitId: string; at: Vec2 }
  | { t: 'explosion'; at: Vec2; radius: number; damage: number }
  | { t: 'terrainBroken'; at: Vec2 }
  | { t: 'xp'; unitId: string; amount: number; reason: string; at: Vec2 }
  | { t: 'levelUp'; unitId: string; level: number; at: Vec2 }
  | { t: 'loot'; at: Vec2; rarity: Rarity; label: string; weapon?: WeaponInstance }
  | { t: 'noise'; at: Vec2; radius: number }
  | { t: 'interrupt'; unitId: string; at: Vec2 }
  | { t: 'bark'; unitId: string; text: string }
  | { t: 'objective'; label: string; done: boolean }
  | { t: 'phase'; phase: string; turn: number }
  | { t: 'outcome'; outcome: 'victory' | 'defeat' };

/** Collector passed through the sim so each action can append without allocating arrays. */
export class EventSink {
  readonly events: CombatEvent[] = [];
  push(e: CombatEvent): void {
    this.events.push(e);
  }
  drain(): CombatEvent[] {
    return this.events.splice(0, this.events.length);
  }
}
