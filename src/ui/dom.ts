/**
 * A deliberately tiny DOM helper. The UI is plain DOM over the canvas — no framework, no
 * virtual DOM, no build-time templating. Screens are cheap enough to rebuild wholesale when
 * their data changes, which keeps state handling honest.
 */

export type Child = Node | string | number | false | null | undefined;

export interface Attrs {
  class?: string;
  id?: string;
  title?: string;
  style?: string;
  disabled?: boolean;
  value?: string;
  type?: string;
  href?: string;
  /** data-* attributes. */
  data?: Record<string, string>;
  /** Event handlers, e.g. { click: () => ... }. */
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  [key: string]: unknown;
}

/** Create an element. `el('div.card', { on: { click } }, 'text')` */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K | string,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElement {
  // Support 'div.cls1.cls2' shorthand.
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length > 0) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') {
      for (const [evt, fn] of Object.entries(v as Record<string, (e: Event) => void>)) {
        node.addEventListener(evt, fn);
      }
    } else if (k === 'data') {
      for (const [dk, dv] of Object.entries(v as Record<string, string>)) {
        node.dataset[dk] = dv;
      }
    } else if (k === 'class') {
      node.className = node.className ? `${node.className} ${String(v)}` : String(v);
    } else if (k === 'style') {
      node.setAttribute('style', String(v));
    } else if (k === 'disabled') {
      if (v) node.setAttribute('disabled', '');
    } else {
      node.setAttribute(k, String(v));
    }
  }

  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace an element's children in one go. */
export function render(host: HTMLElement, ...children: Child[]): void {
  clear(host);
  append(host, children);
}

/** A canvas element sized to a baked sprite, used to drop forge art into the DOM. */
export function spriteImg(canvas: HTMLCanvasElement, className = ''): HTMLElement {
  const wrap = el('span.sprite', { class: className });
  canvas.style.imageRendering = 'pixelated';
  wrap.appendChild(canvas);
  return wrap;
}

/** Format money the way the game talks about it. */
export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** A labelled horizontal bar — HP, stamina, XP, morale all use this. */
export function bar(
  frac: number,
  color: string,
  label?: string,
  className = '',
): HTMLElement {
  const clamped = Math.max(0, Math.min(1, frac));
  return el(
    'div.bar',
    { class: className },
    el('div.bar-fill', { style: `width:${(clamped * 100).toFixed(1)}%;background:${color}` }),
    label ? el('span.bar-label', {}, label) : null,
  );
}

/** Simple modal overlay. Returns a close function. */
export function modal(content: HTMLElement, onClose?: () => void): () => void {
  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const overlay = el(
    'div.modal-overlay',
    {
      on: {
        click: (e: Event) => {
          if (e.target === overlay) close();
        },
      },
    },
    el('div.modal', {}, content),
  );
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  return close;
}
