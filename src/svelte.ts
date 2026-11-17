import { auto, glassify, type AutoOptions, type GlassOptions } from './index';
import { changed } from './adapter';

export type { AutoOptions, GlassOptions } from './index';

/** What a Svelte action returns. */
export interface ActionReturn<P> {
  update?: (parameter: P) => void;
  destroy?: () => void;
}

/**
 * Svelte action: turn one icon into glass.
 *
 * ```svelte
 * <script>
 *   import { glass } from 'glassity/svelte';
 *   import Calendar from '@lucide/svelte/icons/calendar';
 * </script>
 *
 * <svg use:glass={{ tile: true }}>…</svg>
 * <span use:glass><Calendar /></span>   <!-- a component: put the action on a wrapper -->
 * ```
 *
 * Works on an `<svg>` or on any element that contains one.
 */
export function glass(node: Element, options: GlassOptions = {}): ActionReturn<GlassOptions | undefined> {
  const handle = glassify(node, options);
  let current: GlassOptions = options;
  return {
    update(next = {}) {
      if (!changed(current, next)) return;
      current = next;
      handle.set(next);
    },
    destroy() {
      handle.destroy();
    },
  };
}

/**
 * Svelte action: turn every matching icon inside an element into glass, now and as
 * its content changes. Default selector `[data-glass]`.
 *
 * ```svelte
 * <nav use:glassProvider={{ selector: 'svg.lucide', tile: true }}>…</nav>
 * ```
 */
export function glassProvider(node: Element, options: AutoOptions = {}): ActionReturn<AutoOptions | undefined> {
  const { root: _root, selector, ...shared } = options;
  let current: GlassOptions = shared;
  let currentSelector = selector;
  let controller = auto({ ...options, root: node });
  return {
    update(next = {}) {
      const { root: _ignored, selector: nextSelector, ...rest } = next;
      if (nextSelector !== currentSelector) {
        currentSelector = nextSelector;
        current = rest;
        controller.destroy();
        controller = auto({ ...next, root: node });
        return;
      }
      if (!changed(current, rest)) return;
      current = rest;
      controller.set(rest);
    },
    destroy() {
      controller.destroy();
    },
  };
}
