/**
 * The workshop: three jobs at one bench.
 *
 *  1. FITTING   — bolt things to guns. The resolved before/after is shown side by side
 *                 *before* you commit, because "does this scope actually help" is the only
 *                 question the attachment system asks and it should never need arithmetic.
 *  2. CRAFTING  — recipes and improvisation. A job occupies a merc for days, which is the
 *                 real cost; the materials are the small part.
 *  3. REPAIR    — condition back into worn guns, paid for in parts.
 *
 * The materials strip sits above all three because every one of them spends from it.
 */
import './campaign.css';

import { findMerc, isBusy, mercMods, type CampaignState } from '@/campaign';
import { ATTACHMENTS } from '@/data/attachments';
import { MATERIAL_INFO, RECIPES, type RecipeDef } from '@/data/crafting';
import { MERCS } from '@/data/mercs';
import { WEAPONS } from '@/data/weapons';
import { resolveWeapon, type ResolvedWeapon } from '@/sim/combat';
import type { MercState } from '@/sim/spawn';
import type { AttachmentSlot, MaterialId, Materials, WeaponInstance } from '@/sim/types';

import { bar, el, money } from './dom';
import {
  emptyLine,
  materialChips,
  mercName,
  navBar,
  run,
  weaponThumb,
  type CampaignHooks,
} from './screens';

type Job = 'fitting' | 'crafting' | 'repair';

const JOB_LABEL: Record<Job, string> = {
  fitting: 'Fitting',
  crafting: 'Crafting',
  repair: 'Repair',
};

const SLOT_LABEL: Record<AttachmentSlot, string> = {
  optic: 'Optic',
  barrel: 'Barrel',
  underbarrel: 'Underbarrel',
  magazine: 'Magazine',
  stock: 'Stock',
  internal: 'Internal',
};

/** All bench selections live here so a `refresh()` lands the player back where they were. */
let job: Job = 'fitting';
let selectedUid: string | null = null;
let selectedSlot: AttachmentSlot | null = null;
let previewAtt: string | null = null;
let benchMercId: string | null = null;
const improvSpend: Materials = {};

export function workshopScreen(c: CampaignState, hooks: CampaignHooks): HTMLElement {
  const guns = allWeapons(c);
  if (selectedUid === null || !guns.some((g) => g.inst.uid === selectedUid)) {
    selectedUid = guns[0]?.inst.uid ?? null;
    selectedSlot = null;
    previewAtt = null;
  }
  if (benchMercId === null || !findMerc(c, benchMercId)) {
    benchMercId = c.roster.find((m) => !isBusy(c, m.id))?.id ?? c.roster[0]?.id ?? null;
  }

  const tabs = (Object.keys(JOB_LABEL) as Job[]).map((j) =>
    el(
      'button.btn.btn--sm',
      {
        type: 'button',
        class: j === job ? 'is-active' : '',
        on: {
          click: () => {
            job = j;
            hooks.refresh();
          },
        },
      },
      JOB_LABEL[j],
    ),
  );

  const body =
    job === 'fitting'
      ? fittingJob(c, guns, hooks)
      : job === 'crafting'
        ? craftingJob(c, hooks)
        : repairJob(c, guns, hooks);

  return el(
    'div.screen.screen--workshop',
    {},
    navBar(c, 'workshop', hooks),
    materialsStrip(c),
    el('div.ws-tabs', {}, ...tabs, benchStatus(c)),
    body,
  );
}

// ─────────────────────────────────────────────────────────────── stores

/** Every material, always, in a fixed order — including the ones you have none of. */
function materialsStrip(c: CampaignState): HTMLElement {
  const cells = (Object.keys(MATERIAL_INFO) as MaterialId[]).map((m) => {
    const info = MATERIAL_INFO[m];
    const n = c.materials[m] ?? 0;
    return el(
      'div.ws-mat',
      { class: n === 0 ? 'is-empty' : '', style: `--mat:${info.color}`, title: info.desc },
      el('span.ws-mat-dot'),
      el('span.ws-mat-k', {}, info.label),
      el('span.ws-mat-v', {}, `${n}`),
    );
  });
  return el(
    'header.panel.ws-stores',
    {},
    el('span.stencil.ws-stores-title', {}, 'Stores'),
    el('div.ws-mats', {}, ...cells),
  );
}

function benchStatus(c: CampaignState): HTMLElement {
  if (c.craftJobs.length === 0) return el('span.ws-bench-note.mute', {}, 'Bench is clear.');
  return el(
    'div.ws-bench-jobs',
    {},
    ...c.craftJobs.map((j) => {
      const who = mercName(findMerc(c, j.mercId)?.defId ?? j.mercId);
      const what = j.kind === 'recipe' ? (RECIPES[j.recipeId]?.name ?? j.recipeId) : 'something improvised';
      return el('span.chip.chip--info', { title: `${who} is at the bench` }, `${who}: ${what} · ${j.daysLeft}d`);
    }),
  );
}

// ─────────────────────────────────────────────────────────────── weapon pool

interface GunEntry {
  inst: WeaponInstance;
  /** Null when the gun is loose in the stash. */
  owner: MercState | null;
  /** 'primary' | 'sidearm' | 'stash' — shown so the player knows what they are editing. */
  where: string;
}

function allWeapons(c: CampaignState): GunEntry[] {
  const out: GunEntry[] = [];
  for (const m of c.roster) {
    if (m.weapon) out.push({ inst: m.weapon, owner: m, where: 'carried' });
    if (m.sidearm) out.push({ inst: m.sidearm, owner: m, where: 'sidearm' });
  }
  for (const w of c.stash.weapons) out.push({ inst: w, owner: null, where: 'stash' });
  return out;
}

function gunLabel(g: GunEntry): string {
  const def = WEAPONS[g.inst.defId];
  return g.inst.customName ?? def?.name ?? g.inst.defId;
}

function gunPicker(c: CampaignState, guns: GunEntry[], hooks: CampaignHooks, filter?: (g: GunEntry) => boolean): HTMLElement {
  const list = filter ? guns.filter(filter) : guns;
  const rows = list.map((g) => {
    const cond = Math.max(0, Math.min(100, g.inst.condition));
    return el(
      'button.ws-gun',
      {
        type: 'button',
        class: g.inst.uid === selectedUid ? 'is-selected' : '',
        on: {
          click: () => {
            selectedUid = g.inst.uid;
            selectedSlot = null;
            previewAtt = null;
            hooks.refresh();
          },
        },
      },
      weaponThumb(g.inst, 2, 'ws-gun-art'),
      el(
        'span.ws-gun-id',
        {},
        el('span.ws-gun-name', {}, gunLabel(g)),
        el(
          'span.ws-gun-sub',
          {},
          g.owner ? `${mercName(g.owner.defId)} · ${g.where} · ` : 'stash · ',
          el('span', { class: cond < 40 ? 'bad' : cond < 70 ? 'hot' : 'good' }, `${Math.round(cond)}%`),
        ),
        bar(cond / 100, cond < 40 ? 'var(--bad)' : cond < 70 ? 'var(--amber)' : 'var(--lime)', undefined, 'bar--thin'),
      ),
    );
  });

  return el(
    'section.panel.panel--flush.ws-guns',
    {},
    el('div.panel-title', {}, 'Guns', el('span.panel-title-note', {}, `${list.length}`)),
    el(
      'div.panel-body.ws-guns-body.scroll',
      {},
      ...(rows.length > 0 ? rows : [emptyLine('Nothing to work on. Every gun is sound and none are loose.')]),
    ),
  );
}

// ─────────────────────────────────────────────────────────────── 1. fitting

function fittingJob(c: CampaignState, guns: GunEntry[], hooks: CampaignHooks): HTMLElement {
  const entry = guns.find((g) => g.inst.uid === selectedUid) ?? null;
  return el(
    'div.ws-body',
    {},
    gunPicker(c, guns, hooks),
    entry ? slotPanel(c, entry, hooks) : el('section.panel', {}, emptyLine('Pick a gun.')),
    entry ? deltaPanel(entry) : el('aside.panel', {}, emptyLine('No gun selected.')),
  );
}

function slotPanel(c: CampaignState, g: GunEntry, hooks: CampaignHooks): HTMLElement {
  const def = WEAPONS[g.inst.defId];
  if (!def) {
    return el('section.panel', {}, emptyLine('This gun is not in the catalogue — nothing can be fitted to it.'));
  }

  const slots = def.slots.map((slot) => {
    const fittedId = g.inst.attachments[slot];
    const fitted = fittedId ? ATTACHMENTS[fittedId] : undefined;
    return el(
      'div.ws-slot',
      { class: [fittedId ? 'is-filled' : '', slot === selectedSlot ? 'is-selected' : ''].filter(Boolean).join(' ') },
      el(
        'button.ws-slot-main',
        {
          type: 'button',
          on: {
            click: () => {
              selectedSlot = slot === selectedSlot ? null : slot;
              previewAtt = null;
              hooks.refresh();
            },
          },
        },
        el('span.ws-slot-k', {}, SLOT_LABEL[slot]),
        el('span.ws-slot-v', {}, fitted?.name ?? (fittedId ? `${fittedId} (unknown)` : '— empty —')),
      ),
      fittedId
        ? el(
            'button.btn.btn--sm.btn--ghost',
            {
              type: 'button',
              title: 'Take it off and put it back in the stash',
              on: { click: () => run(hooks.onFitAttachment(g.inst.uid, slot, null), hooks) },
            },
            'Remove',
          )
        : null,
    );
  });

  return el(
    'section.panel.panel--flush.ws-fit',
    {},
    el('div.panel-title', {}, gunLabel(g), el('span.panel-title-note', {}, `${def.cls} · ${def.ammo}`)),
    el(
      'div.panel-body.ws-fit-body.scroll',
      {},
      el('span.stencil', {}, 'Slots'),
      ...(slots.length > 0 ? slots : [emptyLine('This weapon takes no attachments.')]),
      el('div.rule'),
      selectedSlot
        ? candidateList(c, g, selectedSlot, hooks)
        : el(
            'p.ws-hint',
            {},
            'Pick a slot to see what in the stash fits it. Nothing is committed until you press ' +
              'Fit — the panel on the right shows the resolved change first.',
          ),
    ),
  );
}

function candidateList(c: CampaignState, g: GunEntry, slot: AttachmentSlot, hooks: CampaignHooks): HTMLElement {
  const def = WEAPONS[g.inst.defId];
  const counts = new Map<string, number>();
  for (const id of c.stash.attachments) counts.set(id, (counts.get(id) ?? 0) + 1);

  const candidates = [...counts.entries()]
    .map(([id, n]) => ({ att: ATTACHMENTS[id], n, id }))
    .filter((x) => x.att !== undefined && x.att.slot === slot)
    .filter((x) => !def || x.att!.fits.length === 0 || x.att!.fits.includes(def.cls));

  const rows = candidates.map(({ att, n, id }) =>
    el(
      'div.ws-cand',
      { class: previewAtt === id ? 'is-preview' : '' },
      el(
        'button.ws-cand-main',
        {
          type: 'button',
          title: att?.desc ?? '',
          on: {
            click: () => {
              previewAtt = previewAtt === id ? null : id;
              hooks.refresh();
            },
          },
        },
        el('span.ws-cand-name', { class: att ? `rar-${att.rarity}` : '' }, att?.name ?? id),
        el('span.ws-cand-sub', {}, `${n} in stash`),
      ),
      el(
        'button.btn.btn--sm.btn--primary',
        { type: 'button', on: { click: () => run(hooks.onFitAttachment(g.inst.uid, slot, id), hooks) } },
        'Fit',
      ),
    ),
  );

  return el(
    'div.ws-cands',
    {},
    el('span.stencil', {}, `${SLOT_LABEL[slot]} — in the stash`),
    ...(rows.length > 0
      ? rows
      : [emptyLine(`Nothing in the stash fits the ${SLOT_LABEL[slot].toLowerCase()} of a ${def?.cls ?? 'gun'}.`)]),
    el('p.ws-hint', {}, 'Select one to preview the change, then Fit to commit.'),
  );
}

/** Before and after, resolved through the real combat maths, one row per stat that moved. */
function deltaPanel(g: GunEntry): HTMLElement {
  const before = resolveWeapon(g.inst);
  if (!before) {
    return el('aside.panel.ws-delta', {}, emptyLine('This gun cannot be resolved — unknown pattern.'));
  }

  let after: ResolvedWeapon | null = null;
  if (selectedSlot && previewAtt) {
    const clone: WeaponInstance = {
      ...g.inst,
      attachments: { ...g.inst.attachments, [selectedSlot]: previewAtt },
    };
    after = resolveWeapon(clone);
  }

  const stats: { k: string; v: (r: ResolvedWeapon) => number; better: 'up' | 'down'; dp?: number }[] = [
    { k: 'Damage', v: (r) => r.damage, better: 'up' },
    { k: 'Accuracy', v: (r) => r.accuracy, better: 'up' },
    { k: 'Optimal range', v: (r) => r.rangeOptimal, better: 'up' },
    { k: 'Max range', v: (r) => r.rangeMax, better: 'up' },
    { k: 'AP per shot', v: (r) => r.apCost, better: 'down' },
    { k: 'Magazine', v: (r) => r.magSize, better: 'up' },
    { k: 'Recoil', v: (r) => r.recoil, better: 'down', dp: 2 },
    { k: 'Noise', v: (r) => r.noise, better: 'down' },
    { k: 'Penetration', v: (r) => r.penetration, better: 'up' },
    { k: 'Weight', v: (r) => r.weight, better: 'down', dp: 1 },
    { k: 'Long-range acc.', v: (r) => r.longRangeAccuracy, better: 'up' },
    { k: 'Close-range pen.', v: (r) => r.closeRangePenalty, better: 'down' },
  ];

  const rows = stats.map((s) => {
    const b = s.v(before);
    const a = after ? s.v(after) : b;
    const d = a - b;
    const dp = s.dp ?? 0;
    const moved = Math.abs(d) > 0.005;
    const good = s.better === 'up' ? d > 0 : d < 0;
    return el(
      'div.ws-stat',
      { class: moved ? (good ? 'is-better' : 'is-worse') : '' },
      el('span.ws-stat-k', {}, s.k),
      el('span.ws-stat-b', {}, b.toFixed(dp)),
      el('span.ws-stat-arrow', {}, moved ? '→' : ''),
      el('span.ws-stat-a', {}, moved ? a.toFixed(dp) : ''),
      el('span.ws-stat-d', {}, moved ? `${d > 0 ? '+' : ''}${d.toFixed(dp)}` : ''),
    );
  });

  const att = previewAtt ? ATTACHMENTS[previewAtt] : undefined;

  return el(
    'aside.panel.panel--flush.ws-delta',
    {},
    el('div.panel-title', {}, after ? 'Before / after' : 'As it stands'),
    el(
      'div.panel-body.ws-delta-body.scroll',
      {},
      weaponThumb(g.inst, 4, 'ws-delta-art'),
      el('div.ws-delta-name', {}, before.name),
      att ? el('div.ws-delta-att', {}, el('span.tag', {}, 'Previewing'), att.name) : null,
      att ? el('p.ws-delta-desc', {}, att.desc) : null,
      el('div.rule'),
      ...rows,
      before.condition < 0.4
        ? el('div.ws-warn', {}, 'Below 40% condition — this gun jams. Repair it before it matters.')
        : null,
    ),
  );
}

// ─────────────────────────────────────────────────────────────── 2. crafting

function craftingJob(c: CampaignState, hooks: CampaignHooks): HTMLElement {
  const merc = benchMercId ? findMerc(c, benchMercId) : undefined;

  const known = Object.values(RECIPES).filter((r) => c.knownRecipes.includes(r.id));
  const unknown = Object.values(RECIPES).filter((r) => !c.knownRecipes.includes(r.id));

  return el(
    'div.ws-body.ws-body--craft',
    {},
    benchPanel(c, hooks),
    el(
      'section.panel.panel--flush.ws-recipes',
      {},
      el('div.panel-title', {}, 'Blueprints', el('span.panel-title-note', {}, `${known.length} known`)),
      el(
        'div.panel-body.ws-recipes-body.scroll',
        {},
        ...(known.length > 0
          ? known.map((r) => recipeCard(c, r, merc, hooks, true))
          : [emptyLine('No blueprints. Buy them from the Ash Order and the Remnant.')]),
        unknown.length > 0 ? el('div.rule') : null,
        unknown.length > 0 ? el('span.stencil', {}, 'Not known') : null,
        ...unknown.map((r) => recipeCard(c, r, merc, hooks, false)),
      ),
    ),
    improvisePanel(c, merc, hooks),
  );
}

function recipeCard(
  c: CampaignState,
  r: RecipeDef,
  merc: MercState | undefined,
  hooks: CampaignHooks,
  known: boolean,
): HTMLElement {
  const haveMats = (Object.entries(r.cost) as [MaterialId, number | undefined][]).every(
    ([k, v]) => (c.materials[k] ?? 0) >= (v ?? 0),
  );
  const skilled = merc !== undefined && merc.attrs.mechanical >= r.requiresMechanical;
  const busy = merc !== undefined && isBusy(c, merc.id);

  const block = !known
    ? `Blueprint unknown${r.learnedFrom ? ` — try the ${r.learnedFrom} market.` : '.'}`
    : !merc
      ? 'Nobody at the bench.'
      : busy
        ? `${mercName(merc.defId)} is already working.`
        : !skilled
          ? `${mercName(merc.defId)} cannot read the plan (mechanical ${merc.attrs.mechanical} < ${r.requiresMechanical}).`
          : !haveMats
            ? 'Not enough materials.'
            : null;

  return el(
    'article.ws-recipe',
    { class: known ? '' : 'is-locked' },
    el(
      'div.ws-recipe-head',
      {},
      el('span.ws-recipe-name', {}, r.name),
      el('span.chip', {}, `${r.days}d`),
      el('span.chip', { class: skilled || !merc ? '' : 'chip--bad' }, `mech ${r.requiresMechanical}`),
    ),
    el('p.ws-recipe-desc', {}, r.desc),
    el(
      'div.ws-recipe-io',
      {},
      el('div.ws-recipe-out', {}, el('span.tag', {}, 'Makes'), `${r.output.qty}× ${outputName(r)}`),
      materialChips(r.cost, c.materials),
    ),
    el(
      'div.ws-recipe-foot',
      {},
      block ? el('span.ws-block', {}, block) : null,
      el(
        'button.btn.btn--sm.btn--primary',
        {
          type: 'button',
          disabled: block !== null,
          on: { click: () => merc && run(hooks.onCraft(r.id, merc.id), hooks) },
        },
        'Start',
      ),
    ),
  );
}

function outputName(r: RecipeDef): string {
  switch (r.output.kind) {
    case 'weapon':
      return WEAPONS[r.output.id]?.name ?? r.output.id;
    case 'attachment':
      return ATTACHMENTS[r.output.id]?.name ?? r.output.id;
    case 'material':
      return MATERIAL_INFO[r.output.id as MaterialId]?.label ?? r.output.id;
    case 'consumable':
      return r.output.id;
  }
}

/** Who is at the bench. One merc at a time, and it costs them days in the field. */
function benchPanel(c: CampaignState, hooks: CampaignHooks): HTMLElement {
  const rows = c.roster.map((m) => {
    const busy = isBusy(c, m.id);
    return el(
      'button.ws-hand',
      {
        type: 'button',
        class: [m.id === benchMercId ? 'is-selected' : '', busy ? 'is-busy' : ''].filter(Boolean).join(' '),
        title: busy ? 'Already at the bench' : `${mercName(m.defId)} — mechanical ${m.attrs.mechanical}`,
        on: {
          click: () => {
            benchMercId = m.id;
            hooks.refresh();
          },
        },
      },
      el('span.ws-hand-name', {}, MERCS[m.defId]?.callsign ?? m.defId),
      el('span.ws-hand-mech', {}, `mech ${m.attrs.mechanical}`),
      busy ? el('span.chip.chip--info', {}, 'busy') : null,
    );
  });

  return el(
    'section.panel.panel--flush.ws-bench',
    {},
    el('div.panel-title', {}, 'At the bench'),
    el(
      'div.panel-body.ws-bench-body.scroll',
      {},
      ...(rows.length > 0 ? rows : [emptyLine('Nobody on the roster to put to work.')]),
      el('p.ws-hint', {}, 'A job occupies one merc for its whole run. They cannot deploy while it lasts.'),
    ),
  );
}

const IMPROV_MIN = 6;

function improvisePanel(c: CampaignState, merc: MercState | undefined, hooks: CampaignHooks): HTMLElement {
  const total = Object.values(improvSpend).reduce<number>((a, b) => a + (b ?? 0), 0);
  const busy = merc !== undefined && isBusy(c, merc.id);

  const rows = (Object.keys(MATERIAL_INFO) as MaterialId[]).map((m) => {
    const have = c.materials[m] ?? 0;
    const n = improvSpend[m] ?? 0;
    const step = (d: number): void => {
      const next = Math.max(0, Math.min(have, n + d));
      if (next === 0) delete improvSpend[m];
      else improvSpend[m] = next;
      hooks.refresh();
    };
    return el(
      'div.ws-improv-row',
      { class: have === 0 ? 'is-empty' : '' },
      el('span.ws-mat-dot', { style: `--mat:${MATERIAL_INFO[m].color}` }),
      el('span.ws-improv-k', {}, MATERIAL_INFO[m].label),
      el('span.ws-improv-have', {}, `${have}`),
      el(
        'div.btn-row',
        {},
        el('button.btn.btn--sm.btn--ghost', { type: 'button', disabled: n === 0, on: { click: () => step(-1) } }, '−'),
        el('span.ws-improv-n', {}, `${n}`),
        el('button.btn.btn--sm.btn--ghost', { type: 'button', disabled: n >= have, on: { click: () => step(1) } }, '+'),
      ),
    );
  });

  const block = !merc
    ? 'Nobody at the bench.'
    : busy
      ? `${mercName(merc.defId)} is already working.`
      : total < IMPROV_MIN
        ? `Needs at least ${IMPROV_MIN} parts — you have set aside ${total}.`
        : null;

  return el(
    'aside.panel.panel--flush.ws-improv',
    {},
    el('div.panel-title', {}, 'Improvise'),
    el(
      'div.panel-body.ws-improv-body.scroll',
      {},
      el(
        'p.ws-hint',
        {},
        'Hand somebody a pile of parts and see what comes back. Quality rides on their ' +
          'mechanical rating and a roll — this is where the named one-off guns come from, and ' +
          'also where "The Cough" came from.',
      ),
      ...rows,
      el('div.rule'),
      el('div.kv', {}, el('span', {}, 'Parts committed'), el('span', {}, `${total}`)),
      merc ? el('div.kv', {}, el('span', {}, 'Built by'), el('span', {}, `${mercName(merc.defId)} (mech ${merc.attrs.mechanical})`)) : null,
      block ? el('div.ws-block', {}, block) : null,
      el(
        'button.btn.btn--wide.btn--primary',
        {
          type: 'button',
          disabled: block !== null,
          on: {
            click: () => {
              if (!merc) return;
              const spend = { ...improvSpend };
              for (const k of Object.keys(improvSpend)) delete improvSpend[k as MaterialId];
              run(hooks.onCraftImprovised(merc.id, spend), hooks);
            },
          },
        },
        'Build something',
      ),
    ),
  );
}

// ─────────────────────────────────────────────────────────────── 3. repair

function repairJob(c: CampaignState, guns: GunEntry[], hooks: CampaignHooks): HTMLElement {
  const worn = guns.filter((g) => g.inst.condition < 100);
  const entry = worn.find((g) => g.inst.uid === selectedUid) ?? worn[0] ?? null;
  const merc = benchMercId ? findMerc(c, benchMercId) : undefined;

  return el(
    'div.ws-body',
    {},
    gunPicker(c, worn, hooks),
    benchPanel(c, hooks),
    entry ? repairPanel(c, entry, merc, hooks) : el('aside.panel', {}, emptyLine('Every gun in the company is sound.')),
  );
}

/**
 * Repair cost mirrors `repairWeapon` in economy.ts. The campaign API has no dry-run, so this
 * is a deliberate duplicate — see the report.
 */
function repairCost(missing: number, repairMul: number): Materials {
  return {
    scrap: Math.max(1, Math.ceil((missing / 12) * repairMul)),
    springs: Math.max(1, Math.ceil((missing / 30) * repairMul)),
    tape: Math.max(1, Math.ceil((missing / 25) * repairMul)),
  };
}

function repairPanel(
  c: CampaignState,
  g: GunEntry,
  merc: MercState | undefined,
  hooks: CampaignHooks,
): HTMLElement {
  const cond = Math.max(0, Math.min(100, g.inst.condition));
  const missing = 100 - cond;
  const mul = merc ? mercMods(merc).repairMul : 1;
  const cost = repairCost(missing, mul);
  const restored = merc ? Math.max(20, Math.min(100, 20 + merc.attrs.mechanical * 6)) : 0;
  const after = Math.min(100, cond + restored);
  const haveAll = (Object.entries(cost) as [MaterialId, number | undefined][]).every(
    ([k, v]) => (c.materials[k] ?? 0) >= (v ?? 0),
  );
  const busy = merc !== undefined && isBusy(c, merc.id);

  const block = !merc
    ? 'Nobody at the bench.'
    : busy
      ? `${mercName(merc.defId)} is already working.`
      : !haveAll
        ? 'Not enough parts.'
        : null;

  const def = WEAPONS[g.inst.defId];

  return el(
    'aside.panel.panel--flush.ws-repair',
    {},
    el('div.panel-title', {}, 'Repair'),
    el(
      'div.panel-body.ws-repair-body.scroll',
      {},
      weaponThumb(g.inst, 4, 'ws-delta-art'),
      el('div.ws-delta-name', {}, gunLabel(g)),
      el('div.ws-gun-sub', {}, g.owner ? `${mercName(g.owner.defId)} · ${g.where}` : 'in the stash'),
      def ? el('div.ws-gun-sub', {}, `list value ${money(def.value)} · ${def.rarity}`) : null,
      el('div.rule'),
      el('div.kv', {}, el('span', {}, 'Condition'), el('span', { class: cond < 40 ? 'bad' : '' }, `${Math.round(cond)}%`)),
      bar(cond / 100, cond < 40 ? 'var(--bad)' : cond < 70 ? 'var(--amber)' : 'var(--lime)', undefined, 'bar--tall'),
      cond < 40 ? el('div.ws-warn', {}, 'Below 40% — jams are likely.') : null,
      el('div.rule'),
      el('span.stencil', {}, 'Parts needed'),
      materialChips(cost, c.materials),
      merc
        ? el(
            'div.ws-repair-out',
            {},
            el('div.kv', {}, el('span', {}, 'Worked by'), el('span', {}, `${mercName(merc.defId)} (mech ${merc.attrs.mechanical})`)),
            el('div.kv', {}, el('span', {}, 'Restores'), el('span', { class: 'good' }, `+${restored} → ${Math.round(after)}%`)),
            mul !== 1 ? el('div.kv', {}, el('span', {}, 'Parts multiplier'), el('span', {}, `×${mul.toFixed(2)}`)) : null,
          )
        : null,
      block ? el('div.ws-block', {}, block) : null,
      el(
        'button.btn.btn--wide.btn--primary',
        {
          type: 'button',
          disabled: block !== null,
          on: { click: () => merc && run(hooks.onRepair(g.inst.uid, merc.id), hooks) },
        },
        'Repair',
      ),
    ),
  );
}
