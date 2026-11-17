/**
 * How glassity marks the page. Frameworks own the DOM glassity works in, so it
 * keeps its footprint to things they never write: its own data attributes, its
 * own canvases and one stylesheet per document or shadow root.
 */

/** On an icon whose glass is on screen: the stylesheet hides the original. */
export const HIDDEN = 'data-glassity-hidden';
/** On every node glassity inserts. */
export const OWN = 'data-glassity-canvas';

/**
 * Hiding with an attribute and a stylesheet instead of an inline style: a
 * framework that rewrites the icon's `style` (Vue string styles, Svelte
 * `style="…"`, an animation library) cannot undo it. Print shows the original.
 */
const CSS = `@media not print{[${HIDDEN}]{opacity:0!important}}@media print{canvas[${OWN}]{display:none!important}}`;

const styled = new WeakSet<Document | ShadowRoot>();

/** Make sure the document or shadow root that holds `node` has glassity's stylesheet. */
export function ensureStyles(node: Node): void {
  const root = node.getRootNode();
  const isShadow = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot;
  if (!(root instanceof Document) && !isShadow) return;
  const target = root as Document | ShadowRoot;
  if (styled.has(target)) return;
  styled.add(target);
  // A constructed sheet is CSSOM, so a Content-Security-Policy without 'unsafe-inline' allows it.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
    return;
  } catch {
    // Older engines: fall back to a <style> element.
  }
  const style = document.createElement('style');
  style.setAttribute(OWN, '');
  style.textContent = CSS;
  if (target instanceof Document) (target.head ?? target.documentElement).appendChild(style);
  else target.appendChild(style);
}

/** The parent of a node, crossing out of a shadow root to its host. */
export function parentOf(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? root.host : null;
}

/** The `<svg>` to use for an element: itself, one inside it, or one in its open shadow root. */
export function findSvg(target: Element): SVGSVGElement | null {
  if (target instanceof SVGSVGElement) return target;
  return target.querySelector('svg') ?? target.shadowRoot?.querySelector('svg') ?? null;
}

/**
 * Run `callback` once the page has loaded and the browser is idle. Server-rendered
 * pages hydrate (React, Vue, Svelte) by walking the DOM the server sent and expect
 * it untouched until they finish; changing it earlier makes them throw away the
 * tree and render it again.
 */
export function whenSettled(callback: () => void): () => void {
  let cancelled = false;
  let idle = 0;
  const idleCallback = (globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  const cancelIdle = (globalThis as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback;
  const run = () => {
    if (cancelled) return;
    if (idleCallback) idle = idleCallback(() => !cancelled && callback(), { timeout: 400 });
    // Safari has no requestIdleCallback: give frameworks two frames and a moment more.
    else
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          idle = window.setTimeout(() => !cancelled && callback(), 120);
        }),
      );
  };
  const onLoad = () => run();
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', onLoad, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', onLoad);
    if (idle) {
      if (idleCallback && cancelIdle) cancelIdle(idle);
      else clearTimeout(idle);
    }
  };
}

interface ZoneLike {
  root: ZoneLike;
  run<T>(fn: () => T): T;
}

/**
 * Run `fn` outside any zone.js zone (Angular with zone.js, and some other apps). Timers,
 * animation frames, observers and listeners created inside it then stay outside too, so
 * glassity's work never triggers the app's change detection.
 */
export function outsideZones<T>(fn: () => T): T {
  const zone = (globalThis as { Zone?: { root?: ZoneLike; current?: ZoneLike } }).Zone;
  return zone?.root && zone.current !== zone.root ? zone.root.run(fn) : fn();
}

const ownKey = (node: object, prefix: string) => Object.keys(node).some((key) => key.startsWith(prefix));

/**
 * True when `el` sits in a React root that has not hydrated it yet. React marks its root
 * container with `__reactContainer$…` and every node it has hydrated or rendered with
 * `__reactFiber$…`. Changing a node React has still to hydrate makes hydration fail, and
 * React then throws the server HTML away and renders the tree again. Hydration can run
 * well after the page has loaded (streaming, Suspense, Safari without requestIdleCallback),
 * so waiting for idle alone is not enough.
 */
export function awaitingHydration(el: Element): boolean {
  let inReact = false;
  for (let node: Node | null = el; node; node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)) {
    if (ownKey(node, '__reactContainer$')) {
      inReact = true;
      break;
    }
  }
  return inReact && !ownKey(el, '__reactFiber$');
}
