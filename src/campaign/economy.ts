/**
 * The market and the workbench.
 *
 * Pricing is one formula with three inputs: the item's authored base value, the seller's
 * `tradeGoods` multiplier for that category, and what they think of you. A category a
 * faction does not list is simply not traded there — the Remnant will not sell you food and
 * Havenhold will not buy your scope.
 *
 * The buy/sell spread is deliberately wide (`MARKET_SPREAD`). It has to be: faction
 * multipliers span 0.7x .. 1.4x, so any spread above 0.30 would let a player with two
 * alliances buy cheap in one market and sell dear in another forever. 0.30 makes the worst
 * arbitrage exactly break even, which is the point — money comes from contracts, not from
 * driving a cart in circles.
 */
import { ATTACHMENTS } from '@/data/attachments';
import { MATERIAL_INFO, RECIPES, SCRAP_YIELD, improvisedQuality } from '@/data/crafting';
import { FACTIONS, type TradeCategory } from '@/data/factions';
import { MERCS } from '@/data/mercs';
import { PERKS } from '@/data/perks';
import { TRAITS } from '@/data/traits';
import { WEAPONS } from '@/data/weapons';
import { makeWeapon, type MercState } from '@/sim/spawn';
import { aggregate, type Mods } from '@/sim/progression';
import type { MaterialId, Materials, WeaponInstance } from '@/sim/types';
import {
  FAIL,
  OK,
  addMaterials,
  clamp,
  nextId,
  takeMaterials,
  withRng,
  type ActionResult,
  type CampaignState,
  type CraftJob,
} from './types';

/** Fraction of the asking price a trader will pay you for the same item. */
export const MARKET_SPREAD = 0.3;

export type MarketKind = 'weapon' | 'attachment' | 'material' | 'consumable' | 'recipe';

/**
 * Consumables have no def file yet (`src/data/consumables.ts` is referenced by crafting.ts
 * but unwritten), so the campaign layer carries their prices until it lands.
 */
const CONSUMABLE_VALUE: Record<string, number> = {
  bandage: 25,
  medkit: 120,
  'trauma-kit': 320,
  antibiotics: 180,
  'adrenaline-shot': 150,
  molotov: 60,
  'pipe-bomb': 90,
  'nail-bomb': 160,
  noisemaker: 45,
  'road-flare': 30,
  'smoke-pot': 70,
  'repair-kit': 110,
  'armour-patch': 95,
  'ammo-9mm': 3,
  'ammo-45acp': 4,
  'ammo-556': 5,
  'ammo-762': 6,
  'ammo-12ga': 5,
  'ammo-338': 14,
};

const CONSUMABLE_CATEGORY: Record<string, TradeCategory> = {
  bandage: 'medicine',
  medkit: 'medicine',
  'trauma-kit': 'medicine',
  antibiotics: 'medicine',
  'adrenaline-shot': 'chems',
  molotov: 'weapons',
  'pipe-bomb': 'weapons',
  'nail-bomb': 'weapons',
  noisemaker: 'materials',
  'road-flare': 'materials',
  'smoke-pot': 'materials',
  'repair-kit': 'materials',
  'armour-patch': 'armour',
  'ammo-9mm': 'ammo',
  'ammo-45acp': 'ammo',
  'ammo-556': 'ammo',
  'ammo-762': 'ammo',
  'ammo-12ga': 'ammo',
  'ammo-338': 'ammo',
};

// ─────────────────────────────────────────────────────────────── merc mods

/** Aggregate a merc's perk and trait modifiers. Used for salary, repair and craft quality. */
export function mercMods(m: MercState): Mods {
  const parts = [];
  for (const id of m.perks) {
    const p = PERKS[id];
    if (p) parts.push(p.mods);
  }
  for (const id of m.traits) {
    const t = TRAITS[id];
    if (t) parts.push(t.mods);
  }
  return aggregate(parts);
}

export function findMerc(c: CampaignState, mercId: string): MercState | undefined {
  return c.roster.find((m) => m.id === mercId);
}

// ─────────────────────────────────────────────────────────────── pricing

function baseValue(kind: MarketKind, id: string): number | null {
  switch (kind) {
    case 'weapon':
      return WEAPONS[id]?.value ?? null;
    case 'attachment':
      return ATTACHMENTS[id]?.value ?? null;
    case 'material':
      return MATERIAL_INFO[id as MaterialId]?.baseValue ?? null;
    case 'consumable':
      return CONSUMABLE_VALUE[id] ?? null;
    case 'recipe':
      // A blueprint is worth what it saves you: roughly ten days of the merc who reads it.
      return RECIPES[id] ? 400 + RECIPES[id]!.requiresMechanical * 120 : null;
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
    case 'consumable':
      return CONSUMABLE_CATEGORY[id] ?? null;
    case 'recipe':
      return 'recipes';
  }
}

/**
 * What `factionId` charges you for one of these, or null if they do not stock the category.
 * Reputation swings the price ±25% across the full -100..100 range.
 */
export function priceFor(
  c: CampaignState,
  kind: MarketKind,
  id: string,
  factionId: string,
): number | null {
  const def = FACTIONS[factionId];
  const base = baseValue(kind, id);
  const cat = categoryOf(kind, id);
  if (!def || base === null || cat === null) return null;
  const tradeMul = def.tradeGoods[cat];
  if (tradeMul === undefined) return null;
  const rep = clamp(c.reputation[factionId] ?? 0, -100, 100);
  return Math.max(1, Math.round(base * tradeMul * (1 - rep / 400)));
}

/** What they will pay you for one. Always well below `priceFor` — see `MARKET_SPREAD`. */
export function sellPriceFor(
  c: CampaignState,
  kind: MarketKind,
  id: string,
  factionId: string,
  condition = 100,
): number | null {
  const ask = priceFor(c, kind, id, factionId);
  if (ask === null) return null;
  return Math.max(1, Math.round(ask * MARKET_SPREAD * clamp(condition, 0, 100) / 100));
}

// ─────────────────────────────────────────────────────────────── buying & selling

/** Buy `qty` of an item from a faction's market. Weapons arrive as used gear. */
export function buy(
  c: CampaignState,
  kind: MarketKind,
  id: string,
  factionId: string,
  qty = 1,
): ActionResult {
  if (qty <= 0) return FAIL('nothing to buy');
  const unit = priceFor(c, kind, id, factionId);
  if (unit === null) return FAIL(`${FACTIONS[factionId]?.name ?? factionId} does not deal in that`);
  const total = unit * qty;
  if (c.cash < total) return FAIL('not enough cash');

  c.cash -= total;
  switch (kind) {
    case 'weapon': {
      for (let i = 0; i < qty; i++) {
        const condition = withRng(c, (rng) => rng.int(62, 96));
        const w = makeWeapon(id, { condition });
        if (!w) {
          c.cash += unit;
          continue;
        }
        w.uid = nextId(c, 'w');
        c.stash.weapons.push(w);
      }
      break;
    }
    case 'attachment':
      for (let i = 0; i < qty; i++) c.stash.attachments.push(id);
      break;
    case 'material':
      addMaterials(c.materials, { [id as MaterialId]: qty });
      break;
    case 'consumable':
      c.stash.consumables[id] = (c.stash.consumables[id] ?? 0) + qty;
      break;
    case 'recipe':
      if (c.knownRecipes.includes(id)) {
        c.cash += total;
        return FAIL('already known');
      }
      c.knownRecipes.push(id);
      break;
  }
  logTrade(c, `Bought ${qty}x ${id} for $${total}.`);
  return OK;
}

/** Sell a stack of materials, consumables, attachments, or a specific weapon by uid. */
export function sell(
  c: CampaignState,
  kind: MarketKind,
  id: string,
  factionId: string,
  qty = 1,
): ActionResult {
  if (qty <= 0) return FAIL('nothing to sell');

  if (kind === 'weapon') {
    const idx = c.stash.weapons.findIndex((w) => w.uid === id);
    const w = c.stash.weapons[idx];
    if (!w) return FAIL('not in the stash');
    const price = sellPriceFor(c, 'weapon', w.defId, factionId, w.condition);
    if (price === null) return FAIL('they do not buy guns');
    c.stash.weapons.splice(idx, 1);
    c.cash += price;
    logTrade(c, `Sold ${WEAPONS[w.defId]?.name ?? w.defId} for $${price}.`);
    return OK;
  }

  const unit = sellPriceFor(c, kind, id, factionId);
  if (unit === null) return FAIL('they do not buy that');

  switch (kind) {
    case 'attachment': {
      let sold = 0;
      for (let i = 0; i < qty; i++) {
        const idx = c.stash.attachments.indexOf(id);
        if (idx < 0) break;
        c.stash.attachments.splice(idx, 1);
        sold += 1;
      }
      if (sold === 0) return FAIL('not in the stash');
      c.cash += unit * sold;
      logTrade(c, `Sold ${sold}x ${id} for $${unit * sold}.`);
      return OK;
    }
    case 'material': {
      const have = c.materials[id as MaterialId] ?? 0;
      const n = Math.min(have, qty);
      if (n === 0) return FAIL('none in stores');
      takeMaterials(c.materials, { [id as MaterialId]: n });
      c.cash += unit * n;
      logTrade(c, `Sold ${n}x ${MATERIAL_INFO[id as MaterialId]?.label ?? id} for $${unit * n}.`);
      return OK;
    }
    case 'consumable': {
      const have = c.stash.consumables[id] ?? 0;
      const n = Math.min(have, qty);
      if (n === 0) return FAIL('none in stores');
      if (n === have) delete c.stash.consumables[id];
      else c.stash.consumables[id] = have - n;
      c.cash += unit * n;
      logTrade(c, `Sold ${n}x ${id} for $${unit * n}.`);
      return OK;
    }
    case 'recipe':
      return FAIL('a blueprint once read cannot be unread');
    default:
      return FAIL('cannot sell that');
  }
}

function logTrade(c: CampaignState, text: string): void {
  c.log.push({ day: c.day, hour: c.hour, text, tone: 'money' });
}

// ─────────────────────────────────────────────────────────────── the bench

/** Break a stashed weapon down for parts. A good mechanic gets more out of it. */
export function scrapWeapon(c: CampaignState, weaponUid: string, mercId?: string): ActionResult {
  const idx = c.stash.weapons.findIndex((w) => w.uid === weaponUid);
  const w = c.stash.weapons[idx];
  if (!w) return FAIL('not in the stash');
  const def = WEAPONS[w.defId];
  if (!def) return FAIL('unknown weapon');

  const merc = mercId ? findMerc(c, mercId) : undefined;
  const skill = merc?.attrs.mechanical ?? 3;
  // Condition matters: a wreck yields less than a working gun.
  const mul = (0.7 + skill * 0.05) * (0.55 + (w.condition / 100) * 0.45);

  const yieldOut: Materials = {};
  for (const [k, v] of Object.entries(SCRAP_YIELD[def.rarity]) as [MaterialId, number][]) {
    const n = Math.max(1, Math.round(v * mul));
    yieldOut[k] = n;
  }
  c.stash.weapons.splice(idx, 1);
  // Fitted attachments come off the gun and stay in the stash.
  for (const attId of Object.values(w.attachments)) {
    if (attId) c.stash.attachments.push(attId);
  }
  addMaterials(c.materials, yieldOut);
  c.log.push({
    day: c.day,
    hour: c.hour,
    text: `Stripped ${def.name} on the bench.`,
    tone: 'info',
  });
  return OK;
}

/** Restore condition with parts and a mechanic. Instant — the cost is materials, not days. */
export function repairWeapon(c: CampaignState, weaponUid: string, mercId: string): ActionResult {
  const w = c.stash.weapons.find((x) => x.uid === weaponUid) ?? weaponOfMerc(c, weaponUid);
  if (!w) return FAIL('no such weapon');
  if (w.condition >= 100) return FAIL('already sound');

  const merc = findMerc(c, mercId);
  if (!merc) return FAIL('no such merc');
  if (isBusy(c, mercId)) return FAIL(`${label(merc)} is at the bench already`);

  const mods = mercMods(merc);
  const missing = 100 - w.condition;
  const cost: Materials = {
    scrap: Math.max(1, Math.ceil((missing / 12) * mods.repairMul)),
    springs: Math.max(1, Math.ceil((missing / 30) * mods.repairMul)),
    tape: Math.max(1, Math.ceil((missing / 25) * mods.repairMul)),
  };
  if (!takeMaterials(c.materials, cost)) return FAIL('not enough parts');

  const restored = clamp(20 + merc.attrs.mechanical * 6, 20, 100);
  w.condition = clamp(w.condition + restored, 0, 100);
  c.log.push({
    day: c.day,
    hour: c.hour,
    text: `${label(merc)} brought ${WEAPONS[w.defId]?.name ?? w.defId} back to ${w.condition}%.`,
    tone: 'good',
  });
  return OK;
}

function weaponOfMerc(c: CampaignState, uid: string): WeaponInstance | undefined {
  for (const m of c.roster) {
    if (m.weapon?.uid === uid) return m.weapon;
    if (m.sidearm?.uid === uid) return m.sidearm;
  }
  return undefined;
}

export function isBusy(c: CampaignState, mercId: string): boolean {
  return c.craftJobs.some((j) => j.mercId === mercId);
}

const label = (m: MercState): string => MERCS[m.defId]?.callsign ?? m.defId;

/** Start a known recipe. Occupies the merc for `recipe.days` and spends the materials now. */
export function craft(c: CampaignState, recipeId: string, mercId: string): ActionResult {
  const recipe = RECIPES[recipeId];
  if (!recipe) return FAIL('no such recipe');
  if (!c.knownRecipes.includes(recipeId)) return FAIL('blueprint not known');

  const merc = findMerc(c, mercId);
  if (!merc) return FAIL('no such merc');
  if (isBusy(c, mercId)) return FAIL(`${label(merc)} is at the bench already`);
  if (merc.attrs.mechanical < recipe.requiresMechanical) {
    return FAIL(`${label(merc)} cannot read the plan`);
  }
  if (!takeMaterials(c.materials, recipe.cost)) return FAIL('not enough materials');

  c.craftJobs.push({
    id: nextId(c, 'job'),
    kind: 'recipe',
    recipeId,
    mercId,
    daysLeft: recipe.days,
  });
  c.log.push({
    day: c.day,
    hour: c.hour,
    text: `${label(merc)} started work on ${recipe.name}.`,
    tone: 'info',
  });
  return OK;
}

/**
 * Recipe-less crafting: hand a merc a pile of parts and see what comes back. Quality is
 * `improvisedQuality(mechanical, roll)` — a poor mechanic on a bad roll produces junk, and
 * a good one occasionally produces a named gun nobody else in the Basin has.
 */
export function craftImprovised(c: CampaignState, mercId: string, spend: Materials): ActionResult {
  const merc = findMerc(c, mercId);
  if (!merc) return FAIL('no such merc');
  if (isBusy(c, mercId)) return FAIL(`${label(merc)} is at the bench already`);

  const total = Object.values(spend).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (total < 6) return FAIL('not enough parts to build anything');
  if (!takeMaterials(c.materials, spend)) return FAIL('not enough materials');

  c.craftJobs.push({
    id: nextId(c, 'job'),
    kind: 'improvised',
    mercId,
    daysLeft: 2,
    spent: { ...spend },
  });
  c.log.push({
    day: c.day,
    hour: c.hour,
    text: `${label(merc)} started improvising something out of ${total} parts.`,
    tone: 'info',
  });
  return OK;
}

/** Cheap, common guns are what an improvised build can realistically imitate. */
const IMPROVISABLE = Object.values(WEAPONS)
  .filter((w) => w.rarity === 'common' && w.cls !== 'thrown')
  .map((w) => w.id)
  .sort();

const CHEAP_ATTACHMENTS = Object.values(ATTACHMENTS)
  .filter((a) => a.value <= 90)
  .map((a) => a.id)
  .sort();

/** Deliver a finished job's output. Called by the dawn tick — see `campaign.ts`. */
export function finishCraftJob(c: CampaignState, job: CraftJob): void {
  const merc = findMerc(c, job.mercId);
  const who = merc ? label(merc) : 'The bench';

  if (job.kind === 'recipe') {
    const recipe = RECIPES[job.recipeId];
    if (!recipe) return;
    const { kind, id, qty } = recipe.output;
    switch (kind) {
      case 'material':
        addMaterials(c.materials, { [id as MaterialId]: qty });
        break;
      case 'consumable':
        c.stash.consumables[id] = (c.stash.consumables[id] ?? 0) + qty;
        break;
      case 'attachment':
        for (let i = 0; i < qty; i++) c.stash.attachments.push(id);
        break;
      case 'weapon': {
        for (let i = 0; i < qty; i++) {
          const w = makeWeapon(id, { condition: 100 });
          if (!w) continue;
          w.uid = nextId(c, 'w');
          c.stash.weapons.push(w);
        }
        break;
      }
    }
    c.log.push({ day: c.day, hour: c.hour, text: `${who} finished ${recipe.name}.`, tone: 'good' });
    return;
  }

  const mechanical = merc?.attrs.mechanical ?? 3;
  const roll = withRng(c, (rng) => rng.next());
  const quality = improvisedQuality(mechanical, roll);
  const defId = withRng(c, (rng) => (IMPROVISABLE.length > 0 ? rng.pick(IMPROVISABLE) : 'pipecarbine'));
  const w = makeWeapon(defId, { condition: quality.condition });
  if (!w) return;
  w.uid = nextId(c, 'w');
  w.customName = improvisedName(c, defId, quality.bonus);
  // A genuinely good build comes off the bench with something bolted to it.
  if (quality.bonus >= 6 && CHEAP_ATTACHMENTS.length > 0) {
    const attId = withRng(c, (rng) => rng.pick(CHEAP_ATTACHMENTS));
    const att = ATTACHMENTS[attId];
    const def = WEAPONS[defId];
    if (att && def && (att.fits.length === 0 || att.fits.includes(def.cls))) {
      w.attachments[att.slot] = attId;
    }
  }
  c.stash.weapons.push(w);
  c.log.push({
    day: c.day,
    hour: c.hour,
    text: `${who} came off the bench with "${w.customName}" (${quality.condition}% condition).`,
    tone: quality.bonus >= 0 ? 'good' : 'info',
  });
}

const GOOD_NAMES = ['Second Opinion', 'Tuesday', 'The Argument', 'Long Story', 'Patience'];
const BAD_NAMES = ['The Mistake', 'Widowmaker (Yours)', 'Coin Toss', 'The Cough'];

function improvisedName(c: CampaignState, defId: string, bonus: number): string {
  const pool = bonus >= 0 ? GOOD_NAMES : BAD_NAMES;
  const pick = withRng(c, (rng) => rng.pick(pool));
  const base = WEAPONS[defId]?.name ?? defId;
  return `${pick} (${base})`;
}
