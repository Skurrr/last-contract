/**
 * The market.
 *
 * One rule runs this whole screen: the player should never wonder why something costs what
 * it costs. Every price is shown as its three factors — the item's list value, the trader's
 * multiplier for that category, and what they think of you — because the interesting decision
 * is not "can I afford this" but "am I buying this from the right people".
 *
 * Traders you are at war with still appear, greyed, with the reason: a closed door is
 * information too.
 */
import './campaign.css';

import {
  MARKET_SPREAD,
  factionStance,
  findMerc,
  priceFor,
  sellPriceFor,
  type CampaignState,
  type MarketKind,
} from '@/campaign';
import { ATTACHMENTS } from '@/data/attachments';
import { MATERIAL_INFO, RECIPES, SCRAP_YIELD } from '@/data/crafting';
import { FACTIONS, type TradeCategory } from '@/data/factions';
import { WEAPONS } from '@/data/weapons';
import type { MaterialId, Materials, WeaponInstance } from '@/sim/types';

import { bar, el, money } from './dom';
import {
  confirmDialog,
  emptyLine,
  factionColor,
  factionName,
  materialChips,
  navBar,
  run,
  weaponDefThumb,
  weaponThumb,
  type CampaignHooks,
} from './screens';

/**
 * Consumables have no def file yet — `src/data/consumables.ts` is referenced by crafting.ts
 * and unwritten, and economy.ts keeps its price/category tables private. This is display
 * metadata only (names and the category badge); every price still comes from `priceFor`.
 */
const CONSUMABLES: Record<string, { label: string; cat: TradeCategory }> = {
  bandage: { label: 'Bandages', cat: 'medicine' },
  medkit: { label: 'Medkit', cat: 'medicine' },
  'trauma-kit': { label: 'Trauma Kit', cat: 'medicine' },
  antibiotics: { label: 'Antibiotics', cat: 'medicine' },
  'adrenaline-shot': { label: 'Adrenaline Shot', cat: 'chems' },
  molotov: { label: 'Molotov', cat: 'weapons' },
  'pipe-bomb': { label: 'Pipe Bomb', cat: 'weapons' },
  'nail-bomb': { label: 'Nail Bomb', cat: 'weapons' },
  noisemaker: { label: 'Noisemaker', cat: 'materials' },
  'road-flare': { label: 'Road Flare', cat: 'materials' },
  'smoke-pot': { label: 'Smoke Pot', cat: 'materials' },
  'repair-kit': { label: 'Repair Kit', cat: 'materials' },
  'armour-patch': { label: 'Armour Patch', cat: 'armour' },
  'ammo-9mm': { label: '9mm', cat: 'ammo' },
  'ammo-45acp': { label: '.45 ACP', cat: 'ammo' },
  'ammo-556': { label: '5.56mm', cat: 'ammo' },
  'ammo-762': { label: '7.62mm', cat: 'ammo' },
  'ammo-12ga': { label: '12 gauge', cat: 'ammo' },
  'ammo-338': { label: '.338', cat: 'ammo' },
};

type BuyTab = 'weapon' | 'attachment' | 'consumable' | 'material' | 'recipe';

const TAB_LABEL: Record<BuyTab, string> = {
  weapon: 'Guns',
  attachment: 'Attachments',
  consumable: 'Supplies',
  material: 'Materials',
  recipe: 'Blueprints',
};

/** Selected trader and catalogue tab, kept across `refresh()`. */
let trader: string | null = null;
let tab: BuyTab = 'weapon';

export function marketScreen(c: CampaignState, hooks: CampaignHooks): HTMLElement {
  if (trader === null || !FACTIONS[trader]) trader = defaultTrader(c);
  const fid = trader;
  // Land on a shelf that is actually stocked — an empty catalogue is a bad first screen.
  if (buyRows(c, fid, hooks).length === 0) {
    const stocked = (Object.keys(TAB_LABEL) as BuyTab[]).find((t) => {
      const was = tab;
      tab = t;
      const n = buyRows(c, fid, hooks).length;
      tab = was;
      return n > 0;
    });
    if (stocked) tab = stocked;
  }

  return el(
    'div.screen.screen--market',
    {},
    navBar(c, 'market', hooks),
    traderBar(c, fid, hooks),
    el(
      'div.mk-body',
      {},
      buyPanel(c, fid, hooks),
      sellPanel(c, fid, hooks),
      pricingPanel(c, fid),
    ),
  );
}

/** Whoever holds the ground you are standing on trades first; otherwise the caravans do. */
function defaultTrader(c: CampaignState): string {
  const holder = c.sectorControl[c.location] ?? null;
  if (holder && FACTIONS[holder]) return holder;
  return FACTIONS['free-traders'] ? 'free-traders' : (Object.keys(FACTIONS)[0] ?? 'free-traders');
}

// ─────────────────────────────────────────────────────────────── trader bar

function traderBar(c: CampaignState, fid: string, hooks: CampaignHooks): HTMLElement {
  const tabs = Object.values(FACTIONS).map((f) => {
    const stance = factionStance(c, f.id);
    return el(
      'button.btn.btn--sm.mk-trader',
      {
        type: 'button',
        class: f.id === fid ? 'is-active' : '',
        style: `--fac:${factionColor(f.id)}`,
        title: `${f.name} — ${stance}`,
        on: {
          click: () => {
            trader = f.id;
            // Selection lives in module scope; `refresh()` rebuilds the screen around it.
            hooks.refresh();
          },
        },
      },
      el('span.mk-trader-dot'),
      f.name,
    );
  });

  const def = FACTIONS[fid];
  const rep = Math.max(-100, Math.min(100, c.reputation[fid] ?? 0));
  const stance = factionStance(c, fid);

  return el(
    'header.panel.mk-top',
    {},
    el('div.mk-traders', {}, ...tabs),
    el(
      'div.mk-trader-id',
      { style: `--fac:${factionColor(fid)}` },
      el('span.mk-trader-name', {}, def?.name ?? fid),
      el('span.chip', { class: `stance-${stance}` }, stance),
      el('span.mk-rep', { class: rep > 0 ? 'good' : rep < 0 ? 'bad' : 'mute' }, `rep ${rep > 0 ? '+' : ''}${rep}`),
      stance === 'war' ? el('span.chip.chip--bad', {}, 'They will not deal with you') : null,
    ),
  );
}

// ─────────────────────────────────────────────────────────────── buying

function buyPanel(c: CampaignState, fid: string, hooks: CampaignHooks): HTMLElement {
  const tabs = (Object.keys(TAB_LABEL) as BuyTab[]).map((t) =>
    el(
      'button.btn.btn--sm',
      {
        type: 'button',
        class: t === tab ? 'is-active' : '',
        on: {
          click: () => {
            tab = t;
            hooks.refresh();
          },
        },
      },
      TAB_LABEL[t],
    ),
  );

  const rows = buyRows(c, fid, hooks);

  return el(
    'section.panel.panel--flush.mk-buy',
    {},
    el('div.panel-title', {}, `Buying from ${factionName(fid)}`),
    el('div.mk-tabs', {}, ...tabs),
    el(
      'div.panel-body.mk-list.scroll',
      {},
      ...(rows.length > 0
        ? rows
        : [emptyLine(`${factionName(fid)} does not deal in ${TAB_LABEL[tab].toLowerCase()}.`)]),
    ),
  );
}

function buyRows(c: CampaignState, fid: string, hooks: CampaignHooks): HTMLElement[] {
  switch (tab) {
    case 'weapon':
      return Object.values(WEAPONS)
        .sort((a, b) => a.value - b.value)
        .map((w) => {
          const p = priceFor(c, 'weapon', w.id, fid);
          if (p === null) return null;
          return itemRow(c, fid, hooks, {
            kind: 'weapon',
            id: w.id,
            name: w.name,
            sub: `${w.cls} · ${w.ammo} · dmg ${w.damage} · mag ${w.magSize}`,
            desc: w.desc,
            rarity: w.rarity,
            price: p,
            art: weaponDefThumb(w.id, 2),
            stack: false,
          });
        })
        .filter((x): x is HTMLElement => x !== null);

    case 'attachment':
      return Object.values(ATTACHMENTS)
        .sort((a, b) => a.slot.localeCompare(b.slot) || a.value - b.value)
        .map((a) => {
          const p = priceFor(c, 'attachment', a.id, fid);
          if (p === null) return null;
          return itemRow(c, fid, hooks, {
            kind: 'attachment',
            id: a.id,
            name: a.name,
            sub: `${a.slot} · ${a.fits.length === 0 ? 'fits all' : a.fits.join(', ')}`,
            desc: a.desc,
            rarity: a.rarity,
            price: p,
            stack: true,
          });
        })
        .filter((x): x is HTMLElement => x !== null);

    case 'consumable':
      return Object.entries(CONSUMABLES)
        .map(([id, info]) => {
          const p = priceFor(c, 'consumable', id, fid);
          if (p === null) return null;
          return itemRow(c, fid, hooks, {
            kind: 'consumable',
            id,
            name: info.label,
            sub: `${info.cat} · you hold ${c.stash.consumables[id] ?? 0}`,
            price: p,
            stack: true,
          });
        })
        .filter((x): x is HTMLElement => x !== null);

    case 'material':
      return (Object.keys(MATERIAL_INFO) as MaterialId[])
        .map((m) => {
          const p = priceFor(c, 'material', m, fid);
          if (p === null) return null;
          const info = MATERIAL_INFO[m];
          return itemRow(c, fid, hooks, {
            kind: 'material',
            id: m,
            name: info.label,
            sub: `you hold ${c.materials[m] ?? 0}`,
            desc: info.desc,
            price: p,
            stack: true,
            swatch: info.color,
          });
        })
        .filter((x): x is HTMLElement => x !== null);

    case 'recipe':
      return Object.values(RECIPES)
        .filter((r) => !c.knownRecipes.includes(r.id))
        .map((r) => {
          const p = priceFor(c, 'recipe', r.id, fid);
          if (p === null) return null;
          return itemRow(c, fid, hooks, {
            kind: 'recipe',
            id: r.id,
            name: r.name,
            sub: `needs mechanical ${r.requiresMechanical} · ${r.days}d at the bench`,
            desc: r.desc,
            price: p,
            stack: false,
          });
        })
        .filter((x): x is HTMLElement => x !== null);
  }
}

interface RowSpec {
  kind: MarketKind;
  id: string;
  name: string;
  sub: string;
  desc?: string | undefined;
  rarity?: 'common' | 'uncommon' | 'rare' | 'exotic' | undefined;
  price: number;
  stack: boolean;
  art?: HTMLElement | undefined;
  swatch?: string | undefined;
}

function itemRow(c: CampaignState, fid: string, hooks: CampaignHooks, spec: RowSpec): HTMLElement {
  const afford = c.cash >= spec.price;
  const buy = (qty: number): void =>
    run(hooks.onBuy(spec.kind, spec.id, fid, qty), hooks);

  return el(
    'div.mk-row',
    { class: spec.rarity ? `rar-border-${spec.rarity}` : '' },
    spec.art ?? (spec.swatch ? el('span.mk-swatch', { style: `background:${spec.swatch}` }) : null),
    el(
      'div.mk-row-id',
      {},
      el('div.mk-row-name', { class: spec.rarity ? `rar-${spec.rarity}` : '' }, spec.name),
      el('div.mk-row-sub', {}, spec.sub),
      el('div.mk-why', {}, priceExplain(c, fid, spec.kind, spec.id, spec.price)),
      spec.desc ? el('div.mk-row-desc', {}, spec.desc) : null,
    ),
    el(
      'div.mk-row-buy',
      {},
      el('div.mk-price', { class: afford ? '' : 'bad' }, money(spec.price)),
      el(
        'div.btn-row',
        {},
        el(
          'button.btn.btn--sm',
          { type: 'button', disabled: !afford, title: afford ? '' : 'Not enough cash', on: { click: () => buy(1) } },
          'Buy',
        ),
        spec.stack
          ? el(
              'button.btn.btn--sm.btn--ghost',
              {
                type: 'button',
                disabled: c.cash < spec.price * 5,
                on: { click: () => buy(5) },
              },
              '×5',
            )
          : null,
      ),
    ),
  );
}

/**
 * The three numbers behind a price. `priceFor` is `base × tradeGoods × (1 − rep/400)`; we
 * know the last factor exactly and read the middle one off the faction, so the only thing
 * we ever have to work backwards is the list value of a consumable (no def file yet).
 */
function priceExplain(c: CampaignState, fid: string, kind: MarketKind, id: string, price: number): string {
  const rep = Math.max(-100, Math.min(100, c.reputation[fid] ?? 0));
  const repMul = 1 - rep / 400;
  const cat = categoryOf(kind, id);
  const tradeMul = cat ? FACTIONS[fid]?.tradeGoods[cat] : undefined;
  const known = baseValueOf(kind, id);
  const base = known ?? (tradeMul ? price / (tradeMul * repMul) : price);

  const parts = [`list $${Math.round(base)}`];
  if (tradeMul !== undefined) parts.push(`${cat} ×${tradeMul.toFixed(2)}`);
  parts.push(`rep ×${repMul.toFixed(2)}`);
  return parts.join(' · ');
}

function baseValueOf(kind: MarketKind, id: string): number | null {
  switch (kind) {
    case 'weapon':
      return WEAPONS[id]?.value ?? null;
    case 'attachment':
      return ATTACHMENTS[id]?.value ?? null;
    case 'material':
      return MATERIAL_INFO[id as MaterialId]?.baseValue ?? null;
    case 'recipe': {
      const r = RECIPES[id];
      return r ? 400 + r.requiresMechanical * 120 : null;
    }
    case 'consumable':
      return null;
  }
}

function categoryOf(kind: MarketKind, id: string): TradeCategory | null {
  switch (kind) {
    case 'weapon':
      return 'weapons';
    case 'attachment':
      return 'attachments';
    case 'material':
      return 'materials';
    case 'recipe':
      return 'recipes';
    case 'consumable':
      return CONSUMABLES[id]?.cat ?? null;
  }
}

// ─────────────────────────────────────────────────────────────── selling

function sellPanel(c: CampaignState, fid: string, hooks: CampaignHooks): HTMLElement {
  const blocks: HTMLElement[] = [];

  // ── guns ──────────────────────────────────────────────────────
  const guns = c.stash.weapons.map((w) => stashWeaponRow(c, fid, w, hooks));
  blocks.push(
    el(
      'div.mk-group',
      {},
      el('span.stencil', {}, `Guns in the stash (${c.stash.weapons.length})`),
      ...(guns.length > 0 ? guns : [emptyLine('No spare guns. Everything you own is on somebody.')]),
    ),
  );

  // ── attachments ───────────────────────────────────────────────
  const attCounts = new Map<string, number>();
  for (const id of c.stash.attachments) attCounts.set(id, (attCounts.get(id) ?? 0) + 1);
  const attRows = [...attCounts.entries()].map(([id, n]) => {
    const att = ATTACHMENTS[id];
    const price = sellPriceFor(c, 'attachment', id, fid);
    return sellRow(c, hooks, {
      name: att?.name ?? id,
      sub: att ? `${att.slot} · ${n} in stock` : `${n} in stock`,
      rarity: att?.rarity,
      price,
      onSell: (qty) => run(hooks.onSell('attachment', id, fid, qty), hooks),
      have: n,
    });
  });
  blocks.push(
    el(
      'div.mk-group',
      {},
      el('span.stencil', {}, 'Attachments'),
      ...(attRows.length > 0 ? attRows : [emptyLine('Nothing loose on the bench.')]),
    ),
  );

  // ── consumables ───────────────────────────────────────────────
  const conRows = Object.entries(c.stash.consumables)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([id, n]) => {
      const price = sellPriceFor(c, 'consumable', id, fid);
      return sellRow(c, hooks, {
        name: CONSUMABLES[id]?.label ?? id,
        sub: `${n} in stock`,
        price,
        onSell: (qty) => run(hooks.onSell('consumable', id, fid, qty), hooks),
        have: n,
      });
    });
  blocks.push(
    el(
      'div.mk-group',
      {},
      el('span.stencil', {}, 'Supplies'),
      ...(conRows.length > 0 ? conRows : [emptyLine('Stores are empty.')]),
    ),
  );

  // ── materials ─────────────────────────────────────────────────
  const matRows = (Object.entries(c.materials) as [MaterialId, number | undefined][])
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([m, n]) => {
      const price = sellPriceFor(c, 'material', m, fid);
      return sellRow(c, hooks, {
        name: MATERIAL_INFO[m]?.label ?? m,
        sub: `${n ?? 0} held`,
        price,
        swatch: MATERIAL_INFO[m]?.color,
        onSell: (qty) => run(hooks.onSell('material', m, fid, qty), hooks),
        have: n ?? 0,
      });
    });
  blocks.push(
    el(
      'div.mk-group',
      {},
      el('span.stencil', {}, 'Materials'),
      ...(matRows.length > 0 ? matRows : [emptyLine('Nothing in stores.')]),
    ),
  );

  return el(
    'section.panel.panel--flush.mk-sell',
    {},
    el(
      'div.panel-title',
      {},
      `Selling to ${factionName(fid)}`,
      el('span.panel-title-note', {}, `they pay ${Math.round(MARKET_SPREAD * 100)}% of ask`),
    ),
    el('div.panel-body.mk-list.scroll', {}, ...blocks),
  );
}

interface SellSpec {
  name: string;
  sub: string;
  rarity?: 'common' | 'uncommon' | 'rare' | 'exotic' | undefined;
  price: number | null;
  swatch?: string | undefined;
  have: number;
  onSell: (qty: number) => void;
}

function sellRow(_c: CampaignState, _hooks: CampaignHooks, spec: SellSpec): HTMLElement {
  return el(
    'div.mk-row.mk-row--sell',
    {},
    spec.swatch ? el('span.mk-swatch', { style: `background:${spec.swatch}` }) : null,
    el(
      'div.mk-row-id',
      {},
      el('div.mk-row-name', { class: spec.rarity ? `rar-${spec.rarity}` : '' }, spec.name),
      el('div.mk-row-sub', {}, spec.sub),
    ),
    el(
      'div.mk-row-buy',
      {},
      el('div.mk-price', { class: spec.price === null ? 'mute' : 'good' }, spec.price === null ? 'not traded' : `+${money(spec.price)}`),
      el(
        'div.btn-row',
        {},
        el(
          'button.btn.btn--sm',
          { type: 'button', disabled: spec.price === null, on: { click: () => spec.onSell(1) } },
          'Sell',
        ),
        spec.have > 1
          ? el(
              'button.btn.btn--sm.btn--ghost',
              { type: 'button', disabled: spec.price === null, on: { click: () => spec.onSell(spec.have) } },
              `All ${spec.have}`,
            )
          : null,
      ),
    ),
  );
}

function stashWeaponRow(c: CampaignState, fid: string, w: WeaponInstance, hooks: CampaignHooks): HTMLElement {
  const def = WEAPONS[w.defId];
  const price = sellPriceFor(c, 'weapon', w.defId, fid, w.condition);
  const cond = Math.max(0, Math.min(100, w.condition));
  const fitted = Object.values(w.attachments).filter((x): x is string => Boolean(x));

  return el(
    'div.mk-row.mk-row--sell',
    { class: def ? `rar-border-${def.rarity}` : '' },
    weaponThumb(w, 2),
    el(
      'div.mk-row-id',
      {},
      el('div.mk-row-name', { class: def ? `rar-${def.rarity}` : '' }, w.customName ?? def?.name ?? w.defId),
      el(
        'div.mk-row-sub',
        {},
        def ? `${def.cls} · ${def.ammo} · ` : 'unknown pattern · ',
        el('span', { class: cond < 40 ? 'bad' : cond < 70 ? 'hot' : 'good' }, `${Math.round(cond)}% condition`),
      ),
      bar(cond / 100, cond < 40 ? 'var(--bad)' : cond < 70 ? 'var(--amber)' : 'var(--lime)', undefined, 'bar--thin'),
      el('div.mk-why', {}, `${Math.round(MARKET_SPREAD * 100)}% of ask × ${Math.round(cond)}% condition`),
      fitted.length > 0
        ? el('div.mk-row-sub', {}, `fitted: ${fitted.map((a) => ATTACHMENTS[a]?.name ?? a).join(', ')}`)
        : null,
    ),
    el(
      'div.mk-row-buy',
      {},
      el('div.mk-price', { class: price === null ? 'mute' : 'good' }, price === null ? 'not traded' : `+${money(price)}`),
      el(
        'div.btn-row',
        {},
        el(
          'button.btn.btn--sm',
          { type: 'button', disabled: price === null, on: { click: () => run(hooks.onSell('weapon', w.uid, fid, 1), hooks) } },
          'Sell',
        ),
        el(
          'button.btn.btn--sm.btn--ghost',
          { type: 'button', on: { click: () => offerScrap(c, w, hooks) } },
          'Scrap',
        ),
      ),
    ),
  );
}

/**
 * Scrapping is irreversible, so the yield is shown first. The formula mirrors
 * `scrapWeapon` in economy.ts — the campaign API has no dry-run, so this is a deliberate
 * duplicate and must move if that formula changes.
 */
function scrapPreview(c: CampaignState, w: WeaponInstance, mercId: string | null): Materials {
  const def = WEAPONS[w.defId];
  if (!def) return {};
  const merc = mercId ? findMerc(c, mercId) : undefined;
  const skill = merc?.attrs.mechanical ?? 3;
  const mul = (0.7 + skill * 0.05) * (0.55 + (Math.max(0, Math.min(100, w.condition)) / 100) * 0.45);
  const out: Materials = {};
  for (const [k, v] of Object.entries(SCRAP_YIELD[def.rarity]) as [MaterialId, number][]) {
    out[k] = Math.max(1, Math.round(v * mul));
  }
  return out;
}

function offerScrap(c: CampaignState, w: WeaponInstance, hooks: CampaignHooks): void {
  // The best mechanic on the roster does the stripping — the player would pick them anyway.
  const best = c.roster.reduce<string | null>(
    (bestId, m) => {
      const cur = bestId ? findMerc(c, bestId)?.attrs.mechanical ?? 0 : -1;
      return m.attrs.mechanical > cur ? m.id : bestId;
    },
    null,
  );
  const yieldOut = scrapPreview(c, w, best);
  const def = WEAPONS[w.defId];
  const fitted = Object.values(w.attachments).filter((x): x is string => Boolean(x));

  confirmDialog(
    `Strip ${w.customName ?? def?.name ?? w.defId}?`,
    [
      el('p', {}, 'The gun is gone for good. Anything bolted to it comes off and stays in the stash.'),
      el('div.kv', {}, el('span', {}, 'Stripped by'), el('span', {}, best ? `${findMerc(c, best)?.defId ?? best} (mech ${findMerc(c, best)?.attrs.mechanical ?? 0})` : 'nobody in particular')),
      el('div.kv', {}, el('span', {}, 'Condition'), el('span', {}, `${Math.round(w.condition)}%`)),
      el('div.scrap-yield', {}, el('span.stencil', {}, 'Expected yield'), materialChips(yieldOut, c.materials)),
      fitted.length > 0
        ? el('div.confirm-warn', {}, `Recovers: ${fitted.map((a) => ATTACHMENTS[a]?.name ?? a).join(', ')}`)
        : el('div.mute', {}, 'Nothing fitted.'),
    ],
    'Strip it',
    () => run(hooks.onScrap(w.uid, best), hooks),
    true,
  );
}

// ─────────────────────────────────────────────────────────────── the ledger

/** Why this trader is the right or wrong one: their whole price list, in one column. */
function pricingPanel(c: CampaignState, fid: string): HTMLElement {
  const def = FACTIONS[fid];
  const rep = Math.max(-100, Math.min(100, c.reputation[fid] ?? 0));
  const repMul = 1 - rep / 400;

  const goods = def
    ? (Object.entries(def.tradeGoods) as [TradeCategory, number | undefined][])
        .filter(([, v]) => v !== undefined)
        .sort((a, b) => (a[1] ?? 1) - (b[1] ?? 1))
    : [];

  return el(
    'aside.panel.panel--flush.mk-info',
    {},
    el('div.panel-title', {}, 'Why it costs that'),
    el(
      'div.panel-body.mk-info-body.scroll',
      {},
      el('p.mk-info-text', {}, def?.blurb ?? 'Nobody trades here.'),
      el('div.rule'),
      el('span.stencil', {}, 'Their multipliers'),
      goods.length === 0
        ? emptyLine('They stock nothing.')
        : el(
            'div.mk-mults',
            {},
            ...goods.map(([cat, mul]) =>
              el(
                'div.mk-mult',
                { class: (mul ?? 1) < 1 ? 'is-cheap' : (mul ?? 1) > 1.15 ? 'is-dear' : '' },
                el('span.mk-mult-k', {}, cat),
                el('span.mk-mult-v', {}, `×${(mul ?? 1).toFixed(2)}`),
              ),
            ),
          ),
      el('div.rule'),
      el('span.stencil', {}, 'Your standing'),
      el('div.kv', {}, el('span', {}, 'Reputation'), el('span', { class: rep > 0 ? 'good' : rep < 0 ? 'bad' : '' }, `${rep > 0 ? '+' : ''}${rep}`)),
      el('div.kv', {}, el('span', {}, 'Price multiplier'), el('span', { class: repMul < 1 ? 'good' : repMul > 1 ? 'bad' : '' }, `×${repMul.toFixed(2)}`)),
      el(
        'p.mk-info-note',
        {},
        'Reputation swings a price ±25% across the full −100…+100 range. Anything they do not ' +
          `stock is simply not for sale here. They buy back at ${Math.round(MARKET_SPREAD * 100)}% of ` +
          'their own asking price, so hauling goods between markets never pays — contracts do.',
      ),
    ),
  );
}
