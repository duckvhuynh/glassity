import { getEngine, type GlassHandle, type Scope } from './engine';
import type { GlassOptions } from './options';
import { awaitingHydration, findSvg, outsideZones, OWN, whenSettled } from './dom';

export type { GlassHandle } from './engine';
export { looks } from './options';
export type { BackdropSource, GlassEnvironment, GlassLook, GlassOptions, GlassProfile, GlassScheme, GlassVariant } from './options';

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

/** Attribute that marks the element a provider or `auto()` root is bound to. */
const ROOT = 'data-glassity-root';
/** Attribute on the wrapper of a single hand-placed glass icon. */
const HOST = 'data-glassity-host';

const inert: GlassHandle = {
  element: null as unknown as SVGSVGElement,
  update() {},
  set() {},
  retarget() {},
  refresh() {},
  destroy() {},
};

/**
 * Turn one SVG into glass.
 *
 * ```js
 * import { glassify } from 'glassity';
 * const glass = glassify(document.querySelector('svg'), { tile: true });
 * glass.update({ depth: 0.3 });
 * glass.destroy();
 * ```
 *
 * @param target an `<svg>`, or an element that contains one (also in its open shadow root)
 */
export function glassify(target: Element, options: GlassOptions = {}): GlassHandle {
  if (!isBrowser) return inert;
  const svg = findSvg(target);
  if (!svg) {
    console.warn('glassity: no <svg> found. Pass an <svg> element, or an element that contains one.', target);
    return inert;
  }
  return outsideZones(() => wrap(getEngine().mount(svg, options, null)));
}

/** Replace the page defaults and update existing icons. Pass {} to reset them. Safe during SSR. */
export function configure(options: GlassOptions): void {
  if (!isBrowser) return;
  outsideZones(() => {
    const engine = getEngine();
    engine.scopes.configure(options);
    engine.configure();
  });
}

/** Calls made later on a handle also leave any zone.js zone. */
function wrap<T extends object>(target: T): T {
  return new Proxy(target, {
    get(object, key, receiver) {
      const value = Reflect.get(object, key, receiver);
      return typeof value === 'function' ? (...args: unknown[]) => outsideZones(() => value.apply(object, args)) : value;
    },
  });
}

export interface AutoOptions extends GlassOptions {
  /** Where to look for icons. Default: the whole document. */
  root?: Element | Document;
  /** Which elements become glass. Default `[data-glass]`. May match an `<svg>` or an element that contains one. */
  selector?: string;
}

/** Control over a group of icons found by `auto()`. */
export interface GlassController {
  /** Change some shared options; the rest keep their values. */
  update(options: GlassOptions): void;
  /** Replace the shared options. */
  set(options: GlassOptions): void;
  /** Look for icons again now, and re-read every backdrop. */
  refresh(): void;
  /** Remove the glass from every icon this controller found. */
  destroy(): void;
}

const noController: GlassController = { update() {}, set() {}, refresh() {}, destroy() {} };

/**
 * Turn every matching icon inside `root` into glass, now and as the page changes.
 *
 * ```js
 * import { auto } from 'glassity';
 * auto();                                   // every [data-glass] on the page
 * auto({ selector: 'svg.lucide', tile: true });
 * ```
 *
 * Per-icon attributes still apply: `data-glass="clear"`, `data-glass-depth="0.3"`, `data-glass="off"`.
 *
 * The first look happens once the page has loaded and the browser is idle, so a
 * server-rendered page can hydrate before anything changes.
 */
export function auto(options: AutoOptions = {}): GlassController {
  if (!isBrowser) return noController;
  return outsideZones(() => wrap(startAuto(options)));
}

function startAuto(options: AutoOptions): GlassController {
  const { root = document, selector = '[data-glass]', ...shared } = options;
  const engine = getEngine();
  const rootElement = root instanceof Document ? null : root;
  const scope: Scope = { root: rootElement, options: shared };
  const container: Element = rootElement ?? document.documentElement;
  if (rootElement) rootElement.setAttribute(ROOT, '');

  let destroyed = false;
  let started = false;
  let queued = false;
  let retry = 0;
  let retryDelay = 100;
  const schedule = () => {
    if (queued || destroyed) return;
    queued = true;
    queueMicrotask(scan);
  };
  engine.scopes.add(scope, () => { if (started) schedule(); });
  engine.configure();

  // Web components (Ionicons, <iconify-icon>, Shoelace) keep their <svg> in a shadow
  // root, often filled in later. The page observer cannot see inside, so each one is
  // watched on its own.
  const shadows = new Map<ShadowRoot, MutationObserver>();
  const waiting = new Set<string>();
  const watchShadow = (host: Element) => {
    const shadow = host.shadowRoot;
    if (shadow) {
      if (shadows.has(shadow)) return;
      const watcher = new MutationObserver(schedule);
      watcher.observe(shadow, { subtree: true, childList: true });
      shadows.set(shadow, watcher);
    } else if (host.localName.includes('-') && !customElements.get(host.localName) && !waiting.has(host.localName)) {
      waiting.add(host.localName);
      customElements.whenDefined(host.localName).then(() => {
        waiting.delete(host.localName);
        schedule();
      });
    }
  };

  const scan = () => {
    queued = false;
    if (destroyed) return;
    started = true;
    // What a copied page (Turbo, swup, Barba) left behind goes first.
    engine.sweep(container);
    engine.syncScopes();
    let hydrating = false;
    const wanted = new Set<SVGSVGElement>();
    let matches: Element[] = [];
    try {
      matches = Array.from(container.querySelectorAll(selector));
      if (rootElement?.matches(selector)) matches.unshift(rootElement);
    } catch {
      console.warn(`glassity: "${selector}" is not a valid selector.`);
    }
    for (const match of matches) {
      // A nested provider owns its own icons; so does a hand-placed <Glass>.
      if (match.closest(`[${ROOT}]`) !== rootElement) continue;
      if (match.closest(`[${HOST}]`)) continue;
      const flag = match.getAttribute('data-glass')?.trim().toLowerCase();
      if (flag === 'off' || flag === 'false' || flag === 'none') continue;
      if (match.shadowRoot || match.localName.includes('-')) watchShadow(match);
      const svg = findSvg(match);
      if (!svg || svg.getAttribute('data-glass')?.trim().toLowerCase() === 'off') continue;
      // Not hydrated yet: look again shortly. An icon already glass keeps its glass.
      if (!engine.get(svg) && awaitingHydration(svg)) {
        hydrating = true;
        continue;
      }
      wanted.add(svg);
    }
    // React's marks cannot be observed, so look again, less often the longer it takes
    // (an island that hydrates on scroll may wait indefinitely).
    clearTimeout(retry);
    if (hydrating) {
      retry = window.setTimeout(schedule, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 2000);
    } else retryDelay = 100;
    for (const instance of engine.inScope(scope)) if (!wanted.has(instance.element) || !instance.element.isConnected) instance.destroy();
    for (const svg of wanted) {
      if (!engine.get(svg)) engine.mount(svg, {}, scope);
      else engine.claim(svg, scope); // picked up earlier by an outer scope: this one owns it now
    }
  };

  const ownCanvas = (node: Node) => node instanceof Element && node.hasAttribute(OWN);
  const observer = new MutationObserver((records) => {
    // Only the canvases glassity inserts itself are not a reason to look again. An
    // attribute change always is, also on an icon that is already glass (data-glass="off").
    const relevant = records.some(
      (record) => record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some((node) => !ownCanvas(node)),
    );
    if (relevant) schedule();
  });

  // Nothing is touched until the page has loaded and gone idle, so a server-rendered
  // page can hydrate first (see whenSettled).
  const cancelStart = whenSettled(() => {
    if (destroyed) return;
    observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-glass', ROOT, 'class', 'ssr'] });
    scan();
  });

  const apply = () => {
    engine.configure();
  };

  return {
    update(next) {
      scope.options = { ...scope.options, ...next };
      apply();
    },
    set(next) {
      scope.options = { ...next };
      apply();
    },
    refresh() {
      scan();
      for (const instance of engine.inScope(scope)) instance.refresh();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelStart();
      clearTimeout(retry);
      observer.disconnect();
      for (const watcher of shadows.values()) watcher.disconnect();
      shadows.clear();
      for (const instance of engine.inScope(scope)) instance.destroy();
      engine.scopes.delete(scope);
      if (rootElement && !engine.scopes.hasRoot(rootElement)) rootElement.removeAttribute(ROOT);
      engine.configure();
      engine.scopes.discover();
    },
  };
}

/** True when this browser can draw the glass (WebGL2). Without it icons stay plain SVG. */
export function isSupported(): boolean {
  return isBrowser && getEngine().renderer !== null;
}
