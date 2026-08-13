/**
 * The character sheet — the screen where a merc stops being a statblock and becomes a person.
 *
 * It renders from whatever we have: a live battlefield `Unit`, a campaign `MercState`, or
 * neither (just a `defId`, e.g. the hire screen). Nothing here throws on missing data — an
 * unknown weapon id, a merc with no sidearm, or a roster entry we've never seen still
 * produces a readable page.
 *
 * This module also owns the vocabulary the level-up screen borrows: `MOD_INFO` (how to name
 * and format every field of `Mods`) and `perkAvailability` (why a perk node is locked).
 * `levelUp.ts` imports both, so the two screens always agree.
 */
import './sheet.css';

import { bar, el, modal, pct, spriteImg, type Child } from './dom';

import { ATTACHMENTS } from '@/data/attachments';
import { MERCS, type MercDef } from '@/data/mercs';
import { PERK_LIST, PERKS } from '@/data/perks';
import { TRAITS } from '@/data/traits';

import { resolveWeapon, unitMods } from '@/sim/combat';
import {
  MAX_LEVEL,
  PERK_TREE_INFO,
  ZERO_MODS,
  aggregate,
  levelProgress,
  maxApFor,
  maxHpFor,
  maxStaminaFor,
  type Mods,
  type PerkDef,
  type PerkTree,
  type TraitDef,
} from '@/sim/progression';
import type { MercState } from '@/sim/spawn';
import {
  ATTRIBUTES,
  type Attribute,
  type Attributes,
  type AttachmentSlot,
  type Unit,
  type WeaponClass,
  type WeaponInstance,
} from '@/sim/types';

import { lookFromPalette, portraitSprite } from '@/art/units';
import { weaponCard, type WeaponArtSpec } from '@/art/weapons';
import { attachmentKey, weaponBodyKey } from '@/art/spritemap';

// ─────────────────────────────────────────────────────────────── subject

export interface SheetSubject {
  unit?: Unit;          // when viewed mid-battle
  state?: MercState;    // when viewed in camp
  defId: string;
}

/** Everything the sheet needs, normalised out of whichever source we were handed. */
interface Resolved {
  def: MercDef | undefined;
  defId: string;
  callsign: string;
  realName: string;
  age: number | null;
  attrs: Attributes;
  perks: string[];
  traits: string[];
  level: number;
  xp: number;
  morale: number | null;
  mods: Mods;
  weapon: WeaponInstance | null;
  sidearm: WeaponInstance | null;
  seed: number;
  /** Present only in camp — a Unit has no career record. */
  career: { kills: number; missions: number; daysHired: number } | null;
  /** Live battlefield numbers, when we have them. */
  live: { hp: number; maxHp: number; stamina: number; maxStamina: number; ap: number; maxAp: number } | null;
}

const ZERO_ATTRS: Attributes = {
  marksmanship: 0, agility: 0, strength: 0, vitality: 0, endurance: 0,
  wisdom: 0, leadership: 0, mechanical: 0, medical: 0, explosives: 0,
};

function modsOf(perks: readonly string[], traits: readonly string[]): Mods {
  const parts: Partial<Mods>[] = [];
  for (const id of perks) {
    const p = PERKS[id];
    if (p) parts.push(p.mods);
  }
  for (const id of traits) {
    const t = TRAITS[id];
    if (t) parts.push(t.mods);
  }
  return aggregate(parts);
}

function resolve(subject: SheetSubject): Resolved {
  const { unit, state } = subject;
  const defId = unit?.defId ?? state?.defId ?? subject.defId;
  const def = MERCS[defId];

  const attrs = unit?.attrs ?? state?.attrs ?? def?.attrs ?? ZERO_ATTRS;
  const perks = [...(unit?.perks ?? state?.perks ?? def?.startingPerks ?? [])];
  const traits = [...(unit?.traits ?? state?.traits ?? def?.startingTraits ?? [])];

  return {
    def,
    defId,
    callsign: def?.callsign ?? unit?.name ?? defId,
    realName: def?.realName ?? 'unrecorded',
    age: def?.age ?? null,
    attrs,
    perks,
    traits,
    level: unit?.level ?? state?.level ?? 1,
    xp: unit?.xp ?? state?.xp ?? 0,
    morale: unit?.morale ?? state?.morale ?? null,
    // A live Unit's mods are cached by the combat layer; otherwise fold them ourselves.
    mods: unit ? unitMods(unit) : modsOf(perks, traits),
    weapon: unit?.weapon ?? state?.weapon ?? null,
    sidearm: unit?.sidearm ?? state?.sidearm ?? null,
    seed: def?.portraitSeed ?? unit?.spriteSeed ?? 1,
    career: state
      ? { kills: state.kills, missions: state.missions, daysHired: state.daysHired }
      : null,
    live: unit
      ? {
          hp: unit.hp, maxHp: unit.maxHp,
          stamina: unit.stamina, maxStamina: unit.maxStamina,
          ap: unit.ap, maxAp: unit.maxAp,
        }
      : null,
  };
}

// ─────────────────────────────────────────────────────────────── modifier vocabulary

export type ModFormat = 'int' | 'frac' | 'mul';

export interface ModInfo {
  label: string;
  format: ModFormat;
  /** Is a larger number better for the merc? Drives the good/bad colouring. */
  betterHigh: boolean;
  /** Rough grouping, so the summary reads in sections instead of alphabetically. */
  group: 'Aim' | 'Damage' | 'Action' | 'Body' | 'Stamina' | 'Senses' | 'Support' | 'Company';
}

/**
 * How to name and print every field of `Mods`. `mul` fields default to 1 and are shown as a
 * percentage swing; `frac` fields are 0..1 and shown as percentage points; `int` fields add.
 */
export const MOD_INFO: Record<keyof Mods, ModInfo> = {
  accuracy:           { label: 'Accuracy',            format: 'int',  betterHigh: true,  group: 'Aim' },
  accuracyMul:        { label: 'Accuracy (scale)',    format: 'mul',  betterHigh: true,  group: 'Aim' },
  calledShotAccuracy: { label: 'Called shot',         format: 'int',  betterHigh: true,  group: 'Aim' },
  longRangeAccuracy:  { label: 'Long range',          format: 'int',  betterHigh: true,  group: 'Aim' },
  closeRangeAccuracy: { label: 'Close range',         format: 'int',  betterHigh: true,  group: 'Aim' },
  damageMul:          { label: 'Damage',              format: 'mul',  betterHigh: true,  group: 'Damage' },
  critChance:         { label: 'Crit chance',         format: 'frac', betterHigh: true,  group: 'Damage' },
  critDamageMul:      { label: 'Crit damage',         format: 'mul',  betterHigh: true,  group: 'Damage' },
  penetration:        { label: 'Penetration',         format: 'int',  betterHigh: true,  group: 'Damage' },
  ap:                 { label: 'Action points',       format: 'int',  betterHigh: true,  group: 'Action' },
  apMul:              { label: 'AP pool',             format: 'mul',  betterHigh: true,  group: 'Action' },
  moveCostMul:        { label: 'Move cost',           format: 'mul',  betterHigh: false, group: 'Action' },
  shotApCost:         { label: 'Shot AP',             format: 'int',  betterHigh: false, group: 'Action' },
  aimApCost:          { label: 'Aim AP',              format: 'int',  betterHigh: false, group: 'Action' },
  reloadApCost:       { label: 'Reload AP',           format: 'int',  betterHigh: false, group: 'Action' },
  stanceApCost:       { label: 'Stance AP',           format: 'int',  betterHigh: false, group: 'Action' },
  interruptChance:    { label: 'Interrupt chance',    format: 'frac', betterHigh: true,  group: 'Action' },
  hp:                 { label: 'Max HP',              format: 'int',  betterHigh: true,  group: 'Body' },
  hpMul:              { label: 'HP pool',             format: 'mul',  betterHigh: true,  group: 'Body' },
  armour:             { label: 'Armour',              format: 'int',  betterHigh: true,  group: 'Body' },
  bleedResist:        { label: 'Bleed resist',        format: 'frac', betterHigh: true,  group: 'Body' },
  stunResist:         { label: 'Stun resist',         format: 'frac', betterHigh: true,  group: 'Body' },
  stamina:            { label: 'Max stamina',         format: 'int',  betterHigh: true,  group: 'Stamina' },
  staminaMul:         { label: 'Stamina pool',        format: 'mul',  betterHigh: true,  group: 'Stamina' },
  staminaCostMul:     { label: 'Stamina cost',        format: 'mul',  betterHigh: false, group: 'Stamina' },
  staminaRegen:       { label: 'Stamina regen',       format: 'frac', betterHigh: true,  group: 'Stamina' },
  noiseMul:           { label: 'Noise',               format: 'mul',  betterHigh: false, group: 'Senses' },
  sightRange:         { label: 'Sight range',         format: 'int',  betterHigh: true,  group: 'Senses' },
  suppressionResist:  { label: 'Suppression resist',  format: 'frac', betterHigh: true,  group: 'Senses' },
  recoilMul:          { label: 'Recoil',              format: 'mul',  betterHigh: false, group: 'Aim' },
  healMul:            { label: 'Healing',             format: 'mul',  betterHigh: true,  group: 'Support' },
  xpMul:              { label: 'XP gain',             format: 'mul',  betterHigh: true,  group: 'Support' },
  squadXpMul:         { label: 'Squad XP',            format: 'mul',  betterHigh: true,  group: 'Support' },
  moraleRegen:        { label: 'Morale regen',        format: 'frac', betterHigh: true,  group: 'Support' },
  craftQuality:       { label: 'Craft quality',       format: 'int',  betterHigh: true,  group: 'Company' },
  repairMul:          { label: 'Repair cost',         format: 'mul',  betterHigh: false, group: 'Company' },
  salaryMul:          { label: 'Salary',              format: 'mul',  betterHigh: false, group: 'Company' },
  lootMul:            { label: 'Loot',                format: 'mul',  betterHigh: true,  group: 'Company' },
  scavengeMul:        { label: 'Scavenging',          format: 'mul',  betterHigh: true,  group: 'Company' },
};

const MOD_GROUP_ORDER: ModInfo['group'][] = [
  'Aim', 'Damage', 'Action', 'Body', 'Stamina', 'Senses', 'Support', 'Company',
];

export interface ModDelta {
  key: keyof Mods;
  info: ModInfo;
  /** Printable, already signed, e.g. "+5", "−30%", "+5pp". */
  text: string;
  /** True when this delta helps the merc. */
  good: boolean;
}

function signed(n: number, suffix = ''): string {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}${suffix}`;
}

/** Format one modifier field against its default (0 for additive, 1 for multiplicative). */
export function formatModDelta(key: keyof Mods, value: number): ModDelta | null {
  const info = MOD_INFO[key];
  const base = ZERO_MODS[key];
  if (Math.abs(value - base) < 1e-9) return null;

  let text: string;
  if (info.format === 'mul') text = signed((value - 1) * 100, '%');
  else if (info.format === 'frac') text = signed(value * 100, 'pp');
  else text = signed(value);

  const up = value > base;
  return { key, info, text, good: up === info.betterHigh };
}

/** Every field of a `Mods` (or a perk's `Partial<Mods>`) that differs from the default. */
export function modDeltas(mods: Partial<Mods>): ModDelta[] {
  const out: ModDelta[] = [];
  for (const key of Object.keys(MOD_INFO) as (keyof Mods)[]) {
    const v = mods[key];
    if (v === undefined) continue;
    const d = formatModDelta(key, v);
    if (d) out.push(d);
  }
  out.sort((a, b) => MOD_GROUP_ORDER.indexOf(a.info.group) - MOD_GROUP_ORDER.indexOf(b.info.group));
  return out;
}

// ─────────────────────────────────────────────────────────────── perk availability

export type PerkState = 'taken' | 'available' | 'locked';

export interface PerkAvailability {
  state: PerkState;
  /** Human-readable reasons the perk is locked. Empty when it isn't. */
  reasons: string[];
}

export interface PerkContext {
  attrs: Attributes;
  perks: readonly string[];
  level: number;
  /** Weapon classes the merc will actually carry. Omit to skip the class check. */
  preferredClasses?: readonly WeaponClass[];
}

const ATTR_LABEL: Record<Attribute, string> = {
  marksmanship: 'Marksmanship', agility: 'Agility', strength: 'Strength',
  vitality: 'Vitality', endurance: 'Endurance', wisdom: 'Wisdom',
  leadership: 'Leadership', mechanical: 'Mechanical', medical: 'Medical',
  explosives: 'Explosives',
};

/** Level at which a tier first becomes offerable. */
export function tierUnlockLevel(tier: 1 | 2 | 3): number {
  return tier === 3 ? 10 : tier === 2 ? 5 : 1;
}

/**
 * Why this perk node looks the way it does. The reasons are the point of drawing a tree at
 * all — a locked node that does not say *what* to raise teaches the player nothing.
 */
export function perkAvailability(perk: PerkDef, ctx: PerkContext): PerkAvailability {
  if (ctx.perks.includes(perk.id)) return { state: 'taken', reasons: [] };

  const reasons: string[] = [];

  const unlock = tierUnlockLevel(perk.tier);
  if (ctx.level < unlock) reasons.push(`Tier ${perk.tier} unlocks at level ${unlock}`);

  for (const [k, need] of Object.entries(perk.requires ?? {}) as [Attribute, number][]) {
    const have = ctx.attrs[k] ?? 0;
    if (have < need) reasons.push(`${ATTR_LABEL[k]} ${need} (have ${have})`);
  }

  for (const pre of perk.after ?? []) {
    if (!ctx.perks.includes(pre)) reasons.push(`Needs ${PERKS[pre]?.name ?? pre}`);
  }

  if (perk.weaponClasses && perk.weaponClasses.length > 0 && ctx.preferredClasses) {
    const fits = perk.weaponClasses.some((c) => ctx.preferredClasses?.includes(c));
    if (!fits) reasons.push(`Only for ${perk.weaponClasses.join(', ')}`);
  }

  return reasons.length > 0 ? { state: 'locked', reasons } : { state: 'available', reasons: [] };
}

// ─────────────────────────────────────────────────────────────── small parts

function stencil(text: string): HTMLElement {
  return el('h3.cs-h', {}, text);
}

function section(title: string, ...body: Child[]): HTMLElement {
  return el('section.cs-panel', {}, stencil(title), el('div.cs-panel-body', {}, ...body));
}

function statChip(label: string, value: string, tone = ''): HTMLElement {
  return el('div.cs-chip', { class: tone }, el('span.cs-chip-k', {}, label), el('span.cs-chip-v', {}, value));
}

/** A 10-cell pip meter — reads "strong / weak" faster than a number ever will. */
function attrMeter(value: number): HTMLElement {
  const v = Math.max(0, Math.min(10, Math.round(value)));
  const tone = v >= 8 ? 'hi' : v >= 5 ? 'mid' : 'lo';
  const pips: Child[] = [];
  for (let i = 1; i <= 10; i++) {
    pips.push(el('i.cs-pip', { class: i <= v ? `on ${tone}` : '' }));
  }
  return el('div.cs-pips', {}, ...pips);
}

// ─────────────────────────────────────────────────────────────── header

function headerBlock(r: Resolved): HTMLElement {
  const look = lookFromPalette(r.seed, r.def?.palette);
  const portrait = spriteImg(portraitSprite(r.seed, look, false).toCanvas(4), 'cs-portrait');

  const prog = levelProgress(r.xp);
  // The sheet's own level field wins if it disagrees — a Unit may have been levelled by hand.
  const level = Math.max(r.level, prog.level);
  const capped = level >= MAX_LEVEL;
  const xpText = capped ? `MAX — ${r.xp.toLocaleString('en-US')} XP` : `${prog.into} / ${prog.need} XP`;

  const idBlock = el(
    'div.cs-id',
    {},
    el('div.cs-callsign', {}, r.callsign),
    el(
      'div.cs-realname',
      {},
      r.realName,
      r.age !== null ? el('span.cs-age', {}, ` · age ${r.age}`) : null,
    ),
    el(
      'div.cs-xp',
      {},
      el('div.cs-xp-top', {},
        el('span.cs-level', {}, `Level ${level}`),
        el('span.cs-xp-num', {}, xpText)),
      bar(capped ? 1 : prog.frac, capped ? 'var(--cs-gold)' : 'var(--cs-cyan)', undefined, 'cs-bar'),
    ),
  );

  const chips: Child[] = [];
  if (r.career) {
    chips.push(statChip('Kills', String(r.career.kills)));
    chips.push(statChip('Missions', String(r.career.missions)));
    chips.push(statChip('Days hired', String(r.career.daysHired)));
  }
  if (r.morale !== null) {
    const m = Math.round(r.morale);
    chips.push(statChip('Morale', String(m), m < 25 ? 'bad' : m > 80 ? 'good' : ''));
  }
  if (r.def) chips.push(statChip('Salary', `$${r.def.salary}/day`));
  if (r.live) {
    chips.push(statChip('HP', `${Math.round(r.live.hp)} / ${r.live.maxHp}`));
    chips.push(statChip('AP', `${Math.round(r.live.ap)} / ${r.live.maxAp}`));
  }

  return el(
    'header.cs-head',
    {},
    portrait,
    idBlock,
    chips.length > 0 ? el('div.cs-chips', {}, ...chips) : null,
  );
}

// ─────────────────────────────────────────────────────────────── dossier

function dossierPanel(r: Resolved): HTMLElement {
  const bio = r.def?.bio ?? 'No file. Whoever they were before, they are not saying.';
  const quirk = r.def?.quirk;

  return section(
    'Dossier',
    el('p.cs-bio', {}, bio),
    quirk ? el('div.cs-quirk', {}, el('span.cs-quirk-tag', {}, 'Quirk'), el('span', {}, quirk)) : null,
  );
}

function nameOf(id: string): string {
  return MERCS[id]?.callsign ?? id;
}

function relationsPanel(r: Resolved): HTMLElement | null {
  const likes = r.def?.likes ?? [];
  const dislikes = r.def?.dislikes ?? [];
  if (likes.length === 0 && dislikes.length === 0) return null;

  const row = (label: string, ids: string[], cls: string): Child =>
    ids.length === 0
      ? null
      : el(
          'div.cs-rel-row',
          {},
          el('span.cs-rel-label', { class: cls }, label),
          el('span.cs-rel-names', {}, ...ids.map((id) => el('span.cs-tag', { class: cls }, nameOf(id)))),
        );

  return section(
    'Relationships',
    el('p.cs-note', {}, 'Sharing a squad shifts morale each day.'),
    row('Works with', likes, 'good'),
    row('Friction', dislikes, 'bad'),
  );
}

// ─────────────────────────────────────────────────────────────── attributes

/**
 * Mirrors `field.sightRange` at full daylight. Duplicated rather than imported because the
 * real function needs a `BattleState`, and the sheet must render out of battle.
 */
function daylightSight(attrs: Attributes, mods: Mods): number {
  return Math.round(14 + attrs.wisdom * 0.3) + Math.round(mods.sightRange);
}

function derivedRow(label: string, value: string, formula: string): HTMLElement {
  return el(
    'div.cs-derived',
    {},
    el('span.cs-derived-k', {}, label),
    el('span.cs-derived-v', {}, value),
    el('span.cs-derived-f', {}, formula),
  );
}

function attributesPanel(r: Resolved): HTMLElement {
  const rows = ATTRIBUTES.map((a) => {
    const v = r.attrs[a] ?? 0;
    return el(
      'div.cs-attr',
      {},
      el('span.cs-attr-k', {}, ATTR_LABEL[a]),
      attrMeter(v),
      el('span.cs-attr-v', { class: v >= 8 ? 'hi' : v <= 3 ? 'lo' : '' }, String(v)),
    );
  });

  const maxHp = maxHpFor(r.attrs, r.level, r.mods);
  const maxSta = maxStaminaFor(r.attrs, r.mods);
  const maxAp = maxApFor(r.attrs, r.mods);
  const sight = daylightSight(r.attrs, r.mods);

  return section(
    'Attributes',
    el('div.cs-attrs', {}, ...rows),
    el('div.cs-rule'),
    el('h4.cs-sub', {}, 'Derived'),
    derivedRow('Max HP', String(maxHp), `40 + vit×4 + (lvl−1)×3 → ${r.attrs.vitality}·${r.level}`),
    derivedRow('Max stamina', String(maxSta), `50 + end×5 → ${r.attrs.endurance}`),
    derivedRow('Max AP', String(maxAp), `8 + ⌊agi/3⌋ → ${r.attrs.agility}`),
    derivedRow('Sight (day)', `${sight} tiles`, `14 + wis×0.3 → ${r.attrs.wisdom}`),
  );
}

// ─────────────────────────────────────────────────────────────── perk tree

const TREES = Object.keys(PERK_TREE_INFO) as PerkTree[];

function perkNode(perk: PerkDef, ctx: PerkContext, color: string): HTMLElement {
  const av = perkAvailability(perk, ctx);
  const deltas = modDeltas(perk.mods);

  const body: Child[] = [
    el('div.cs-perk-name', {}, perk.name),
    el('p.cs-perk-desc', {}, perk.desc),
  ];

  if (deltas.length > 0) {
    body.push(
      el(
        'div.cs-perk-mods',
        {},
        ...deltas.map((d) =>
          el('span.cs-delta', { class: d.good ? 'good' : 'bad' }, `${d.info.label} ${d.text}`),
        ),
      ),
    );
  }
  if (perk.special) body.push(el('div.cs-perk-special', {}, 'Special rule'));

  if (av.state === 'locked') {
    body.push(
      el('ul.cs-locks', {}, ...av.reasons.map((why) => el('li.cs-lock', {}, why))),
    );
  }

  return el(
    'div.cs-perk',
    {
      class: `is-${av.state}`,
      style: `--tree:${color}`,
      title: av.state === 'locked' ? `Locked — ${av.reasons.join('; ')}` : perk.name,
    },
    el('span.cs-perk-flag', {}, av.state === 'taken' ? 'TAKEN' : av.state === 'locked' ? 'LOCKED' : 'OPEN'),
    ...body,
  );
}

function perkTreePanel(r: Resolved): HTMLElement {
  const ctx: PerkContext = r.def
    ? { attrs: r.attrs, perks: r.perks, level: r.level, preferredClasses: r.def.preferredClasses }
    : { attrs: r.attrs, perks: r.perks, level: r.level };

  const columns = TREES.map((tree) => {
    const info = PERK_TREE_INFO[tree];
    const inTree = PERK_LIST.filter((p) => p.tree === tree);
    const taken = inTree.filter((p) => r.perks.includes(p.id)).length;

    const tiers: Child[] = [];
    for (const tier of [1, 2, 3] as const) {
      const perks = inTree.filter((p) => p.tier === tier);
      if (perks.length === 0) continue;
      tiers.push(
        el(
          'div.cs-tier',
          {},
          el('div.cs-tier-h', {}, `Tier ${tier}`, el('span.cs-tier-lvl', {}, `lvl ${tierUnlockLevel(tier)}+`)),
          ...perks.map((p) => perkNode(p, ctx, info.color)),
        ),
      );
    }

    return el(
      'div.cs-tree',
      { style: `--tree:${info.color}` },
      el(
        'div.cs-tree-h',
        {},
        el('span.cs-tree-name', {}, info.label),
        el('span.cs-tree-count', {}, `${taken}/${inTree.length}`),
      ),
      ...tiers,
    );
  });

  return section(
    'Perk Tree',
    el('p.cs-note', {}, 'One pick per level. Locked nodes say what they are waiting for.'),
    el('div.cs-trees', {}, ...columns),
  );
}

// ─────────────────────────────────────────────────────────────── traits

function traitCard(t: TraitDef): HTMLElement {
  const positive = t.cost > 0;
  const deltas = modDeltas(t.mods);
  return el(
    'div.cs-trait',
    { class: positive ? 'pos' : 'neg' },
    el(
      'div.cs-trait-h',
      {},
      el('span.cs-trait-name', {}, t.name),
      el('span.cs-trait-cost', {}, `${positive ? '+' : '−'}${Math.abs(t.cost)}`),
    ),
    el('p.cs-trait-desc', {}, t.desc),
    deltas.length > 0
      ? el(
          'div.cs-perk-mods',
          {},
          ...deltas.map((d) =>
            el('span.cs-delta', { class: d.good ? 'good' : 'bad' }, `${d.info.label} ${d.text}`),
          ),
        )
      : null,
    t.special ? el('div.cs-perk-special', {}, 'Special rule') : null,
  );
}

function traitsPanel(r: Resolved): HTMLElement {
  const defs = r.traits.map((id) => TRAITS[id]).filter((t): t is TraitDef => t !== undefined);
  const unknown = r.traits.filter((id) => !TRAITS[id]);
  const pos = defs.filter((t) => t.cost > 0);
  const neg = defs.filter((t) => t.cost <= 0);
  const budget = defs.reduce((s, t) => s + t.cost, 0);

  if (defs.length === 0 && unknown.length === 0) {
    return section('Traits', el('p.cs-empty', {}, 'No traits on file.'));
  }

  return section(
    'Traits',
    el('p.cs-note', {}, `Permanent, chosen at hire. Net budget spent: ${budget >= 0 ? '+' : '−'}${Math.abs(budget)}`),
    pos.length > 0 ? el('h4.cs-sub.good', {}, 'Positive') : null,
    pos.length > 0 ? el('div.cs-traits', {}, ...pos.map(traitCard)) : null,
    neg.length > 0 ? el('h4.cs-sub.bad', {}, 'Negative') : null,
    neg.length > 0 ? el('div.cs-traits', {}, ...neg.map(traitCard)) : null,
    unknown.length > 0 ? el('p.cs-empty', {}, `Unrecognised: ${unknown.join(', ')}`) : null,
  );
}

// ─────────────────────────────────────────────────────────────── loadout

const SLOT_LABEL: Record<AttachmentSlot, string> = {
  optic: 'Optic', barrel: 'Barrel', underbarrel: 'Underbarrel',
  magazine: 'Magazine', stock: 'Stock', internal: 'Internal',
};

function weaponBlock(label: string, inst: WeaponInstance | null): HTMLElement {
  if (!inst) {
    return el('div.cs-weapon.is-empty', {}, el('div.cs-weapon-slot', {}, label), el('p.cs-empty', {}, 'Nothing carried.'));
  }

  const rw = resolveWeapon(inst);
  if (!rw) {
    // Unknown weapon id — a broken save should not blank the sheet.
    return el(
      'div.cs-weapon.is-empty',
      {},
      el('div.cs-weapon-slot', {}, label),
      el('p.cs-empty', {}, `Unrecognised weapon "${inst.defId}".`),
    );
  }

  const def = rw.def;
  const cond = Math.max(0, Math.min(100, inst.condition));
  const jamRisk = cond < 40;

  const attachKeys = def.slots
    .map((slot) => {
      const id = inst.attachments[slot];
      const att = id ? ATTACHMENTS[id] : undefined;
      return att ? attachmentKey(att.sprite, slot) : null;
    })
    .filter((k): k is NonNullable<typeof k> => k !== null);

  const spec: WeaponArtSpec = {
    body: weaponBodyKey(def.sprite, def.cls),
    attachments: attachKeys,
    condition: cond / 100,
  };

  const slots = def.slots.map((slot) => {
    const id = inst.attachments[slot];
    const att = id ? ATTACHMENTS[id] : undefined;
    return el(
      'div.cs-slot',
      { class: att ? 'filled' : 'empty', title: att?.desc ?? 'Empty slot' },
      el('span.cs-slot-k', {}, SLOT_LABEL[slot]),
      el('span.cs-slot-v', {}, att ? att.name : id ? `${id} (unknown)` : '— empty —'),
    );
  });

  return el(
    'div.cs-weapon',
    {},
    el('div.cs-weapon-slot', {}, label),
    el(
      'div.cs-weapon-top',
      {},
      spriteImg(weaponCard(spec, 3), 'cs-gun'),
      el(
        'div.cs-weapon-id',
        {},
        el('div.cs-weapon-name', {}, inst.customName ?? rw.name),
        el('div.cs-weapon-cls', {}, `${def.cls} · ${def.ammo} · ${inst.mode}`),
        el(
          'div.cs-weapon-stats',
          {},
          el('span', {}, `DMG ${Math.round(rw.damage)}`),
          el('span', {}, `ACC ${Math.round(rw.accuracy)}`),
          el('span', {}, `AP ${rw.apCost}`),
          el('span', {}, `RNG ${rw.rangeOptimal}/${rw.rangeMax}`),
          el('span', {}, `MAG ${inst.loaded}/${rw.magSize}`),
        ),
      ),
    ),
    el(
      'div.cs-cond',
      {},
      el('span.cs-cond-k', {}, 'Condition'),
      bar(cond / 100, jamRisk ? 'var(--cs-blood)' : cond < 70 ? 'var(--cs-amber)' : 'var(--cs-green)', undefined, 'cs-bar'),
      el('span.cs-cond-v', { class: jamRisk ? 'bad' : '' }, pct(cond / 100)),
    ),
    jamRisk ? el('div.cs-warn', {}, '⚠ Below 40% — jams are likely. Repair before deploying.') : null,
    slots.length > 0
      ? el('div.cs-slots', {}, ...slots)
      : el('p.cs-empty', {}, 'No attachment slots.'),
  );
}

function loadoutPanel(r: Resolved): HTMLElement {
  return section(
    'Loadout',
    el('div.cs-loadout', {}, weaponBlock('Primary', r.weapon), weaponBlock('Sidearm', r.sidearm)),
  );
}

// ─────────────────────────────────────────────────────────────── build summary

function buildPanel(r: Resolved): HTMLElement {
  const deltas = modDeltas(r.mods);
  if (deltas.length === 0) {
    return section('Build', el('p.cs-empty', {}, 'No perks or traits are changing anything yet.'));
  }

  const groups: Child[] = [];
  for (const g of MOD_GROUP_ORDER) {
    const inGroup = deltas.filter((d) => d.info.group === g);
    if (inGroup.length === 0) continue;
    groups.push(
      el(
        'div.cs-modgroup',
        {},
        el('div.cs-modgroup-h', {}, g),
        ...inGroup.map((d) =>
          el(
            'div.cs-modrow',
            { class: d.good ? 'good' : 'bad' },
            el('span.cs-modrow-k', {}, d.info.label),
            el('span.cs-modrow-v', {}, d.text),
          ),
        ),
      ),
    );
  }

  return section(
    'Build',
    el('p.cs-note', {}, 'Everything the perks and traits add up to. Defaults are hidden.'),
    el('div.cs-mods', {}, ...groups),
  );
}

// ─────────────────────────────────────────────────────────────── public

/** The sheet as a plain element, for embedding in the camp screen or a side panel. */
export function characterSheetPanel(subject: SheetSubject): HTMLElement {
  const r = resolve(subject);

  return el(
    'div.char-sheet',
    {},
    headerBlock(r),
    el(
      'div.cs-cols',
      {},
      el('div.cs-col', {}, dossierPanel(r), attributesPanel(r)),
      el('div.cs-col', {}, loadoutPanel(r), traitsPanel(r)),
      el('div.cs-col', {}, buildPanel(r), relationsPanel(r)),
    ),
    perkTreePanel(r),
  );
}

/** Open the sheet as a modal. Returns the close function. */
export function openCharacterSheet(subject: SheetSubject): () => void {
  const panel = characterSheetPanel(subject);
  const close = modal(el('div.cs-modal', {}, panel));
  panel.insertBefore(
    el('button.cs-close', { type: 'button', title: 'Close (Esc)', on: { click: () => close() } }, '✕'),
    panel.firstChild,
  );
  return close;
}
