/**
 * The screen manager and the contract between the strategy screens and the game loop.
 *
 * Every strategy screen is a pure `(state, hooks) => HTMLElement`. They never touch the
 * campaign directly and they never mutate their own DOM after a change: they call a hook,
 * the hook mutates the campaign, and `hooks.refresh()` rebuilds the screen from the new
 * state. That is the whole architecture — no diffing, no bindings, no stale views.
 *
 * `CampaignHooks` is the seam. `main.ts` implements it over the real campaign API; the
 * screens know nothing about the game loop, the battle, or persistence.
 */
import type { ActionResult, CampaignState, LogTone, MarketKind } from '@/campaign';
import { FACTIONS } from '@/data/factions';
import { MATERIAL_INFO } from '@/data/crafting';
import { MERCS } from '@/data/mercs';
import { ATTACHMENTS } from '@/data/attachments';
import { WEAPONS } from '@/data/weapons';
import { lookFromPalette, portraitSprite } from '@/art/units';
import { FACTION_COLORS } from '@/art/palette';
import { weaponCard, type WeaponArtSpec } from '@/art/weapons';
import { attachmentKey, weaponBodyKey } from '@/art/spritemap';
import type { AttachmentSlot, MaterialId, Materials, Rarity, WeaponInstance } from '@/sim/types';
import { el, modal, money, render, spriteImg } from './dom';

export type ScreenId = 'map' | 'hiring' | 'market' | 'workshop' | 'battle' | 'afterAction';

/**
 * Mutating hooks may hand back a refusal so the screen can show the reason. Returning
 * nothing is equally valid — the screens treat `void` as "it went through".
 */
export type HookResult = ActionResult | void;

/**
 * Everything the strategy screens need from the outside world.
 *
 * Each `on*` maps onto one campaign API call; the implementation in `main.ts` is expected to
 * be a one-liner that forwards to `src/campaign` and returns its `ActionResult`. `refresh()`
 * must rebuild and re-show the current screen.
 */
export interface CampaignHooks {
  /** Turn the active contract into a battle. Only ever called with a live contract id. */
  onDeploy(contractId: string): HookResult;
  /** `travelTo` — the screens already show the hour cost before calling. */
  onTravel(sectorId: string): HookResult;
  /** `acceptContract` — signs the job and makes it the active one. */
  onAcceptContract(contractId: string): HookResult;
  onHire(defId: string): HookResult;
  onFire(mercId: string): HookResult;
  /** `setSquad` — the full new deployment list, not a delta. */
  onSquadChange(ids: readonly string[]): HookResult;

  onBuy(kind: MarketKind, id: string, factionId: string, qty: number): HookResult;
  /** For weapons, `id` is the stash instance uid; for everything else the def id. */
  onSell(kind: MarketKind, id: string, factionId: string, qty: number): HookResult;
  /** `scrapWeapon`. `mercId` picks whose mechanical rating sets the yield; null = nobody's. */
  onScrap(weaponUid: string, mercId: string | null): HookResult;

  onCraft(recipeId: string, mercId: string): HookResult;
  onCraftImprovised(mercId: string, spend: Materials): HookResult;
  onRepair(weaponUid: string, mercId: string): HookResult;
  /**
   * Fit or clear an attachment. `attachmentId: null` pulls the current fitting off and puts
   * it back in the stash. NOTE: the campaign API has no equivalent — see the report.
   */
  onFitAttachment(weaponUid: string, slot: AttachmentSlot, attachmentId: string | null): HookResult;

  onAdvanceTime(hours: number): HookResult;
  onNavigate(id: ScreenId): void;
  onSave(): HookResult;
  onLoad(): HookResult;
  /** Rebuild the current screen from campaign state. Called after every mutation. */
  refresh(): void;
}

// ─────────────────────────────────────────────────────────────── screen manager

/**
 * Owns one host element and whichever screen is currently in it. Deliberately dumb: it does
 * not build screens, it only swaps them, so the caller keeps control of construction order.
 */
export class ScreenManager {
  current: ScreenId = 'map';
  /** Fired after a screen is mounted, e.g. so `main.ts` can resize a canvas underneath. */
  onChange?: (id: ScreenId, node: HTMLElement) => void;

  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  show(id: ScreenId, node: HTMLElement): void {
    this.current = id;
    render(this.host, node);
    this.host.scrollTop = 0;
    this.onChange?.(id, node);
  }
}

// ─────────────────────────────────────────────────────────────── shared nav

const NAV: readonly { id: ScreenId; label: string; key: string }[] = [
  { id: 'map', label: 'Basin', key: 'F1' },
  { id: 'hiring', label: 'Hiring Hall', key: 'F2' },
  { id: 'market', label: 'Market', key: 'F3' },
  { id: 'workshop', label: 'Workshop', key: 'F4' },
];

/**
 * The strip along the top of every strategy screen. Carries the four destinations, the two
 * numbers the player checks constantly (cash and the clock), and save/load.
 */
export function navBar(c: CampaignState, current: ScreenId, hooks: CampaignHooks): HTMLElement {
  const tabs = NAV.map((n) =>
    el(
      'button.btn.btn--sm.nav-tab',
      {
        type: 'button',
        class: n.id === current ? 'is-active' : '',
        title: n.key,
        on: { click: () => hooks.onNavigate(n.id) },
      },
      n.label,
    ),
  );

  return el(
    'nav.nav',
    {},
    el('span.nav-brand', {}, 'Vulture Co.'),
    el('div.nav-tabs', {}, ...tabs),
    el('div.nav-spacer'),
    el('span.nav-stat', {}, el('span.nav-stat-k', {}, 'Cash'), el('span.nav-stat-v', { class: c.cash < 500 ? 'bad' : '' }, money(c.cash))),
    el('span.nav-stat', {}, el('span.nav-stat-k', {}, 'Day'), el('span.nav-stat-v', {}, `${c.day} · ${String(c.hour).padStart(2, '0')}:00`)),
    el(
      'div.nav-tabs',
      {},
      el('button.btn.btn--sm.btn--ghost', { type: 'button', on: { click: () => run(hooks.onSave(), hooks, 'Saved.') } }, 'Save'),
      el('button.btn.btn--sm.btn--ghost', { type: 'button', on: { click: () => run(hooks.onLoad(), hooks, 'Loaded.') } }, 'Load'),
    ),
  );
}

// ─────────────────────────────────────────────────────────────── shared feedback

/**
 * Run a hook result: refuse loudly, succeed quietly, and always refresh. Every mutating
 * button in every strategy screen goes through this, which is why none of them rebuild DOM
 * by hand.
 */
export function run(result: HookResult, hooks: CampaignHooks, okMessage?: string): void {
  if (result && result.ok === false) {
    toast(result.reason, 'bad');
    return;
  }
  if (okMessage) toast(okMessage, 'good');
  hooks.refresh();
}

let toastHost: HTMLElement | null = null;

/** A transient line of feedback in the bottom-right. Refusals are the main customer. */
export function toast(message: string, tone: LogTone = 'info'): void {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = el('div.toasts');
    document.body.appendChild(toastHost);
  }
  const node = el('div.toast', { class: `tone-${tone}` }, message);
  toastHost.appendChild(node);
  window.setTimeout(() => {
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 320);
  }, 2600);
}

/** Yes/no over a modal. Used for hiring, firing, scrapping — anything you cannot undo. */
export function confirmDialog(
  title: string,
  body: readonly (HTMLElement | string)[],
  confirmLabel: string,
  onConfirm: () => void,
  danger = false,
): void {
  const close = modal(
    el(
      'div.confirm',
      {},
      el('h2', {}, title),
      el('div.confirm-body', {}, ...body),
      el(
        'div.confirm-actions',
        {},
        el('button.btn.btn--ghost', { type: 'button', on: { click: () => close() } }, 'Cancel'),
        el(
          'button.btn',
          {
            type: 'button',
            class: danger ? 'btn--danger' : 'btn--primary',
            on: {
              click: () => {
                close();
                onConfirm();
              },
            },
          },
          confirmLabel,
        ),
      ),
    ),
  );
}

// ─────────────────────────────────────────────────────────────── shared atoms
// Small presentational pieces every strategy screen needs. They live here rather than in
// five copies, and every one of them tolerates an id it has never heard of.

/**
 * A faction's map/dossier tint. `FACTION_COLORS` keys are underscored where faction ids are
 * hyphenated, so we try both before falling back to the faction's own `color`.
 */
export function factionColor(factionId: string | null | undefined): string {
  if (!factionId) return FACTION_COLORS['neutral'] ?? '#6b6b63';
  return (
    FACTION_COLORS[factionId] ??
    FACTION_COLORS[factionId.replace(/-/g, '_')] ??
    FACTIONS[factionId]?.color ??
    FACTION_COLORS['neutral'] ??
    '#6b6b63'
  );
}

export function factionName(factionId: string | null | undefined): string {
  if (!factionId) return 'Nobody';
  return FACTIONS[factionId]?.name ?? factionId;
}

export function mercName(defId: string): string {
  return MERCS[defId]?.callsign ?? defId;
}

/** Threat 1–5 as five boxes. The single most-scanned number on the map. */
export function threatPips(threat: number, className = ''): HTMLElement {
  const n = Math.max(0, Math.min(5, Math.round(threat)));
  const pips = [1, 2, 3, 4, 5].map((i) =>
    el('span.threat-pip', { class: i <= n ? `is-on lv${n}` : '' }),
  );
  return el('span.threat', { class: className, title: `Threat ${n}/5` }, ...pips);
}

/** A merc portrait at `scale`, or an empty frame when the def is unknown. */
export function portrait(defId: string, scale = 3, className = ''): HTMLElement {
  const def = MERCS[defId];
  if (!def) return el('span.portrait-empty', { class: className }, '?');
  const look = lookFromPalette(def.portraitSeed, def.palette);
  return spriteImg(portraitSprite(def.portraitSeed, look, false).toCanvas(scale), className);
}

/** Materials as coloured chips. Optionally checked against what the company actually holds. */
export function materialChips(cost: Materials, have?: Materials): HTMLElement {
  const entries = Object.entries(cost) as [MaterialId, number | undefined][];
  const chips = entries
    .filter(([, v]) => (v ?? 0) !== 0)
    .map(([k, v]) => {
      const info = MATERIAL_INFO[k];
      const held = have ? (have[k] ?? 0) : null;
      const short = held !== null && held < (v ?? 0);
      return el(
        'span.mat-chip',
        {
          class: short ? 'is-short' : '',
          style: `--mat:${info?.color ?? '#8a7f6d'}`,
          title: info?.desc ?? k,
        },
        el('span.mat-dot'),
        el('span.mat-label', {}, info?.label ?? k),
        el('span.mat-qty', {}, held !== null ? `${v ?? 0}/${held}` : `${v ?? 0}`),
      );
    });
  if (chips.length === 0) return el('span.mute', {}, '—');
  return el('span.mat-chips', {}, ...chips);
}

export const RARITY_ORDER: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, exotic: 3 };

/** Empty-state line. Every list in these screens can legitimately be empty. */
export function emptyLine(text: string): HTMLElement {
  return el('div.empty-line', {}, text);
}

// ─────────────────────────────────────────────────────────────── weapon art

/**
 * Forged weapon art for a concrete instance — fitted attachments and wear included. Unknown
 * def ids get a placeholder rather than an exception, because the stash can outlive a rename.
 */
export function weaponThumb(inst: WeaponInstance, scale = 3, className = 'wpn-thumb'): HTMLElement {
  const def = WEAPONS[inst.defId];
  if (!def) return el('span.portrait-empty', { class: className }, '?');
  const attachments = def.slots
    .map((slot) => {
      const id = inst.attachments[slot];
      const att = id ? ATTACHMENTS[id] : undefined;
      return att ? attachmentKey(att.sprite, slot) : null;
    })
    .filter((k): k is NonNullable<typeof k> => k !== null);

  const spec: WeaponArtSpec = {
    body: weaponBodyKey(def.sprite, def.cls),
    attachments,
    condition: Math.max(0, Math.min(100, inst.condition)) / 100,
  };
  return spriteImg(weaponCard(spec, scale), className);
}

/** The same, for a catalogue entry that has no instance yet (the market's buy list). */
export function weaponDefThumb(defId: string, scale = 3, className = 'wpn-thumb'): HTMLElement {
  const def = WEAPONS[defId];
  if (!def) return el('span.portrait-empty', { class: className }, '?');
  return spriteImg(
    weaponCard({ body: weaponBodyKey(def.sprite, def.cls), attachments: [], condition: 1 }, scale),
    className,
  );
}
