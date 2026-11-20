import { createEffect, onCleanup, onMount, type Accessor } from 'solid-js';
import { auto, glassify, type AutoOptions, type GlassHandle, type GlassOptions } from './index';
import { changed } from './adapter';

export type { AutoOptions, GlassOptions } from './index';

declare module 'solid-js' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface Directives {
      glass: GlassOptions | true;
      glassProvider: AutoOptions | true;
    }
  }
}

const value = <T,>(accessor: Accessor<T | true | undefined> | undefined): T => {
  const v = accessor?.();
  return (v === true || v == null ? {} : v) as T;
};

/**
 * Solid directive: turn one icon into glass.
 *
 * ```tsx
 * import { glass } from 'glassity/solid';
 * false && glass; // keep the import: Solid directives are referenced by name only
 *
 * <svg use:glass={{ tile: true }}>…</svg>
 * <span use:glass><Calendar /></span>   // a component: put the directive on a wrapper
 * ```
 *
 * Works on an `<svg>` or on any element that contains one. Options are reactive.
 */
export function glass(el: Element, accessor?: Accessor<GlassOptions | true | undefined>): void {
  let handle: GlassHandle | null = null;
  let current: GlassOptions | undefined;
  // A directive runs before the element is in the page; the glass needs it laid out.
  onMount(() => {
    current = value<GlassOptions>(accessor);
    handle = glassify(el, current);
  });
  createEffect(() => {
    const next = value<GlassOptions>(accessor);
    if (!handle || !changed(current, next)) return;
    current = next;
    handle.set(next);
  });
  onCleanup(() => handle?.destroy());
}

/**
 * Solid directive: turn every matching icon inside an element into glass, now and as
 * its content changes. Default selector `[data-glass]`.
 *
 * ```tsx
 * <nav use:glassProvider={{ selector: 'svg.lucide', tile: true }}>…</nav>
 * ```
 */
export function glassProvider(el: Element, accessor?: Accessor<AutoOptions | true | undefined>): void {
  let controller: ReturnType<typeof auto> | null = null;
  let current: GlassOptions | undefined;
  let selector = '[data-glass]';
  onMount(() => {
    const { root: _root, selector: nextSelector = '[data-glass]', ...shared } = value<AutoOptions>(accessor);
    selector = nextSelector;
    current = shared;
    controller = auto({ root: el, selector, ...shared });
  });
  createEffect(() => {
    const { root: _root, selector: nextSelector = '[data-glass]', ...next } = value<AutoOptions>(accessor);
    if (!controller) return;
    if (selector !== nextSelector) {
      controller.destroy();
      selector = nextSelector;
      controller = auto({ root: el, selector, ...next });
    } else if (changed(current, next)) controller.set(next);
    current = next;
  });
  onCleanup(() => controller?.destroy());
}
