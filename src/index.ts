import { getEngine, type GlassHandle, type Scope } from './engine';
import type { GlassOptions } from './options';

export type { GlassHandle } from './engine';
export type { BackdropSource, GlassOptions, GlassProfile, GlassScheme, GlassVariant } from './options';

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

function findSvg(target: Element): SVGSVGElement | null {
  if (target instanceof SVGSVGElement) return target;
  return target.querySelector('svg');
}

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
 * @param target an `<svg>`, or an element that contains one
 */
export function glassify(target: Element, options: GlassOptions = {}): GlassHandle {
  if (!isBrowser) return inert;
  const svg = findSvg(target);
  if (!svg) {
    console.warn('glassity: no <svg> found. Pass an <svg> element, or an element that contains one.', target);
    return inert;
  }
  return getEngine().mount(svg, options, null);
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
 */
export function auto(options: AutoOptions = {}): GlassController {
  if (!isBrowser) return noController;
  const { root = document, selector = '[data-glass]', ...shared } = options;
  const engine = getEngine();
  const rootElement = root instanceof Document ? null : root;
  const scope: Scope = { root: rootElement, options: shared };
  const container: Element = rootElement ?? document.documentElement;
  if (rootElement) rootElement.setAttribute(ROOT, '');

  let destroyed = false;
  let queued = false;

  const scan = () => {
    queued = false;
    if (destroyed) return;
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
      const svg = findSvg(match);
      if (!svg || svg.getAttribute('data-glass')?.trim().toLowerCase() === 'off') continue;
      wanted.add(svg);
    }
    for (const instance of engine.inScope(scope)) if (!wanted.has(instance.element) || !instance.element.isConnected) instance.destroy();
    for (const svg of wanted) if (!engine.get(svg)) engine.mount(svg, {}, scope);
  };

  const ownCanvas = (node: Node) => node instanceof Element && node.hasAttribute('data-glassity-canvas');
  const observer = new MutationObserver((records) => {
    // Only the canvases glassity inserts itself are not a reason to look again. An
    // attribute change always is, also on an icon that is already glass (data-glass="off").
    const relevant = records.some(
      (record) => record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some((node) => !ownCanvas(node)),
    );
    if (queued || !relevant) return;
    queued = true;
    queueMicrotask(scan);
  });
  observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-glass', 'class'] });
  scan();

  const apply = () => {
    for (const instance of engine.inScope(scope)) instance.configure();
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
      observer.disconnect();
      for (const instance of engine.inScope(scope)) instance.destroy();
      rootElement?.removeAttribute(ROOT);
    },
  };
}

/** True when this browser can draw the glass (WebGL2). Without it icons stay plain SVG. */
export function isSupported(): boolean {
  return isBrowser && getEngine().renderer !== null;
}
