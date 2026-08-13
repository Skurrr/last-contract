/**
 * The level-up screen — three perk cards dealt face-up, plus the free attribute point.
 *
 * The offer is a **pure function of (defId, level, attrs, perks)**: reopening the screen deals
 * the same three cards, and a save/reload cannot be used to reroll. `perkOffers` is exported
 * so it can be validated outside the DOM.
 */
import './sheet.css';

import { el, type Child } from './dom';
import { modDeltas, perkAvailability, tierUnlockLevel, type PerkContext } from './characterSheet';

import { MERCS } from '@/data/mercs';
import { PERK_LIST } from '@/data/perks';
import { hashString } from '@/core/rng';
import { PERK_TREE_INFO, type PerkDef } from '@/sim/progression';
import { ATTRIBUTES, type Attribute, type Attributes } from '@/sim/types';
import { lookFromPalette, portraitSprite } from '@/art/units';

export interface LevelUpChoice {
  perkId: string | null;
  attribute: keyof Attributes | null;
}

export interface LevelUpSubject {
  defId: string;
  level: number;
  attrs: Attributes;
  perks: string[];
  traits: string[];
}

// ─────────────────────────────────────────────────────────────── offer selection

const OFFER_COUNT = 3;

function contextFor(subject: LevelUpSubject): PerkContext {
  const def = MERCS[subject.defId];
  return def
    ? {
        attrs: subject.attrs,
        perks: subject.perks,
        level: subject.level,
        preferredClasses: def.preferredClasses,
      }
    : { attrs: subject.attrs, perks: subject.perks, level: subject.level };
}

/**
 * Every perk this merc could legitimately be handed right now: attribute `requires` met, all
 * `after` prerequisites already taken, not already taken, tier unlocked by level, and (when
 * the perk names weapon classes) usable with something they actually carry.
 *
 * The weapon-class filter is dropped if it would empty the pool — a merc who somehow prefers
 * nothing should still get offers rather than dead-ending.
 */
export function qualifyingPerks(subject: LevelUpSubject): PerkDef[] {
  const ctx = contextFor(subject);
  const strict = PERK_LIST.filter((p) => perkAvailability(p, ctx).state === 'available');
  if (strict.length > 0 || ctx.preferredClasses === undefined) return strict;

  const loose: PerkContext = { attrs: ctx.attrs, perks: ctx.perks, level: ctx.level };
  return PERK_LIST.filter((p) => perkAvailability(p, loose).state === 'available');
}

/** A stable per-merc ordering of the catalogue — level-independent, so the window below steps cleanly. */
function rank(defId: string, perkId: string): number {
  return hashString(`${defId}:${perkId}`);
}

/**
 * Deal `OFFER_COUNT` cards out of `pool` starting at the window for `level`, skipping
 * anything in `avoid` while there is still enough pool left to fill the hand.
 */
function deal(pool: readonly PerkDef[], level: number, avoid: ReadonlySet<string>): PerkDef[] {
  const n = pool.length;
  if (n <= OFFER_COUNT) return [...pool];

  // Level 2 is the first level-up, so it deals from offset 0.
  const start = (Math.max(0, level - 2) * OFFER_COUNT) % n;
  const chosen: PerkDef[] = [];
  const seenTrees = new Set<string>();

  // Pass 1 — one perk per tree, walking the window forward. Pass 2 relaxes the tree rule,
  // pass 3 relaxes `avoid`, so a thin pool still fills the hand instead of dealing short.
  for (const relax of [0, 1, 2] as const) {
    for (let i = 0; i < n && chosen.length < OFFER_COUNT; i++) {
      const p = pool[(start + i) % n];
      if (!p || chosen.includes(p)) continue;
      if (relax < 2 && avoid.has(p.id)) continue;
      if (relax < 1 && seenTrees.has(p.tree)) continue;
      chosen.push(p);
      seenTrees.add(p.tree);
    }
  }
  return chosen;
}

/**
 * The three cards dealt at `subject.level`.
 *
 * Deterministic and reopen-safe: the pool is ordered by a per-merc hash and a window that
 * advances by `OFFER_COUNT` per level picks from it, preferring one perk per tree so a deal
 * never reads as three flavours of the same idea. The previous level's deal is recomputed
 * and avoided, so the player is not shown the same card two level-ups running.
 *
 * Returns fewer than three only when the merc qualifies for fewer than three perks — the
 * caller must let them skip in that case.
 */
export function perkOffers(subject: LevelUpSubject): PerkDef[] {
  const pool = qualifyingPerks(subject).sort((a, b) => {
    const ra = rank(subject.defId, a.id);
    const rb = rank(subject.defId, b.id);
    return ra !== rb ? ra - rb : a.id < b.id ? -1 : 1;
  });

  const previous =
    subject.level > 2
      ? new Set(deal(pool, subject.level - 1, new Set<string>()).map((p) => p.id))
      : new Set<string>();

  return deal(pool, subject.level, previous);
}

// ─────────────────────────────────────────────────────────────── card rendering

const ATTR_LABEL: Record<Attribute, string> = {
  marksmanship: 'Marksmanship', agility: 'Agility', strength: 'Strength',
  vitality: 'Vitality', endurance: 'Endurance', wisdom: 'Wisdom',
  leadership: 'Leadership', mechanical: 'Mechanical', medical: 'Medical',
  explosives: 'Explosives',
};

function tierPips(tier: 1 | 2 | 3): HTMLElement {
  const pips: Child[] = [];
  for (let i = 1; i <= 3; i++) pips.push(el('i.lu-pip', { class: i <= tier ? 'on' : '' }));
  return el('div.lu-pips', { title: `Tier ${tier} (level ${tierUnlockLevel(tier)}+)` }, ...pips);
}

function perkCard(perk: PerkDef, index: number, onPick: (id: string) => void): HTMLElement {
  const info = PERK_TREE_INFO[perk.tree];
  const deltas = modDeltas(perk.mods);

  const face = el(
    'div.lu-face',
    {},
    el(
      'div.lu-card-h',
      {},
      el('span.lu-tree', {}, info.label),
      tierPips(perk.tier),
    ),
    el('div.lu-name', {}, perk.name),
    el('p.lu-desc', {}, perk.desc),
    el(
      'div.lu-deltas',
      {},
      ...(deltas.length > 0
        ? deltas.map((d) =>
            el(
              'div.lu-delta',
              { class: d.good ? 'good' : 'bad' },
              el('span.lu-delta-k', {}, d.info.label),
              el('span.lu-delta-v', {}, d.text),
            ),
          )
        : [el('div.lu-delta', {}, el('span.lu-delta-k', {}, 'No flat bonuses'))]),
      perk.special ? el('div.lu-delta.special', {}, el('span.lu-delta-k', {}, 'Special rule in combat')) : null,
    ),
    el('div.lu-take', {}, 'Take'),
  );

  const back = el('div.lu-back', {}, el('span', {}, 'LC'));

  return el(
    'button.lu-card',
    {
      type: 'button',
      style: `--tree:${info.color};--deal-delay:${(index * 160 + 250)}ms`,
      data: { perk: perk.id },
      on: { click: () => onPick(perk.id) },
    },
    el('div.lu-card-inner', {}, back, face),
  );
}

// ─────────────────────────────────────────────────────────────── screen

/**
 * Show the level-up screen. `onConfirm` fires once, on the explicit button press, and the
 * overlay tears itself down first so the caller can immediately open something else.
 */
export function openLevelUp(subject: LevelUpSubject, onConfirm: (choice: LevelUpChoice) => void): void {
  const def = MERCS[subject.defId];
  const offers = perkOffers(subject);
  const eligible = qualifyingPerks(subject);

  let perkId: string | null = null;
  let attribute: Attribute | null = null;
  let skipPerk = offers.length === 0;

  const overlay = el('div.lu-overlay');
  const confirmBtn = el('button.lu-confirm', { type: 'button', disabled: true }, 'Confirm');

  const sync = (): void => {
    for (const node of Array.from(overlay.querySelectorAll('.lu-card'))) {
      node.classList.toggle('selected', (node as HTMLElement).dataset['perk'] === perkId);
    }
    for (const node of Array.from(overlay.querySelectorAll('.lu-attr'))) {
      node.classList.toggle('selected', (node as HTMLElement).dataset['attr'] === attribute);
    }
    overlay.querySelector('.lu-skip')?.classList.toggle('selected', skipPerk);

    const perkDone = perkId !== null || skipPerk;
    if (perkDone && attribute !== null) confirmBtn.removeAttribute('disabled');
    else confirmBtn.setAttribute('disabled', '');

    const readout = overlay.querySelector('.lu-readout');
    if (readout) {
      const before = attribute ? subject.attrs[attribute] : 0;
      readout.textContent = attribute
        ? `${ATTR_LABEL[attribute]}  ${before} → ${before + 1}`
        : 'Choose one attribute to raise.';
      readout.classList.toggle('is-set', attribute !== null);
    }
  };

  const pickPerk = (id: string): void => {
    perkId = perkId === id ? null : id;
    if (perkId !== null) skipPerk = false;
    sync();
  };

  // ── banner
  const look = lookFromPalette(def?.portraitSeed ?? hashString(subject.defId), def?.palette);
  const portrait = portraitSprite(def?.portraitSeed ?? hashString(subject.defId), look, false).toCanvas(3);
  portrait.style.imageRendering = 'pixelated';

  const banner = el(
    'header.lu-banner',
    {},
    el('div.lu-banner-rule'),
    el(
      'div.lu-banner-body',
      {},
      el('span.lu-portrait', {}, portrait),
      el(
        'div.lu-banner-text',
        {},
        el('div.lu-banner-kicker', {}, 'Promotion'),
        el('div.lu-banner-title', {}, 'LEVEL UP'),
        el(
          'div.lu-banner-sub',
          {},
          el('span.lu-who', {}, def?.callsign ?? subject.defId),
          ' reaches ',
          el('span.lu-lvl', {}, `Level ${subject.level}`),
        ),
      ),
    ),
    el('div.lu-banner-rule'),
  );

  // ── perk cards
  const cardRow =
    offers.length > 0
      ? el('div.lu-cards', {}, ...offers.map((p, i) => perkCard(p, i, pickPerk)))
      : el(
          'div.lu-none',
          {},
          el('div.lu-none-h', {}, 'No perks on offer'),
          el(
            'p',
            {},
            eligible.length === 0
              ? 'Nothing in the catalogue is open to them yet — raise an attribute and the tree will open up.'
              : 'Everything they qualify for is already taken.',
          ),
        );

  const shortfall =
    offers.length > 0 && offers.length < OFFER_COUNT
      ? el(
          'p.lu-note.warn',
          {},
          `Only ${offers.length} perk${offers.length === 1 ? '' : 's'} qualify at level ${subject.level}. ` +
            'You may take one or skip the pick.',
        )
      : null;

  const skipBtn = el(
    'button.lu-skip',
    {
      type: 'button',
      on: {
        click: () => {
          skipPerk = !skipPerk;
          if (skipPerk) perkId = null;
          sync();
        },
      },
    },
    'Take no perk',
  );

  // ── attribute point
  const attrGrid = el(
    'div.lu-attrs',
    {},
    ...ATTRIBUTES.map((a) => {
      const v = subject.attrs[a] ?? 0;
      const capped = v >= 10;
      // Raising an attribute is otherwise a blind choice; say what it would open up.
      const unlocks = capped ? [] : perksUnlockedBy(subject, a);
      return el(
        'button.lu-attr',
        {
          type: 'button',
          data: { attr: a },
          disabled: capped,
          title: capped
            ? `${ATTR_LABEL[a]} is already at the cap.`
            : unlocks.length > 0
              ? `Raise ${ATTR_LABEL[a]} — opens ${unlocks.map((p) => p.name).join(', ')}`
              : `Raise ${ATTR_LABEL[a]}`,
          on: {
            click: () => {
              if (capped) return;
              attribute = attribute === a ? null : a;
              sync();
            },
          },
        },
        el('span.lu-attr-k', {}, ATTR_LABEL[a]),
        el('span.lu-attr-v', {}, `${v} → ${Math.min(10, v + 1)}`),
        unlocks.length > 0
          ? el('span.lu-attr-unlock', {}, `opens ${unlocks.length} perk${unlocks.length === 1 ? '' : 's'}`)
          : null,
      );
    }),
  );

  confirmBtn.addEventListener('click', () => {
    if (confirmBtn.hasAttribute('disabled')) return;
    const choice: LevelUpChoice = { perkId, attribute };
    overlay.remove();
    onConfirm(choice);
  });

  overlay.appendChild(
    el(
      'div.lu-sheet',
      {},
      banner,
      el(
        'section.lu-block',
        {},
        el('h3.lu-h', {}, 'Choose a perk'),
        shortfall,
        cardRow,
        el('div.lu-skiprow', {}, skipBtn),
      ),
      el(
        'section.lu-block',
        {},
        el('h3.lu-h', {}, 'Spend the attribute point'),
        el('div.lu-readout', {}, 'Choose one attribute to raise.'),
        attrGrid,
      ),
      el('footer.lu-foot', {}, confirmBtn),
    ),
  );

  document.body.appendChild(overlay);
  sync();
}

/** Which perks would become available if this attribute went up by one. Used for tooltips. */
export function perksUnlockedBy(subject: LevelUpSubject, attr: Attribute): PerkDef[] {
  const before = new Set(qualifyingPerks(subject).map((p) => p.id));
  const raised: LevelUpSubject = {
    ...subject,
    attrs: { ...subject.attrs, [attr]: (subject.attrs[attr] ?? 0) + 1 },
  };
  return qualifyingPerks(raised).filter((p) => !before.has(p.id));
}
