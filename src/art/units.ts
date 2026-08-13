/**
 * Character sprite generation. A merc's whole appearance derives from their seed, so the
 * same person looks like themselves on the battlefield, in the roster, and on their
 * character sheet — without a single image file in the repo.
 *
 * The battlefield view is top-down at a shallow angle: the head reads large, shoulders are
 * wide, and legs are foreshortened. The body is generated facing "down"; the renderer
 * rotates the weapon around the unit rather than baking eight facings per character.
 */
import { Rng } from '@/core/rng';
import { Pix, hex, memoise, mix, shade, type RGBA } from './forge';
import { CLOTH_TONES, HAIR_TONES, PAL, SKIN_TONES, TEAM_OUTLINE } from './palette';

export const UNIT_W = 16;
export const UNIT_H = 18;

export interface UnitLook {
  skin: RGBA;
  hair: RGBA;
  cloth: RGBA;
  accent: RGBA;
  /** 0 slim, 1 average, 2 heavy — changes silhouette width. */
  build: 0 | 1 | 2;
  headgear: 'none' | 'cap' | 'helmet' | 'hood' | 'beret' | 'bandana';
  vest: 'none' | 'plate' | 'chest_rig' | 'coat';
  hairStyle: 'short' | 'long' | 'bald' | 'mohawk' | 'tied';
}

/** Derive a look from a seed. Explicit overrides win, so hand-authored mercs stay on-model. */
export function lookFromSeed(seed: number, override: Partial<UnitLook> = {}): UnitLook {
  const r = new Rng(seed);
  const base: UnitLook = {
    skin: r.pick(SKIN_TONES),
    hair: r.pick(HAIR_TONES),
    cloth: r.pick(CLOTH_TONES),
    accent: r.pick([PAL.rust, PAL.amber, PAL.blood, PAL.navy, PAL.khaki, PAL.cyan]),
    build: r.weighted([[0, 1], [1, 2.2], [2, 1]] as const) as 0 | 1 | 2,
    headgear: r.weighted([
      ['none', 1.4], ['cap', 1.6], ['helmet', 1.2], ['hood', 0.8], ['beret', 0.5], ['bandana', 0.9],
    ] as const),
    vest: r.weighted([['none', 0.8], ['plate', 1.4], ['chest_rig', 1.6], ['coat', 0.8]] as const),
    hairStyle: r.weighted([
      ['short', 2], ['long', 1.2], ['bald', 0.6], ['mohawk', 0.35], ['tied', 1],
    ] as const),
  };
  return { ...base, ...override };
}

/** Parse the hex-string palette a MercDef carries into forge colours. */
export function lookFromPalette(
  seed: number,
  p: { skin?: string; hair?: string; cloth?: string; accent?: string } | undefined,
  extra: Partial<UnitLook> = {},
): UnitLook {
  const override: Partial<UnitLook> = { ...extra };
  if (p?.skin) override.skin = hex(p.skin);
  if (p?.hair) override.hair = hex(p.hair);
  if (p?.cloth) override.cloth = hex(p.cloth);
  if (p?.accent) override.accent = hex(p.accent);
  return lookFromSeed(seed, override);
}

// ─────────────────────────────────────────────────────────────── merc body

function drawBody(p: Pix, look: UnitLook, dead = false): void {
  const widen = look.build === 2 ? 1 : look.build === 0 ? -1 : 0;
  const cloth = dead ? mix(look.cloth, PAL.ash, 0.45) : look.cloth;
  const clothDark = shade(cloth, -0.3);
  const clothLight = shade(cloth, 0.18);
  const skin = dead ? mix(look.skin, PAL.rotPale, 0.5) : look.skin;

  // Legs — short and stubby, since we are looking down at them.
  const legTop = 12;
  p.rect(5, legTop, 2, 4, clothDark);
  p.rect(9, legTop, 2, 4, clothDark);
  // Boots.
  p.rect(5, 15, 2, 2, PAL.ink);
  p.rect(9, 15, 2, 2, PAL.ink);

  // Torso.
  const tx = 4 - widen;
  const tw = 8 + widen * 2;
  p.rect(tx, 6, tw, 7, cloth);
  p.rect(tx, 6, tw, 2, clothLight); // shoulder highlight catches the sky

  // Arms hanging at the sides.
  p.rect(tx - 1, 7, 1, 5, clothDark);
  p.rect(tx + tw, 7, 1, 5, clothDark);
  // Hands.
  p.set(tx - 1, 12, skin);
  p.set(tx + tw, 12, skin);

  drawVest(p, look, tx, tw, cloth);

  // Head — the dominant read at this size.
  const headR = look.build === 2 ? 3.4 : 3.1;
  p.ellipse(8, 4.2, headR, 3.3, skin);
  drawHair(p, look, skin);
  drawHeadgear(p, look);

  if (!dead) {
    // Eyes: two dark pixels. At 16px this is all the face you need or want.
    p.set(7, 4, PAL.ink);
    p.set(9, 4, PAL.ink);
  }
}

function drawVest(p: Pix, look: UnitLook, tx: number, tw: number, cloth: RGBA): void {
  switch (look.vest) {
    case 'plate': {
      const plate = shade(mix(cloth, PAL.gunmetal, 0.5), -0.05);
      p.rect(tx + 1, 7, tw - 2, 5, plate);
      p.rect(tx + 1, 7, tw - 2, 1, shade(plate, 0.22));
      // Buckle strap.
      p.rect(tx + 1, 9, tw - 2, 1, shade(plate, -0.35));
      break;
    }
    case 'chest_rig': {
      const rig = shade(mix(cloth, PAL.coyote, 0.6), -0.08);
      p.rect(tx + 1, 8, tw - 2, 3, rig);
      // Magazine pouches — three little blocks, instantly reads as "loaded for work".
      for (let i = 0; i < 3; i++) {
        p.rect(tx + 1 + i * 2, 8, 1, 3, shade(rig, -0.3));
      }
      p.set(tx + 1, 7, look.accent);
      break;
    }
    case 'coat': {
      const coat = shade(cloth, -0.18);
      p.rect(tx, 7, tw, 6, coat);
      p.rect(tx + Math.floor(tw / 2), 7, 1, 6, shade(coat, -0.35)); // centre seam
      p.rect(tx, 7, 1, 6, shade(coat, 0.15));
      break;
    }
    case 'none':
      break;
  }
}

function drawHair(p: Pix, look: UnitLook, skin: RGBA): void {
  const h = look.hair;
  const hd = shade(h, -0.25);
  switch (look.hairStyle) {
    case 'bald':
      p.over(8, 1, { r: 255, g: 255, b: 255, a: 40 });
      break;
    case 'short':
      p.ellipse(8, 2.6, 3.1, 2, h);
      p.rect(5, 1, 6, 1, hd);
      break;
    case 'long':
      p.ellipse(8, 2.6, 3.2, 2.1, h);
      p.rect(4, 3, 1, 4, h);
      p.rect(11, 3, 1, 4, h);
      p.rect(4, 6, 1, 1, hd);
      p.rect(11, 6, 1, 1, hd);
      break;
    case 'tied':
      p.ellipse(8, 2.6, 3.1, 2, h);
      p.rect(7, 0, 2, 2, hd); // bun on top, visible from above
      break;
    case 'mohawk':
      p.rect(7, 0, 2, 4, h);
      p.rect(7, 0, 2, 1, shade(h, 0.3));
      // Shaved sides show skin.
      p.rect(5, 2, 2, 1, skin);
      p.rect(9, 2, 2, 1, skin);
      break;
  }
}

function drawHeadgear(p: Pix, look: UnitLook): void {
  const a = look.accent;
  switch (look.headgear) {
    case 'cap': {
      const c = shade(look.cloth, -0.2);
      p.ellipse(8, 2.4, 3.2, 1.9, c);
      p.rect(5, 4, 6, 1, shade(c, -0.35)); // brim
      p.set(8, 1, shade(c, 0.25));
      break;
    }
    case 'helmet': {
      const c = mix(look.cloth, PAL.oliveDark, 0.6);
      p.ellipse(8, 2.6, 3.5, 2.3, c);
      p.ellipse(8, 2.2, 3.5, 1.4, shade(c, 0.14));
      p.rect(4, 4, 8, 1, shade(c, -0.4)); // rim
      p.set(11, 3, a); // unit tape
      break;
    }
    case 'hood': {
      const c = shade(look.cloth, -0.25);
      p.ellipse(8, 2.8, 3.7, 2.6, c);
      p.ellipse(8, 4.2, 2.4, 2.2, { r: 0, g: 0, b: 0, a: 90 }); // shadowed face
      break;
    }
    case 'beret': {
      p.ellipse(8, 2.2, 3.3, 1.6, a);
      p.rect(10, 1, 2, 1, shade(a, -0.35)); // it flops to one side
      break;
    }
    case 'bandana': {
      p.rect(5, 2, 6, 2, a);
      p.rect(5, 2, 6, 1, shade(a, 0.2));
      p.rect(4, 3, 1, 3, shade(a, -0.2)); // trailing tail
      break;
    }
    case 'none':
      break;
  }
}

// ─────────────────────────────────────────────────────────────── public sprites

export type Team = 'player' | 'ally' | 'enemy' | 'zombie';

function buildMerc(seed: number, team: Team, look: UnitLook, state: 'ok' | 'down' | 'dead'): Pix {
  const p = new Pix(UNIT_W, UNIT_H);
  drawBody(p, look, state !== 'ok');
  p.topLight(0.22);
  p.outline(PAL.ink);
  // A second, team-tinted outline ring so allegiance is legible without a healthbar.
  p.outline(mix(PAL.ink, TEAM_OUTLINE[team], 0.75));
  p.groundShadow(8, 16.5, 5.5, 2, 95);

  if (state === 'down') p.tint(PAL.blood, 0.3);
  if (state === 'dead') p.tint(PAL.ash, 0.5);
  return p;
}

export const mercSprite = memoise(buildMerc, (seed, team, look, state) =>
  `${seed}|${team}|${state}|${look.build}${look.headgear}${look.vest}${look.hairStyle}` +
  `|${look.skin.r},${look.hair.r},${look.cloth.r},${look.cloth.g},${look.cloth.b},${look.accent.r}`,
);

// ─────────────────────────────────────────────────────────────── the dead

export type ZombieVariant = 'shambler' | 'runner' | 'bloater' | 'armoured' | 'screamer' | 'crawler';

function buildZombie(seed: number, variant: ZombieVariant): Pix {
  const p = new Pix(UNIT_W, UNIT_H);
  const r = new Rng(seed);

  const flesh =
    variant === 'bloater' ? PAL.bloatGreen :
    variant === 'runner' ? mix(PAL.rot, PAL.skin2, 0.35) :
    PAL.rot;
  const fleshDark = shade(flesh, -0.28);
  // Eight years of the same clothes.
  const rag = mix(r.pick(CLOTH_TONES), PAL.dirt, 0.45);
  const ragDark = shade(rag, -0.3);

  if (variant === 'crawler') {
    // No legs, dragging itself. Low, wide silhouette so it reads as different at a glance.
    p.ellipse(8, 11, 4.5, 2.6, rag);
    p.rect(3, 11, 2, 1, flesh);
    p.rect(11, 11, 2, 1, flesh);
    p.ellipse(8, 7.5, 3, 2.8, flesh);
    p.set(7, 7, PAL.blood);
    p.set(9, 7, PAL.blood);
    p.rect(4, 13, 8, 1, mix(PAL.blood, PAL.ink, 0.4)); // smear behind it
  } else {
    const heavy = variant === 'bloater' || variant === 'armoured';
    const widen = heavy ? 2 : variant === 'runner' ? -1 : 0;

    // Legs, always slightly wrong.
    p.rect(5, 12, 2, 4, ragDark);
    p.rect(9, 12, 2, 4, ragDark);
    p.rect(5, 15, 2, 1, PAL.ink);
    p.rect(9, 15, 2, 1, PAL.ink);

    const tx = 4 - widen;
    const tw = 8 + widen * 2;
    p.rect(tx, 6, tw, 7, rag);

    if (variant === 'bloater') {
      // Distended, gas-filled torso.
      p.ellipse(8, 10, 4.6, 3.4, flesh);
      p.ellipse(8, 10, 3, 2, shade(flesh, 0.18));
      p.set(6, 9, PAL.rotDark);
      p.set(10, 11, PAL.rotDark);
    }
    if (variant === 'armoured') {
      // Ex-soldier still wearing the plate that did not save them.
      const plate = mix(PAL.gunmetal, PAL.oliveDark, 0.4);
      p.rect(tx + 1, 7, tw - 2, 5, plate);
      p.rect(tx + 1, 7, tw - 2, 1, shade(plate, 0.2));
      p.rect(tx + 2, 9, 3, 1, PAL.blood); // the hole it came through
    }

    // Arms out in front — the universal shorthand.
    p.rect(tx - 2, 8, 2, 2, rag);
    p.rect(tx + tw, 8, 2, 2, rag);
    p.rect(tx - 2, 10, 2, 1, flesh);
    p.rect(tx + tw, 10, 2, 1, flesh);

    // Head, tilted wrong.
    const tilt = r.int(-1, 1);
    p.ellipse(8 + tilt, 4, 3.1, 3.2, flesh);
    p.ellipse(8 + tilt, 5.2, 2.4, 1.6, fleshDark);

    if (variant === 'screamer') {
      // A jaw hanging far too open. This one you learn to shoot first.
      p.rect(7 + tilt, 5, 3, 3, PAL.ink);
      p.rect(7 + tilt, 6, 3, 1, PAL.blood);
      p.set(6 + tilt, 3, PAL.bloodBright);
      p.set(10 + tilt, 3, PAL.bloodBright);
    } else {
      p.set(7 + tilt, 4, PAL.blood);
      p.set(9 + tilt, 4, PAL.blood);
    }

    if (variant === 'runner') {
      // Fresher, faster, still has most of its face.
      p.rect(6, 2, 4, 1, mix(PAL.blood, PAL.ink, 0.3));
    }

    // Random rot patches.
    for (let i = 0; i < 3; i++) {
      p.set(r.int(4, 11), r.int(7, 12), fleshDark);
    }
  }

  p.topLight(0.2);
  p.outline(PAL.ink);
  p.outline(mix(PAL.ink, TEAM_OUTLINE.zombie, 0.7));
  p.groundShadow(8, 16.5, 5, 2, 85);
  return p;
}

export const zombieSprite = memoise(buildZombie, (seed, variant) => `z${seed}|${variant}`);

// ─────────────────────────────────────────────────────────────── portraits

export const PORTRAIT_W = 32;
export const PORTRAIT_H = 32;

/**
 * A head-and-shoulders portrait for the roster and character sheet. Deliberately built from
 * the same look object as the battle sprite so the face you hire is the face you deploy.
 */
function buildPortrait(seed: number, look: UnitLook, dead = false): Pix {
  const p = new Pix(PORTRAIT_W, PORTRAIT_H);
  const r = new Rng(seed ^ 0x5bf03635);

  const skin = dead ? mix(look.skin, PAL.rotPale, 0.6) : look.skin;
  const skinShade = shade(skin, -0.22);
  const cloth = look.cloth;

  // Backdrop: a flat field with a vignette, so portraits sit in a frame nicely.
  const bg = mix(PAL.inkSoft, look.accent, 0.12);
  p.rect(0, 0, PORTRAIT_W, PORTRAIT_H, bg);
  p.rect(0, 22, PORTRAIT_W, 10, shade(bg, -0.25));

  // Shoulders.
  p.ellipse(16, 34, 13, 10, cloth);
  p.ellipse(16, 35, 13, 10, shade(cloth, 0.1));
  // Collar.
  p.rect(11, 25, 10, 2, shade(cloth, -0.3));

  // Neck.
  p.rect(13, 21, 6, 5, skinShade);

  // Head.
  p.ellipse(16, 15, 8, 9.5, skin);
  // Jaw shading gives the flat oval some structure.
  p.ellipse(16, 19, 6.5, 5, shade(skin, -0.08));
  p.ellipse(16, 12, 7.5, 6, shade(skin, 0.07));

  // Brow shadow — the single detail that most makes a pixel face look like a person.
  p.rect(9, 12, 14, 1, shade(skin, -0.3));

  // Eyes.
  const eyeY = 14;
  p.rect(11, eyeY, 3, 2, PAL.bone);
  p.rect(18, eyeY, 3, 2, PAL.bone);
  const gaze = r.int(0, 2);
  p.rect(12 + (gaze === 0 ? -1 : gaze === 2 ? 1 : 0), eyeY, 1, 2, PAL.ink);
  p.rect(19 + (gaze === 0 ? -1 : gaze === 2 ? 1 : 0), eyeY, 1, 2, PAL.ink);
  // Brows carry the expression.
  const browTilt = r.int(0, 2);
  p.rect(10, 12 - (browTilt === 0 ? 0 : 1), 4, 1, look.hair);
  p.rect(18, 12 - (browTilt === 2 ? 0 : 1), 4, 1, look.hair);

  // Nose and mouth.
  p.rect(15, 16, 2, 2, shade(skin, -0.18));
  const mouth = r.int(0, 2);
  p.rect(13, 20, 6, 1, shade(skin, -0.35));
  if (mouth === 1) p.rect(13, 21, 6, 1, shade(skin, -0.2));

  // Weathering: everyone in the Basin has scars.
  if (r.chance(0.4)) {
    const sx = r.int(8, 22);
    p.line(sx, r.int(9, 13), sx + r.int(-2, 2), r.int(17, 21), mix(skin, PAL.blood, 0.35));
  }
  if (r.chance(0.35)) {
    // Stubble.
    for (let i = 0; i < 16; i++) p.over(r.int(11, 21), r.int(19, 23), { r: 40, g: 34, b: 30, a: 70 });
  }

  drawPortraitHair(p, look, r);
  drawPortraitHeadgear(p, look);

  p.outline(PAL.ink, true);
  if (dead) p.tint(PAL.ash, 0.55);
  return p;
}

function drawPortraitHair(p: Pix, look: UnitLook, r: Rng): void {
  const h = look.hair;
  const hd = shade(h, -0.28);
  const hl = shade(h, 0.18);
  switch (look.hairStyle) {
    case 'bald':
      p.ellipse(16, 8, 6, 3, shade(look.skin, 0.1));
      break;
    case 'short':
      p.ellipse(16, 9, 8.2, 6, h);
      p.ellipse(16, 12, 8.4, 4, { r: 0, g: 0, b: 0, a: 0 });
      p.ellipse(16, 8, 8.2, 5, h);
      p.ellipse(16, 7, 6, 3, hl);
      break;
    case 'long':
      p.ellipse(16, 9, 8.6, 6, h);
      p.rect(7, 10, 3, 14, h);
      p.rect(22, 10, 3, 14, h);
      p.rect(7, 22, 3, 2, hd);
      p.rect(22, 22, 3, 2, hd);
      p.ellipse(16, 8, 8.2, 5, h);
      p.ellipse(16, 7, 5, 2.5, hl);
      break;
    case 'tied':
      p.ellipse(16, 8, 8.2, 5, h);
      p.ellipse(16, 7, 5, 2.5, hl);
      p.ellipse(26, 14, 3, 4, h); // ponytail
      p.ellipse(26, 14, 2, 3, hd);
      break;
    case 'mohawk':
      p.rect(14, 2, 4, 8, h);
      p.rect(14, 2, 4, 2, hl);
      p.ellipse(16, 9, 8, 3, shade(look.skin, -0.05));
      p.rect(14, 2, 4, 8, h);
      break;
  }
  if (r.chance(0.25) && look.hairStyle !== 'bald') {
    // Grey at the temples.
    p.over(9, 11, { r: 220, g: 218, b: 208, a: 150 });
    p.over(23, 11, { r: 220, g: 218, b: 208, a: 150 });
  }
}

function drawPortraitHeadgear(p: Pix, look: UnitLook): void {
  const a = look.accent;
  switch (look.headgear) {
    case 'cap': {
      const c = shade(look.cloth, -0.2);
      p.ellipse(16, 8, 8.6, 5, c);
      p.ellipse(16, 6, 6, 3, shade(c, 0.18));
      p.rect(6, 11, 20, 2, shade(c, -0.35));
      break;
    }
    case 'helmet': {
      const c = mix(look.cloth, PAL.oliveDark, 0.55);
      p.ellipse(16, 8, 9.4, 6.4, c);
      p.ellipse(16, 6, 7, 3.4, shade(c, 0.16));
      p.rect(6, 11, 20, 2, shade(c, -0.4));
      p.rect(22, 7, 3, 2, a);
      // Chin strap.
      p.line(8, 13, 10, 22, shade(c, -0.3));
      p.line(24, 13, 22, 22, shade(c, -0.3));
      break;
    }
    case 'hood': {
      const c = shade(look.cloth, -0.22);
      p.ellipse(16, 10, 11, 10, c);
      p.ellipse(16, 15, 8, 8, { r: 0, g: 0, b: 0, a: 0 });
      p.ellipse(16, 15, 8.4, 8.4, { r: 0, g: 0, b: 0, a: 70 });
      p.ellipse(16, 16, 7.6, 8, { r: 0, g: 0, b: 0, a: 0 });
      break;
    }
    case 'beret': {
      p.ellipse(16, 7, 8.6, 4, a);
      p.ellipse(24, 6, 4, 2.6, shade(a, -0.3));
      p.rect(7, 10, 18, 1, shade(a, -0.45));
      break;
    }
    case 'bandana': {
      p.rect(7, 7, 18, 4, a);
      p.rect(7, 7, 18, 1, shade(a, 0.22));
      p.rect(4, 9, 4, 5, shade(a, -0.2));
      break;
    }
    case 'none':
      break;
  }
}

export const portraitSprite = memoise(buildPortrait, (seed, look, dead) =>
  `p${seed}|${dead}|${look.build}${look.headgear}${look.vest}${look.hairStyle}` +
  `|${look.skin.r},${look.hair.r},${look.cloth.r},${look.cloth.g},${look.cloth.b},${look.accent.r}`,
);

/** Portrait for a zombie, used in the bestiary and kill feed. */
export const zombiePortrait = memoise(
  (seed: number, variant: ZombieVariant): Pix => {
    const look = lookFromSeed(seed, {
      skin: variant === 'bloater' ? PAL.bloatGreen : PAL.rot,
      hairStyle: 'short',
      headgear: variant === 'armoured' ? 'helmet' : 'none',
    });
    const p = buildPortrait(seed, look, true);
    p.tint(PAL.rotDark, 0.25);
    return p;
  },
  (seed, variant) => `zp${seed}|${variant}`,
);
