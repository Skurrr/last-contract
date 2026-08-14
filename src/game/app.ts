/**
 * The application state machine: menu, campaign, battle, after-action.
 *
 * This owns the one thing neither the simulation nor the screens can own — the transition
 * between them. A contract becomes a battle here; a battle's outcome becomes campaign
 * consequences here. Everything else stays ignorant of the loop it sits inside.
 */
import { lookFromPalette } from '@/art/units';
import { sfx } from '@/audio/sfx';
import {
  acceptContract,
  advanceTime,
  completeContract,
  createCampaign,
  dailyPayroll,
  fireMerc,
  hireMerc,
  mercDied,
  setSquad,
  travelTo,
  deserialize,
  serialize,
  buy,
  craft,
  craftImprovised,
  fitAttachment,
  repairWeapon,
  scrapWeapon,
  sell,
  findMerc,
  type CampaignState,
  type Contract,
} from '@/campaign/index';
import { MERCS } from '@/data/mercs';
import { SECTORS } from '@/data/sectors';
import { applyLevelUp, unitById } from '@/sim/battle';
import { absorbBattleResult, type MercState } from '@/sim/spawn';
import type { CombatEvent } from '@/sim/events';
import type { Attribute, Unit } from '@/sim/types';
import { deploy } from './deploy';
import { BattleController } from './battleController';
import { Hud } from '@/ui/hud';
import { openLevelUp } from '@/ui/levelUp';
import { openCharacterSheet } from '@/ui/characterSheet';
import {
  afterActionScreen,
  type AfterActionMerc,
  type AfterActionReport,
} from '@/ui/afterAction';
import { hiringHallScreen } from '@/ui/hiringHall';
import { marketScreen } from '@/ui/market';
import { workshopScreen } from '@/ui/workshop';
import { worldMapScreen } from '@/ui/worldMap';
import { ScreenManager, toast, type CampaignHooks, type ScreenId } from '@/ui/screens';
import { el, render } from '@/ui/dom';
import '@/ui/campaign.css';

const SAVE_KEY = 'lc.save.v1';

/** Collapse duplicates into [id, count] pairs so three identical fittings read as one card. */
function countBy(ids: readonly string[]): [string, number][] {
  const n = new Map<string, number>();
  for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n.entries()];
}

/** Snapshot of a merc taken at deployment, so the report can show what the fight cost. */
interface Baseline {
  xp: number;
  hp: number;
  level: number;
}

export class App {
  private campaign: CampaignState;
  private screens: ScreenManager;

  private controller: BattleController | null = null;
  private hud: Hud | null = null;
  private dirty = true;

  /** Which merc ids deployed, and what they looked like before the shooting started. */
  private deployed: string[] = [];
  private baselines = new Map<string, Baseline>();
  private activeContract: Contract | null = null;
  private battleStats = new Map<string, { kills: number; dealt: number; taken: number }>();

  private readonly levelUpQueue: string[] = [];
  private levelUpOpen = false;
  private readonly lastOffers = new Map<string, readonly string[]>();

  constructor(
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly hudHost: HTMLElement,
    private readonly screenHost: HTMLElement,
    seed = Math.floor(Math.random() * 1e9),
  ) {
    this.campaign = createCampaign(seed);
    this.screens = new ScreenManager(screenHost);
  }

  // ─────────────────────────────────────────────── persistence

  save(): boolean {
    try {
      localStorage.setItem(SAVE_KEY, serialize(this.campaign));
      toast('Company records filed.', 'good');
      return true;
    } catch {
      toast('Could not write the save.', 'bad');
      return false;
    }
  }

  load(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        toast('No saved company found.', 'info');
        return false;
      }
      const c = deserialize(raw);
      if (!c) {
        toast('That save could not be read.', 'bad');
        return false;
      }
      this.campaign = c;
      this.showCampaign('map');
      toast('Company restored.', 'good');
      return true;
    } catch {
      toast('That save could not be read.', 'bad');
      return false;
    }
  }

  static hasSave(): boolean {
    try {
      return localStorage.getItem(SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  newCampaign(seed = Math.floor(Math.random() * 1e9)): void {
    this.campaign = createCampaign(seed);
    this.showCampaign('map');
  }

  // ─────────────────────────────────────────────── campaign screens

  private hooks(): CampaignHooks {
    const c = (): CampaignState => this.campaign;
    return {
      onDeploy: (contractId) => this.startContract(contractId),
      onTravel: (sectorId) => travelTo(c(), sectorId),
      onAcceptContract: (contractId) => acceptContract(c(), contractId),
      onHire: (defId) => hireMerc(c(), defId),
      onFire: (mercId) => fireMerc(c(), mercId),
      onSquadChange: (ids) => setSquad(c(), [...ids]),

      onBuy: (kind, id, factionId, qty) => buy(c(), kind, id, factionId, qty),
      onSell: (kind, id, factionId, qty) => sell(c(), kind, id, factionId, qty),
      onScrap: (weaponUid, mercId) =>
        mercId ? scrapWeapon(c(), weaponUid, mercId) : scrapWeapon(c(), weaponUid),

      onCraft: (recipeId, mercId) => craft(c(), recipeId, mercId),
      onCraftImprovised: (mercId, spend) => craftImprovised(c(), mercId, spend),
      onRepair: (weaponUid, mercId) => repairWeapon(c(), weaponUid, mercId),
      onFitAttachment: (weaponUid, slot, attachmentId) =>
        fitAttachment(c(), weaponUid, slot, attachmentId),

      onAdvanceTime: (hours) => {
        advanceTime(c(), hours);
      },
      onNavigate: (id) => this.showCampaign(id),
      onSave: () => {
        this.save();
      },
      onLoad: () => {
        this.load();
      },
      refresh: () => this.renderCampaign(),
    };
  }

  private currentScreen: ScreenId = 'map';

  showCampaign(id: ScreenId = 'map'): void {
    this.currentScreen = id;
    this.canvas.style.display = 'none';
    this.hudHost.style.display = 'none';
    this.screenHost.style.display = '';
    this.renderCampaign();
  }

  private renderCampaign(): void {
    const hooks = this.hooks();
    const c = this.campaign;
    let node: HTMLElement;
    switch (this.currentScreen) {
      case 'hiring': node = hiringHallScreen(c, hooks); break;
      case 'market': node = marketScreen(c, hooks); break;
      case 'workshop': node = workshopScreen(c, hooks); break;
      default: node = worldMapScreen(c, hooks); break;
    }
    this.screens.show(this.currentScreen, node);
  }

  // ─────────────────────────────────────────────── contract → battle

  private startContract(contractId: string): void {
    const c = this.campaign;
    const contract = c.contracts.find((x) => x.id === contractId) ?? null;
    if (!contract) {
      toast('That contract is no longer on the board.', 'bad');
      return;
    }
    const squad = c.squad
      .map((id) => c.roster.find((m) => m.id === id))
      .filter((m): m is MercState => Boolean(m));
    if (squad.length === 0) {
      toast('Nobody is assigned to the squad.', 'bad');
      return;
    }

    const sector = SECTORS.find((s) => s.id === contract.targetSector) ?? SECTORS[0]!;
    this.activeContract = contract;
    this.deployed = squad.map((m) => m.id);
    this.baselines = new Map(
      squad.map((m) => [m.id, { xp: m.xp, hp: m.hp, level: m.level }] as const),
    );
    this.battleStats = new Map(squad.map((m) => [m.id, { kills: 0, dealt: 0, taken: 0 }] as const));

    const dep = deploy({
      seed: (c.seed ^ (c.day * 2654435761) ^ contractId.length) | 0,
      sector,
      squad,
      opposition: contract.against ?? sector.owner ?? null,
      hordePressure: c.hordeClock / 100,
      // Passed by reference: deployment removes what it issues, so bought ordnance is
      // actually spent rather than duplicated every time the squad goes out.
      supplies: c.stash.consumables,
    });

    this.enterBattle(dep.battle, dep.squad);
  }

  /** Start a one-off skirmish, used by the menu's practice option. */
  skirmish(seed: number, squad: MercState[]): void {
    const sector = SECTORS[Math.abs(seed) % SECTORS.length]!;
    this.activeContract = null;
    this.deployed = squad.map((m) => m.id);
    this.baselines = new Map(
      squad.map((m) => [m.id, { xp: m.xp, hp: m.hp, level: m.level }] as const),
    );
    this.battleStats = new Map(squad.map((m) => [m.id, { kills: 0, dealt: 0, taken: 0 }] as const));
    const dep = deploy({ seed, sector, squad, opposition: sector.owner ?? null });
    this.enterBattle(dep.battle, dep.squad);
  }

  private enterBattle(battle: ReturnType<typeof deploy>['battle'], units: Unit[]): void {
    this.hud?.destroy();
    this.screenHost.style.display = 'none';
    this.canvas.style.display = '';
    this.hudHost.style.display = '';

    const ctrl = new BattleController(this.canvas, battle, {
      onDirty: () => {
        this.dirty = true;
      },
      portraitAnchor: (unitId) => this.hud?.portraitAnchor(unitId) ?? null,
      logLine: (text, tone) => this.hud?.logLine(text, tone),
      showBark: (unitId, text) => this.hud?.showBark(unitId, text),
      onLevelUp: (unitId) => {
        this.levelUpQueue.push(unitId);
        this.drainLevelUps();
      },
      onOutcome: (outcome) => this.finishBattle(outcome),
      onEvent: (e) => this.tally(e),
    });

    for (const u of units) {
      const def = MERCS[u.defId];
      if (def) ctrl.renderer.setLook(u.id, lookFromPalette(def.portraitSeed, def.palette));
    }

    this.controller = ctrl;
    this.hud = new Hud(this.hudHost, ctrl);
    this.hud.update();
    this.resize();
    ctrl.frameOnSquad();
    this.dirty = true;
  }

  // ─────────────────────────────────────────────── battle → after-action

  private finishBattle(outcome: 'victory' | 'defeat'): void {
    const ctrl = this.controller;
    if (!ctrl) return;
    const b = ctrl.battle;

    // Fold every deployed merc's results back into their campaign record.
    const mercs: AfterActionMerc[] = [];
    const casualties: string[] = [];

    for (const id of this.deployed) {
      const unit = b.units.find((u) => u.id === id);
      const state = findMerc(this.campaign, id);
      const base = this.baselines.get(id);
      if (!unit || !state || !base) continue;

      const stats = this.battleStats.get(id) ?? { kills: 0, dealt: 0, taken: 0 };
      if (unit.alive) {
        absorbBattleResult(state, unit);
      } else {
        casualties.push(id);
      }

      mercs.push({
        id,
        xpGained: Math.max(0, unit.xp - base.xp),
        kills: stats.kills,
        damageDealt: stats.dealt,
        damageTaken: Math.max(0, base.hp - unit.hp),
        defId: unit.defId,
        ...(unit.level > base.level ? { levelledTo: unit.level } : {}),
        ...(unit.alive ? {} : { died: true }),
      });
    }

    // Deaths are permanent, and the campaign needs to know before the payout is computed.
    for (const id of casualties) mercDied(this.campaign, id);

    // Everything the squad carried off the field goes into the company stash.
    const rec = ctrl.recovered;
    for (const w of rec.weapons) this.campaign.stash.weapons.push(w);
    for (const a of rec.attachments) this.campaign.stash.attachments.push(a);
    for (const [k, v] of Object.entries(rec.materials)) {
      if (v && v > 0) {
        const key = k as keyof typeof this.campaign.materials;
        this.campaign.materials[key] = (this.campaign.materials[key] ?? 0) + v;
      }
    }
    this.campaign.cash += rec.cash;

    const contract = this.activeContract;
    const cashBefore = this.campaign.cash;
    const repBefore = { ...this.campaign.reputation };

    if (contract) {
      completeContract(this.campaign, contract.id, outcome === 'victory');
    }

    const repChanges = Object.entries(this.campaign.reputation)
      .map(([factionId, value]) => ({ factionId, delta: value - (repBefore[factionId] ?? 0), value }))
      .filter((r) => r.delta !== 0);

    const best = mercs
      .filter((m) => !m.died)
      .sort((a, z) => z.xpGained - a.xpGained)[0];

    const report: AfterActionReport = {
      outcome,
      turns: b.turn,
      mercs,
      cash: this.campaign.cash - cashBefore + rec.cash,
      // The card shows wear and fittings when it is handed the real instance.
      loot: [
        ...rec.weapons.map((w) => ({ kind: 'weapon' as const, id: w.defId, weapon: w })),
        ...countBy(rec.attachments).map(([id, qty]) => ({
          kind: 'attachment' as const,
          id,
          qty,
        })),
      ],
      materials: rec.materials,
      repChanges,
      mercOfTheMatch: best?.id ?? null,
      ...(casualties.length > 0 ? { casualties } : {}),
      ...(contract
        ? {
            sectorName: SECTORS.find((s) => s.id === contract.targetSector)?.name ?? contract.targetSector,
            employerId: contract.employer,
            contractKind: contract.kind,
          }
        : {}),
    };

    sfx.play(outcome === 'victory' ? 'victory' : 'defeat');
    this.showAfterAction(report);
  }

  private showAfterAction(report: AfterActionReport): void {
    this.hud?.destroy();
    this.hud = null;
    this.controller = null;
    this.canvas.style.display = 'none';
    this.hudHost.style.display = 'none';
    this.screenHost.style.display = '';
    this.screens.show('afterAction', afterActionScreen(report, () => this.showCampaign('map')));
  }

  // ─────────────────────────────────────────────── level-ups

  private drainLevelUps(): void {
    if (this.levelUpOpen || !this.controller) return;
    const id = this.levelUpQueue.shift();
    if (id === undefined) return;
    const u = unitById(this.controller.battle, id);
    if (!u) return this.drainLevelUps();

    this.levelUpOpen = true;
    const previousOffer = this.lastOffers.get(u.id);
    openLevelUp(
      {
        defId: u.defId,
        level: u.level + 1,
        attrs: u.attrs,
        perks: u.perks,
        traits: u.traits,
        ...(previousOffer ? { previousOffer } : {}),
      },
      (choice) => {
        this.levelUpOpen = false;
        this.lastOffers.set(u.id, choice.offered);
        if (this.controller) {
          applyLevelUp(
            this.controller.battle,
            u,
            choice.perkId,
            choice.attribute as Attribute | null,
          );
        }
        this.dirty = true;
        this.drainLevelUps();
      },
    );
  }

  // ─────────────────────────────────────────────── frame loop

  get inBattle(): boolean {
    return this.controller !== null;
  }

  get battleController(): BattleController | null {
    return this.controller;
  }

  markDirty(): void {
    this.dirty = true;
  }

  openSheetForSelected(): void {
    const u = this.controller?.selected;
    if (u) openCharacterSheet({ unit: u, defId: u.defId });
  }

  resize(): void {
    const w = Math.max(640, Math.floor(window.innerWidth));
    const h = Math.max(480, Math.floor(window.innerHeight));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    this.controller?.resize(w, h);
    this.applyHudInsets();
    this.dirty = true;
  }

  /**
   * Tell the camera how much canvas the HUD covers. Measured from the live DOM so the
   * responsive breakpoints in the stylesheet cannot drift out of sync with the framing.
   */
  private applyHudInsets(): void {
    const ctrl = this.controller;
    if (!ctrl) return;
    const rectOf = (sel: string): DOMRect | null =>
      this.hudHost.querySelector(sel)?.getBoundingClientRect() ?? null;

    const squad = rectOf('.hud-squad');
    const recon = rectOf('.hud-recon');
    const actions = rectOf('.hud-actions');
    const banner = rectOf('.hud-banner');

    ctrl.camera.setInsets(
      squad?.width ? squad.right : 0,
      recon?.width ? this.canvas.width - recon.left : 0,
      banner?.height ? banner.bottom : 0,
      actions?.height ? this.canvas.height - actions.top : 0,
    );
  }

  tick(dt: number): void {
    const ctrl = this.controller;
    if (!ctrl) return;
    ctrl.tick(dt);
    ctrl.draw();
    if (this.dirty) {
      this.hud?.update();
      this.dirty = false;
    }
  }

  // ─────────────────────────────────────────────── menu

  showMenu(): void {
    this.canvas.style.display = 'none';
    this.hudHost.style.display = 'none';
    this.screenHost.style.display = '';

    const payroll = dailyPayroll(this.campaign);
    const menu = el(
      'div.menu',
      {},
      el('div.menu-title', {}, el('h1.stencil', {}, 'LAST CONTRACT')),
      el(
        'p.menu-blurb',
        {},
        'Eight years after the Grey Fever. You run Vulture Company. Villages hire you to ' +
          'clear the dead; factions hire you to kill each other. The dead hunt by sound.',
      ),
      el(
        'div.menu-actions',
        {},
        el(
          'button.btn.btn--primary.btn--wide',
          { on: { click: () => { sfx.unlock(); this.newCampaign(); } } },
          'New company',
        ),
        App.hasSave()
          ? el(
              'button.btn.btn--wide',
              { on: { click: () => { sfx.unlock(); this.load(); } } },
              'Continue',
            )
          : null,
        el(
          'button.btn.btn--ghost.btn--wide',
          {
            on: {
              click: () => {
                sfx.unlock();
                this.newCampaign();
                this.showCampaign('map');
              },
            },
          },
          'Take a contract',
        ),
      ),
      el('div.menu-foot', {}, `Daily payroll at start: $${payroll}. Press ? for the field manual.`),
    );

    render(this.screenHost, menu);
  }

  /** Who fired most recently, so a `hit` can be credited to them. */
  private lastAttacker: string | null = null;

  /**
   * Tally per-merc contribution as the battle runs. A `hit` event names the victim rather
   * than the attacker, so credit goes to whoever most recently fired or swung.
   */
  private tally(e: CombatEvent): void {
    switch (e.t) {
      case 'shot':
        this.lastAttacker = e.unitId;
        break;
      case 'melee': {
        this.lastAttacker = e.unitId;
        const s = this.battleStats.get(e.unitId);
        if (s) s.dealt += e.damage;
        const victim = this.battleStats.get(e.targetId);
        if (victim) victim.taken += e.damage;
        break;
      }
      case 'hit': {
        const victim = this.battleStats.get(e.unitId);
        if (victim) victim.taken += e.damage;
        // Only credit shooting damage; melee is already counted above.
        if (this.lastAttacker && this.lastAttacker !== e.unitId) {
          const attacker = this.battleStats.get(this.lastAttacker);
          if (attacker) attacker.dealt += e.damage;
        }
        break;
      }
      case 'kill': {
        const killer = this.battleStats.get(e.by || this.lastAttacker || '');
        if (killer) killer.kills += 1;
        break;
      }
      default:
        break;
    }
  }
}
