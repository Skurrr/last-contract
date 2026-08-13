# LAST CONTRACT

**Turn-based tactics in a world eight years dead.**

You run Vulture Company, a mercenary outfit in the Basin — eight years after the Grey Fever
turned 99% of humanity into the walking dead. Villages hire you to clear the dead. Factions
hire you to kill each other. You hire the mercs, buy the guns, build the attachments, and
decide which faction lives to see next winter.

Inspired by **Jagged Alliance 2** (mercenary company, body-part gunplay, unforgettable
characters), **Fallout Tactics** (grid combat), and **Project Zomboid** (trait and perk density).

## Features

- **Turn-based tactics** — action points, three stances, directional cover, line of sight,
  called shots to head/torso/arms/legs, burst and auto fire, interrupts, suppression.
- **Noise-driven undead** — zombies chase a propagating noise field, not your position.
  Suppressors and knives are strategy, not flavour.
- **Grand strategy** — sector map, five factions with reputation, alliances and wars,
  contracts, salaries, a budget you can genuinely run out of, and a global horde clock.
- **Unique mercenaries** — hand-written characters with quirks, barks, morale and grudges.
- **Deep progression** — HP, stamina, XP, 20 levels, ~60 perks across five trees,
  ~24 positive/negative traits, and a full character sheet.
- **Weapon building** — six attachment slots, ~40 attachments, weapon condition and jams,
  material scavenging, recipe crafting and improvised one-off guns.
- **Procedural pixel art** — every sprite is forged in code from a seed. No asset pipeline,
  and every merc looks like themselves everywhere they appear.

## Running it

```bash
npm install
npm run dev       # play at localhost:5173
npm test          # simulation test suite
npm run build     # typecheck + production build
```

## Architecture

| Path | Role |
|---|---|
| `src/core/` | Seeded RNG, grid maths, pathfinding primitives. No game concepts. |
| `src/sim/` | The deterministic simulation: types, field queries, combat, turn flow. Pure data in, events out. |
| `src/data/` | All content: weapons, attachments, perks, traits, mercs, enemies, factions, recipes. |
| `src/campaign/` | Strategy layer: sectors, factions, contracts, economy, time. |
| `src/art/` | Procedural sprite forge. Seeded pixel art for every entity. |
| `src/render/` | Canvas renderer, camera, particles, juice. |
| `src/ui/` | Screens: HUD, character sheet, hiring, market, workshop. |
| `tests/` | Vitest suites over the deterministic core. |

The simulation never touches the DOM. It mutates a `BattleState` value and emits
`CombatEvent`s; the renderer decides how loud to be about each one. That separation is what
makes battles replayable from a seed and testable headlessly.

See [`docs/SPEC.md`](docs/SPEC.md) for the full design spec.

## Licence

MIT
