# LAST CONTRACT — Design Spec

> A compact top-down turn-based tactics game. Jagged Alliance 2's mercenary company and
> body-part gunplay, Fallout Tactics' grid combat, Project Zomboid's trait/perk density.
> Set 8 years after the Grey Fever turned 99% of humanity into the walking dead.

---

## 1. Pitch

You run **Vulture Company**, a mercenary outfit that takes any contract. Villages hire you
to clear the dead. Factions hire you to kill each other. You hire the mercs, buy the guns,
build the attachments, and decide which faction lives to see next winter.

The world is a hex-free 2D sector map. Each sector is a tactical battle. Between battles
you manage cash, salaries, morale, reputation, and a workshop.

**Core loop:** Take contract → deploy squad → tactical battle → loot & XP → spend at the
workshop/market → faction politics shift → new contracts unlock.

---

## 2. The World

### 2.1 The Grey Fever
Eight years ago a prion-like pathogen crossed from a research facility. 99% turned. The
dead do not rot the way they should — the Fever keeps them walking. They are slow in the
cold, fast in the heat, and they *hear* far better than they see.

### 2.2 Geography
The playable region is **the Basin** — a 8×6 grid of sectors around a drained reservoir.
Each sector has a terrain type, a controlling faction (or none), and a threat level.

Sector types: `village`, `farmland`, `woods`, `industrial`, `highway`, `ruins`, `military`, `swamp`.

### 2.3 Factions

| Faction | Ideology | Trades | Hostile to |
|---|---|---|---|
| **Havenhold** | Farmer-democrats, walled village, food surplus | Food, medicine, cash | Rust Kings |
| **Rust Kings** | Scrap-baron raiders, highway toll gangs | Weapon parts, ammo | Havenhold, Ash Order |
| **Ash Order** | Doomsday cult, believe the Fever is a cleansing | Rare chems, oddities | Rust Kings |
| **The Remnant** | Ex-national-guard holdouts, military discipline | Guns, armour, mil-spec parts | (opportunistic) |
| **Free Traders** | Neutral caravan network | Everything, at a markup | (neutral) |

**Reputation** with each faction: `-100 … +100`.
- `>= +60` → **Alliance**: discounts, elite contracts, they reinforce your battles.
- `<= -60` → **War**: they ambush your squad in transit, place bounties on your mercs.
- Helping one faction against another moves both bars in opposite directions. There is no
  path where everyone loves you.

---

## 3. Tactical Layer

### 3.1 Grid & Time
- Square grid, 4-directional movement cost 2 AP, diagonal cost 3 AP (no 1.5 rounding bugs —
  costs are integers throughout).
- Strict turn phases: `PLAYER → ALLY → ENEMY → ZOMBIE → (environment) → PLAYER`.
- Each unit has **Action Points (AP)** refreshed at the start of its turn.
  `maxAP = 8 + floor(agility / 3) + perkBonuses`.
- Unspent AP (up to 6) converts to **interrupt reserve** — the unit may interrupt an enemy
  move if it has reserve and passes an `agility + marksmanship` check vs the mover's agility.

### 3.2 Stances
| Stance | Move cost | To-hit taken | To-hit given | Change cost |
|---|---|---|---|---|
| Standing | ×1.0 | ×1.00 | ×1.00 | — |
| Crouched | ×1.5 | ×0.75 | ×1.10 | 2 AP |
| Prone | ×3.0 | ×0.50 | ×1.20 | 3 AP |

Prone units cannot move diagonally and take +2 AP to turn. Crawling is deliberately painful
and deliberately worth it.

### 3.3 Shooting
Every shot resolves as:

```
hitChance = base(weapon, distance)
          × aimBonus(apSpent)
          × stanceMod(shooter) × stanceMod(target)
          × coverMod(target)
          × lightMod × staminaMod × injuryMod(shooter)
          × weaponCondition
```

- **Aiming**: each extra AP past the shot's base cost adds an aim level (max 4).
  Aim levels give `+8% / +15% / +21% / +26%` cumulative to-hit and unlock body-part targeting.
- **Body parts** (JA2 heritage): `head`, `torso`, `arms`, `legs`.
  - head: ×0.45 to-hit, ×2.5 damage, high stun chance
  - torso: ×1.00 to-hit, ×1.0 damage
  - arms: ×0.65 to-hit, ×0.7 damage, causes *Shaky* (−25% to-hit for the victim)
  - legs: ×0.70 to-hit, ×0.8 damage, causes *Hobbled* (move cost ×2)
- **Cover** is directional. Each tile edge may hold `low` (−25%) or `high` (−45%) cover.
  Flanking negates it. Cover is destructible by explosives and sustained fire.
- **Burst / auto fire**: multiple rounds, each with a widening cone penalty.
  Cost is `baseCost + rounds`. Recoil accumulates within a burst.

### 3.4 Damage & Health
- `HP = 40 + vitality × 4 + perkBonuses`
- Damage rolls `weapon.damage ± 20%`, then subtracts armour at the hit location, then
  applies the body-part multiplier.
- **Bleeding**: wounds above a threshold apply bleed stacks; each stack costs 2 HP per turn
  until bandaged. Bleeding out is the most common way to lose a merc.
- **Downed, not dead**: at 0 HP a merc is *Critical* — they may be stabilised within 3 turns
  by an adjacent ally with a medkit. Otherwise they die permanently. Mercs are not respawnable.

### 3.5 Stamina
- `maxStamina = 50 + endurance × 5`
- Moving costs stamina (running costs more), melee costs a lot, being hit costs some.
- Below 30% stamina: −20% to-hit, +50% AP cost on melee.
- Stamina regenerates ~15%/turn while not sprinting. It is the pacing lever that stops
  players from kiting infinitely.

### 3.6 Noise & The Dead
Zombies are driven by a **noise map**, not by player position.
- Every action emits noise with a radius: silenced shot 4, pistol 14, rifle 22, explosion 40,
  sprinting 6, melee 3, breaking a window 10.
- Noise propagates over the grid, decaying per tile, and zombies path toward the loudest
  recent source. This makes suppressors and melee genuinely strategic rather than flavour.
- Zombie types: `shambler` (basic), `runner` (fast, low HP), `bloater` (explodes into gas),
  `armoured` (ex-soldier, plate carrier, needs headshots), `screamer` (calls a horde on sight).

---

## 4. Mercenaries

Every merc is a **hand-written character** — not a generated statblock. Each has a name,
portrait seed, voice (barks), salary, hiring quirk, and a personality that shows up in the
UI. The JA2 "Steroid" test: you should be able to describe any merc in one sentence and have
someone remember them.

### 4.1 Attributes (1–10)
`marksmanship`, `agility`, `strength`, `vitality`, `endurance`, `wisdom` (XP rate), `leadership`, `mechanical`, `medical`, `explosives`.

### 4.2 Roster (launch: 12 hireable + 1 starting)

| Callsign | Real name | One-line | Salary/day |
|---|---|---|---|
| **Steroid** ↗ homage | Ivan Dolvich | Bodybuilder who lifts corpses "for cardio". Huge strength, terrible marksmanship, will not shut up about protein. | $340 |
| **Sister Maggie** | Magdalena Reyes | Ex-hospice nurse. Best medic alive. Refuses to fire the first shot — she'll only shoot if you were shot at first. | $520 |
| **Deadline** | Yusuf Adeyemi | Ex-war-correspondent turned marksman. Narrates the battle like he's filing copy. +XP to whole squad (his "coverage"). | $610 |
| **Grandma Vy** | Vy Nguyen, 71 | Retired competition shooter. Slowest unit in the game. Never misses a called headshot she spends 4 AP on. | $700 |
| **Chainlink** | Marcus Boyd | Ex-prison welder. Builds barricades mid-battle. Best crafter in the roster. | $450 |
| **Twitch** | Elena Sokolova | Amphetamine-wired scout. Highest AP, lowest morale stability. Panics if a squadmate goes Critical. | $380 |
| **Padre** | Tomás Iglesias | Defrocked priest, ex-Ash Order. Gives last rites to zombies. Ash Order won't shoot him. | $490 |
| **Hoyt** | Danny Hoyt | 19, lied about his age, hero-worships whoever kills the most. Cheap, fragile, levels absurdly fast. | $150 |
| **Sable** | Unknown | Silent knife specialist. No file, no past. Melee god, refuses to carry firearms. | $580 |
| **Bricks** | Aisha Bello | Demolitions. Believes every problem is a doorway problem. Terrified of enclosed spaces. | $560 |
| **Old Mill** | Walter Millard | Ex-Remnant quartermaster. Reduces squad salary costs by being an insufferable haggler. | $410 |
| **Coyote** | Rosa Vidal | Highway smuggler, knows every sector. Reveals map intel, hates The Remnant on sight. | $470 |
| **Nine** | (you start with them) | Your first hire, loyal, average at everything. The control group. | $200 |

### 4.3 Morale
`0–100` per merc. Affected by: wins, losses, deaths in squad, unpaid salary, personality
clashes (some mercs refuse to work together), and personal quirks being honoured or violated.
- `< 25` → merc may refuse orders or quit at end of contract.
- `> 80` → merc gets +1 AP and +10% to-hit.

---

## 5. Progression

### 5.1 XP & Levels
- XP awarded for: damage dealt, kills, called shots landed, objectives, surviving, healing,
  crafting, *and using an underused skill* (JA2-style learn-by-doing).
- Level curve: `xpForLevel(n) = 100 × n^1.55`. Cap: 20.
- On level: `+1 attribute point`, `+HP`, and every level a **perk pick from 3 offered**.

### 5.2 Perks (Project-Zomboid-density target: ~60 at launch)
Grouped into trees. Each merc's available perks are filtered by their attributes and
personality, so Steroid genuinely cannot become a sniper.

- **Gunfighting**: Steady Hands, Double Tap, Called Shot Specialist, Recoil Discipline, Trigger Discipline, Quickdraw, Marksman I–III, Suppressive Fire, Hipfire, Ammo Sense…
- **Survival**: Iron Lungs, Second Wind, Pain Tolerance, Cauterise, Scrounger, Light Sleeper, Cold Blooded…
- **Movement**: Sprinter, Cat Fall, Low Profile, Combat Crawl, Ghost (noise −50%), Interrupt Reflex…
- **Support**: Field Surgeon, Triage, Inspiring, Quartermaster, Spotter…
- **Engineering**: Gunsmith I–III, Scrapper, Improviser, Demolitionist, Trap Layer…

### 5.3 Traits (chosen at hire, permanent — PZ-style positive/negative)
Positive traits cost points, negative traits refund them. Each merc has a fixed budget, so
hiring is a build decision.
Examples: `Hemophiliac (−)`, `Iron Gut (+)`, `Claustrophobic (−)`, `Night Owl (+)`,
`Loud Breather (−: +3 noise)`, `Deaf to Fear (+)`, `Bad Back (−: −carry)`, `Lucky (+)`.

### 5.4 Character Sheet
A full screen showing: portrait, attributes with growth arrows, perk tree with taken/available
nodes, traits, equipped loadout with attachment slots, kill/mission/wound history, morale,
and relationships with other squad members.

---

## 6. Weapons, Attachments & Crafting

### 6.1 Weapons
Classes: `pistol`, `smg`, `rifle`, `battle rifle`, `sniper`, `shotgun`, `lmg`, `melee`, `thrown`.
Each has: damage, AP cost, range curve, accuracy, recoil, mag size, ammo type, noise, weight,
**condition (0–100%)**, and an **attachment slot mask**.

Condition degrades with use, faster on improvised weapons. Below 40% jams become likely.

### 6.2 Attachment slots
`optic`, `barrel`, `underbarrel`, `magazine`, `stock`, `internal`

Attachments modify stats and are visually reflected on the weapon sprite (the art forge
composites them). ~40 attachments at launch, e.g. Suppressor (noise −70%, damage −10%),
4× ACOG (+range accuracy, −close accuracy), Extended Mag, Foregrip (recoil −30%),
Bipod (huge accuracy while prone), Match Trigger, Bump Fire Kit, Bayonet.

### 6.3 Crafting
Materials: `scrap`, `steel`, `polymer`, `springs`, `optics glass`, `powder`, `electronics`, `duct tape`.
Sources: looting, scrapping unwanted guns, faction trade, sector scavenging.

Two crafting modes:
1. **Recipes** — known blueprints, deterministic output. Found or bought.
2. **Improvised** — combine materials with a mercs' `mechanical` skill; quality of result
   scales with skill and a roll. This is how you get named one-off guns.

Crafting is done between missions, takes in-game days, and occupies a merc (opportunity cost).

---

## 7. Strategy Layer

- **Cash**: contracts pay; salaries drain daily; ammo, medicine, and repairs cost.
  Running out of money is a real fail state.
- **Time**: advances in hours. Travel between sectors, crafting, healing, and training all
  consume it. Contracts have deadlines.
- **Contracts**: `clear`, `defend`, `escort`, `assassinate`, `retrieve`, `sabotage`.
  Generated from faction state; accepting one for Havenhold against the Rust Kings has
  reputation consequences.
- **Sector control**: taking a sector for a faction shifts the map. Held sectors generate
  income or supply.
- **The Horde clock**: a global pressure meter. Loud missions raise it. When it fills, a
  horde event sweeps a sector row and everyone — every faction — loses something.

---

## 8. Presentation

### 8.1 Art direction
Colorful retro pixel art, military palette (olive drab, gunmetal, rust orange, blood, ash
grey) with high-saturation accents for readability. 16×16 tiles rendered at 3× with modern
polish: soft shadows, dynamic lighting tint, particle systems, screen shake.

**All art is procedurally forged in code** (`src/art/`) from seeded palettes and shape
primitives — no external image assets. Every merc's portrait and battle sprite derives from
their `spriteSeed`, so each is visually unique and consistent everywhere they appear.

### 8.2 Reward feedback ("juice")
- Floating damage numbers, scaled and coloured by severity; crits punch bigger with a flash.
- Hit markers, blood decals that persist on the tile for the battle.
- Screen shake proportional to damage; hitstop on kills.
- Kill cam ring-flash on called headshots.
- XP shards fly from the corpse to the merc's portrait, filling the XP bar.
- Level-up: full-screen banner, three perk cards dealt face-up with a card-flip animation.
- Loot presentation: rarity-tiered card reveal with a rising chime.
- After-action report: itemised XP, cash, loot, and a "merc of the match".

---

## 9. Scope of "done" for v1.0

- [ ] 8×6 sector campaign, 5 factions, reputation and alliance/war states
- [ ] Full tactical layer: AP, stances, cover, LOS, body-part targeting, interrupts, noise
- [ ] 13 hand-written mercs with barks, quirks, and relationships
- [ ] ~60 perks, ~24 traits
- [ ] ~30 weapons, ~40 attachments, crafting with recipes + improvisation
- [ ] Health / stamina / XP / levels / character sheet
- [ ] Procedural art forge covering units, weapons, tiles, UI
- [ ] Full juice pass
- [ ] Save/load
- [ ] Test suite over the deterministic sim core
- [ ] Published and playable in a browser
