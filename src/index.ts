import { getEngine, type GlassHandle, type Scope } from './engine';
import { readAttributes, type GlassOptions } from './options';

export type { GlassHandle } from './engine';
export type { BackdropSource, GlassOptions, GlassProfile, GlassScheme, GlassVariant } from './options';

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

/** Attribute that marks the element a provider or `auto()` root is bound to. */
const ROOT = 'data-glassity-root';
/** Attribute on the wrapper of a single hand-placed glass icon. */
const HOST = 'data-glassity-host';
/** Written by the page author: every icon inside becomes one merged piece of glass. */
const GROUP = 'data-glass-group';
/** Set by `group()` on a root that does not carry the author attribute. */
const GROUP_MANAGED = 'data-glassity-group';
const ANY_GROUP = `[${GROUP}],[${GROUP_MANAGED}]`;

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

const optedOut = (el: Element) => {
  const flag = el.getAttribute('data-glass')?.trim().toLowerCase();
  return flag === 'off' || flag === 'false' || flag === 'none';
};

const ownCanvas = (node: Node) => node instanceof Element && node.hasAttribute('data-glassity-canvas');

/** True when a batch of mutations is more than glassity's own canvases coming and going. */
const worthALook = (records: MutationRecord[]) =>
  records.some((record) => record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some((node) => !ownCanvas(node)));

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

/** Control over the icons found by `auto()` or `group()`. */
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

export interface GroupOptions extends GlassOptions {
  /** Which elements inside the group become glass. Default `svg`. */
  selector?: string;
}

interface GroupParts {
  controller: GlassController;
  /** Options handed down from an enclosing `auto()`; the group's own attributes and options win over them. */
  inherit(options: GlassOptions): void;
}

function makeGroup(root: Element, explicit: GroupOptions, inherited: GlassOptions): GroupParts {
  const engine = getEngine();
  const { selector = 'svg', ...given } = explicit;
  let own: GlassOptions = given;
  let handedDown = inherited;
  const compose = (): GlassOptions => ({ ...handedDown, ...(readAttributes(root) ?? {}), ...own });
  const scope: Scope = { root, options: compose() };
  const marked = !root.hasAttribute(GROUP) && !root.hasAttribute(GROUP_MANAGED);
  if (marked) root.setAttribute(GROUP_MANAGED, '');
  const drawn = engine.createGroup(root, scope);
  const handles = new Map<SVGSVGElement, GlassHandle>();

  let destroyed = false;
  let queued = false;

  const scan = () => {
    queued = false;
    if (destroyed) return;
    const wanted = new Set<SVGSVGElement>();
    let matches: Element[] = [];
    try {
      matches = Array.from(root.querySelectorAll(selector));
    } catch {
      console.warn(`glassity: "${selector}" is not a valid selector.`);
    }
    for (const match of matches) {
      const svg = findSvg(match);
      if (!svg || optedOut(match) || optedOut(svg)) continue;
      // An inner group, provider or hand-placed <Glass> owns its own icons.
      if (svg.closest(ANY_GROUP) !== root || svg.closest(`[${HOST}]`)) continue;
      const provider = svg.closest(`[${ROOT}]`);
      if (provider && provider !== root && root.contains(provider)) continue;
      wanted.add(svg);
    }
    for (const [svg, handle] of handles)
      if (!wanted.has(svg) || !svg.isConnected) {
        handle.destroy();
        handles.delete(svg);
      }
    for (const svg of wanted) {
      if (!handles.has(svg)) handles.set(svg, engine.mount(svg, {}, scope));
      engine.assign(svg, drawn);
    }
  };

  const reconfigure = () => {
    scope.options = compose();
    drawn.configure();
    for (const instance of engine.inScope(scope)) instance.configure();
  };

  const tree = new MutationObserver((records) => {
    if (queued || !worthALook(records)) return;
    queued = true;
    queueMicrotask(scan);
  });
  tree.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-glass', 'class'] });
  // The group's own data-glass-* attributes are its options.
  const attributes = new MutationObserver((records) => {
    if (records.some((record) => record.attributeName?.startsWith('data-glass'))) reconfigure();
  });
  attributes.observe(root, { attributes: true });
  scan();

  return {
    inherit(options) {
      handedDown = options;
      reconfigure();
    },
    controller: {
      update(next) {
        own = { ...own, ...next };
        reconfigure();
      },
      set(next) {
        own = { ...next };
        reconfigure();
      },
      refresh() {
        scan();
        for (const handle of handles.values()) handle.refresh();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        tree.disconnect();
        attributes.disconnect();
        for (const handle of handles.values()) handle.destroy();
        handles.clear();
        drawn.destroy();
        if (marked) root.removeAttribute(GROUP_MANAGED);
      },
    },
  };
}

/**
 * Draw every icon inside `root` as one piece of glass. Icons that come close
 * reach for each other and join; with `bar` they share a single glass bar.
 *
 * ```js
 * import { group } from 'glassity';
 * const toolbar = group(document.querySelector('.toolbar'), { tile: true, spacing: 0.4 });
 * toolbar.update({ bar: true });
 * ```
 *
 * The same thing without code: put `data-glass-group` on the container and use
 * `auto()`. The group's options are its `data-glass-*` attributes.
 *
 * All icons of a group share one material. Keep groups to clusters such as a
 * toolbar: a group is one canvas, and a very large one falls back to separate icons.
 */
export function group(root: Element, options: GroupOptions = {}): GlassController {
  if (!isBrowser) return noController;
  return makeGroup(root, options, {}).controller;
}

export interface AutoOptions extends GlassOptions {
  /** Where to look for icons. Default: the whole document. */
  root?: Element | Document;
  /** Which elements become glass. Default `[data-glass]`. May match an `<svg>` or an element that contains one. */
  selector?: string;
}

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
 * A container with `data-glass-group` becomes a merged group of all the icons inside it.
 */
export function auto(options: AutoOptions = {}): GlassController {
  if (!isBrowser) return noController;
  const { root = document, selector = '[data-glass]', ...shared } = options;
  const engine = getEngine();
  const rootElement = root instanceof Document ? null : root;
  const scope: Scope = { root: rootElement, options: shared };
  const container: Element = rootElement ?? document.documentElement;
  if (rootElement) rootElement.setAttribute(ROOT, '');
  const handles = new Map<SVGSVGElement, GlassHandle>();
  const groups = new Map<Element, GroupParts>();

  let destroyed = false;
  let queued = false;

  const scan = () => {
    queued = false;
    if (destroyed) return;

    // Groups first: their icons belong to them, not to this scan.
    for (const [element, parts] of groups)
      if (!element.isConnected || !element.hasAttribute(GROUP)) {
        parts.controller.destroy();
        groups.delete(element);
      }
    for (const element of Array.from(container.querySelectorAll(`[${GROUP}]`)))
      if (!groups.has(element) && element.closest(`[${ROOT}]`) === rootElement && !optedOut(element))
        groups.set(element, makeGroup(element, {}, scope.options));

    const wanted = new Set<SVGSVGElement>();
    let matches: Element[] = [];
    try {
      matches = Array.from(container.querySelectorAll(selector));
      if (rootElement?.matches(selector)) matches.unshift(rootElement);
    } catch {
      console.warn(`glassity: "${selector}" is not a valid selector.`);
    }
    for (const match of matches) {
      // A nested provider owns its own icons; so do a group and a hand-placed <Glass>.
      if (match.closest(`[${ROOT}]`) !== rootElement) continue;
      if (match.closest(`[${HOST}]`) || match.closest(ANY_GROUP) || optedOut(match)) continue;
      const svg = findSvg(match);
      if (!svg || optedOut(svg) || svg.closest(ANY_GROUP)) continue;
      wanted.add(svg);
    }
    for (const [svg, handle] of handles)
      if (!wanted.has(svg) || !svg.isConnected) {
        handle.destroy();
        handles.delete(svg);
      }
    for (const svg of wanted) if (!handles.has(svg) && !engine.get(svg)) handles.set(svg, engine.mount(svg, {}, scope));
  };

  const observer = new MutationObserver((records) => {
    // Only the canvases glassity inserts itself are not a reason to look again. An
    // attribute change always is, also on an icon that is already glass (data-glass="off").
    if (queued || !worthALook(records)) return;
    queued = true;
    queueMicrotask(scan);
  });
  observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-glass', GROUP, 'class'] });
  scan();

  const apply = () => {
    for (const instance of engine.inScope(scope)) instance.configure();
    for (const parts of groups.values()) parts.inherit(scope.options);
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
      for (const handle of handles.values()) handle.refresh();
      for (const parts of groups.values()) parts.controller.refresh();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      for (const handle of handles.values()) handle.destroy();
      handles.clear();
      for (const parts of groups.values()) parts.controller.destroy();
      groups.clear();
      rootElement?.removeAttribute(ROOT);
    },
  };
}

/** True when this browser can draw the glass (WebGL2). Without it icons stay plain SVG. */
export function isSupported(): boolean {
  return isBrowser && getEngine().renderer !== null;
}

/** True when icons in a group can merge on this device. Without it a group's icons are drawn one by one. */
export function canMerge(): boolean {
  return isBrowser && !!getEngine().renderer?.canCompose;
}
