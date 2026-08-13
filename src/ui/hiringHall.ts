/**
 * The hiring hall.
 *
 * This screen exists to make you care about a name before you pay for it. The numbers are
 * here — salary, signing fee, ten attributes — but they sit under the bio and the quirk,
 * which get the room, because a merc you can describe in one sentence is a merc you will
 * regret losing. Relationship warnings are surfaced *before* the button, not after: hiring
 * someone the roster hates is a legitimate decision, but never an accidental one.
 */
import './campaign.css';

import {
  SQUAD_MAX,
  companySalaryMul,
  dailyPayroll,
  isBusy,
  salaryFor,
  type CampaignState,
} from '@/campaign';
import { MERCS, type MercDef } from '@/data/mercs';
import { TRAITS } from '@/data/traits';
import { WEAPONS } from '@/data/weapons';
import { maxHpFor } from '@/sim/progression';
import { mercMods } from '@/campaign';
import { ATTRIBUTES, type Attribute } from '@/sim/types';
import type { MercState } from '@/sim/spawn';

import { bar, el, money } from './dom';
import { openCharacterSheet } from './characterSheet';
import {
  confirmDialog,
  emptyLine,
  mercName,
  navBar,
  portrait,
  run,
  type CampaignHooks,
} from './screens';

/** Which candidate the dossier is showing. Module-level so a `refresh()` does not lose it. */
let selectedDefId: string | null = null;

const ATTR_LABEL: Record<Attribute, string> = {
  marksmanship: 'Marksmanship',
  agility: 'Agility',
  strength: 'Strength',
  vitality: 'Vitality',
  endurance: 'Endurance',
  wisdom: 'Wisdom',
  leadership: 'Leadership',
  mechanical: 'Mechanical',
  medical: 'Medical',
  explosives: 'Explosives',
};

export function hiringHallScreen(c: CampaignState, hooks: CampaignHooks): HTMLElement {
  const candidates = c.available.map((id) => MERCS[id]).filter((d): d is MercDef => d !== undefined);

  // A stale selection (just hired, save reloaded) falls back to the first candidate.
  if (selectedDefId === null || !c.available.includes(selectedDefId)) {
    selectedDefId = candidates[0]?.id ?? null;
  }
  const selected = selectedDefId ? MERCS[selectedDefId] : undefined;

  return el(
    'div.screen.screen--hiring',
    {},
    navBar(c, 'hiring', hooks),
    hallHeader(c),
    el(
      'div.hh-body',
      {},
      candidateList(c, candidates, hooks),
      el('div.hh-detail.scroll', {}, selected ? dossier(c, selected, hooks) : noCandidates()),
      rosterColumn(c, hooks),
    ),
  );
}

function noCandidates(): HTMLElement {
  return el(
    'div.panel.hh-nobody',
    {},
    el('h2', {}, 'No takers'),
    el(
      'p.hh-nobody-text',
      {},
      'Nobody is asking after work today. Word gets around every couple of weeks — rest, take a ' +
        'contract, and check back. A company with a reputation attracts people; a company without ' +
        'one waits.',
    ),
  );
}

function hallHeader(c: CampaignState): HTMLElement {
  const payroll = dailyPayroll(c);
  const haggle = companySalaryMul(c);
  const stat = (k: string, v: string, cls = ''): HTMLElement =>
    el('div.wm-stat', {}, el('span.wm-stat-k', {}, k), el('span.wm-stat-v', { class: cls }, v));

  return el(
    'header.panel.hh-top',
    {},
    stat('Cash', money(c.cash), c.cash < payroll ? 'bad' : 'hot'),
    stat('Payroll / day', money(payroll)),
    stat('On the books', `${c.roster.length}`),
    stat('Deployment', `${c.squad.length}/${SQUAD_MAX}`),
    haggle < 1
      ? el(
          'div.hh-haggle',
          { title: 'Your best haggler works for everybody — including themselves.' },
          el('span.tag', {}, 'Quartermaster'),
          `every salary is at ×${haggle.toFixed(2)}`,
        )
      : null,
  );
}

// ─────────────────────────────────────────────────────────────── candidates

function candidateList(c: CampaignState, candidates: MercDef[], hooks: CampaignHooks): HTMLElement {
  const rows = candidates.map((d) => {
    const affordable = c.cash >= d.hireCost;
    return el(
      'button.hh-card',
      {
        type: 'button',
        class: [selectedDefId === d.id ? 'is-selected' : '', affordable ? '' : 'is-poor'].filter(Boolean).join(' '),
        on: {
          click: () => {
            selectedDefId = d.id;
            hooks.refresh();
          },
        },
      },
      portrait(d.id, 2, 'hh-card-portrait'),
      el(
        'span.hh-card-text',
        {},
        el('span.hh-card-name', {}, d.callsign),
        el('span.hh-card-real', {}, `${d.realName} · ${d.age}`),
        el(
          'span.hh-card-cost',
          {},
          el('span', { class: affordable ? '' : 'bad' }, `${money(d.hireCost)} fee`),
          el('span.dim', {}, `${money(d.salary)}/day`),
        ),
      ),
    );
  });

  return el(
    'section.panel.panel--flush.hh-list',
    {},
    el('div.panel-title', {}, 'Asking after work', el('span.panel-title-note', {}, `${candidates.length}`)),
    el('div.panel-body.hh-list-body.scroll', {}, ...(rows.length > 0 ? rows : [emptyLine('Nobody today.')])),
  );
}

// ─────────────────────────────────────────────────────────────── the dossier

function dossier(c: CampaignState, d: MercDef, hooks: CampaignHooks): HTMLElement {
  const affordable = c.cash >= d.hireCost;
  const alreadyHired = c.roster.some((m) => m.defId === d.id);
  const dailyAfter = dailyPayroll(c) + Math.round(d.salary * companySalaryMul(c));

  const blocked = alreadyHired
    ? `${d.callsign} already works here.`
    : !affordable
      ? `Short ${money(d.hireCost - c.cash)} of the ${money(d.hireCost)} signing fee.`
      : null;

  const rel = relationships(c, d);

  return el(
    'article.hh-dossier',
    {},
    el(
      'div.panel.hh-doss-head',
      {},
      portrait(d.id, 4, 'hh-doss-portrait'),
      el(
        'div.hh-doss-id',
        {},
        el('h1.hh-doss-callsign', {}, d.callsign),
        el('div.hh-doss-real', {}, `${d.realName} · age ${d.age}`),
        el(
          'div.hh-doss-chips',
          {},
          el('span.chip.chip--hot', {}, `${money(d.hireCost)} to sign`),
          el('span.chip', {}, `${money(d.salary)}/day`),
          ...d.preferredClasses.map((k) => el('span.chip', {}, k)),
        ),
        el(
          'div.hh-doss-actions',
          {},
          el(
            'button.btn.btn--primary',
            {
              type: 'button',
              disabled: blocked !== null,
              title: blocked ?? `Sign ${d.callsign}`,
              on: { click: () => offerContract(c, d, dailyAfter, rel, hooks) },
            },
            `Hire ${d.callsign}`,
          ),
          el(
            'button.btn.btn--ghost',
            { type: 'button', on: { click: () => openCharacterSheet({ defId: d.id }) } },
            'Full sheet',
          ),
        ),
        blocked ? el('div.hh-block', {}, blocked) : null,
      ),
    ),
    el(
      'div.hh-doss-cols',
      {},
      el(
        'div.hh-doss-col',
        {},
        el(
          'section.panel.hh-bio',
          {},
          el('span.stencil', {}, 'File'),
          el('p.hh-bio-text', {}, d.bio),
          el('div.hh-quirk', {}, el('span.hh-quirk-tag', {}, 'Quirk'), el('span.hh-quirk-text', {}, d.quirk)),
        ),
        el(
          'section.panel.hh-rel',
          {},
          el('span.stencil', {}, 'The rest of the company'),
          ...(rel.length > 0
            ? rel.map((r) =>
                el(
                  'div.hh-rel-row',
                  { class: r.good ? 'is-good' : 'is-bad' },
                  el('span.hh-rel-mark', {}, r.good ? '+' : '!'),
                  el('span', {}, r.text),
                ),
              )
            : [emptyLine('No history with anyone on the books. Nothing to manage.')]),
        ),
      ),
      el(
        'div.hh-doss-col',
        {},
        el('section.panel.hh-attrs', {}, el('span.stencil', {}, 'Attributes'), attrGrid(d)),
        el(
          'section.panel.hh-traits',
          {},
          el('span.stencil', {}, 'Traits'),
          ...(d.startingTraits.length > 0
            ? d.startingTraits.map((id) => {
                const t = TRAITS[id];
                if (!t) return el('div.hh-trait', {}, el('span.hh-trait-name', {}, id));
                return el(
                  'div.hh-trait',
                  { class: t.cost >= 0 ? 'is-pos' : 'is-neg' },
                  el('span.hh-trait-name', {}, t.name),
                  el('span.hh-trait-desc', {}, t.desc),
                );
              })
            : [emptyLine('No traits on file.')]),
          el('div.rule'),
          el('span.stencil', {}, 'Kit'),
          el(
            'div.hh-kit',
            {},
            el('div.kv', {}, el('span', {}, 'Carries'), el('span', {}, WEAPONS[d.startingWeapon]?.name ?? d.startingWeapon)),
            d.startingSidearm
              ? el('div.kv', {}, el('span', {}, 'Sidearm'), el('span', {}, WEAPONS[d.startingSidearm]?.name ?? d.startingSidearm))
              : null,
            el('div.kv', {}, el('span', {}, 'Payroll after'), el('span', {}, `${money(dailyAfter)}/day`)),
          ),
        ),
      ),
    ),
  );
}

function attrGrid(d: MercDef): HTMLElement {
  return el(
    'div.hh-attr-grid',
    {},
    ...ATTRIBUTES.map((a) => {
      const v = d.attrs[a] ?? 0;
      const tone = v >= 8 ? 'var(--lime)' : v <= 3 ? 'var(--blood-bright)' : 'var(--khaki)';
      return el(
        'div.hh-attr',
        {},
        el('span.hh-attr-k', {}, ATTR_LABEL[a]),
        bar(v / 10, tone, undefined, 'bar--thin'),
        el('span.hh-attr-v', { class: v >= 8 ? 'good' : v <= 3 ? 'bad' : '' }, `${v}`),
      );
    }),
  );
}

interface Relation {
  good: boolean;
  text: string;
}

/** Both directions matter: they may hate someone here, or someone here may hate them. */
function relationships(c: CampaignState, d: MercDef): Relation[] {
  const out: Relation[] = [];
  for (const m of c.roster) {
    const other = MERCS[m.defId];
    if (!other || other.id === d.id) continue;
    if (d.dislikes.includes(other.id)) out.push({ good: false, text: `${d.callsign} dislikes ${other.callsign}.` });
    if (other.dislikes.includes(d.id)) out.push({ good: false, text: `${other.callsign} dislikes ${d.callsign} — morale drops on signing.` });
    if (d.likes.includes(other.id)) out.push({ good: true, text: `${d.callsign} gets on with ${other.callsign}.` });
    if (other.likes.includes(d.id)) out.push({ good: true, text: `${other.callsign} will be glad to see ${d.callsign}.` });
  }
  return out;
}

function offerContract(
  c: CampaignState,
  d: MercDef,
  dailyAfter: number,
  rel: Relation[],
  hooks: CampaignHooks,
): void {
  const warnings = rel.filter((r) => !r.good);
  confirmDialog(
    `Sign ${d.callsign}?`,
    [
      el('p', {}, d.quirk),
      el('div.kv', {}, el('span', {}, 'Signing fee'), el('span', {}, money(d.hireCost))),
      el('div.kv', {}, el('span', {}, 'Daily salary'), el('span', {}, money(d.salary))),
      el('div.kv', {}, el('span', {}, 'Cash after'), el('span', {}, money(c.cash - d.hireCost))),
      el('div.kv', {}, el('span', {}, 'Payroll after'), el('span', {}, `${money(dailyAfter)}/day`)),
      ...(warnings.length > 0
        ? [el('div.confirm-warn', {}, ...warnings.map((w) => el('div', {}, `⚠ ${w.text}`)))]
        : []),
    ],
    'Sign',
    () => run(hooks.onHire(d.id), hooks, `${d.callsign} signs on.`),
  );
}

// ─────────────────────────────────────────────────────────────── the roster

function rosterColumn(c: CampaignState, hooks: CampaignHooks): HTMLElement {
  const rows = c.roster.map((m) => rosterRow(c, m, hooks));
  return el(
    'section.panel.panel--flush.hh-roster',
    {},
    el('div.panel-title', {}, 'On the books', el('span.panel-title-note', {}, `${c.roster.length}`)),
    el(
      'div.panel-body.hh-roster-body.scroll',
      {},
      ...(rows.length > 0 ? rows : [emptyLine('Empty payroll. That is one way to save money.')]),
    ),
  );
}

function rosterRow(c: CampaignState, m: MercState, hooks: CampaignHooks): HTMLElement {
  const def = MERCS[m.defId];
  const cap = maxHpFor(m.attrs, m.level, mercMods(m));
  const unpaid = c.unpaidDays[m.id] ?? 0;

  return el(
    'div.hh-rr',
    {},
    el(
      'button.hh-rr-id',
      { type: 'button', title: 'Open character sheet', on: { click: () => openCharacterSheet({ state: m, defId: m.defId }) } },
      portrait(m.defId, 1, 'hh-rr-portrait'),
      el(
        'span.hh-rr-text',
        {},
        el('span.hh-rr-name', {}, def?.callsign ?? m.defId),
        el('span.hh-rr-sub', {}, `Lv ${m.level} · ${money(salaryFor(c, m))}/day`),
      ),
    ),
    el(
      'div.hh-rr-bars',
      {},
      bar(cap > 0 ? m.hp / cap : 0, m.hp / Math.max(1, cap) < 0.4 ? 'var(--bad)' : 'var(--lime)', `HP ${m.hp}/${cap}`, 'bar--tall'),
      bar(m.morale / 100, m.morale < 25 ? 'var(--bad)' : 'var(--cyan)', `Morale ${Math.round(m.morale)}`, 'bar--tall'),
    ),
    el(
      'div.hh-rr-foot',
      {},
      isBusy(c, m.id) ? el('span.chip.chip--info', {}, 'At the bench') : null,
      unpaid > 0 ? el('span.chip.chip--bad', {}, `${unpaid}d unpaid`) : null,
      el(
        'button.btn.btn--sm.btn--danger',
        {
          type: 'button',
          on: {
            click: () =>
              confirmDialog(
                `Let ${mercName(m.defId)} go?`,
                [
                  el('p', {}, 'They keep their gear and go back on the hire board. Everyone left loses a little morale.'),
                  el('div.kv', {}, el('span', {}, 'Saves'), el('span', {}, `${money(salaryFor(c, m))}/day`)),
                ],
                'Fire',
                () => run(hooks.onFire(m.id), hooks),
                true,
              ),
          },
        },
        'Fire',
      ),
    ),
  );
}
