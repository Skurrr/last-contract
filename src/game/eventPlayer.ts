/**
 * Translates simulation events into presentation.
 *
 * The sim decides *what* happened; this decides *how loud to be about it*. Keeping the
 * mapping in one file means the whole feel of the game — how much a headshot shakes the
 * screen, how big a damage number gets — is tunable from a single place.
 */
import { toHex } from '@/art/forge';
import { PAL } from '@/art/palette';
import { bark } from '@/data/barks';
import { MERCS } from '@/data/mercs';
import type { CombatEvent } from '@/sim/events';
import type { BattleState, Unit } from '@/sim/types';
import { BASE_SCALE, TILE_PX } from '@/render/camera';
import type { Fx } from '@/render/fx';
import type { Renderer } from '@/render/renderer';

const TS = TILE_PX * BASE_SCALE;

const centre = (x: number, y: number): { x: number; y: number } => ({
  x: (x + 0.5) * TS,
  y: (y + 0.5) * TS,
});

export interface PlaybackHooks {
  /** Screen-space point XP shards fly toward — the merc's portrait in the HUD. */
  portraitAnchor: (unitId: string) => { x: number; y: number } | null;
  /** Push a line into the on-screen combat log. */
  logLine: (text: string, tone: 'info' | 'good' | 'bad' | 'crit') => void;
  /** Show a merc's bark as a speech bubble. */
  showBark: (unitId: string, text: string) => void;
  /** A merc levelled — the UI should queue the perk-choice card deal. */
  onLevelUp: (unitId: string, level: number) => void;
  onOutcome: (outcome: 'victory' | 'defeat') => void;
}

export class EventPlayer {
  constructor(
    private readonly fx: Fx,
    private readonly renderer: Renderer,
    private readonly hooks: PlaybackHooks,
  ) {}

  private unit(b: BattleState, id: string): Unit | undefined {
    return b.units.find((u) => u.id === id);
  }

  /** Fire a bark for a merc, if they have a voice and are not the silent type. */
  private tryBark(b: BattleState, unitId: string, situation: string, chance: number): void {
    const u = this.unit(b, unitId);
    if (!u || u.kind !== 'merc') return;
    // Sable's traits make her mute; her bark set answers in stage directions anyway.
    const def = MERCS[u.defId];
    if (!def) return;
    // Deterministic per-unit, per-turn roll so barks don't stutter on re-render.
    const roll = ((u.spriteSeed ^ (b.turn * 2654435761)) >>> 8) / 0xffffff;
    if (roll > chance) return;
    const line = bark(def.voice, situation, roll);
    if (line) this.hooks.showBark(unitId, line);
  }

  play(b: BattleState, events: readonly CombatEvent[]): void {
    for (const e of events) this.one(b, e);
  }

  private one(b: BattleState, e: CombatEvent): void {
    switch (e.t) {
      case 'shot': {
        const from = centre(e.from.x, e.from.y);
        const to = centre(e.to.x, e.to.y);
        const u = this.unit(b, e.unitId);
        if (e.tracer) {
          this.fx.tracer(from.x, from.y, to.x, to.y);
          this.fx.brass(from.x, from.y, 1);
          // Flash size tracks how loud the weapon is — a suppressed shot barely blooms.
          const size = e.noise > 20 ? 2 : e.noise > 10 ? 1 : 0;
          this.renderer.addMuzzleFlash(e.from, e.to, size);
          this.fx.addShake(0.6 + size * 0.9);
        }
        if (u) this.tryBark(b, e.unitId, 'shoot', 0.25);
        break;
      }

      case 'hit': {
        const u = this.unit(b, e.unitId);
        const p = centre(e.at.x, e.at.y);
        const frac = u ? e.damage / Math.max(1, u.maxHp) : 0.2;

        this.fx.damageNumber(p.x, p.y - TS * 0.5, e.damage, frac, e.crit);
        if (u?.kind === 'zombie') this.fx.rot(p.x, p.y, e.damage);
        else this.fx.blood(p.x, p.y, e.damage);

        // Impact weight: a graze ticks, a crit stops the world for a beat.
        this.fx.addShake(1.5 + frac * 9 + (e.crit ? 4 : 0));
        if (e.crit) {
          this.fx.addHitstop(0.075);
          this.fx.flash(toHex(PAL.gold), 0.16);
        } else if (frac > 0.25) {
          this.fx.addHitstop(0.035);
        }

        if (e.part !== 'torso') {
          this.fx.text(p.x, p.y - TS * 0.9, e.part.toUpperCase(), toHex(PAL.amber), 9, 1.3);
        }
        break;
      }

      case 'miss': {
        const p = centre(e.at.x, e.at.y);
        this.fx.text(p.x + 8, p.y - TS * 0.4, 'miss', 'rgba(200,200,190,0.75)', 9, 1.2);
        this.fx.sparks(p.x, p.y, 0, -1, 4);
        break;
      }

      case 'melee': {
        const u = this.unit(b, e.targetId);
        if (u) {
          const p = centre(u.pos.x, u.pos.y);
          this.fx.addShake(e.crit ? 7 : 3.5);
          this.fx.addHitstop(e.crit ? 0.09 : 0.04);
          if (u.kind === 'zombie') this.fx.rot(p.x, p.y, e.damage * 1.4);
          else this.fx.blood(p.x, p.y, e.damage * 1.4);
        }
        break;
      }

      case 'kill': {
        const p = centre(e.at.x, e.at.y);
        const u = this.unit(b, e.unitId);
        this.fx.addShake(e.headshot ? 9 : 5);
        this.fx.addHitstop(e.headshot ? 0.12 : 0.06);
        if (u?.kind === 'zombie') this.fx.rot(p.x, p.y, 34);
        else this.fx.blood(p.x, p.y, 34);

        if (e.headshot) {
          this.fx.flash(toHex(PAL.bloodBright), 0.2);
          this.fx.text(p.x, p.y - TS, 'HEADSHOT', toHex(PAL.gold), 15, 2.4);
        }
        this.hooks.logLine(`${u?.name ?? 'Someone'} is down.`, u?.team === 'player' ? 'bad' : 'good');
        if (e.by) this.tryBark(b, e.by, e.headshot ? 'headshot' : 'kill', 0.55);
        break;
      }

      case 'critical': {
        const p = centre(e.at.x, e.at.y);
        const u = this.unit(b, e.unitId);
        this.fx.flash(toHex(PAL.blood), 0.3);
        this.fx.addShake(8);
        this.fx.addHitstop(0.14);
        this.fx.text(p.x, p.y - TS, 'CRITICAL', toHex(PAL.bloodBright), 14, 2.2);
        this.hooks.logLine(`${u?.name ?? 'A merc'} is down and bleeding — 3 turns to stabilise.`, 'bad');
        // Everyone who can see it has an opinion.
        for (const ally of b.units) {
          if (ally.alive && ally.team === 'player' && ally.id !== e.unitId) {
            this.tryBark(b, ally.id, 'ally_down', 0.4);
          }
        }
        break;
      }

      case 'stabilised': {
        const p = centre(e.at.x, e.at.y);
        this.fx.text(p.x, p.y - TS * 0.6, 'STABILISED', toHex(PAL.lime), 12, 1.9);
        this.fx.levelUp(p.x, p.y);
        this.hooks.logLine(`${this.unit(b, e.unitId)?.name ?? 'Merc'} is back on their feet.`, 'good');
        break;
      }

      case 'move': {
        const last = e.path[e.path.length - 1];
        if (last) {
          const p = centre(last.x, last.y);
          this.fx.dust(p.x, p.y + TS * 0.3, 3);
        }
        this.renderer.invalidateVision();
        break;
      }

      case 'status': {
        if (!e.applied) break;
        const p = centre(e.at.x, e.at.y);
        const good = e.kind === 'inspired' || e.kind === 'adrenaline' || e.kind === 'overwatch';
        this.fx.text(
          p.x, p.y - TS * 0.75,
          e.kind.toUpperCase(),
          good ? toHex(PAL.cyan) : toHex(PAL.violet),
          9, 1.4,
        );
        break;
      }

      case 'reload':
        this.fx.text(centre(e.at.x, e.at.y).x, centre(e.at.x, e.at.y).y - TS * 0.5,
          'reload', 'rgba(210,210,200,0.8)', 9, 1.2);
        this.tryBark(b, e.unitId, 'reload', 0.3);
        break;

      case 'jam': {
        const p = centre(e.at.x, e.at.y);
        this.fx.text(p.x, p.y - TS * 0.6, 'JAM!', toHex(PAL.rust), 13, 2);
        this.fx.addShake(2);
        this.hooks.logLine(`${this.unit(b, e.unitId)?.name ?? 'Merc'}'s weapon jammed.`, 'bad');
        this.tryBark(b, e.unitId, 'jam', 0.8);
        break;
      }

      case 'explosion': {
        const p = centre(e.at.x, e.at.y);
        this.fx.explosion(p.x, p.y, e.radius);
        break;
      }

      case 'terrainBroken': {
        const p = centre(e.at.x, e.at.y);
        this.fx.dust(p.x, p.y, 10);
        this.fx.sparks(p.x, p.y, 0, -1, 5);
        break;
      }

      case 'xp': {
        const p = centre(e.at.x, e.at.y);
        const anchor = this.hooks.portraitAnchor(e.unitId);
        if (anchor) this.fx.xpBurst(p.x, p.y, anchor.x, anchor.y, Math.ceil(e.amount / 6));
        this.fx.text(p.x, p.y - TS * 0.3, `+${e.amount} XP`, toHex(PAL.cyan), 10, 1.4);
        break;
      }

      case 'levelUp': {
        const p = centre(e.at.x, e.at.y);
        this.fx.levelUp(p.x, p.y);
        this.fx.addShake(3);
        this.fx.text(p.x, p.y - TS * 1.2, `LEVEL ${e.level}`, toHex(PAL.gold), 17, 2.6);
        this.hooks.logLine(`${this.unit(b, e.unitId)?.name ?? 'Merc'} reached level ${e.level}.`, 'crit');
        this.tryBark(b, e.unitId, 'levelUp', 0.9);
        this.hooks.onLevelUp(e.unitId, e.level);
        break;
      }

      case 'loot': {
        const p = centre(e.at.x, e.at.y);
        this.fx.text(p.x, p.y - TS * 0.6, e.label, toHex(PAL.gold), 11, 1.8);
        break;
      }

      case 'interrupt': {
        const p = centre(e.at.x, e.at.y);
        this.fx.text(p.x, p.y - TS, 'INTERRUPT', toHex(PAL.amber), 13, 2.2);
        this.fx.addShake(3);
        this.fx.addHitstop(0.06);
        break;
      }

      case 'noise': {
        // Noise itself is silent visually — the noise overlay renders the field. But a very
        // loud event is worth flagging, because it is about to bring company.
        if (e.radius >= 28) {
          const p = centre(e.at.x, e.at.y);
          this.fx.text(p.x, p.y - TS * 1.4, 'LOUD', toHex(PAL.rust), 12, 2);
          this.hooks.logLine('That was heard for a long way.', 'bad');
        }
        break;
      }

      case 'bark':
        this.hooks.showBark(e.unitId, e.text);
        break;

      case 'objective':
        this.hooks.logLine(
          e.done ? `Objective complete: ${e.label}` : `Objective failed: ${e.label}`,
          e.done ? 'good' : 'bad',
        );
        break;

      case 'phase':
        this.renderer.invalidateVision();
        break;

      case 'outcome':
        this.hooks.onOutcome(e.outcome);
        break;
    }
  }
}
