/**
 * The after-action report — the reward moment.
 *
 * A battle is over the instant the last hostile drops; this screen is where it becomes
 * *worth something*. Everything is itemised and attributed: XP with the reason it was
 * earned, loot as rarity-tiered cards that deal themselves out one at a time, casualties
 * named rather than counted, and one merc of the match, because someone always carried it.
 *
 * The report is a value produced by the caller. This module never reads campaign state, so
 * the same screen renders a real battle, an auto-resolve, or a fixture in a test page.
 */
import './campaign.css';

import { MERCS } from '@/data/mercs';
import { ATTACHMENTS } from '@/data/attachments';
import { MATERIAL_INFO } from '@/data/crafting';
import { WEAPONS } from '@/data/weapons';
import type { MaterialId, Materials, Rarity, WeaponInstance } from '@/sim/types';

import { bar, el, money } from './dom';
import {
  emptyLine,
  factionColor,
  factionName,
  materialChips,
  portrait,
  weaponDefThumb,
  weaponThumb,
} from './screens';

/** One line of the XP table: what a merc did, and what it was worth. */
export interface AfterActionXp {
  label: string;
  xp: number;
}

export interface AfterActionMerc {
  /** Campaign merc id. */
  id: string;
  /** MercDef id, for the portrait and callsign. Falls back to `id` when omitted. */
  defId?: string;
  xpGained: number;
  /** Itemised breakdown. Omit for a bare total. */
  xpReasons?: readonly AfterActionXp[];
  kills: number;
  damageDealt: number;
  damageTaken: number;
  /** Set when this battle pushed them over a level boundary. */
  levelledTo?: number;
  /** They did not walk off the field. */
  died?: boolean;
}

export interface AfterActionLoot {
  kind: 'weapon' | 'attachment' | 'consumable';
  /** Def id — weapon/attachment/consumable id. */
  id: string;
  qty?: number;
  /** The actual instance, when one exists: the card then shows its wear and fittings. */
  weapon?: WeaponInstance;
  /** Overrides the rarity looked up from the catalogue. */
  rarity?: Rarity;
}

export interface AfterActionRep {
  factionId: string;
  delta: number;
}

export interface AfterActionReport {
  outcome: 'victory' | 'defeat';
  turns: number;
  mercs: readonly AfterActionMerc[];
  /** Net cash from the job: payment plus anything taken off bodies, less field costs. */
  cash: number;
  loot: readonly AfterActionLoot[];
  materials: Materials;
  repChanges: readonly AfterActionRep[];
  /** Campaign merc id, or null when nobody stood out (or nobody survived). */
  mercOfTheMatch: string | null;
  /** Campaign merc ids of the dead. */
  casualties?: readonly string[];
  /** Optional header dressing: where this happened and who paid for it. */
  sectorName?: string;
  employerId?: string;
  contractKind?: string;
}

/**
 * @param report what happened
 * @param onContinue wired to the "Back to the Basin" button; omitted in previews
 */
export function afterActionScreen(report: AfterActionReport, onContinue?: () => void): HTMLElement {
  const win = report.outcome === 'victory';

  return el(
    'div.screen.screen--aar',
    {},
    banner(report, onContinue),
    el(
      'div.aar-body',
      {},
      el('div.aar-col.aar-col--main', {}, xpPanel(report), lootPanel(report)),
      el('div.aar-col.aar-col--side', {}, payPanel(report), politicsPanel(report), casualtyPanel(report)),
    ),
    !win && report.mercs.length === 0 ? emptyLine('Nobody came back to file a report.') : null,
  );
}

// ─────────────────────────────────────────────────────────────── banner

function banner(r: AfterActionReport, onContinue?: () => void): HTMLElement {
  const win = r.outcome === 'victory';
  const where = r.sectorName ? ` — ${r.sectorName}` : '';
  const who = r.employerId ? factionName(r.employerId) : null;

  return el(
    'header.aar-banner',
    { class: win ? 'is-win' : 'is-loss', style: r.employerId ? `--fac:${factionColor(r.employerId)}` : '' },
    el(
      'div.aar-banner-id',
      {},
      el('h1.aar-title', {}, win ? 'Contract Complete' : 'Contract Failed'),
      el(
        'div.aar-sub',
        {},
        `${r.turns} turn${r.turns === 1 ? '' : 's'}${where}`,
        who ? el('span.chip', {}, who) : null,
        r.contractKind ? el('span.chip', {}, r.contractKind) : null,
      ),
    ),
    el('div.aar-banner-cash', { class: r.cash >= 0 ? 'good' : 'bad' }, `${r.cash >= 0 ? '+' : ''}${money(r.cash)}`),
    onContinue
      ? el('button.btn.btn--primary.aar-continue', { type: 'button', on: { click: () => onContinue() } }, 'Back to the Basin')
      : null,
  );
}

// ─────────────────────────────────────────────────────────────── XP

function xpPanel(r: AfterActionReport): HTMLElement {
  const best = r.mercOfTheMatch;
  const rows = r.mercs.map((m) => mercRow(m, m.id === best, r));

  return el(
    'section.panel.panel--flush.aar-xp',
    {},
    el('div.panel-title', {}, 'The squad', el('span.panel-title-note', {}, `${r.mercs.length} deployed`)),
    el('div.panel-body.aar-xp-body.scroll', {}, ...(rows.length > 0 ? rows : [emptyLine('No squad on file.')])),
  );
}

function mercRow(m: AfterActionMerc, isBest: boolean, r: AfterActionReport): HTMLElement {
  const defId = m.defId ?? m.id;
  const def = MERCS[defId];
  const died = m.died === true || (r.casualties?.includes(m.id) ?? false);
  const maxXp = Math.max(1, ...r.mercs.map((x) => x.xpGained));

  const reasons = m.xpReasons ?? [];

  return el(
    'article.aar-merc',
    { class: [isBest ? 'is-best' : '', died ? 'is-dead' : ''].filter(Boolean).join(' ') },
    el(
      'div.aar-merc-head',
      {},
      portrait(defId, 2, 'aar-merc-portrait'),
      el(
        'div.aar-merc-id',
        {},
        el(
          'div.aar-merc-name',
          {},
          def?.callsign ?? defId,
          isBest ? el('span.aar-medal', { title: 'Merc of the match' }, '★ Merc of the match') : null,
          died ? el('span.chip.chip--bad', {}, 'KIA') : null,
        ),
        el(
          'div.aar-merc-stats',
          {},
          el('span', {}, `${m.kills} kill${m.kills === 1 ? '' : 's'}`),
          el('span', {}, `${Math.round(m.damageDealt)} dealt`),
          el('span', { class: m.damageTaken > 0 ? 'bad' : '' }, `${Math.round(m.damageTaken)} taken`),
        ),
      ),
      el(
        'div.aar-merc-xp',
        {},
        el('span.aar-xp-num', {}, `+${m.xpGained} XP`),
        m.levelledTo !== undefined ? el('span.chip.chip--hot', {}, `Level ${m.levelledTo}`) : null,
      ),
    ),
    bar(m.xpGained / maxXp, isBest ? 'var(--gold)' : 'var(--cyan)', undefined, 'bar--thin'),
    reasons.length > 0
      ? el(
          'div.aar-reasons',
          {},
          ...reasons.map((x) =>
            el('div.aar-reason', {}, el('span.aar-reason-k', {}, x.label), el('span.aar-reason-v', {}, `+${x.xp}`)),
          ),
        )
      : null,
  );
}

// ─────────────────────────────────────────────────────────────── loot

const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  exotic: 'Exotic',
};

function rarityOf(l: AfterActionLoot): Rarity {
  if (l.rarity) return l.rarity;
  if (l.kind === 'weapon') return WEAPONS[l.weapon?.defId ?? l.id]?.rarity ?? 'common';
  if (l.kind === 'attachment') return ATTACHMENTS[l.id]?.rarity ?? 'common';
  return 'common';
}

function lootName(l: AfterActionLoot): string {
  if (l.kind === 'weapon') {
    return l.weapon?.customName ?? WEAPONS[l.weapon?.defId ?? l.id]?.name ?? l.id;
  }
  if (l.kind === 'attachment') return ATTACHMENTS[l.id]?.name ?? l.id;
  return l.id;
}

const RARITY_RANK: Record<Rarity, number> = { exotic: 0, rare: 1, uncommon: 2, common: 3 };

/** Rarity-tiered reveal: best first, dealt out on a stagger so each card lands on its own. */
function lootPanel(r: AfterActionReport): HTMLElement {
  const sorted = [...r.loot].sort((a, b) => RARITY_RANK[rarityOf(a)] - RARITY_RANK[rarityOf(b)]);

  const cards = sorted.map((l, i) => {
    const rar = rarityOf(l);
    const art =
      l.kind === 'weapon'
        ? l.weapon
          ? weaponThumb(l.weapon, 3, 'aar-loot-art')
          : weaponDefThumb(l.id, 3, 'aar-loot-art')
        : null;

    return el(
      'article.aar-loot',
      { class: `rar-border-${rar} rar-${rar}`, style: `animation-delay:${Math.min(i, 12) * 80}ms` },
      el('div.aar-loot-rar', {}, RARITY_LABEL[rar]),
      art,
      el('div.aar-loot-name', {}, lootName(l)),
      el(
        'div.aar-loot-sub',
        {},
        l.kind === 'weapon'
          ? `${WEAPONS[l.weapon?.defId ?? l.id]?.cls ?? 'weapon'}${l.weapon ? ` · ${Math.round(l.weapon.condition)}%` : ''}`
          : l.kind === 'attachment'
            ? (ATTACHMENTS[l.id]?.slot ?? 'attachment')
            : `supply${(l.qty ?? 1) > 1 ? ` ×${l.qty}` : ''}`,
      ),
    );
  });

  const mats = (Object.entries(r.materials) as [MaterialId, number | undefined][]).filter(
    ([, v]) => (v ?? 0) > 0,
  );

  return el(
    'section.panel.panel--flush.aar-lootpanel',
    {},
    el('div.panel-title', {}, 'Recovered', el('span.panel-title-note', {}, `${r.loot.length} item${r.loot.length === 1 ? '' : 's'}`)),
    el(
      'div.panel-body.aar-loot-body',
      {},
      cards.length > 0 ? el('div.aar-loot-grid', {}, ...cards) : emptyLine('Nothing worth carrying out.'),
      mats.length > 0 ? el('div.rule') : null,
      mats.length > 0 ? el('span.stencil', {}, 'Salvage') : null,
      mats.length > 0
        ? materialChips(Object.fromEntries(mats) as Materials)
        : null,
      mats.length === 0 && cards.length === 0
        ? el('p.aar-nothing', {}, 'The dead carry nothing worth taking. They never do.')
        : null,
    ),
  );
}

// ─────────────────────────────────────────────────────────────── side column

function payPanel(r: AfterActionReport): HTMLElement {
  const totalXp = r.mercs.reduce((a, m) => a + m.xpGained, 0);
  const kills = r.mercs.reduce((a, m) => a + m.kills, 0);
  const mats = (Object.entries(r.materials) as [MaterialId, number | undefined][]).reduce(
    (a, [, v]) => a + (v ?? 0),
    0,
  );

  return el(
    'section.panel.panel--flush.aar-pay',
    {},
    el('div.panel-title', {}, 'The ledger'),
    el(
      'div.panel-body',
      {},
      el('div.kv', {}, el('span', {}, 'Cash'), el('span', { class: r.cash >= 0 ? 'good' : 'bad' }, money(r.cash))),
      el('div.kv', {}, el('span', {}, 'XP awarded'), el('span', {}, `${totalXp}`)),
      el('div.kv', {}, el('span', {}, 'Kills'), el('span', {}, `${kills}`)),
      el('div.kv', {}, el('span', {}, 'Turns'), el('span', {}, `${r.turns}`)),
      el('div.kv', {}, el('span', {}, 'Materials'), el('span', {}, `${mats}`)),
    ),
  );
}

function politicsPanel(r: AfterActionReport): HTMLElement {
  const rows = r.repChanges
    .filter((x) => x.delta !== 0)
    .map((x) =>
      el(
        'div.aar-rep',
        { style: `--fac:${factionColor(x.factionId)}` },
        el('span.aar-rep-name', {}, factionName(x.factionId)),
        el('span.aar-rep-d', { class: x.delta > 0 ? 'good' : 'bad' }, `${x.delta > 0 ? '+' : ''}${x.delta}`),
      ),
    );

  return el(
    'section.panel.panel--flush.aar-politics',
    {},
    el('div.panel-title', {}, 'Word gets around'),
    el(
      'div.panel-body',
      {},
      ...(rows.length > 0 ? rows : [emptyLine('Nobody who matters noticed.')]),
      rows.length > 0
        ? el('p.aar-note', {}, 'Every favour is an insult to somebody. Their enemies moved too.')
        : null,
    ),
  );
}

function casualtyPanel(r: AfterActionReport): HTMLElement {
  const dead = new Set<string>(r.casualties ?? []);
  for (const m of r.mercs) if (m.died === true) dead.add(m.id);

  const rows = [...dead].map((id) => {
    const m = r.mercs.find((x) => x.id === id);
    const defId = m?.defId ?? id;
    return el(
      'div.aar-kia',
      {},
      portrait(defId, 1, 'aar-kia-portrait'),
      el(
        'div.aar-kia-id',
        {},
        el('span.aar-kia-name', {}, MERCS[defId]?.callsign ?? defId),
        el('span.aar-kia-sub', {}, MERCS[defId]?.realName ?? 'unrecorded'),
      ),
    );
  });

  return el(
    'section.panel.panel--flush.aar-kias',
    { class: rows.length > 0 ? 'is-grim' : '' },
    el('div.panel-title', {}, rows.length > 0 ? 'Did not come back' : 'Everybody walked'),
    el(
      'div.panel-body',
      {},
      ...(rows.length > 0
        ? [...rows, el('p.aar-note', {}, 'Permanent. Their kit is in the stash; they are not.')]
        : [el('p.aar-note', {}, 'The whole squad is accounted for. Rare enough to be worth saying.')]),
    ),
  );
}
