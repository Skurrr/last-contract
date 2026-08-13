/**
 * The Basin — the strategy screen, and the game's main hub.
 *
 * Everything the player does between battles starts here: where the company is standing,
 * who is paying, who wants them dead, and how close the dead themselves are to walking a
 * row of the map flat. The layout puts the three answers side by side deliberately — the
 * ground, the politics, and the work — because every contract decision is really a decision
 * about all three at once.
 *
 * Hovering a sector only rewrites the briefing panel; it never calls `refresh()`. Hover is a
 * view concern, not a campaign mutation, and rebuilding the whole screen on mousemove would
 * throw away the pointer's own hover state.
 */
import './campaign.css';

import {
  SQUAD_MAX,
  dailyPayroll,
  estimateSuccessChance,
  factionStance,
  findMerc,
  isBusy,
  salaryFor,
  sectorName,
  travelTime,
  type CampaignState,
  type Contract,
  type FactionStance,
} from '@/campaign';
import { ALLIANCE_THRESHOLD, FACTIONS, WAR_THRESHOLD } from '@/data/factions';
import { MAP_H, MAP_W, SECTORS, type SectorDef } from '@/data/sectors';
import { MERCS } from '@/data/mercs';
import { MATERIAL_INFO } from '@/data/crafting';
import { maxHpFor } from '@/sim/progression';
import { mercMods } from '@/campaign';
import type { MaterialId } from '@/sim/types';

import { bar, el, money, pct, render } from './dom';
import { openCharacterSheet } from './characterSheet';
import {
  confirmDialog,
  emptyLine,
  factionColor,
  factionName,
  navBar,
  portrait,
  run,
  threatPips,
  type CampaignHooks,
} from './screens';

/** Sector the briefing panel is currently describing. Survives a `refresh()`. */
let focusedSector: string | null = null;

const STANCE_LABEL: Record<FactionStance, string> = {
  war: 'At war',
  hostile: 'Hostile',
  neutral: 'Neutral',
  friendly: 'Friendly',
  allied: 'Allied',
};

const KIND_LABEL: Record<string, string> = {
  clear: 'Clear',
  defend: 'Defend',
  escort: 'Escort',
  assassinate: 'Assassinate',
  retrieve: 'Retrieve',
  sabotage: 'Sabotage',
};

const sectorById = (id: string): SectorDef | undefined => SECTORS.find((s) => s.id === id);

export function worldMapScreen(c: CampaignState, hooks: CampaignHooks): HTMLElement {
  // A stale focus (loaded save, unknown id) simply falls back to where the company stands.
  if (focusedSector === null || !sectorById(focusedSector)) focusedSector = c.location;

  const briefing = el('div.panel.wm-brief');
  const showSector = (id: string): void => {
    focusedSector = id;
    render(briefing, ...briefingContent(c, id, hooks));
    for (const cell of grid.querySelectorAll('.wm-cell')) {
      cell.classList.toggle('is-focused', (cell as HTMLElement).dataset['sector'] === id);
    }
  };

  const grid = sectorGrid(c, showSector);
  render(briefing, ...briefingContent(c, focusedSector, hooks));

  return el(
    'div.screen.screen--map',
    {},
    navBar(c, 'map', hooks),
    topBar(c, hooks),
    el(
      'div.wm-body',
      {},
      el('div.wm-col.wm-col--map', {}, el('div.panel.wm-mappanel', {}, mapHeader(c), grid), briefing),
      el('div.wm-col.wm-col--side', {}, factionPanel(c), squadPanel(c, hooks)),
      el('div.wm-col.wm-col--board', {}, contractBoard(c, hooks)),
    ),
  );
}

// ─────────────────────────────────────────────────────────────── top bar

function topBar(c: CampaignState, hooks: CampaignHooks): HTMLElement {
  const payroll = dailyPayroll(c);
  const here = sectorById(c.location);
  const active = c.contracts.find((ct) => ct.id === c.activeContractId) ?? null;

  const deployBlocked =
    !active
      ? 'Sign a contract before you deploy.'
      : c.squad.length === 0
        ? 'Nobody is on the deployment list.'
        : null;

  const stat = (k: string, v: string | HTMLElement, cls = ''): HTMLElement =>
    el('div.wm-stat', {}, el('span.wm-stat-k', {}, k), el('span.wm-stat-v', { class: cls }, v));

  return el(
    'header.panel.wm-top',
    {},
    stat('Cash', money(c.cash), c.cash < payroll ? 'bad' : 'hot'),
    stat('Payroll / day', money(payroll), payroll > c.cash ? 'bad' : ''),
    stat('Roster', `${c.roster.length} · squad ${c.squad.length}/${SQUAD_MAX}`),
    stat('Standing at', here?.name ?? c.location),
    hordeMeter(c),
    el(
      'div.wm-top-actions',
      {},
      el(
        'div.btn-row',
        {},
        el(
          'button.btn.btn--sm',
          { type: 'button', title: 'Wait four hours', on: { click: () => run(hooks.onAdvanceTime(4), hooks) } },
          '+4h',
        ),
        el(
          'button.btn.btn--sm',
          { type: 'button', title: 'Rest until tomorrow', on: { click: () => run(hooks.onAdvanceTime(Math.max(1, 24 - c.hour)), hooks) } },
          'Rest',
        ),
      ),
      el(
        'button.btn.btn--primary.wm-deploy',
        {
          type: 'button',
          disabled: deployBlocked !== null,
          title: deployBlocked ?? `Deploy to ${sectorName(active?.targetSector ?? '')}`,
          on: { click: () => active && run(hooks.onDeploy(active.id), hooks) },
        },
        'Deploy',
      ),
    ),
  );
}

/**
 * The horde clock. It is a global threat and it gets the widest element on the bar: a ticked
 * meter that changes colour and starts pulsing once a sweep is genuinely close.
 */
function hordeMeter(c: CampaignState): HTMLElement {
  const v = Math.max(0, Math.min(100, c.hordeClock));
  const state = v >= 80 ? 'is-critical' : v >= 55 ? 'is-high' : '';
  const colour = v >= 80 ? 'var(--bad)' : v >= 55 ? 'var(--rust)' : 'var(--olive-light)';
  const note =
    v >= 80
      ? 'A sweep is imminent.'
      : v >= 55
        ? 'The valley is loud. They are moving.'
        : 'Quiet, for now.';

  return el(
    'div.wm-horde',
    { class: state },
    el(
      'div.wm-horde-head',
      {},
      el('span.stencil', {}, 'Horde Clock'),
      el('span.wm-horde-num', {}, `${Math.round(v)}%`),
    ),
    bar(v / 100, colour, undefined, 'bar--tall bar--ticked'),
    el('div.wm-horde-note', {}, note),
  );
}

// ─────────────────────────────────────────────────────────────── the map

function mapHeader(c: CampaignState): HTMLElement {
  const held = new Map<string, number>();
  for (const s of SECTORS) {
    const owner = c.sectorControl[s.id] ?? null;
    const key = owner ?? 'neutral';
    held.set(key, (held.get(key) ?? 0) + 1);
  }
  const keys = [...Object.keys(FACTIONS), 'neutral'];
  return el(
    'div.wm-maphead',
    {},
    el('span.stencil', {}, 'The Basin'),
    el(
      'div.wm-legend',
      {},
      ...keys.map((id) =>
        el(
          'span.wm-legend-item',
          { title: id === 'neutral' ? 'Contested or empty ground' : factionName(id) },
          el('span.wm-swatch', { style: `background:${factionColor(id === 'neutral' ? null : id)}` }),
          el('span', {}, `${id === 'neutral' ? 'Open' : factionName(id)} ${held.get(id) ?? 0}`),
        ),
      ),
    ),
  );
}

function sectorGrid(c: CampaignState, showSector: (id: string) => void): HTMLElement {
  const cells: HTMLElement[] = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const s = SECTORS.find((sec) => sec.x === x && sec.y === y);
      if (!s) {
        cells.push(el('div.wm-cell.is-void', {}, '—'));
        continue;
      }
      const owner = c.sectorControl[s.id] ?? null;
      const here = c.location === s.id;
      const cleared = c.sectorCleared[s.id] === true;
      const target = c.contracts.some((ct) => ct.targetSector === s.id);
      const isActiveTarget =
        c.activeContractId !== null &&
        c.contracts.find((ct) => ct.id === c.activeContractId)?.targetSector === s.id;

      cells.push(
        el(
          'button.wm-cell',
          {
            type: 'button',
            data: { sector: s.id },
            class: [
              here ? 'is-here' : '',
              cleared ? 'is-cleared' : '',
              isActiveTarget ? 'is-objective' : '',
              focusedSector === s.id ? 'is-focused' : '',
            ]
              .filter(Boolean)
              .join(' '),
            style: `--sec:${factionColor(owner)}`,
            on: { mouseenter: () => showSector(s.id), focus: () => showSector(s.id), click: () => showSector(s.id) },
          },
          el('span.wm-cell-id', {}, s.id.toUpperCase()),
          el('span.wm-cell-name', {}, s.name),
          el(
            'span.wm-cell-foot',
            {},
            threatPips(s.threat, 'threat--sm'),
            here ? el('span.wm-here', { title: 'The company is here' }, '◈') : null,
            !here && target ? el('span.wm-job', { title: 'Work available here' }, '✦') : null,
          ),
        ),
      );
    }
  }
  return el('div.wm-grid', {}, ...cells);
}

/** The briefing for one sector: what it is, who holds it, what it is worth, how far away. */
function briefingContent(c: CampaignState, sectorId: string, hooks: CampaignHooks): HTMLElement[] {
  const s = sectorById(sectorId);
  if (!s) return [el('div.panel-body', {}, emptyLine('No sector selected.'))];

  const owner = c.sectorControl[s.id] ?? null;
  const here = c.location === s.id;
  const hours = travelTime(c.location, s.id);
  const jobs = c.contracts.filter((ct) => ct.targetSector === s.id);

  const scav = (Object.entries(s.scavengeTable) as [MaterialId, number | undefined][])
    .filter(([, w]) => (w ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));

  return [
    el(
      'div.wm-brief-head',
      {},
      el('span.wm-brief-id', {}, s.id.toUpperCase()),
      el('h3.wm-brief-name', {}, s.name),
      el('span.chip', { style: `border-color:${factionColor(owner)};color:${factionColor(owner)}` }, factionName(owner)),
      el('span.chip', {}, s.terrain),
      threatPips(s.threat),
      c.sectorCleared[s.id] === true ? el('span.chip.chip--good', {}, 'Cleared') : null,
    ),
    el('p.wm-brief-blurb', {}, s.blurb),
    s.landmark ? el('div.wm-brief-landmark', {}, el('span.tag', {}, 'Landmark'), s.landmark) : null,
    el(
      'div.wm-brief-grid',
      {},
      el(
        'div.wm-brief-cell',
        {},
        el('span.stencil', {}, 'Scavenge'),
        scav.length === 0
          ? emptyLine('Picked clean.')
          : el(
              'div.wm-scav',
              {},
              ...scav.map(([k, w]) =>
                el(
                  'span.mat-chip',
                  { style: `--mat:${MATERIAL_INFO[k]?.color ?? '#8a7f6d'}`, title: MATERIAL_INFO[k]?.desc ?? k },
                  el('span.mat-dot'),
                  el('span.mat-label', {}, MATERIAL_INFO[k]?.label ?? k),
                  el('span.mat-qty', {}, `×${w ?? 0}`),
                ),
              ),
            ),
      ),
      el(
        'div.wm-brief-cell',
        {},
        el('span.stencil', {}, 'Movement'),
        here
          ? el('div.wm-brief-here', {}, 'The company is standing here.')
          : el(
              'div.wm-brief-travel',
              {},
              el('div.kv', {}, el('span', {}, 'Travel time'), el('span', {}, `${hours}h`)),
              el(
                'button.btn.btn--sm.btn--primary',
                { type: 'button', on: { click: () => run(hooks.onTravel(s.id), hooks) } },
                `Move out (${hours}h)`,
              ),
            ),
        jobs.length > 0
          ? el('div.wm-brief-jobs', {}, `${jobs.length} job${jobs.length === 1 ? '' : 's'} on the board here.`)
          : null,
      ),
    ),
  ].filter((x): x is HTMLElement => x !== null);
}

// ─────────────────────────────────────────────────────────────── politics

/**
 * Five bars from -100 to +100 with the war and alliance thresholds marked on the track, so
 * the player can see how close a relationship is to flipping without doing arithmetic.
 */
function factionPanel(c: CampaignState): HTMLElement {
  const rows = Object.values(FACTIONS).map((f) => {
    const rep = Math.max(-100, Math.min(100, c.reputation[f.id] ?? 0));
    const stance = factionStance(c, f.id);
    const colour = factionColor(f.id);
    const pos = ((rep + 100) / 200) * 100;

    const toAlliance = ALLIANCE_THRESHOLD - rep;
    const toWar = rep - WAR_THRESHOLD;
    const nextNote =
      stance === 'allied'
        ? `${rep - ALLIANCE_THRESHOLD} above the alliance line`
        : stance === 'war'
          ? `${WAR_THRESHOLD - rep} below the war line`
          : toAlliance <= toWar
            ? `+${toAlliance} to an alliance`
            : `−${toWar} to open war`;

    return el(
      'div.fac-row',
      { style: `--fac:${colour}`, title: `${f.name} — ${f.blurb}` },
      el(
        'div.fac-head',
        {},
        el('span.fac-name', {}, f.name),
        el('span.chip', { class: `stance-${stance}` }, STANCE_LABEL[stance]),
        el('span.fac-rep', { class: rep > 0 ? 'good' : rep < 0 ? 'bad' : 'mute' }, rep > 0 ? `+${rep}` : `${rep}`),
      ),
      el(
        'div.fac-track',
        {},
        el('span.fac-zero'),
        el('span.fac-tick.fac-tick--war', { title: `War at ${WAR_THRESHOLD}` }),
        el('span.fac-tick.fac-tick--ally', { title: `Alliance at +${ALLIANCE_THRESHOLD}` }),
        el('span.fac-fill', { style: buildFill(rep, colour) }),
        el('span.fac-marker', { style: `left:${pos}%` }),
      ),
      el('div.fac-note', {}, nextNote),
    );
  });

  return el(
    'section.panel.panel--flush.wm-factions',
    {},
    el('div.panel-title', {}, 'The Powers'),
    el('div.panel-body.wm-factions-body', {}, ...rows),
  );
}

/** Bar grows out from the zero mark in whichever direction the reputation went. */
function buildFill(rep: number, colour: string): string {
  const mid = 50;
  const span = (Math.abs(rep) / 200) * 100;
  const left = rep >= 0 ? mid : mid - span;
  return `left:${left}%;width:${span}%;background:${rep >= 0 ? colour : 'var(--blood)'}`;
}

// ─────────────────────────────────────────────────────────────── the squad

function squadPanel(c: CampaignState, hooks: CampaignHooks): HTMLElement {
  const rows = c.roster.map((m) => {
    const def = MERCS[m.defId];
    const inSquad = c.squad.includes(m.id);
    const busy = isBusy(c, m.id);
    const cap = maxHpFor(m.attrs, m.level, mercMods(m));
    const full = c.squad.length >= SQUAD_MAX && !inSquad;

    const toggle = (): void => {
      const next = inSquad ? c.squad.filter((id) => id !== m.id) : [...c.squad, m.id];
      run(hooks.onSquadChange(next), hooks);
    };

    return el(
      'div.sqd-row',
      { class: [inSquad ? 'is-in' : '', busy ? 'is-busy' : ''].filter(Boolean).join(' ') },
      el(
        'button.sqd-toggle',
        {
          type: 'button',
          disabled: busy || full,
          title: busy ? 'At the workbench' : full ? `No more than ${SQUAD_MAX} in the field` : inSquad ? 'Stand down' : 'Add to the deployment',
          on: { click: toggle },
        },
        inSquad ? '■' : '□',
      ),
      el(
        'button.sqd-id',
        { type: 'button', title: 'Open character sheet', on: { click: () => openCharacterSheet({ state: m, defId: m.defId }) } },
        portrait(m.defId, 1, 'sqd-portrait'),
        el(
          'span.sqd-text',
          {},
          el('span.sqd-name', {}, def?.callsign ?? m.defId),
          el(
            'span.sqd-sub',
            { title: `HP ${m.hp}/${cap} · morale ${Math.round(m.morale)}` },
            `Lv ${m.level} · ${m.hp}hp · ${money(salaryFor(c, m))}/d`,
          ),
        ),
      ),
      el(
        'div.sqd-bars',
        {},
        bar(cap > 0 ? m.hp / cap : 0, m.hp / Math.max(1, cap) < 0.4 ? 'var(--bad)' : 'var(--lime)', undefined, 'bar--thin'),
        bar(m.morale / 100, m.morale < 25 ? 'var(--bad)' : 'var(--cyan)', undefined, 'bar--thin'),
      ),
      busy ? el('span.chip.chip--info', {}, 'Bench') : null,
    );
  });

  return el(
    'section.panel.panel--flush.wm-squad',
    {},
    el(
      'div.panel-title',
      {},
      'Deployment',
      el('span.panel-title-note', {}, `${c.squad.length}/${SQUAD_MAX}`),
    ),
    el(
      'div.panel-body.wm-squad-body.scroll',
      {},
      ...(rows.length > 0 ? rows : [emptyLine('Nobody on the books. Visit the hiring hall.')]),
    ),
  );
}

// ─────────────────────────────────────────────────────────────── the board

function contractBoard(c: CampaignState, hooks: CampaignHooks): HTMLElement {
  const active = c.contracts.find((ct) => ct.id === c.activeContractId) ?? null;
  const others = c.contracts.filter((ct) => ct.id !== c.activeContractId);

  const cards: HTMLElement[] = [];
  if (active) cards.push(contractCard(c, active, hooks, true));
  for (const ct of others) cards.push(contractCard(c, ct, hooks, false));

  return el(
    'section.panel.panel--flush.wm-board',
    {},
    el(
      'div.panel-title',
      {},
      'Contract Board',
      el('span.panel-title-note', {}, `${c.contracts.length} posted`),
    ),
    el(
      'div.panel-body.wm-board-body.scroll',
      {},
      ...(cards.length > 0
        ? cards
        : [emptyLine('Nothing posted. The board fills every couple of days — rest, or make yourself useful.')]),
    ),
  );
}

function contractCard(c: CampaignState, ct: Contract, hooks: CampaignHooks, isActive: boolean): HTMLElement {
  const employer = FACTIONS[ct.employer];
  const colour = factionColor(ct.employer);
  const daysLeft = ct.deadlineDay - c.day;
  const odds = estimateSuccessChance(c, ct);
  const oddsClass = odds >= 0.7 ? 'chip--good' : odds >= 0.45 ? 'chip--hot' : 'chip--bad';

  const repChips = [
    ...Object.entries(ct.repSuccess).map(([fid, d]) =>
      el(
        'span.chip',
        { class: d >= 0 ? 'chip--good' : 'chip--bad', title: `On success: ${factionName(fid)} ${d >= 0 ? '+' : ''}${d}` },
        `${factionName(fid)} ${d >= 0 ? '+' : ''}${d}`,
      ),
    ),
    ...Object.entries(ct.repFailure).map(([fid, d]) =>
      el(
        'span.chip.chip--bad',
        { title: `On failure: ${factionName(fid)} ${d >= 0 ? '+' : ''}${d}` },
        `fail ${factionName(fid)} ${d >= 0 ? '+' : ''}${d}`,
      ),
    ),
  ];

  const canSign = !c.activeContractId && c.squad.length > 0 && factionStance(c, ct.employer) !== 'war';
  const signBlock =
    c.activeContractId && !isActive
      ? 'One job at a time.'
      : c.squad.length === 0
        ? 'Put somebody on the deployment list first.'
        : factionStance(c, ct.employer) === 'war'
          ? 'That employer wants you dead.'
          : null;

  return el(
    'article.ct-card',
    { class: isActive ? 'is-active' : '', style: `--fac:${colour}` },
    el(
      'div.ct-head',
      {},
      el('span.ct-kind', {}, KIND_LABEL[ct.kind] ?? ct.kind),
      el('span.ct-employer', {}, employer?.name ?? ct.employer),
      el('span.ct-pay', {}, money(ct.payment)),
    ),
    el(
      'div.ct-meta',
      {},
      el('span.chip', { title: 'Target sector' }, sectorName(ct.targetSector)),
      threatPips(ct.threat, 'threat--sm'),
      el(
        'span.chip',
        { class: daysLeft <= 1 ? 'chip--bad' : daysLeft <= 3 ? 'chip--hot' : '' },
        daysLeft < 0 ? 'expired' : daysLeft === 0 ? 'due today' : `${daysLeft}d left`,
      ),
      ct.against ? el('span.chip.chip--bad', { title: 'Aimed at' }, `vs ${factionName(ct.against)}`) : el('span.chip', {}, 'vs the dead'),
      el('span.chip', { class: oddsClass, title: 'Estimated odds for the current deployment' }, `${pct(odds)} odds`),
    ),
    el('p.ct-desc', {}, `“${ct.description}”`),
    el('div.ct-obj', {}, el('span.tag', {}, 'Objective'), ct.objectives),
    el('div.ct-reps', {}, ...repChips),
    isActive
      ? el(
          'div.ct-actions',
          {},
          el('span.chip.chip--hot', {}, 'Signed'),
          el(
            'button.btn.btn--sm.btn--primary',
            {
              type: 'button',
              disabled: c.squad.length === 0,
              title: c.squad.length === 0 ? 'Nobody is on the deployment list.' : 'Take the squad in',
              on: { click: () => run(hooks.onDeploy(ct.id), hooks) },
            },
            'Deploy',
          ),
        )
      : el(
          'div.ct-actions',
          {},
          signBlock ? el('span.ct-block', {}, signBlock) : null,
          el(
            'button.btn.btn--sm',
            {
              type: 'button',
              disabled: !canSign,
              on: {
                click: () =>
                  confirmDialog(
                    `Sign with ${employer?.name ?? ct.employer}?`,
                    [
                      el('p', {}, `“${ct.description}”`),
                      el('div.kv', {}, el('span', {}, 'Pay'), el('span', {}, money(ct.payment))),
                      el('div.kv', {}, el('span', {}, 'Where'), el('span', {}, sectorName(ct.targetSector))),
                      el('div.kv', {}, el('span', {}, 'Deadline'), el('span', {}, `day ${ct.deadlineDay}`)),
                      el('div.kv', {}, el('span', {}, 'Squad odds'), el('span', {}, pct(odds))),
                      el(
                        'div.kv',
                        {},
                        el('span', {}, 'Deploying'),
                        el('span', {}, c.squad.map((id) => MERCS[findMerc(c, id)?.defId ?? '']?.callsign ?? id).join(', ') || '—'),
                      ),
                    ],
                    'Sign',
                    () => run(hooks.onAcceptContract(ct.id), hooks),
                  ),
              },
            },
            'Accept',
          ),
        ),
  );
}
