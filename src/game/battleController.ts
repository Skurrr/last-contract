/**
 * The battle controller: owns the tactical game loop, player input, and the pacing of enemy
 * turns. It is the only place that both mutates the simulation and talks to the renderer.
 *
 * Enemy turns are deliberately paced rather than resolved instantly — the player needs to
 * see what the dead did and why, or the noise system is invisible and the game feels random.
 */
import { chebyshev, type Vec2 } from '@/core/grid';
import { EventSink } from '@/sim/events';
import { takeAiAction } from '@/sim/ai';
import {
  advancePhase,
  bandage,
  checkOutcome,
  endUnitTurn,
  melee,
  moveUnit,
  overwatch,
  reload,
  setStance,
  shoot,
  unitById,
} from '@/sim/battle';
import { activeWeapon, estimateShot, MAX_AIM, type ShotPlan } from '@/sim/combat';
import { throwables, throwApCost, throwAt, throwRange } from '@/sim/throwing';
import { findPath, reachable, unitAt } from '@/sim/field';
import {
  collectAt,
  describeDrop,
  dropLootFor,
  dropRarity,
  emptyRecovered,
  type Recovered,
} from '@/sim/loot';
import type { CombatEvent } from '@/sim/events';
import type { BattleState, BodyPart, FireMode, Stance, Unit } from '@/sim/types';
import { Camera } from '@/render/camera';
import { Fx } from '@/render/fx';
import { Renderer, type RenderOverlays } from '@/render/renderer';
import { EventPlayer, type PlaybackHooks } from './eventPlayer';

export type ActionMode = 'move' | 'fire' | 'melee' | 'medic' | 'throw';

export interface ControllerHooks extends PlaybackHooks {
  /** Called whenever anything the HUD displays may have changed. */
  onDirty: () => void;
}

/** How long the controller waits between individual enemy actions, in seconds. */
const AI_STEP_DELAY = 0.28;

export class BattleController {
  readonly fx = new Fx();
  readonly renderer: Renderer;
  readonly camera: Camera;
  private readonly player: EventPlayer;

  battle: BattleState;
  selectedId: string | null = null;
  hover: Vec2 | null = null;
  mode: ActionMode = 'move';
  plan: ShotPlan = { mode: 'single', aim: 0, part: 'torso' };
  /** Which thrown item is armed, in throw mode. */
  throwItem: string | null = null;
  showNoise = false;
  fogOfWar = true;
  /** Set while an enemy phase is resolving; input is locked. */
  busy = false;

  /** Everything the squad has picked up this battle, handed to the campaign at the end. */
  readonly recovered: Recovered = emptyRecovered();

  private reachCache: { unitId: string; ap: number; tiles: Map<number, number> } | null = null;
  private pathCache: { key: string; tiles: Vec2[] } | null = null;
  private aiTimer = 0;
  private aiQueue: string[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    battle: BattleState,
    private readonly hooks: ControllerHooks,
  ) {
    this.battle = battle;
    this.camera = new Camera(canvas.width, canvas.height, battle.w, battle.h);
    this.renderer = new Renderer(canvas, this.camera, this.fx);
    this.player = new EventPlayer(this.fx, this.renderer, hooks);

    const first = battle.units.find((u) => u.team === 'player' && u.alive);
    if (first) this.selectedId = first.id;
    this.frameOnSquad();
  }

  // ─────────────────────────────────────────────── queries

  get selected(): Unit | null {
    return this.selectedId ? unitById(this.battle, this.selectedId) ?? null : null;
  }

  get playerSquad(): Unit[] {
    return this.battle.units.filter((u) => u.team === 'player');
  }

  /** Whether the player may act right now. */
  get canAct(): boolean {
    return !this.busy && this.battle.phase === 'player' && this.battle.outcome === 'ongoing';
  }

  /** Tiles the selected unit can reach, cached until its AP changes. */
  get reachableTiles(): Map<number, number> | undefined {
    const u = this.selected;
    if (!u || u.critical || this.mode !== 'move' || !this.canAct) return undefined;
    if (this.reachCache && this.reachCache.unitId === u.id && this.reachCache.ap === u.ap) {
      return this.reachCache.tiles;
    }
    const tiles = reachable(this.battle, u, u.ap);
    this.reachCache = { unitId: u.id, ap: u.ap, tiles };
    return tiles;
  }

  /** Preview path to the hovered tile. */
  get previewPath(): Vec2[] | undefined {
    const u = this.selected;
    if (!u || !this.hover || this.mode !== 'move' || !this.canAct) return undefined;
    const key = `${u.id}:${u.ap}:${u.pos.x},${u.pos.y}:${this.hover.x},${this.hover.y}`;
    if (this.pathCache?.key === key) return this.pathCache.tiles;
    const { tiles } = findPath(this.battle, u, this.hover, u.ap);
    this.pathCache = { key, tiles };
    return tiles;
  }

  /** Unit under the cursor, if it is a valid target. */
  get hoveredUnit(): Unit | null {
    if (!this.hover) return null;
    return unitAt(this.battle, this.hover.x, this.hover.y) ?? null;
  }

  /** Live shot estimate for the HUD, or null if no shot is possible. */
  get shotEstimate(): ReturnType<typeof estimateShot> | null {
    const u = this.selected;
    const t = this.hoveredUnit;
    if (!u || !t || t.team === u.team || !t.alive) return null;
    if (this.mode !== 'fire') return null;
    return estimateShot(this.battle, u, t, this.plan);
  }

  // ─────────────────────────────────────────────── input

  selectUnit(id: string): void {
    const u = unitById(this.battle, id);
    if (!u || u.team !== 'player' || !u.alive) return;
    this.selectedId = id;
    this.mode = 'move';
    this.plan = { mode: 'single', aim: 0, part: 'torso' };
    this.camera.centerOn(u.pos);
    this.invalidate();
  }

  /** Cycle to the next squad member with AP left. */
  selectNext(): void {
    const squad = this.playerSquad.filter((u) => u.alive && !u.critical);
    if (squad.length === 0) return;
    const i = squad.findIndex((u) => u.id === this.selectedId);
    // Prefer someone who can still do something.
    for (let step = 1; step <= squad.length; step++) {
      const cand = squad[(i + step) % squad.length]!;
      if (cand.ap > 0) return this.selectUnit(cand.id);
    }
    this.selectUnit(squad[(i + 1) % squad.length]!.id);
  }

  setHover(tile: Vec2 | null): void {
    if (tile && this.hover && tile.x === this.hover.x && tile.y === this.hover.y) return;
    this.hover = tile;
    this.hooks.onDirty();
  }

  setMode(mode: ActionMode): void {
    this.mode = mode;
    if (mode !== 'fire') this.plan = { mode: 'single', aim: 0, part: 'torso' };
    // Arm the first thing they are carrying, so throw mode is never a dead end.
    if (mode === 'throw' && !this.throwItem) {
      this.throwItem = this.availableThrowables[0]?.id ?? null;
    }
    this.invalidate();
  }

  /** Thrown items the selected merc is carrying. */
  get availableThrowables(): { id: string; name: string; count: number }[] {
    const u = this.selected;
    return u ? throwables(u) : [];
  }

  setThrowItem(id: string): void {
    this.throwItem = id;
    this.hooks.onDirty();
  }

  /** Tiles the armed throw can reach, for the overlay. */
  get throwTiles(): Set<number> | undefined {
    const u = this.selected;
    if (!u || this.mode !== 'throw' || !this.throwItem || !this.canAct) return undefined;
    const r = throwRange(u, this.throwItem);
    const out = new Set<number>();
    for (let y = u.pos.y - r; y <= u.pos.y + r; y++) {
      for (let x = u.pos.x - r; x <= u.pos.x + r; x++) {
        if (x < 0 || y < 0 || x >= this.battle.w || y >= this.battle.h) continue;
        if (chebyshev(u.pos, { x, y }) > r) continue;
        out.add((y << 10) | x);
      }
    }
    return out;
  }

  /** AP and reach for the armed item, for the HUD. */
  get throwInfo(): { cost: number; range: number; name: string } | null {
    const u = this.selected;
    if (!u || !this.throwItem) return null;
    const entry = this.availableThrowables.find((t) => t.id === this.throwItem);
    if (!entry) return null;
    return {
      cost: throwApCost(u, this.throwItem),
      range: throwRange(u, this.throwItem),
      name: entry.name,
    };
  }

  setAim(aim: number): void {
    this.plan = { ...this.plan, aim: Math.max(0, Math.min(MAX_AIM, aim)) };
    this.hooks.onDirty();
  }

  setBodyPart(part: BodyPart): void {
    // Called shots require at least one level of aim — you cannot pick a target while
    // spraying, and the UI should reflect that rather than silently ignoring the choice.
    const aim = part !== 'torso' ? Math.max(1, this.plan.aim) : this.plan.aim;
    this.plan = { ...this.plan, part, aim };
    this.hooks.onDirty();
  }

  setFireMode(mode: FireMode): void {
    this.plan = { ...this.plan, mode };
    this.hooks.onDirty();
  }

  /** Primary click at a tile — meaning depends on the current mode. */
  click(tile: Vec2): void {
    if (!this.canAct) return;
    const u = this.selected;
    if (!u || u.critical) return;

    const target = unitAt(this.battle, tile.x, tile.y);

    // Clicking a squadmate always selects them, whatever mode we are in.
    if (target && target.team === 'player' && target.id !== u.id && this.mode !== 'medic') {
      return this.selectUnit(target.id);
    }

    const sink = new EventSink();
    let result: { ok: boolean; reason?: string } = { ok: false, reason: 'Nothing to do' };

    switch (this.mode) {
      case 'move':
        if (target && target.team !== u.team && target.alive) {
          // Clicking an enemy in move mode is a convenience: melee if adjacent, else shoot.
          result = chebyshev(u.pos, target.pos) <= 1
            ? melee(this.battle, u, target, sink)
            : shoot(this.battle, u, target, this.plan, sink);
        } else {
          result = moveUnit(this.battle, u, tile, sink);
        }
        break;

      case 'fire':
        if (target && target.team !== u.team && target.alive) {
          result = shoot(this.battle, u, target, this.plan, sink);
        }
        break;

      case 'melee':
        if (target && target.team !== u.team && target.alive) {
          result = melee(this.battle, u, target, sink);
        }
        break;

      case 'medic':
        if (target && target.team === u.team) {
          result = bandage(this.battle, u, target, sink);
        }
        break;

      case 'throw': {
        if (!this.throwItem) {
          result = { ok: false, reason: 'Nothing to throw' };
          break;
        }
        const out = throwAt(this.battle, u, tile, this.throwItem, sink);
        result = out.ok ? { ok: true } : { ok: false, ...(out.reason ? { reason: out.reason } : {}) };
        if (out.ok) {
          if (out.scattered) this.hooks.logLine('The throw went wide.', 'bad');
          // Drop the item once the last one is gone rather than leaving a dead selection.
          if (!this.availableThrowables.some((t) => t.id === this.throwItem)) {
            this.throwItem = this.availableThrowables[0]?.id ?? null;
          }
        }
        break;
      }
    }

    this.resolve(sink, result.reason);
  }

  doReload(): void {
    if (!this.canAct || !this.selected) return;
    const sink = new EventSink();
    const r = reload(this.battle, this.selected, sink);
    this.resolve(sink, r.reason);
  }

  doStance(stance: Stance): void {
    if (!this.canAct || !this.selected) return;
    const sink = new EventSink();
    const r = setStance(this.battle, this.selected, stance, sink);
    this.resolve(sink, r.reason);
  }

  doOverwatch(): void {
    if (!this.canAct || !this.selected) return;
    const sink = new EventSink();
    const r = overwatch(this.battle, this.selected, sink);
    this.resolve(sink, r.reason);
    this.selectNext();
  }

  /** End the selected merc's turn, banking leftover AP as interrupt reserve. */
  doEndUnitTurn(): void {
    if (!this.canAct || !this.selected) return;
    endUnitTurn(this.battle, this.selected);
    this.invalidate();
    this.selectNext();
  }

  /** End the whole player phase and hand over to the AI. */
  endTurn(): void {
    if (!this.canAct) return;
    for (const u of this.playerSquad) {
      if (u.alive && !u.critical && u.ap > 0) endUnitTurn(this.battle, u);
    }
    this.beginAiPhases();
  }

  // ─────────────────────────────────────────────── turn flow

  private beginAiPhases(): void {
    this.busy = true;
    const sink = new EventSink();
    advancePhase(this.battle, sink);
    this.player.play(this.battle, sink.drain());
    this.queueCurrentPhase();
    this.invalidate();
  }

  private queueCurrentPhase(): void {
    const phase = this.battle.phase;
    if (phase === 'player') {
      this.busy = false;
      this.aiQueue = [];
      // Refresh the selection to someone who can act.
      const ready = this.playerSquad.find((u) => u.alive && !u.critical && u.ap > 0);
      if (ready) this.selectUnit(ready.id);
      this.invalidate();
      return;
    }
    this.aiQueue = this.battle.units
      .filter((u) => u.alive && !u.critical && u.team === phase)
      .map((u) => u.id);
    this.aiTimer = AI_STEP_DELAY;
  }

  /** Advance the AI one unit per tick so the player can follow what is happening. */
  private stepAi(dt: number): void {
    if (!this.busy) return;
    this.aiTimer -= dt;
    if (this.aiTimer > 0) return;
    this.aiTimer = AI_STEP_DELAY;

    const nextId = this.aiQueue.shift();
    if (nextId === undefined) {
      // Phase exhausted — move to the next one.
      const sink = new EventSink();
      advancePhase(this.battle, sink);
      this.player.play(this.battle, sink.drain());
      checkOutcome(this.battle, sink);
      this.player.play(this.battle, sink.drain());
      if (this.battle.outcome !== 'ongoing') {
        this.busy = false;
        return;
      }
      this.queueCurrentPhase();
      return;
    }

    const u = unitById(this.battle, nextId);
    if (!u || !u.alive || u.critical) return;

    const sink = new EventSink();
    takeAiAction(this.battle, u, sink);
    const events = sink.drain();
    this.player.play(this.battle, events);
    this.settleLoot(events);
    // Follow the action so off-screen shots are not a mystery.
    if (this.fogOfWar) this.camera.centerOn(u.pos);
    this.invalidate();
  }

  // ─────────────────────────────────────────────── loop

  /**
   * Bodies drop what they were carrying, and any squad member standing on a pile takes it.
   * Handled here rather than inside combat resolution so the loot tables never have to be
   * reachable from the shot resolver.
   */
  private settleLoot(events: readonly CombatEvent[]): void {
    for (const e of events) {
      if (e.t !== 'kill') continue;
      const victim = unitById(this.battle, e.unitId);
      if (victim && victim.team !== 'player') dropLootFor(this.battle, victim);
    }

    for (const u of this.battle.units) {
      if (!u.alive || u.critical || u.team !== 'player') continue;
      const drop = collectAt(this.battle, u.pos, this.recovered);
      if (!drop) continue;
      this.hooks.logLine(`${u.name} recovered ${describeDrop(drop)}.`, 'good');
      this.player.play(this.battle, [
        { t: 'loot', at: u.pos, rarity: dropRarity(drop), label: describeDrop(drop) },
      ]);
    }
  }

  private resolve(sink: EventSink, failReason?: string): void {
    const events = sink.drain();
    if (events.length > 0) {
      this.player.play(this.battle, events);
      this.settleLoot(events);
      const outSink = new EventSink();
      checkOutcome(this.battle, outSink);
      this.player.play(this.battle, outSink.drain());
    } else if (failReason) {
      this.hooks.logLine(failReason, 'info');
    }
    this.invalidate();
  }

  private invalidate(): void {
    this.reachCache = null;
    this.pathCache = null;
    this.renderer.invalidateVision();
    this.hooks.onDirty();
  }

  resize(w: number, h: number): void {
    this.camera.resize(w, h);
  }

  /**
   * Open framed on the squad's centre of mass at a zoom that shows the ground around them.
   * Landing at max zoom on one merc hides the terrain, which is the only thing tactics is
   * about — and centring on a single merc near a map edge parks them under the HUD.
   */
  frameOnSquad(): void {
    const squad = this.playerSquad.filter((u) => u.alive);
    if (squad.length === 0) return;
    const cx = squad.reduce((n, u) => n + u.pos.x, 0) / squad.length;
    const cy = squad.reduce((n, u) => n + u.pos.y, 0) / squad.length;
    this.camera.setZoom(Math.max(this.camera.fitZoom(), 0.55), true);
    this.camera.centerOn({ x: Math.round(cx), y: Math.round(cy) }, true);
  }

  /** Drive one frame. `dt` is real seconds; hitstop is applied internally. */
  tick(dt: number): void {
    const simDt = this.fx.update(dt);
    this.camera.update(dt);
    this.renderer.update(dt);
    if (simDt > 0) this.stepAi(simDt);
  }

  draw(): void {
    const u = this.selected;
    const overlays: RenderOverlays = {
      selectedId: this.selectedId,
      hover: this.hover,
      showNoise: this.showNoise,
      fogOfWar: this.fogOfWar,
    };
    const reach = this.reachableTiles;
    if (reach) overlays.reachable = reach;
    const path = this.previewPath;
    if (path) overlays.path = path;
    const hovered = this.hoveredUnit;
    if (hovered && u && hovered.team !== u.team) overlays.targetId = hovered.id;
    const throwTiles = this.throwTiles;
    if (throwTiles) overlays.throwTiles = throwTiles;

    this.renderer.draw(this.battle, overlays);
  }

  /** Ammo readout for the HUD. */
  ammoOf(u: Unit): { loaded: number; size: number } | null {
    const w = activeWeapon(u);
    if (!w || w.def.cls === 'melee') return null;
    return { loaded: w.inst.loaded, size: w.magSize };
  }
}
