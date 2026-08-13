/**
 * Controls and rules reference.
 *
 * A tactics game that does not explain itself is a tactics game nobody finishes. This covers
 * the controls, but more importantly the four systems a new player cannot infer from the
 * screen — aiming, cover, the Critical window, and that the dead hunt by sound.
 */
import { el, modal } from './dom';
import './help.css';

interface Binding {
  keys: string[];
  label: string;
  note?: string;
}

const MOVEMENT: Binding[] = [
  { keys: ['Left click'], label: 'Move to tile, or attack the enemy on it' },
  { keys: ['Tab'], label: 'Next merc with AP left' },
  { keys: ['Space'], label: 'End this merc\'s turn', note: 'Unspent AP becomes interrupt reserve' },
  { keys: ['Enter'], label: 'End the whole squad turn' },
  { keys: ['Wheel'], label: 'Zoom' },
  { keys: ['Middle drag'], label: 'Pan the camera' },
];

const ACTIONS: Binding[] = [
  { keys: ['1'], label: 'Move mode' },
  { keys: ['2'], label: 'Fire mode', note: 'Opens aim and called-shot controls' },
  { keys: ['3'], label: 'Melee mode', note: 'Quiet. The dead will not hear it' },
  { keys: ['4'], label: 'Medic mode', note: 'Click a downed merc to stabilise them' },
  { keys: ['R'], label: 'Reload' },
  { keys: ['O'], label: 'Overwatch', note: 'Bank AP to fire on the first enemy that moves' },
  { keys: ['Z', 'X', 'C'], label: 'Stand / Crouch / Prone' },
  { keys: ['5', '…', '9'], label: 'Aim levels 0 to 4' },
];

const VIEW: Binding[] = [
  { keys: ['I'], label: 'Character sheet', note: 'Attributes, perk tree, loadout, history' },
  { keys: ['N'], label: 'Toggle the sound overlay', note: 'Shows what the dead can hear' },
  { keys: ['M'], label: 'Mute' },
  { keys: ['?'], label: 'This screen' },
];

interface Rule {
  title: string;
  body: string;
}

/** The four things a player will otherwise learn the hard way. */
const RULES: Rule[] = [
  {
    title: 'The dead hunt by sound',
    body:
      'Zombies do not know where you are. They follow a noise field, and they walk toward the ' +
      'loudest thing they can hear. A rifle carries twenty-two tiles; a suppressed shot carries ' +
      'four; a knife carries three. Press N to see the field. Every loud fight you win brings ' +
      'the next one to you.',
  },
  {
    title: 'Aiming is a purchase',
    body:
      'Every AP past a shot\'s base cost buys an aim level, up to four, with diminishing returns. ' +
      'Aiming also unlocks called shots. A head shot does two and a half times damage but is ' +
      'far harder to land; legs cripple movement; arms wreck the target\'s aim. Spending your ' +
      'whole turn on one careful shot is often correct.',
  },
  {
    title: 'Cover is directional',
    body:
      'A wall only protects a target from the side it is on. Move around it and the protection ' +
      'is gone — flanking is not a bonus, it is the removal of a penalty. High cover cuts hit ' +
      'chance by 45%, low cover by 25%. Cover is also destructible: sustained fire will chew ' +
      'through it.',
  },
  {
    title: 'Down is not dead',
    body:
      'A merc who runs out of health goes Critical instead of dying, and has three of their own ' +
      'turns to be reached. An adjacent squadmate in Medic mode can stabilise them. If nobody ' +
      'gets there, they are gone permanently — mercenaries do not come back. Bleeding is the ' +
      'most common way to lose someone, so bandage early.',
  },
];

function bindingRow(b: Binding): HTMLElement {
  return el(
    'div.help-row',
    {},
    el('div.help-keys', {}, ...b.keys.map((k) => el('kbd', {}, k))),
    el(
      'div.help-desc',
      {},
      el('span.help-label', {}, b.label),
      b.note ? el('span.help-note', {}, b.note) : null,
    ),
  );
}

function section(title: string, rows: Binding[]): HTMLElement {
  return el(
    'div.help-section',
    {},
    el('h3.stencil', {}, title),
    ...rows.map(bindingRow),
  );
}

export function helpPanel(): HTMLElement {
  return el(
    'div.help',
    {},
    el('h2.stencil.help-title', {}, 'Field Manual'),
    el(
      'div.help-cols',
      {},
      section('Movement', MOVEMENT),
      section('Actions', [...ACTIONS, ...VIEW]),
    ),
    el(
      'div.help-rules',
      {},
      el('h3.stencil', {}, 'What will kill you'),
      ...RULES.map((r) =>
        el(
          'div.help-rule',
          {},
          el('div.help-rule-title', {}, r.title),
          el('div.help-rule-body', {}, r.body),
        ),
      ),
    ),
    el('div.help-foot', {}, 'Press Escape or click outside to close.'),
  );
}

export function openHelp(): () => void {
  return modal(helpPanel());
}

/** Show the manual once per browser, the first time someone plays. */
export function openHelpOnFirstRun(): void {
  const KEY = 'lc.seenHelp.v1';
  try {
    if (localStorage.getItem(KEY)) return;
    localStorage.setItem(KEY, '1');
  } catch {
    // Private browsing or blocked storage: show it, just don't remember.
  }
  openHelp();
}
