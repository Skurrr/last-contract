/**
 * Application entry point: canvas setup, input wiring, and the frame loop.
 *
 * The loop is deliberately thin. It advances the controller, draws, and refreshes the HUD
 * only when something changed — everything with an opinion about the game lives elsewhere.
 */
import './ui/styles.css';
import { createMercState, type MercState } from '@/sim/spawn';
import { pendingLevelUps, applyLevelUp, unitById } from '@/sim/battle';
import { MERCS, STARTING_MERC } from '@/data/mercs';
import { lookFromPalette } from '@/art/units';
import { BattleController } from '@/game/battleController';
import { skirmish } from '@/game/deploy';
import { Hud } from '@/ui/hud';
import { openCharacterSheet } from '@/ui/characterSheet';
import { openLevelUp } from '@/ui/levelUp';
import { el, render } from '@/ui/dom';
import { sfx } from '@/audio/sfx';
import type { Attribute } from '@/sim/types';

const app = document.getElementById('app');
if (!app) throw new Error('#app host element missing');

// ─────────────────────────────────────────────────────────────── canvas

const canvas = el('canvas.stage') as HTMLCanvasElement;
const hudHost = el('div.hud-root');
render(app, canvas, hudHost);

let controller: BattleController | null = null;
let hud: Hud | null = null;
let dirty = true;

/**
 * Size the backing store to CSS pixels 1:1. The camera and the HUD's portrait anchors both
 * assume this, so a device-pixel-ratio scale would have to be threaded through both.
 */
function resize(): void {
  const w = Math.max(640, Math.floor(window.innerWidth));
  const h = Math.max(480, Math.floor(window.innerHeight));
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  controller?.resize(w, h);
  applyHudInsets();
  dirty = true;
}

/**
 * Tell the camera how much of the canvas the HUD is sitting on top of. Measured from the
 * live DOM rather than hard-coded, so the responsive breakpoints in styles.css cannot drift
 * out of sync with the framing.
 */
function applyHudInsets(): void {
  if (!controller) return;
  const rectOf = (sel: string): DOMRect | null =>
    document.querySelector(sel)?.getBoundingClientRect() ?? null;

  const squad = rectOf('.hud-squad');
  const recon = rectOf('.hud-recon');
  const actions = rectOf('.hud-actions');
  const banner = rectOf('.hud-banner');

  controller.camera.setInsets(
    squad?.width ? squad.right : 0,
    recon?.width ? canvas.width - recon.left : 0,
    banner?.height ? banner.bottom : 0,
    actions?.height ? canvas.height - actions.top : 0,
  );
}

// ─────────────────────────────────────────────────────────────── level-up queue

/** Level-ups are queued so several at once are presented one after another, not stacked. */
const levelUpQueue: string[] = [];
let levelUpOpen = false;

function drainLevelUps(): void {
  if (levelUpOpen || !controller) return;
  const id = levelUpQueue.shift();
  if (id === undefined) return;
  const u = unitById(controller.battle, id);
  if (!u) return drainLevelUps();

  levelUpOpen = true;
  openLevelUp(
    { defId: u.defId, level: u.level + 1, attrs: u.attrs, perks: u.perks, traits: u.traits },
    (choice) => {
      levelUpOpen = false;
      if (controller) {
        applyLevelUp(controller.battle, u, choice.perkId, choice.attribute as Attribute | null);
      }
      dirty = true;
      drainLevelUps();
    },
  );
}

// ─────────────────────────────────────────────────────────────── battle setup

function startSkirmish(seed: number, roster: MercState[]): void {
  hud?.destroy();

  const dep = skirmish(seed, roster);
  const ctrl = new BattleController(canvas, dep.battle, {
    onDirty: () => {
      dirty = true;
    },
    portraitAnchor: (unitId) => hud?.portraitAnchor(unitId) ?? null,
    logLine: (text, tone) => hud?.logLine(text, tone),
    showBark: (unitId, text) => hud?.showBark(unitId, text),
    onLevelUp: (unitId) => {
      levelUpQueue.push(unitId);
      drainLevelUps();
    },
    onOutcome: (outcome) => {
      hud?.logLine(
        outcome === 'victory' ? 'Contract complete. Exfiltrate.' : 'Squad down. Contract failed.',
        outcome === 'victory' ? 'good' : 'bad',
      );
    },
  });

  // Give every merc their authored look so the battlefield sprite matches the portrait.
  for (const u of dep.squad) {
    const def = MERCS[u.defId];
    if (def) ctrl.renderer.setLook(u.id, lookFromPalette(def.portraitSeed, def.palette));
  }

  controller = ctrl;
  hud = new Hud(hudHost, ctrl);
  hud.update();
  resize();
  // Insets need the HUD in the DOM, and the opening framing needs the insets.
  applyHudInsets();
  ctrl.frameOnSquad();
  dirty = true;
}

// ─────────────────────────────────────────────────────────────── input

// Browsers keep the audio context suspended until a real gesture, so the first click or
// key the player makes is what turns the sound on.
const unlockAudio = (): void => sfx.unlock();
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });


canvas.addEventListener('mousemove', (e) => {
  if (!controller) return;
  const r = canvas.getBoundingClientRect();
  controller.setHover(controller.camera.toTile(e.clientX - r.left, e.clientY - r.top));
});

canvas.addEventListener('mouseleave', () => controller?.setHover(null));

canvas.addEventListener('click', (e) => {
  if (!controller) return;
  const r = canvas.getBoundingClientRect();
  controller.click(controller.camera.toTile(e.clientX - r.left, e.clientY - r.top));
});

// Right-click cycles fire mode on a target, which is faster than reaching for the panel.
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!controller) return;
  controller.setMode(controller.mode === 'fire' ? 'move' : 'fire');
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    controller?.camera.zoomBy(e.deltaY > 0 ? 0.9 : 1.1);
    dirty = true;
  },
  { passive: false },
);

// Middle-drag pans.
let panning = false;
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1) {
    panning = true;
    e.preventDefault();
  }
});
window.addEventListener('mouseup', () => {
  panning = false;
});
window.addEventListener('mousemove', (e) => {
  if (!panning || !controller) return;
  controller.camera.panBy(-e.movementX, -e.movementY);
  dirty = true;
});

window.addEventListener('keydown', (e) => {
  const c = controller;
  if (!c) return;
  // Never swallow keys while a modal has focus.
  if (document.querySelector('.modal-overlay')) return;

  switch (e.key.toLowerCase()) {
    case 'tab':
      e.preventDefault();
      c.selectNext();
      break;
    case '1': c.setMode('move'); break;
    case '2': c.setMode('fire'); break;
    case '3': c.setMode('melee'); break;
    case '4': c.setMode('medic'); break;
    case 'r': c.doReload(); break;
    case 'o': c.doOverwatch(); break;
    case 'z': c.doStance('standing'); break;
    case 'x': c.doStance('crouched'); break;
    case 'c': c.doStance('prone'); break;
    case 'n':
      c.showNoise = !c.showNoise;
      dirty = true;
      break;
    case 'm':
      sfx.muted = !sfx.muted;
      hud?.logLine(sfx.muted ? 'Sound off.' : 'Sound on.', 'info');
      break;
    case ' ':
      e.preventDefault();
      c.doEndUnitTurn();
      break;
    case 'enter':
      c.endTurn();
      break;
    case 'i': {
      const u = c.selected;
      if (u) openCharacterSheet({ unit: u, defId: u.defId });
      break;
    }
    default:
      // Aim levels on the number row above the mode keys.
      if (e.key >= '5' && e.key <= '9') c.setAim(Number(e.key) - 5);
  }
});

window.addEventListener('resize', resize);

// ─────────────────────────────────────────────────────────────── frame loop

let last = performance.now();

function frame(now: number): void {
  // Clamp dt so a backgrounded tab does not fast-forward the whole battle on return.
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (controller) {
    controller.tick(dt);
    controller.draw();
    // The HUD is DOM; only touch it when the controller says something changed, or while
    // effects are still animating and the numbers are still moving.
    if (dirty) {
      hud?.update();
      dirty = false;
    }
  }
  requestAnimationFrame(frame);
}

// ─────────────────────────────────────────────────────────────── boot

function boot(): void {
  const roster: MercState[] = [createMercState(STARTING_MERC)];
  // A starting squad wide enough to show the systems off: a medic, a shooter, and muscle.
  for (const id of ['maggie', 'vy', 'steroid', 'twitch', 'chainlink']) {
    if (MERCS[id]) roster.push(createMercState(id));
  }
  startSkirmish(Math.floor(Math.random() * 1e9), roster);
  requestAnimationFrame(frame);
}

resize();
boot();
