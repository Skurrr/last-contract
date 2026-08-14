/**
 * Application entry point: DOM scaffolding, input wiring, and the frame loop.
 *
 * Deliberately thin. The App owns the state machine; this owns the browser.
 */
import './ui/styles.css';
import { sfx } from '@/audio/sfx';
import { App } from '@/game/app';
import { el, render } from '@/ui/dom';
import { openHelp, openHelpOnFirstRun } from '@/ui/help';

const host = document.getElementById('app');
if (!host) throw new Error('#app host element missing');

// Canvas for the battle, one host for the battle HUD, one for the campaign screens.
const canvas = el('canvas.stage') as HTMLCanvasElement;
const hudHost = el('div.hud-root');
const screenHost = el('div.screen-root');
render(host, canvas, hudHost, screenHost);

const app = new App(host, canvas, hudHost, screenHost);

// ─────────────────────────────────────────────────────────────── audio

// Browsers keep the audio context suspended until a real gesture, so the first click or key
// the player makes is what turns the sound on.
const unlockAudio = (): void => sfx.unlock();
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

// ─────────────────────────────────────────────────────────────── pointer input

const tileAt = (e: MouseEvent): { x: number; y: number } | null => {
  const ctrl = app.battleController;
  if (!ctrl) return null;
  const r = canvas.getBoundingClientRect();
  return ctrl.camera.toTile(e.clientX - r.left, e.clientY - r.top);
};

canvas.addEventListener('mousemove', (e) => {
  const t = tileAt(e);
  if (t) app.battleController?.setHover(t);
});

canvas.addEventListener('mouseleave', () => app.battleController?.setHover(null));

canvas.addEventListener('click', (e) => {
  const t = tileAt(e);
  if (t) app.battleController?.click(t);
});

// Right-click toggles between move and fire, which is faster than reaching for the panel.
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const ctrl = app.battleController;
  if (ctrl) ctrl.setMode(ctrl.mode === 'fire' ? 'move' : 'fire');
});

canvas.addEventListener(
  'wheel',
  (e) => {
    if (!app.inBattle) return;
    e.preventDefault();
    app.battleController?.camera.zoomBy(e.deltaY > 0 ? 0.9 : 1.1);
    app.markDirty();
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
  if (!panning) return;
  app.battleController?.camera.panBy(-e.movementX, -e.movementY);
  app.markDirty();
});

// ─────────────────────────────────────────────────────────────── keyboard

window.addEventListener('keydown', (e) => {
  // Never swallow keys while a modal owns the screen.
  if (document.querySelector('.modal-overlay, .lu-overlay')) return;

  const key = e.key.toLowerCase();

  // Always available, in battle or out of it.
  if (key === '?' || key === '/' || key === 'h') {
    openHelp();
    return;
  }

  const c = app.battleController;
  if (!c) return;

  switch (key) {
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
      app.markDirty();
      break;
    case 'm':
      sfx.muted = !sfx.muted;
      break;
    case ' ':
      e.preventDefault();
      c.doEndUnitTurn();
      break;
    case 'enter':
      c.endTurn();
      break;
    case 'i':
      app.openSheetForSelected();
      break;
    default:
      // Aim levels sit on the number row above the mode keys.
      if (e.key >= '5' && e.key <= '9') c.setAim(Number(e.key) - 5);
  }
});

window.addEventListener('resize', () => app.resize());

// ─────────────────────────────────────────────────────────────── frame loop

let last = performance.now();

function frame(now: number): void {
  // Clamp dt so a backgrounded tab does not fast-forward the whole battle on return.
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  app.tick(dt);
  requestAnimationFrame(frame);
}

// ─────────────────────────────────────────────────────────────── boot

app.resize();
app.showMenu();
requestAnimationFrame(frame);
// A tactics game that does not explain itself is a tactics game nobody finishes.
openHelpOnFirstRun();
