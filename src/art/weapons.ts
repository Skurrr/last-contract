/**
 * Weapon sprites, drawn side-on so the renderer can rotate them around a unit toward its
 * facing. Attachments composite onto the same buffer at fixed anchor points, so a gun you
 * built in the workshop actually looks like the gun you built.
 */
import { Pix, memoise, mix, shade, type RGBA } from './forge';
import { PAL } from './palette';

export const WEAPON_W = 26;
export const WEAPON_H = 12;

/** Where on the weapon canvas each attachment class mounts. */
const ANCHOR = {
  optic: { x: 11, y: 2 },
  barrel: { x: 21, y: 5 },
  underbarrel: { x: 15, y: 8 },
  magazine: { x: 11, y: 7 },
  stock: { x: 1, y: 4 },
  internal: { x: 8, y: 5 },
} as const;

const METAL = PAL.gunmetal;
const METAL_HI = shade(PAL.gunmetal, 0.3);
const METAL_LO = shade(PAL.gunmetal, -0.35);
const WOOD = PAL.wood;
const WOOD_HI = shade(PAL.wood, 0.22);
const POLY = shade(PAL.charcoal, 0.1);

/** Weapon body shapes, keyed by the `sprite` field on a WeaponDef. */
export type WeaponSpriteKey =
  | 'pistol-light' | 'pistol-heavy' | 'revolver'
  | 'smg-compact' | 'smg-long'
  | 'rifle-assault' | 'rifle-bullpup' | 'rifle-hunting'
  | 'battlerifle' | 'sniper-bolt' | 'sniper-heavy'
  | 'shotgun-pump' | 'shotgun-sawn' | 'lmg-belt'
  | 'melee-knife' | 'melee-machete' | 'melee-axe' | 'melee-blunt' | 'melee-spear'
  | 'thrown-grenade' | 'thrown-bottle' | 'thrown-pipe'
  | 'improv-pipe' | 'improv-nailgun' | 'improv-bolt';

function receiver(p: Pix, x: number, y: number, w: number, h: number, c: RGBA): void {
  p.rect(x, y, w, h, c);
  p.rect(x, y, w, 1, shade(c, 0.25));
  p.rect(x, y + h - 1, w, 1, shade(c, -0.3));
}

function drawBody(p: Pix, key: WeaponSpriteKey): void {
  switch (key) {
    // ── handguns ──────────────────────────────────────────────
    case 'pistol-light':
      receiver(p, 8, 4, 11, 3, METAL);
      p.rect(9, 7, 3, 4, POLY);       // grip
      p.rect(12, 7, 1, 2, METAL_LO);  // trigger guard
      p.rect(18, 5, 2, 1, METAL_HI);  // muzzle
      break;
    case 'pistol-heavy':
      receiver(p, 7, 3, 13, 4, METAL);
      p.rect(8, 7, 4, 5, POLY);
      p.rect(12, 7, 1, 2, METAL_LO);
      p.rect(19, 4, 2, 2, METAL_HI);
      p.rect(9, 3, 1, 1, PAL.bone);   // front sight
      break;
    case 'revolver':
      receiver(p, 8, 4, 10, 3, METAL);
      p.ellipse(12, 6, 2.2, 2.2, METAL_LO); // cylinder
      p.ellipse(12, 6, 1.2, 1.2, METAL);
      p.rect(8, 7, 3, 5, WOOD);
      p.rect(17, 5, 3, 1, METAL_HI);
      break;

    // ── submachine guns ───────────────────────────────────────
    case 'smg-compact':
      receiver(p, 6, 4, 13, 3, METAL);
      p.rect(9, 7, 3, 4, POLY);
      p.rect(3, 4, 3, 2, METAL_LO);   // folding stock
      p.rect(18, 5, 3, 1, METAL_HI);
      break;
    case 'smg-long':
      receiver(p, 4, 4, 17, 3, METAL);
      p.rect(9, 7, 3, 4, POLY);
      p.rect(1, 4, 3, 3, POLY);
      p.rect(20, 5, 3, 1, METAL_HI);
      p.rect(14, 3, 4, 1, METAL_LO);  // heat shield
      break;

    // ── rifles ────────────────────────────────────────────────
    case 'rifle-assault':
      receiver(p, 4, 4, 18, 3, METAL);
      p.rect(1, 4, 4, 3, POLY);       // stock
      p.rect(9, 7, 3, 4, POLY);       // pistol grip
      p.rect(14, 4, 5, 3, shade(POLY, 0.1)); // handguard
      p.rect(21, 5, 4, 1, METAL_HI);  // barrel
      p.rect(20, 3, 1, 2, METAL_LO);  // front sight post
      p.rect(6, 3, 2, 1, METAL_LO);   // charging handle
      break;
    case 'rifle-bullpup':
      receiver(p, 2, 4, 20, 4, POLY);
      p.rect(2, 4, 20, 1, shade(POLY, 0.3));
      p.rect(13, 8, 3, 4, shade(POLY, -0.2)); // grip well forward
      p.rect(22, 5, 3, 1, METAL_HI);
      p.rect(6, 3, 8, 1, METAL_LO);   // integral rail
      break;
    case 'rifle-hunting':
      receiver(p, 5, 4, 16, 3, METAL);
      p.rect(1, 4, 5, 4, WOOD);
      p.rect(1, 4, 5, 1, WOOD_HI);
      p.rect(11, 5, 6, 3, WOOD);      // fore-end
      p.rect(21, 5, 4, 1, METAL_HI);
      p.rect(9, 3, 2, 1, METAL_LO);   // bolt handle
      break;
    case 'battlerifle':
      receiver(p, 3, 3, 19, 4, METAL);
      p.rect(1, 3, 3, 5, WOOD);
      p.rect(9, 7, 3, 5, WOOD);
      p.rect(13, 4, 6, 4, WOOD);
      p.rect(22, 4, 3, 2, METAL_HI);
      break;

    // ── precision ─────────────────────────────────────────────
    case 'sniper-bolt':
      receiver(p, 4, 4, 17, 3, METAL);
      p.rect(1, 4, 4, 4, WOOD);
      p.rect(1, 4, 4, 1, WOOD_HI);
      p.rect(9, 7, 3, 4, WOOD);
      p.rect(21, 5, 4, 1, METAL_HI);
      p.rect(10, 3, 3, 1, METAL_LO);  // bolt
      break;
    case 'sniper-heavy':
      receiver(p, 2, 3, 21, 5, mix(METAL, PAL.oliveDark, 0.4));
      p.rect(1, 3, 3, 6, POLY);
      p.rect(10, 8, 3, 4, POLY);
      p.rect(23, 4, 3, 2, METAL_HI);
      p.rect(21, 3, 4, 1, METAL_LO);  // muzzle brake
      p.rect(21, 7, 4, 1, METAL_LO);
      break;

    // ── shotguns & support ────────────────────────────────────
    case 'shotgun-pump':
      receiver(p, 4, 4, 17, 3, METAL);
      p.rect(1, 4, 4, 4, WOOD);
      p.rect(11, 7, 6, 2, WOOD);      // pump
      p.rect(11, 7, 6, 1, WOOD_HI);
      p.rect(21, 5, 4, 2, METAL_HI);  // wide bore
      break;
    case 'shotgun-sawn':
      receiver(p, 7, 4, 10, 3, METAL);
      p.rect(5, 5, 3, 5, WOOD);       // cut-down stock
      p.rect(17, 4, 2, 3, METAL_HI);
      break;
    case 'lmg-belt':
      receiver(p, 3, 3, 20, 4, mix(METAL, PAL.oliveDark, 0.3));
      p.rect(1, 3, 3, 5, POLY);
      p.rect(10, 7, 3, 4, POLY);
      p.rect(13, 7, 6, 4, METAL_LO);  // ammo box
      p.rect(13, 7, 6, 1, shade(METAL_LO, 0.3));
      p.rect(23, 4, 3, 2, METAL_HI);
      p.rect(19, 2, 5, 1, METAL_LO);  // carry handle
      break;

    // ── melee ─────────────────────────────────────────────────
    case 'melee-knife':
      p.rect(6, 5, 4, 2, WOOD);
      p.rect(10, 5, 1, 3, METAL_LO);  // guard
      for (let i = 0; i < 9; i++) p.rect(11 + i, 5, 1, 2 - (i > 6 ? 1 : 0), i % 2 ? METAL : METAL_HI);
      break;
    case 'melee-machete':
      p.rect(4, 5, 5, 3, PAL.charcoal);
      p.rect(9, 4, 14, 3, METAL);
      p.rect(9, 4, 14, 1, METAL_HI);
      p.rect(20, 4, 3, 1, PAL.rust);  // it has seen work
      break;
    case 'melee-axe':
      p.rect(3, 5, 16, 2, WOOD);
      p.rect(3, 5, 16, 1, WOOD_HI);
      p.ellipse(21, 6, 4, 4.5, METAL);
      p.ellipse(19, 6, 3, 3.5, { r: 0, g: 0, b: 0, a: 0 });
      p.rect(23, 3, 2, 6, METAL_HI);
      break;
    case 'melee-blunt':
      p.rect(2, 5, 16, 2, WOOD);
      p.rect(18, 2, 6, 8, METAL);
      p.rect(18, 2, 6, 1, METAL_HI);
      p.rect(18, 9, 6, 1, METAL_LO);
      break;
    case 'melee-spear':
      p.rect(1, 5, 20, 2, WOOD);
      p.rect(1, 5, 20, 1, WOOD_HI);
      p.rect(20, 4, 3, 1, METAL_LO);  // lashing
      for (let i = 0; i < 4; i++) p.rect(21 + i, 4 + (i > 1 ? 1 : 0), 1, 4 - i, METAL_HI);
      break;

    // ── thrown ────────────────────────────────────────────────
    case 'thrown-grenade':
      p.ellipse(13, 7, 4, 4.5, mix(PAL.oliveDark, METAL, 0.3));
      p.ellipse(12, 6, 2.5, 2.5, PAL.oliveLight);
      p.rect(11, 1, 4, 3, METAL_LO);  // fuze
      p.rect(15, 2, 3, 1, METAL_HI);  // spoon
      p.ellipse(10, 2, 1.6, 1.6, PAL.amber); // pin ring
      break;
    case 'thrown-bottle':
      p.ellipse(13, 8, 4, 4, mix(PAL.water, PAL.rust, 0.5));
      p.rect(11, 3, 4, 4, mix(PAL.water, PAL.rust, 0.5));
      p.rect(11, 3, 1, 4, shade(PAL.water, 0.4));
      p.rect(11, 1, 4, 2, PAL.bone);  // burning rag
      p.set(13, 0, PAL.amber);
      break;
    case 'thrown-pipe':
      p.rect(7, 4, 12, 5, METAL_LO);
      p.rect(7, 4, 12, 1, METAL);
      p.rect(6, 3, 2, 7, PAL.rust);   // end caps
      p.rect(18, 3, 2, 7, PAL.rust);
      p.rect(12, 1, 1, 3, PAL.bone);  // fuse
      p.rect(9, 6, 8, 1, PAL.amber);  // tape
      break;

    // ── improvised ────────────────────────────────────────────
    case 'improv-pipe':
      p.rect(6, 5, 15, 3, PAL.rust);
      p.rect(6, 5, 15, 1, shade(PAL.rust, 0.3));
      p.rect(3, 5, 4, 4, WOOD);       // a plank for a stock
      p.rect(9, 8, 3, 3, WOOD);
      p.rect(11, 4, 4, 1, PAL.amber); // duct tape, always duct tape
      p.rect(16, 4, 3, 1, PAL.amber);
      break;
    case 'improv-nailgun':
      receiver(p, 7, 4, 11, 4, PAL.amber);
      p.rect(9, 8, 3, 4, PAL.charcoal);
      p.rect(12, 2, 5, 3, METAL_LO);  // nail magazine on top
      p.rect(18, 5, 3, 1, METAL_HI);
      p.rect(7, 4, 11, 1, shade(PAL.amber, 0.3));
      break;
    case 'improv-bolt':
      p.rect(4, 5, 17, 2, WOOD);
      p.rect(9, 2, 1, 9, METAL_LO);   // limbs
      p.rect(10, 1, 1, 2, METAL_LO);
      p.rect(10, 9, 1, 2, METAL_LO);
      p.line(10, 1, 10, 11, PAL.bone); // string
      p.rect(11, 5, 10, 1, METAL_HI);  // bolt in the groove
      p.rect(4, 5, 4, 3, WOOD_HI);
      break;
  }
}

// ─────────────────────────────────────────────────────────────── attachments

/** Attachment sprite keys, matched to the `sprite` field on an AttachmentDef. */
export type AttachSpriteKey =
  | 'optic-reddot' | 'optic-scope' | 'optic-thermal' | 'optic-iron' | 'optic-junk'
  | 'barrel-suppressor' | 'barrel-brake' | 'barrel-heavy' | 'barrel-junk'
  | 'under-grip' | 'under-bipod' | 'under-laser' | 'under-bayonet' | 'under-launcher'
  | 'mag-extended' | 'mag-drum' | 'mag-quick'
  | 'stock-fixed' | 'stock-folding' | 'stock-precision'
  | 'internal-trigger' | 'internal-spring' | 'internal-bumpfire';

function drawAttachment(p: Pix, key: AttachSpriteKey): void {
  switch (key) {
    case 'optic-reddot': {
      const { x, y } = ANCHOR.optic;
      p.rect(x, y, 5, 3, METAL_LO);
      p.rect(x + 1, y, 3, 1, METAL_HI);
      p.set(x + 3, y + 1, PAL.bloodBright);
      break;
    }
    case 'optic-scope': {
      const { x, y } = ANCHOR.optic;
      p.rect(x - 2, y, 10, 3, METAL_LO);
      p.rect(x - 2, y, 10, 1, METAL_HI);
      p.rect(x - 3, y - 1, 2, 5, METAL);   // objective bell
      p.rect(x + 8, y, 2, 3, METAL);
      p.set(x - 3, y + 1, PAL.cyan);       // lens glint
      break;
    }
    case 'optic-thermal': {
      const { x, y } = ANCHOR.optic;
      p.rect(x - 2, y - 1, 10, 4, PAL.charcoal);
      p.rect(x - 2, y - 1, 10, 1, shade(PAL.charcoal, 0.4));
      p.rect(x - 1, y, 2, 2, PAL.violet);
      p.set(x + 7, y, PAL.lime);
      break;
    }
    case 'optic-iron': {
      const { x, y } = ANCHOR.optic;
      p.rect(x + 4, y + 1, 1, 2, METAL_LO);
      p.rect(x, y + 1, 1, 2, METAL_LO);
      break;
    }
    case 'optic-junk': {
      const { x, y } = ANCHOR.optic;
      p.rect(x - 1, y, 7, 3, PAL.rust);
      p.rect(x - 1, y, 7, 1, PAL.amber);   // taped on
      p.set(x + 5, y + 1, PAL.cyan);
      break;
    }
    case 'barrel-suppressor': {
      const { x, y } = ANCHOR.barrel;
      p.rect(x, y - 1, 5, 3, PAL.charcoal);
      p.rect(x, y - 1, 5, 1, shade(PAL.charcoal, 0.35));
      p.rect(x + 1, y - 1, 1, 3, METAL_LO);
      p.rect(x + 3, y - 1, 1, 3, METAL_LO);
      break;
    }
    case 'barrel-brake': {
      const { x, y } = ANCHOR.barrel;
      p.rect(x, y - 1, 4, 3, METAL);
      p.rect(x + 1, y - 2, 1, 1, METAL_LO); // ports
      p.rect(x + 3, y - 2, 1, 1, METAL_LO);
      break;
    }
    case 'barrel-heavy': {
      const { x, y } = ANCHOR.barrel;
      p.rect(x - 4, y - 1, 8, 3, METAL);
      p.rect(x - 4, y - 1, 8, 1, METAL_HI);
      break;
    }
    case 'barrel-junk': {
      const { x, y } = ANCHOR.barrel;
      p.rect(x, y - 1, 4, 3, PAL.rust);
      p.rect(x, y - 1, 4, 1, PAL.amber);
      break;
    }
    case 'under-grip': {
      const { x, y } = ANCHOR.underbarrel;
      p.rect(x, y, 2, 4, POLY);
      p.rect(x, y + 3, 2, 1, shade(POLY, -0.3));
      break;
    }
    case 'under-bipod': {
      const { x, y } = ANCHOR.underbarrel;
      p.line(x, y, x - 2, y + 4, METAL_LO);
      p.line(x + 1, y, x + 3, y + 4, METAL_LO);
      p.rect(x - 3, y + 4, 2, 1, METAL);
      p.rect(x + 3, y + 4, 2, 1, METAL);
      break;
    }
    case 'under-laser': {
      const { x, y } = ANCHOR.underbarrel;
      p.rect(x, y, 4, 2, PAL.charcoal);
      p.set(x + 4, y, PAL.bloodBright);
      break;
    }
    case 'under-bayonet': {
      const { x, y } = ANCHOR.underbarrel;
      p.rect(x + 4, y - 1, 6, 1, METAL_HI);
      p.rect(x + 9, y - 1, 2, 1, PAL.bone);
      break;
    }
    case 'under-launcher': {
      const { x, y } = ANCHOR.underbarrel;
      p.rect(x - 2, y, 8, 3, METAL_LO);
      p.rect(x - 2, y, 8, 1, METAL);
      p.ellipse(x + 6, y + 1, 1.5, 1.5, PAL.charcoal);
      break;
    }
    case 'mag-extended': {
      const { x, y } = ANCHOR.magazine;
      p.rect(x, y, 3, 5, METAL_LO);
      p.rect(x, y, 3, 1, METAL);
      p.rect(x, y + 4, 3, 1, PAL.amber);
      break;
    }
    case 'mag-drum': {
      const { x, y } = ANCHOR.magazine;
      p.ellipse(x + 1, y + 3, 3.4, 3.4, METAL_LO);
      p.ellipse(x + 1, y + 3, 1.6, 1.6, METAL);
      p.rect(x, y, 3, 2, METAL_LO);
      break;
    }
    case 'mag-quick': {
      const { x, y } = ANCHOR.magazine;
      p.rect(x, y, 3, 4, METAL_LO);
      p.rect(x - 1, y + 3, 5, 1, PAL.amber); // pull tab
      break;
    }
    case 'stock-fixed': {
      const { x, y } = ANCHOR.stock;
      p.rect(x, y, 4, 4, POLY);
      p.rect(x, y, 4, 1, shade(POLY, 0.3));
      break;
    }
    case 'stock-folding': {
      const { x, y } = ANCHOR.stock;
      p.rect(x, y + 1, 4, 1, METAL_LO);
      p.rect(x, y + 3, 4, 1, METAL_LO);
      p.rect(x, y + 1, 1, 3, METAL);
      break;
    }
    case 'stock-precision': {
      const { x, y } = ANCHOR.stock;
      p.rect(x - 1, y - 1, 5, 6, POLY);
      p.rect(x - 1, y - 1, 5, 1, shade(POLY, 0.3));
      p.rect(x + 1, y + 4, 3, 2, shade(POLY, -0.25)); // adjustable cheek riser
      break;
    }
    case 'internal-trigger':
    case 'internal-spring':
    case 'internal-bumpfire': {
      // Internals are invisible from outside — a small etched mark records the work.
      const { x, y } = ANCHOR.internal;
      p.set(x, y, PAL.gold);
      p.set(x + 1, y, shade(PAL.gold, -0.3));
      break;
    }
  }
}

// ─────────────────────────────────────────────────────────────── public

export interface WeaponArtSpec {
  body: WeaponSpriteKey;
  attachments: readonly AttachSpriteKey[];
  /** 0..1 — wear adds rust and chips the finish. */
  condition: number;
}

function buildWeapon(spec: WeaponArtSpec): Pix {
  const p = new Pix(WEAPON_W, WEAPON_H);
  drawBody(p, spec.body);
  for (const a of spec.attachments) drawAttachment(p, a);

  // Wear pass: a beaten weapon should look beaten.
  if (spec.condition < 0.85) {
    const wear = 1 - spec.condition;
    let n = 0;
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        if (p.alphaAt(x, y) === 0) continue;
        // Deterministic scatter — no RNG needed, and it stays stable across redraws.
        n = (n * 1103515245 + x * 12345 + y * 7919) >>> 0;
        if ((n % 1000) / 1000 < wear * 0.28) {
          p.over(x, y, { ...PAL.rust, a: Math.round(200 * wear) });
        }
      }
    }
  }

  p.outline(PAL.ink);
  return p;
}

export const weaponSprite = memoise(buildWeapon, (spec) =>
  `${spec.body}|${spec.attachments.join('+')}|${Math.round(spec.condition * 10)}`,
);

/** Big presentation render for the shop, workshop, and loot cards. */
export function weaponCard(spec: WeaponArtSpec, scale = 3): HTMLCanvasElement {
  return weaponSprite(spec).toCanvas(scale);
}

/** A muzzle-flash sprite the renderer stamps at the barrel when a shot fires. */
export const muzzleFlash = memoise(
  (size: 0 | 1 | 2): Pix => {
    const p = new Pix(11, 11);
    const r = 2 + size * 1.6;
    p.ellipse(5, 5, r, r * 0.55, { ...PAL.gold, a: 235 });
    p.ellipse(5, 5, r * 0.6, r * 0.35, PAL.white);
    // Four-point star spikes read as a flash even at one frame.
    p.line(5 - r * 1.7, 5, 5 + r * 1.7, 5, { ...PAL.amber, a: 200 });
    p.line(5, 5 - r * 0.9, 5, 5 + r * 0.9, { ...PAL.amber, a: 170 });
    return p;
  },
  (size) => `flash${size}`,
);
