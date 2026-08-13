/**
 * Terrain tiles. Each tile is generated per (kind, variant) so a field of grass has texture
 * without repeating obviously — the variant is derived from the tile's grid position, so the
 * map looks identical every time you load the same battle.
 */
import { Rng } from '@/core/rng';
import { Pix, memoise, mix, shade, type RGBA } from './forge';
import { PAL } from './palette';
import type { TerrainKind } from '@/sim/types';

export const TILE = 16;

/** Scatter n deterministic specks of `c` across the tile. */
function speckle(p: Pix, r: Rng, c: RGBA, n: number, alpha = 255): void {
  for (let i = 0; i < n; i++) {
    p.blend(r.int(0, TILE - 1), r.int(0, TILE - 1), { ...c, a: alpha });
  }
}

function drawTile(kind: TerrainKind, variant: number): Pix {
  const p = new Pix(TILE, TILE);
  const r = new Rng((variant + 1) * 2654435761);

  switch (kind) {
    case 'grass': {
      p.rect(0, 0, TILE, TILE, PAL.grass);
      speckle(p, r, PAL.grassDark, 9, 150);
      speckle(p, r, shade(PAL.grass, 0.14), 6, 130);
      // Occasional tufts give the field a direction. Sparse on purpose — dense tufting
      // turns a whole field into noise once it tiles across the map.
      for (let i = 0; i < (variant % 2 === 0 ? 2 : 0); i++) {
        const x = r.int(1, TILE - 2);
        const y = r.int(1, TILE - 3);
        p.set(x, y, shade(PAL.grass, 0.3));
        p.set(x, y + 1, PAL.grassDark);
      }
      break;
    }
    case 'dirt': {
      p.rect(0, 0, TILE, TILE, PAL.dirt);
      speckle(p, r, PAL.dirtDark, 10, 150);
      speckle(p, r, shade(PAL.dirt, 0.12), 6, 130);
      break;
    }
    case 'road': {
      p.rect(0, 0, TILE, TILE, PAL.road);
      speckle(p, r, PAL.roadDark, 8, 140);
      // Cracks — the roads have not been maintained in eight years.
      if (r.chance(0.4)) {
        let x = r.int(2, TILE - 3);
        for (let y = 0; y < TILE; y++) {
          p.set(x, y, PAL.roadDark);
          x += r.int(-1, 1);
          x = Math.max(1, Math.min(TILE - 2, x));
        }
      }
      break;
    }
    case 'floor': {
      // Weathering tint varies per tile so a warehouse floor is not one flat grey.
      const c = mix(
        PAL.concrete,
        r.pick([PAL.grassDark, PAL.rust, PAL.khaki, PAL.concrete]),
        r.float(0.05, 0.22),
      );
      p.rect(0, 0, TILE, TILE, c);
      speckle(p, r, shade(c, -0.12), 7, 140);
      // Tile seams.
      p.rect(0, 0, TILE, 1, shade(c, -0.22));
      p.rect(0, 0, 1, TILE, shade(c, -0.22));
      break;
    }
    case 'water': {
      p.rect(0, 0, TILE, TILE, PAL.water);
      for (let i = 0; i < 5; i++) {
        const y = r.int(1, TILE - 2);
        const x = r.int(0, TILE - 6);
        p.rect(x, y, r.int(3, 6), 1, shade(PAL.water, 0.28));
      }
      break;
    }
    case 'rubble': {
      p.rect(0, 0, TILE, TILE, mix(mix(PAL.concrete, PAL.dirt, 0.4), PAL.grassDark, r.float(0, 0.25)));
      for (let i = 0; i < 6; i++) {
        const x = r.int(0, TILE - 3);
        const y = r.int(0, TILE - 3);
        const s = r.int(1, 3);
        p.rect(x, y, s, s, r.pick([PAL.concrete, PAL.ash, PAL.steel, PAL.dirtDark]));
        p.rect(x, y, s, 1, PAL.bone);
      }
      break;
    }
    case 'wall': {
      const c = mix(PAL.concrete, r.pick([PAL.rust, PAL.grassDark, PAL.khaki]), r.float(0.06, 0.2));
      p.rect(0, 0, TILE, TILE, c);
      // Brick courses, offset every other row.
      for (let row = 0; row < 4; row++) {
        const y = row * 4;
        p.rect(0, y, TILE, 1, shade(c, -0.45));
        const off = row % 2 === 0 ? 0 : 4;
        for (let x = off; x < TILE; x += 8) p.rect(x, y, 1, 4, shade(c, -0.45));
      }
      p.rect(0, 0, TILE, 1, shade(c, 0.25));
      speckle(p, r, shade(c, -0.12), 5, 130);
      // Moss taking the north face back.
      if (r.chance(0.45)) {
        for (let i = 0; i < 5; i++) {
          p.blend(r.int(0, TILE - 1), r.int(TILE - 6, TILE - 1), { ...PAL.grassDark, a: 120 });
        }
      }
      break;
    }
    case 'window': {
      const frame = PAL.steel;
      p.rect(0, 0, TILE, TILE, frame);
      p.rect(2, 2, TILE - 4, TILE - 4, mix(PAL.water, PAL.bone, 0.35));
      p.rect(2, 2, TILE - 4, 2, shade(PAL.bone, 0.1));
      p.rect(TILE / 2 - 1, 2, 2, TILE - 4, frame);
      p.rect(2, TILE / 2 - 1, TILE - 4, 2, frame);
      break;
    }
    case 'door': {
      p.rect(0, 0, TILE, TILE, PAL.wood);
      p.rect(1, 1, TILE - 2, TILE - 2, shade(PAL.wood, -0.15));
      p.rect(3, 3, TILE - 6, 5, shade(PAL.wood, 0.12)); // panels
      p.rect(3, 9, TILE - 6, 4, shade(PAL.wood, 0.12));
      p.rect(TILE - 4, TILE / 2, 2, 2, PAL.gold);        // handle
      break;
    }
    case 'crate': {
      p.rect(1, 1, TILE - 2, TILE - 2, PAL.wood);
      p.rect(1, 1, TILE - 2, 2, shade(PAL.wood, 0.25));
      p.rect(1, TILE - 3, TILE - 2, 2, shade(PAL.wood, -0.28));
      // Diagonal bracing.
      p.line(2, 2, TILE - 3, TILE - 3, shade(PAL.wood, -0.2));
      p.line(TILE - 3, 2, 2, TILE - 3, shade(PAL.wood, -0.2));
      p.frame(1, 1, TILE - 2, TILE - 2, PAL.ink);
      break;
    }
    case 'sandbag': {
      // Three staggered rows of bags.
      for (let row = 0; row < 3; row++) {
        const y = 2 + row * 4;
        const off = row % 2 === 0 ? 0 : 3;
        for (let x = -off; x < TILE; x += 6) {
          p.ellipse(x + 3, y + 2, 3.2, 2.2, PAL.khaki);
          p.ellipse(x + 3, y + 1.4, 2.6, 1.4, shade(PAL.khaki, 0.16));
          p.line(x + 3, y, x + 3, y + 4, shade(PAL.khaki, -0.25));
        }
      }
      p.outline(PAL.ink);
      break;
    }
    case 'fence': {
      // Chain link, seen from above as a thin barrier with posts.
      p.rect(6, 0, 4, TILE, mix(PAL.steel, PAL.rust, 0.3));
      for (let y = 0; y < TILE; y += 3) {
        p.set(6, y, shade(PAL.steel, 0.3));
        p.set(9, y + 1, shade(PAL.steel, 0.3));
      }
      p.rect(5, 0, 6, 2, PAL.steelLight);
      p.rect(5, TILE - 2, 6, 2, PAL.steelLight);
      break;
    }
    case 'tree': {
      p.rect(0, 0, TILE, TILE, PAL.grassDark);
      // Canopy seen from above.
      p.ellipse(8, 8, 7, 7, PAL.grassDark);
      p.ellipse(7, 7, 6, 6, shade(PAL.grass, -0.1));
      p.ellipse(6, 6, 4, 4, shade(PAL.grass, 0.12));
      for (let i = 0; i < 20; i++) {
        const a = r.float(0, Math.PI * 2);
        const d = r.float(0, 6.5);
        p.set(Math.round(8 + Math.cos(a) * d), Math.round(8 + Math.sin(a) * d), PAL.grassDark);
      }
      p.ellipse(8, 8, 1.4, 1.4, PAL.wood); // trunk glimpsed through the leaves
      break;
    }
    case 'car': {
      p.rect(0, 0, TILE, TILE, PAL.road);
      const body = r.pick([PAL.blood, PAL.navy, PAL.khaki, PAL.steel, PAL.rust]);
      const faded = mix(body, PAL.rust, 0.35);
      // Roof-down view of a long-abandoned car.
      p.rect(2, 1, 12, 14, faded);
      p.rect(2, 1, 12, 1, shade(faded, 0.25));
      p.rect(3, 3, 10, 4, mix(PAL.water, PAL.ink, 0.5));   // windscreen
      p.rect(3, 9, 10, 4, mix(PAL.water, PAL.ink, 0.5));   // rear window
      p.rect(2, 7, 12, 2, shade(faded, -0.2));             // roof line
      p.rect(1, 3, 1, 3, PAL.ink);                          // wheels
      p.rect(14, 3, 1, 3, PAL.ink);
      p.rect(1, 11, 1, 3, PAL.ink);
      p.rect(14, 11, 1, 3, PAL.ink);
      speckle(p, r, PAL.rust, 8, 140);                     // eight years of weather
      p.outline(PAL.ink);
      break;
    }
  }

  return p;
}

export const tileSprite = memoise(drawTile, (kind, variant) => `${kind}:${variant}`);

/** Deterministic variant index for a tile position — same map, same texture, every time. */
export function variantFor(x: number, y: number, count = 4): number {
  let h = (x * 73856093) ^ (y * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return h % count;
}

// ─────────────────────────────────────────────────────────────── overlays

/** Blood decal stamped onto a tile as damage accumulates there. */
export const bloodDecal = memoise(
  (variant: number, intensity: number): Pix => {
    const p = new Pix(TILE, TILE);
    const r = new Rng((variant + 7) * 2246822519);
    const blobs = 2 + Math.floor(intensity * 5);
    for (let i = 0; i < blobs; i++) {
      const cx = r.float(3, TILE - 3);
      const cy = r.float(3, TILE - 3);
      const rad = r.float(1.2, 2.2 + intensity * 2);
      p.ellipse(cx, cy, rad, rad * r.float(0.6, 1), {
        ...PAL.blood,
        a: Math.round(110 + intensity * 110),
      });
    }
    // Spatter flecks around the pool.
    for (let i = 0; i < Math.floor(intensity * 14); i++) {
      p.blend(r.int(0, TILE - 1), r.int(0, TILE - 1), { ...PAL.blood, a: r.int(70, 180) });
    }
    return p;
  },
  (variant, intensity) => `blood${variant}:${Math.round(intensity * 6)}`,
);

/** Scorch mark left by an explosion. */
export const scorchDecal = memoise(
  (variant: number): Pix => {
    const p = new Pix(TILE, TILE);
    const r = new Rng((variant + 13) * 3266489917);
    p.ellipse(8, 8, r.float(5, 7), r.float(5, 7), { r: 20, g: 16, b: 14, a: 150 });
    p.ellipse(8, 8, 3, 3, { r: 10, g: 8, b: 8, a: 200 });
    for (let i = 0; i < 12; i++) {
      p.blend(r.int(0, TILE - 1), r.int(0, TILE - 1), { r: 30, g: 24, b: 20, a: r.int(60, 140) });
    }
    return p;
  },
  (variant) => `scorch${variant}`,
);

/** Loot bag marker dropped on the field. */
export const lootSprite = memoise(
  (rarityColor: string): Pix => {
    const p = new Pix(TILE, TILE);
    const c = PAL.coyote;
    p.ellipse(8, 10, 4.5, 3.6, c);
    p.ellipse(8, 9, 3.4, 2.4, shade(c, 0.2));
    p.rect(6, 5, 4, 3, shade(c, -0.2));  // neck of the bag
    p.rect(5, 6, 6, 1, PAL.ink);         // drawstring
    p.outline(PAL.ink);
    // A rarity-coloured glow ring so valuable drops read from across the map.
    const glow = { ...PAL.white, a: 90 };
    void rarityColor;
    p.ellipse(8, 12, 6, 2, glow);
    return p;
  },
  (rarityColor) => `loot${rarityColor}`,
);
