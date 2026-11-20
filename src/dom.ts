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
 * Run `callback` after DOM readiness and a bounded idle wait. Server-rendered
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
    if (idleCallback) idle = idleCallback(() => !cancelled && callback(), { timeout: 100 });
    // Safari has no requestIdleCallback: give frameworks two frames and a moment more.
    else
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          idle = window.setTimeout(() => !cancelled && callback(), 120);
        }),
      );
  };
  const onLoad = () => run();
  if (document.readyState !== 'loading') run();
  else document.addEventListener('DOMContentLoaded', onLoad, { once: true });
  return () => {
    cancelled = true;
    document.removeEventListener('DOMContentLoaded', onLoad);
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
 * so waiting for idle alone is not enough. Astro islands and lazily hydrated Vue
 * components are recognised too.
 */
export function awaitingHydration(el: Element): boolean {
  // Astro islands (any framework) carry an ssr attribute until they have hydrated;
  // client:visible and client:idle islands can stay that way long after load.
  if (el.closest('astro-island[ssr]')) return true;
  if (awaitingVueHydration(el)) return true;
  let inReact = false;
  for (let node: Node | null = el; node; node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)) {
    if (ownKey(node, '__reactContainer$')) {
      inReact = true;
      break;
    }
  }
  return inReact && !ownKey(el, '__reactFiber$');
}

interface VueVNode {
  component?: VueInstance | null;
  children?: unknown;
  suspense?: { activeBranch?: VueVNode | null } | null;
  el?: Node | null;
}
interface VueInstance {
  type?: { __asyncLoader?: unknown } | null;
  subTree?: VueVNode | null;
  vnode?: VueVNode | null;
}

/** DOM that a lazily hydrated Vue component has yet to claim, per app container, briefly cached. */
const vueCache = new WeakMap<object, { at: number; roots: Node[] }>();

function pendingVueRoots(root: VueVNode): Node[] {
  const roots: Node[] = [];
  const seen = new Set<object>();
  const visit = (vnode: unknown, depth: number) => {
    if (!vnode || typeof vnode !== 'object' || depth > 400 || seen.has(vnode)) return;
    seen.add(vnode);
    const node = vnode as VueVNode;
    const instance = node.component;
    if (instance) {
      // An async wrapper's subTree becomes the inner component's vnode once it has
      // hydrated. Before that (hydrateOnVisible, hydrateOnIdle, hydrateOnInteraction,
      // Nuxt's hydrate-on-* props) it is missing or a plain element vnode.
      if (instance.type?.__asyncLoader && !instance.subTree?.component) {
        const el = instance.vnode?.el ?? node.el;
        if (el) roots.push(el);
        return;
      }
      visit(instance.subTree, depth + 1);
      return;
    }
    if (node.suspense) visit(node.suspense.activeBranch, depth + 1);
    if (Array.isArray(node.children)) for (const child of node.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return roots;
}

/** True when `node` lies in the DOM range Vue will hydrate from `start` (an element, or a `[` … `]` fragment). */
function inVueRange(start: Node, node: Node): boolean {
  if (start.nodeType !== Node.COMMENT_NODE || (start as Comment).data !== '[') return start.contains(node);
  let depth = 1;
  for (let next = start.nextSibling; next; next = next.nextSibling) {
    if (next.nodeType === Node.COMMENT_NODE) {
      const data = (next as Comment).data;
      if (data === ']' && --depth === 0) return false;
      if (data === '[') depth++;
    } else if (next.contains(node)) return true;
  }
  return false;
}

/**
 * True when `el` sits in a Vue component that hydrates lazily and has not hydrated yet.
 * Production Vue marks no node it has hydrated, so the component tree is read instead,
 * from the root vnode Vue keeps on the app's container.
 */
function awaitingVueHydration(el: Element): boolean {
  for (let node: Node | null = el; node; node = node.parentNode) {
    if (!Object.prototype.hasOwnProperty.call(node, '__vue_app__')) continue;
    const root = (node as unknown as { _vnode?: VueVNode })._vnode;
    if (!root) return false;
    let cached = vueCache.get(node);
    const now = performance.now();
    if (!cached || now - cached.at > 50) vueCache.set(node, (cached = { at: now, roots: pendingVueRoots(root) }));
    return cached.roots.some((start) => inVueRange(start, el));
  }
  return false;
}
