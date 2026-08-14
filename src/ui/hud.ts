/**
 * The tactical HUD.
 *
 * Plain DOM over the battle canvas. It reads the `BattleController` and never mutates the
 * simulation directly — every interaction goes through a controller method, so the HUD can
 * be thrown away and rebuilt at any moment without losing game state.
 *
 * Two things deliberately do *not* get rebuilt by `update()`: the combat log and the bark
 * bubbles. Both have their own lifecycle (append-only, timed dismissal) and live in stable
 * containers created once in the constructor.
 *
 * Nothing here may throw. A merc can be dead, weaponless, downed, or the battle already
 * over — the HUD's job in all of those cases is to keep showing something sensible.
 */
import { toHex } from '@/art/forge';
import { PAL } from '@/art/palette';
import { lookFromPalette, portraitSprite } from '@/art/units';
import { MERCS } from '@/data/mercs';
import type { ActionMode, BattleController } from '@/game/battleController';
import { bar, clear, el, pct, render } from '@/ui/dom';
import {
  MAX_AIM,
  activeWeapon,
  roundsFor,
  shotApCost,
  unitMods,
  type ResolvedWeapon,
  type ShotEstimate,
} from '@/sim/combat';
import { levelProgress } from '@/sim/progression';
import {
  BODY_PARTS,
  BODY_PART_TABLE,
  STANCES,
  STANCE_TABLE,
  STATUS_INFO,
  type BodyPart,
  type FireMode,
  type Objective,
  type Stance,
  type Unit,
} from '@/sim/types';

const LOG_CAP = 60;
const BARK_MS = 2500;
const BARK_FADE_MS = 220;
const BARK_GAP = 6;

const HP_GOOD = toHex(PAL.lime);
const HP_WARN = toHex(PAL.amber);
const HP_BAD = toHex(PAL.bloodBright);
const STAMINA = toHex(PAL.cyan);
const XP = toHex(PAL.violet);

const PHASE_LABEL: Record<string, string> = {
  player: 'Your Move',
  ally: 'Allies Moving',
  enemy: 'Enemy Turn',
  zombie: 'The Dead',
};

const MODE_LABEL: Record<ActionMode, string> = {
  move: 'Move',
  fire: 'Fire',
  melee: 'Melee',
  medic: 'Medic',
  throw: 'Throw',
};

const COVER_LABEL = ['None', 'Low', 'High'] as const;

/** Two-letter status glyph. Short enough to fit, long enough to guess. */
function statusGlyph(kind: string): string {
  return kind.slice(0, 2).toUpperCase();
}

function hpColor(frac: number): string {
  if (frac > 0.6) return HP_GOOD;
  if (frac > 0.3) return HP_WARN;
  return HP_BAD;
}

interface ActiveBark {
  node: HTMLElement;
  /** Preferred top offset within the HUD, in px. Used to keep bubbles near their card. */
  want: number;
  hideTimer: number;
  killTimer: number;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly objectivesEl: HTMLElement;
  private readonly squadEl: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private readonly reconEl: HTMLElement;
  private readonly logScrollEl: HTMLElement;
  private readonly barkLayerEl: HTMLElement;

  /** Live squad card elements, refreshed on every `update()`. Drives `portraitAnchor`. */
  private readonly cards = new Map<string, HTMLElement>();
  /** Baked portrait canvases, keyed by unit + visual state. Baking is not free. */
  private readonly portraits = new Map<string, HTMLCanvasElement>();
  private readonly logLines: HTMLElement[] = [];
  private readonly barks: ActiveBark[] = [];
  private destroyed = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly ctrl: BattleController,
  ) {
    this.bannerEl = el('div.hud-banner');
    this.objectivesEl = el('div.panel.panel--notch.hud-objectives');
    this.squadEl = el('div.hud-squad');
    this.actionsEl = el('div.panel.hud-actions');
    this.reconEl = el('div.hud-recon');

    // The log owns its own children for the life of the HUD; update() never touches it.
    this.logScrollEl = el('div.log-scroll.scroll');
    const logEl = el(
      'div.panel.panel--notch.panel--flush.hud-log',
      {},
      el('div.panel-title', {}, 'Contact Log'),
      this.logScrollEl,
    );

    this.barkLayerEl = el('div.hud-barks');

    this.root = el(
      'div.hud',
      {},
      this.bannerEl,
      this.objectivesEl,
      this.squadEl,
      this.actionsEl,
      this.reconEl,
      logEl,
      this.barkLayerEl,
    );
    this.host.appendChild(this.root);
    this.update();
  }

  // ───────────────────────────────────────────────────────────────────── public API

  update(): void {
    if (this.destroyed) return;
    this.renderBanner();
    this.renderObjectives();
    this.renderSquad();
    this.renderActions();
    this.renderRecon();
  }

  /** Centre of a merc's portrait in HUD-local pixels — where XP shards should land. */
  portraitAnchor(unitId: string): { x: number; y: number } | null {
    const card = this.cards.get(unitId);
    if (!card) return null;
    const portrait = card.querySelector('.sq-portrait');
    if (!(portrait instanceof HTMLElement)) return null;
    const r = portrait.getBoundingClientRect();
    const host = this.root.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left - host.left + r.width / 2, y: r.top - host.top + r.height / 2 };
  }

  logLine(text: string, tone: 'info' | 'good' | 'bad' | 'crit'): void {
    if (this.destroyed) return;
    const line = el(`div.log-line.tone-${tone}`, {}, text);
    this.logScrollEl.appendChild(line);
    this.logLines.push(line);
    while (this.logLines.length > LOG_CAP) {
      this.logLines.shift()?.remove();
    }
    // Pin to the newest line. `scrollTop` is cheap enough at this cadence.
    this.logScrollEl.scrollTop = this.logScrollEl.scrollHeight;
  }

  showBark(unitId: string, text: string): void {
    if (this.destroyed || !text) return;
    const unit = this.unit(unitId);
    const def = unit ? MERCS[unit.defId] : undefined;
    // Sable and the dead answer in stage directions; those are set in italics, not quoted.
    const silent = text.trimStart().startsWith('[');

    const node = el(
      `div.bark${silent ? '.is-silent' : ''}`,
      {},
      def && !silent ? el('span.bark-who', {}, def.callsign) : null,
      text,
    );
    this.barkLayerEl.appendChild(node);

    const host = this.root.getBoundingClientRect();
    const card = this.cards.get(unitId);
    let want = host.height * 0.34;
    if (card) {
      const r = card.getBoundingClientRect();
      node.style.left = `${Math.round(r.right - host.left + 10)}px`;
      want = r.top - host.top;
    } else {
      // No card (an ally, or a merc already removed) — float it over the map instead.
      node.style.left = `${Math.round(host.width * 0.36)}px`;
    }
    node.style.top = `${Math.round(want)}px`;

    const entry: ActiveBark = {
      node,
      want,
      hideTimer: window.setTimeout(() => {
        node.classList.add('is-out');
      }, BARK_MS),
      killTimer: window.setTimeout(() => {
        this.dropBark(entry);
      }, BARK_MS + BARK_FADE_MS),
    };
    this.barks.push(entry);
    this.layoutBarks();
  }

  destroy(): void {
    this.destroyed = true;
    for (const b of this.barks) {
      window.clearTimeout(b.hideTimer);
      window.clearTimeout(b.killTimer);
    }
    this.barks.length = 0;
    this.logLines.length = 0;
    this.cards.clear();
    this.portraits.clear();
    this.root.remove();
  }

  // ───────────────────────────────────────────────────────────────────── barks

  private dropBark(entry: ActiveBark): void {
    window.clearTimeout(entry.hideTimer);
    window.clearTimeout(entry.killTimer);
    entry.node.remove();
    const i = this.barks.indexOf(entry);
    if (i >= 0) this.barks.splice(i, 1);
    this.layoutBarks();
  }

  /**
   * Push overlapping bubbles downward so three mercs shouting at once stays readable.
   * Each bubble keeps its preferred anchor unless a bubble above it is in the way.
   */
  private layoutBarks(): void {
    if (this.barks.length === 0) return;
    const ordered = [...this.barks].sort((a, b) => a.want - b.want);
    const limit = this.root.clientHeight;
    let cursor = 0;
    for (const b of ordered) {
      const top = Math.max(b.want, cursor);
      b.node.style.top = `${Math.round(Math.min(top, Math.max(0, limit - 40)))}px`;
      cursor = top + b.node.offsetHeight + BARK_GAP;
    }
  }

  // ───────────────────────────────────────────────────────────────────── helpers

  private unit(id: string): Unit | undefined {
    return this.ctrl.battle.units.find((u) => u.id === id);
  }

  /** Bake (once) and return the portrait canvas for a merc in its current state. */
  private portraitFor(u: Unit): HTMLCanvasElement | null {
    const def = MERCS[u.defId];
    if (!def) return null;
    const state = !u.alive ? 'dead' : u.critical ? 'down' : 'ok';
    const key = `${u.id}|${state}`;
    const cached = this.portraits.get(key);
    if (cached) return cached;
    const look = lookFromPalette(def.portraitSeed, def.palette);
    const canvas = portraitSprite(def.portraitSeed, look, !u.alive).toCanvas(2);
    this.portraits.set(key, canvas);
    return canvas;
  }

  private stanceCost(u: Unit, to: Stance): number {
    const mods = unitMods(u);
    return Math.max(
      1,
      Math.ceil(
        Math.max(STANCE_TABLE[to].changeAP, STANCE_TABLE[u.stance].changeAP) + mods.stanceApCost,
      ),
    );
  }

  private reloadCost(u: Unit): number {
    return Math.max(1, Math.ceil(4 + unitMods(u).reloadApCost));
  }

  private meleeCost(u: Unit, w: ResolvedWeapon | null): number {
    const isMelee = w?.def.cls === 'melee';
    return Math.max(2, Math.ceil((isMelee && w ? w.apCost : 4) + unitMods(u).shotApCost));
  }

  /** A button that costs AP: shows the price and greys out when it cannot be paid. */
  private apButton(
    label: string,
    cost: number | null,
    enabled: boolean,
    onClick: () => void,
    extraClass = '',
    tip?: string,
  ): HTMLElement {
    const attrs: Record<string, unknown> = {
      disabled: !enabled,
      on: { click: () => { if (enabled) onClick(); } },
    };
    if (tip !== undefined) attrs['title'] = tip;
    return el(
      `button.btn${extraClass ? `.${extraClass}` : ''}`,
      attrs,
      label,
      cost !== null ? el('span.ap-cost', {}, `${cost}`) : null,
    );
  }

  // ───────────────────────────────────────────────────────────────────── banner

  private renderBanner(): void {
    const b = this.ctrl.battle;
    const over = b.outcome !== 'ongoing';
    const hostile = !over && (b.phase !== 'player' || this.ctrl.busy);

    this.bannerEl.className = `hud-banner${hostile ? ' is-enemy' : ''}${over ? ' is-over' : ''}`;

    const phaseText = over
      ? b.outcome === 'victory'
        ? 'Contract Complete'
        : 'Squad Lost'
      : this.ctrl.busy && b.phase !== 'player'
        ? `${PHASE_LABEL[b.phase] ?? b.phase} …`
        : (PHASE_LABEL[b.phase] ?? b.phase);

    const alive = this.ctrl.playerSquad.filter((u) => u.alive && !u.critical).length;
    const total = this.ctrl.playerSquad.length;

    render(
      this.bannerEl,
      el('span.turn-no', {}, `Turn ${b.turn}`),
      el('span.phase', {}, phaseText),
      el('span.spacer'),
      el('span.chip', {}, `Squad ${alive}/${total}`),
      el('span.chip', { class: b.light < 0.5 ? 'chip--info' : '' }, `Light ${pct(b.light)}`),
      el(
        'button.btn.btn--sm.btn--ghost.tip.tip--below',
        {
          class: this.ctrl.showNoise ? 'is-active' : '',
          data: {
            tip: 'Sound overlay. The dead do not see — they listen, and they walk toward the loudest thing they heard. Gunfire carries; knives do not.',
          },
          on: {
            click: () => {
              this.ctrl.showNoise = !this.ctrl.showNoise;
              this.update();
            },
          },
        },
        'Sound',
      ),
    );
  }

  // ───────────────────────────────────────────────────────────────────── objectives

  private renderObjectives(): void {
    const objectives = this.ctrl.battle.objectives;
    render(
      this.objectivesEl,
      el('div.stencil', {}, 'Objectives'),
      objectives.length === 0
        ? el('div.hint', {}, 'No standing orders. Get out alive.')
        : el(
            'div.list.scroll',
            {},
            ...objectives.map((o) => this.objectiveRow(o)),
          ),
    );
  }

  private objectiveRow(o: Objective): HTMLElement {
    const state = o.failed ? 'is-failed' : o.done ? 'is-done' : '';
    const mark = o.failed ? '✕' : o.done ? '✓' : '·';
    return el(
      `div.obj${state ? `.${state}` : ''}`,
      {},
      el('span.obj-mark', {}, mark),
      el('span', {}, o.label),
      o.turns !== undefined && !o.done && !o.failed
        ? el('span.chip.chip--hot', {}, `${o.turns}T`)
        : null,
    );
  }

  // ───────────────────────────────────────────────────────────────────── squad strip

  private renderSquad(): void {
    this.cards.clear();
    clear(this.squadEl);
    for (const u of this.ctrl.playerSquad) {
      const card = this.squadCard(u);
      this.cards.set(u.id, card);
      this.squadEl.appendChild(card);
    }
  }

  private squadCard(u: Unit): HTMLElement {
    const def = MERCS[u.defId];
    const selected = this.ctrl.selectedId === u.id;
    const cls = [
      'sq-card',
      selected ? 'is-selected' : '',
      !u.alive ? 'is-dead' : u.critical ? 'is-down' : '',
    ]
      .filter(Boolean)
      .join('.');

    const prog = levelProgress(u.xp);
    const ammo = this.ctrl.ammoOf(u);
    const canvas = this.portraitFor(u);

    const portrait = el(
      'div.sq-portrait',
      {},
      canvas,
      el('span.sq-level', {}, `L${u.level || prog.level}`),
    );

    const hpFrac = u.maxHp > 0 ? u.hp / u.maxHp : 0;
    const stamFrac = u.maxStamina > 0 ? u.stamina / u.maxStamina : 0;

    const stats = el(
      'div.sq-stats',
      {},
      el(
        'div.sq-head',
        {},
        el('span.sq-name', {}, def?.callsign ?? u.name),
        ammo
          ? el(
              `span.sq-ammo${ammo.loaded === 0 ? '.is-empty' : ''}`,
              {},
              `${ammo.loaded}/${ammo.size}`,
            )
          : el('span.sq-ammo.dim', {}, 'melee'),
      ),
      bar(hpFrac, hpColor(hpFrac), `${Math.max(0, Math.round(u.hp))}/${u.maxHp}`),
      bar(stamFrac, STAMINA, '', 'bar--thin'),
      this.apPips(u),
      bar(prog.frac, XP, '', 'bar--thin'),
      u.statuses.length > 0 ? this.statusRow(u) : null,
    );

    const children: (HTMLElement | null)[] = [portrait, stats];
    if (!u.alive) {
      children.push(el('div.sq-dead-stamp', {}, 'Killed in action'));
    } else if (u.critical) {
      children.push(
        el(
          'div.sq-critical',
          {},
          el('span', {}, 'Critical'),
          el('span.num', {}, `${Math.max(0, u.criticalTurns)} turns`),
        ),
      );
    }

    return el(
      `button.${cls}`,
      {
        data: { unit: u.id },
        disabled: !u.alive,
        title: def ? `${def.callsign} — ${def.realName}` : u.name,
        on: {
          click: () => {
            if (u.alive) this.ctrl.selectUnit(u.id);
          },
        },
      },
      ...children,
    );
  }

  private apPips(u: Unit): HTMLElement {
    // Cap the pip run so a high-agility merc does not wrap into three rows.
    const shown = Math.min(u.maxAp, 12);
    const pips: HTMLElement[] = [];
    for (let i = 0; i < shown; i++) {
      pips.push(el(`div.pip${i < u.ap ? '.is-full' : ''}`));
    }
    for (let i = 0; i < Math.min(u.reserve, 6); i++) {
      pips.push(el('div.pip.is-reserve'));
    }
    return el(
      'div.sq-pips',
      { title: u.reserve > 0 ? `${u.reserve} AP held in reserve for interrupts` : 'Action points' },
      ...pips,
      el('span.pip-label', {}, `${u.ap}/${u.maxAp}`),
    );
  }

  private statusRow(u: Unit): HTMLElement {
    return el(
      'div.sq-statuses',
      {},
      ...u.statuses.map((s) => {
        const info = STATUS_INFO[s.kind];
        const turns = s.turns >= 0 ? ` ${s.turns}t` : '';
        const stacks = s.stacks > 1 ? ` ×${s.stacks}` : '';
        return el(
          `span.status-icon${info?.good ? '.is-good' : ''}`,
          { title: `${info?.label ?? s.kind}${stacks}${turns} — ${info?.desc ?? ''}` },
          statusGlyph(s.kind),
        );
      }),
    );
  }

  // ───────────────────────────────────────────────────────────────────── action bar

  private renderActions(): void {
    const u = this.ctrl.selected;
    const act = this.ctrl.canAct;
    this.actionsEl.className = `panel hud-actions${act ? '' : ' is-locked'}`;

    if (!u) {
      render(
        this.actionsEl,
        el('div.hint', {}, this.ctrl.busy ? 'Hostiles are moving.' : 'No merc selected.'),
      );
      return;
    }

    const w = activeWeapon(u);
    const usable = act && u.alive && !u.critical;
    const ammo = this.ctrl.ammoOf(u);

    render(
      this.actionsEl,
      el(
        'div.act-weapon',
        {},
        el('span.wname', {}, w ? w.name : 'Unarmed'),
        w ? el('span.chip', {}, w.def.cls) : null,
        ammo ? el('span.chip', { class: ammo.loaded === 0 ? 'chip--bad' : '' }, `${ammo.loaded}/${ammo.size}`) : null,
        w ? el('span.chip', {}, `Cond ${pct(w.condition)}`) : null,
        el('span.chip.chip--info', {}, STANCE_TABLE[u.stance].label),
      ),
      el(
        'div.act-groups',
        {},
        this.modeGroup(u, w, usable),
        this.utilityGroup(u, w, usable),
        this.throwGroup(usable),
        this.stanceGroup(u, usable),
        this.turnGroup(usable),
      ),
    );
  }

  /** Which piece of ordnance is armed. Only meaningful in throw mode. */
  private throwGroup(usable: boolean): HTMLElement | null {
    if (this.ctrl.mode !== 'throw') return null;
    const items = this.ctrl.availableThrowables;
    if (items.length === 0) return null;

    return el(
      'div.act-group',
      {},
      el('div.stencil', {}, 'Ordnance'),
      el(
        'div.btn-row',
        {},
        ...items.map((it) =>
          el(
            'button.btn.btn--sm',
            {
              class: this.ctrl.throwItem === it.id ? 'is-active' : '',
              disabled: !usable,
              on: { click: () => { if (usable) this.ctrl.setThrowItem(it.id); } },
            },
            it.name,
            el('span.ap-cost', {}, `x${it.count}`),
          ),
        ),
      ),
    );
  }

  private modeGroup(u: Unit, w: ResolvedWeapon | null, usable: boolean): HTMLElement {
    const ranged = w !== null && w.def.cls !== 'melee';
    const thrown = this.ctrl.throwInfo;
    const hasThrowables = this.ctrl.availableThrowables.length > 0;
    const costs: Record<ActionMode, number | null> = {
      move: null,
      fire: ranged && w ? shotApCost(u, w, this.ctrl.plan) : null,
      melee: this.meleeCost(u, w),
      medic: 4,
      throw: thrown ? thrown.cost : null,
    };
    const modes: ActionMode[] = ['move', 'fire', 'melee', 'medic', 'throw'];

    return el(
      'div.act-group',
      {},
      el('div.stencil', {}, 'Mode'),
      el(
        'div.btn-row',
        {},
        ...modes.map((m) => {
          const enabled =
            usable && (m !== 'fire' || ranged) && (m !== 'throw' || hasThrowables);
          const attrs: Record<string, unknown> = {
            class: this.ctrl.mode === m ? 'is-active' : '',
            disabled: !enabled,
            on: { click: () => { if (enabled) this.ctrl.setMode(m); } },
          };
          if (m === 'medic') attrs['title'] = 'Bandage an adjacent squadmate. 6 AP to stabilise a downed merc.';
          if (m === 'fire' && !ranged) attrs['title'] = 'No ranged weapon.';
          if (m === 'throw') {
            attrs['title'] = hasThrowables
              ? `Lob ordnance at a tile. Reach ${thrown?.range ?? 0} tiles; explosives skill tightens the throw.`
              : 'Nothing to throw.';
          }
          return el(
            'button.btn',
            attrs,
            MODE_LABEL[m],
            costs[m] !== null ? el('span.ap-cost', {}, `${costs[m]}`) : null,
          );
        }),
      ),
    );
  }

  private utilityGroup(u: Unit, w: ResolvedWeapon | null, usable: boolean): HTMLElement {
    const reloadAp = this.reloadCost(u);
    const canReload = usable && w !== null && w.def.cls !== 'melee'
      && w.inst.loaded < w.magSize && u.ap >= reloadAp;
    const canOverwatch = usable && w !== null && u.ap >= 2;

    return el(
      'div.act-group',
      {},
      el('div.stencil', {}, 'Weapon'),
      el(
        'div.btn-row',
        {},
        this.apButton('Reload', reloadAp, canReload, () => this.ctrl.doReload()),
        this.apButton(
          'Overwatch',
          Math.max(2, Math.min(u.ap, 6)),
          canOverwatch,
          () => this.ctrl.doOverwatch(),
          '',
          'Bank up to 6 AP as interrupt reserve and fire on the first enemy that moves into view.',
        ),
      ),
    );
  }

  private stanceGroup(u: Unit, usable: boolean): HTMLElement {
    return el(
      'div.act-group',
      {},
      el('div.stencil', {}, 'Stance'),
      el(
        'div.btn-row',
        {},
        ...STANCES.map((s) => {
          const current = u.stance === s;
          const cost = this.stanceCost(u, s);
          const enabled = usable && !current && u.ap >= cost;
          return el(
            'button.btn',
            {
              class: current ? 'is-active' : '',
              disabled: !enabled && !current,
              title: `${STANCE_TABLE[s].label}: ×${STANCE_TABLE[s].hitGiven.toFixed(2)} to hit, ×${STANCE_TABLE[s].hitTaken.toFixed(2)} incoming, ×${STANCE_TABLE[s].moveMul.toFixed(1)} move cost`,
              on: { click: () => { if (enabled) this.ctrl.doStance(s); } },
            },
            STANCE_TABLE[s].label,
            current ? null : el('span.ap-cost', {}, `${cost}`),
          );
        }),
      ),
    );
  }

  private turnGroup(usable: boolean): HTMLElement {
    return el(
      'div.act-group',
      {},
      el('div.stencil', {}, 'Turn'),
      el(
        'div.btn-row',
        {},
        el(
          'button.btn.btn--primary',
          {
            disabled: !usable,
            title: 'End this merc’s turn. Leftover AP is banked as interrupt reserve.',
            on: { click: () => { if (usable) this.ctrl.doEndUnitTurn(); } },
          },
          'End Unit',
        ),
        el(
          'button.btn.btn--danger',
          {
            disabled: !this.ctrl.canAct,
            title: 'Hand the turn to everything else on the map.',
            on: { click: () => { if (this.ctrl.canAct) this.ctrl.endTurn(); } },
          },
          'End Turn',
        ),
      ),
    );
  }

  // ───────────────────────────────────────────────────────────────────── fire control

  private renderRecon(): void {
    const panels: HTMLElement[] = [];
    const u = this.ctrl.selected;
    const w = u ? activeWeapon(u) : null;

    if (u && w && this.ctrl.mode === 'fire') {
      panels.push(this.firePanel(u, w));
    }

    const est = this.ctrl.shotEstimate;
    if (est) panels.push(this.shotPanel(est));

    render(this.reconEl, ...panels);
  }

  private firePanel(u: Unit, w: ResolvedWeapon): HTMLElement {
    const plan = this.ctrl.plan;
    const modes = w.def.modes.length > 0 ? w.def.modes : (['single'] as const);

    const modeRow = el(
      'div.btn-row',
      {},
      ...modes.map((m: FireMode) =>
        el(
          'button.btn.btn--sm',
          {
            class: plan.mode === m ? 'is-active' : '',
            on: { click: () => this.ctrl.setFireMode(m) },
            title: `${roundsFor(w, m)} round(s) per attack`,
          },
          m,
          el('span.ap-cost', {}, `×${roundsFor(w, m)}`),
        ),
      ),
    );

    const aimRow = el('div.aim-row');
    for (let a = 0; a <= MAX_AIM; a++) {
      const cost = shotApCost(u, w, { ...plan, aim: a });
      const affordable = u.ap >= cost;
      aimRow.appendChild(
        el(
          'button.btn.btn--sm',
          {
            class: plan.aim === a ? 'is-active' : '',
            title: affordable
              ? `Aim ${a}: total ${cost} AP`
              : `Aim ${a}: ${cost} AP — not enough`,
            on: { click: () => this.ctrl.setAim(a) },
          },
          el('span.aim-lv', {}, a === 0 ? 'SNAP' : `+${a}`),
          el('span.aim-ap', { class: affordable ? '' : 'bad' }, `${cost} AP`),
        ),
      );
    }

    const fig = el('div.body-fig');
    for (const part of BODY_PARTS) {
      const info = BODY_PART_TABLE[part];
      fig.appendChild(
        el(
          `button.btn.btn--sm.part.part-${part}`,
          {
            class: plan.part === part ? 'is-active' : '',
            title:
              `${info.label}: ×${info.hit.toFixed(2)} to hit, ×${info.damage.toFixed(2)} damage` +
              (info.inflicts ? ` — can inflict ${STATUS_INFO[info.inflicts].label}` : '') +
              (part === 'torso' ? '' : '\nCalled shots need at least one level of aim.'),
            on: { click: () => this.ctrl.setBodyPart(part) },
          },
          el('span', {}, info.label),
          el('span.part-mul', {}, `×${info.hit.toFixed(2)}`),
        ),
      );
    }

    return el(
      'div.panel.panel--notch.fire-panel',
      {},
      el('div.stencil', {}, 'Fire Control'),
      el(
        'div.fire-grid',
        {},
        modeRow,
        el('div.stencil', {}, 'Aim'),
        aimRow,
        el('div.stencil', {}, 'Called Shot'),
        fig,
        plan.part !== 'torso' && plan.aim < 1
          ? el('div.hint.bad', {}, 'Called shots require aim.')
          : el('div.hint', {}, 'Torso is the free shot. Everything else costs aim.'),
      ),
    );
  }

  // ───────────────────────────────────────────────────────────────────── shot readout

  private shotPanel(est: ShotEstimate): HTMLElement {
    const chanceCls = est.chance >= 0.6 ? '' : est.chance >= 0.3 ? '.is-poor' : '.is-bad';

    const warnings: HTMLElement[] = [];
    if (!est.hasLos) warnings.push(el('span.shot-warn', {}, 'No line of sight'));
    if (!est.inRange) warnings.push(el('span.shot-warn', {}, 'Out of range'));
    if (!est.hasAmmo) warnings.push(el('span.shot-warn', {}, 'Empty'));

    const rows = est.breakdown.map((b, i) => {
      // The first entry is the absolute base accuracy; the rest are percentage deltas.
      if (i === 0) {
        return el(
          'div.bd-row.is-base',
          {},
          el('span.bd-label', {}, b.label),
          el('span.bd-val', {}, `${Math.round(b.value)}`),
        );
      }
      const v = Math.round(b.value);
      return el(
        `div.bd-row.${v >= 0 ? 'is-plus' : 'is-minus'}`,
        {},
        el('span.bd-label', {}, b.label),
        el('span.bd-val', {}, `${v >= 0 ? '+' : ''}${v}%`),
      );
    });

    return el(
      'div.panel.panel--notch.panel--hot.shot-panel',
      {},
      el('div.stencil', {}, 'Shot'),
      el(
        'div.shot-head',
        {},
        el(`div.shot-chance${chanceCls}`, {}, pct(est.chance)),
        el(
          'div.shot-meta',
          {},
          el('span.chip.chip--hot', {}, `${est.apCost} AP`),
          el('span.chip', {}, `${est.rounds} rnd`),
          el('span.chip', {}, `${est.distance.toFixed(1)}t`),
          el(
            'span.chip',
            { class: est.cover > 0 ? 'chip--bad' : '' },
            `Cover: ${COVER_LABEL[est.cover] ?? 'None'}`,
          ),
        ),
      ),
      warnings.length > 0 ? el('div.btn-row', {}, ...warnings) : null,
      est.perRound.length > 1
        ? el(
            'div.per-round',
            {},
            'Per round: ',
            ...est.perRound.map((p) => el('span', {}, pct(p))),
          )
        : null,
      el('hr.rule'),
      rows.length > 0
        ? el('div.breakdown', {}, ...rows)
        : el('div.hint', {}, 'No modifiers in play.'),
    );
  }
}
