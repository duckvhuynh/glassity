import { createMixin } from 'remix/component';
import { auto, glassify, type AutoOptions, type GlassController, type GlassHandle, type GlassOptions } from './index';
import { changed } from './adapter';

export type { AutoOptions, GlassOptions } from './index';

/*
 * Remix 3 mixins. Both are browser-only ({ ssr: false }): they add nothing to the
 * server HTML, so hydration and frame reloads see exactly what the server sent.
 */

/**
 * Turn one icon into glass. Put it on an `<svg>`, or on an element that contains one.
 *
 * ```tsx
 * import { glass } from 'glassity/remix';
 *
 * <svg mix={glass({ tile: true })} viewBox="0 0 24 24">…</svg>
 * ```
 *
 * Options are read on every render; the glass updates when they change.
 */
export const glass = createMixin<Element, [options?: GlassOptions]>(
  (handle) => {
    let current: GlassOptions = {};
    let glassHandle: GlassHandle | null = null;
    handle.addEventListener('insert', ({ node }) => {
      glassHandle = glassify(node, current);
    });
    handle.addEventListener('reclaimed', ({ node }) => {
      if (glassHandle && glassHandle.element !== node) glassHandle.retarget(node as SVGSVGElement);
    });
    handle.addEventListener('remove', () => {
      glassHandle?.destroy();
      glassHandle = null;
    });
    return (options = {}) => {
      if (glassHandle && changed(current, options)) glassHandle.set(options);
      current = options;
      return handle.element;
    };
  },
  { ssr: false },
);

/**
 * Turn every matching icon inside an element into glass, now and as its content
 * changes (including frame reloads). Default selector `[data-glass]`.
 *
 * ```tsx
 * import { glassProvider } from 'glassity/remix';
 *
 * <nav mix={glassProvider({ selector: 'svg', tile: true })}>…</nav>
 * ```
 */
export const glassProvider = createMixin<Element, [options?: AutoOptions]>(
  (handle) => {
    let current: AutoOptions = {};
    let controller: GlassController | null = null;
    let root: Element | null = null;
    const shared = ({ root: _root, selector: _selector, ...rest }: AutoOptions): GlassOptions => rest;
    handle.addEventListener('insert', ({ node }) => {
      root = node;
      controller = auto({ ...current, root: node });
    });
    handle.addEventListener('remove', () => {
      controller?.destroy();
      controller = null;
      root = null;
    });
    return (options = {}) => {
      if (controller && root) {
        if ((current.selector ?? '[data-glass]') !== (options.selector ?? '[data-glass]')) {
          controller.destroy();
          controller = auto({ ...options, root });
        } else if (changed(shared(current), shared(options))) controller.set(shared(options));
      }
      current = { ...options };
      return handle.element;
    };
  },
  { ssr: false },
);
