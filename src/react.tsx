import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { auto, glassify, type BackdropSource, type GlassController, type GlassHandle, type GlassOptions } from './index';
import { OPTION_KEYS, readAttributes } from './options';
import { textTarget } from './text';
import { findSvg } from './dom';
import { inheritedOptions } from './scopes';

export type { BackdropSource, GlassHandle, GlassOptions, GlassLook, GlassProfile, GlassScheme, GlassVariant } from './index';

/** In React, `backdrop` may also be a ref to the element to refract. */
export interface GlassProps extends Omit<GlassOptions, 'backdrop'> {
  backdrop?: BackdropSource | RefObject<HTMLElement | null>;
}

// Every option, from the defaults themselves, so a new option cannot be forgotten here.
const OPTION_NAMES = OPTION_KEYS;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const Inherited = createContext<GlassProps>({});

/** Split glass options from the other props, and build a key that changes only when an option does. */
function pickOptions<P extends GlassProps>(props: P): { options: GlassProps; rest: Omit<P, keyof GlassProps>; key: string } {
  const options: Record<string, unknown> = {};
  const rest = { ...props } as Record<string, unknown>;
  let key = '';
  for (const name of OPTION_NAMES) {
    if (!(name in rest)) continue;
    const value = rest[name];
    delete rest[name];
    if (value === undefined) continue;
    options[name] = value;
    if (typeof value !== 'object' && typeof value !== 'function') key += name + '=' + String(value) + ';';
  }
  return { options: options as GlassProps, rest: rest as Omit<P, keyof GlassProps>, key };
}

function isRef(value: unknown): value is RefObject<HTMLElement | null> {
  return typeof value === 'object' && value !== null && 'current' in value && !(typeof Element !== 'undefined' && value instanceof Element);
}

/** Refs can only be read after mount, so the backdrop is resolved inside effects. */
function unwrap(options: GlassProps): GlassOptions {
  const backdrop = options.backdrop;
  if (!isRef(backdrop)) return options as GlassOptions;
  const { backdrop: _ref, ...others } = options;
  return backdrop.current ? { ...others, backdrop: backdrop.current } : others;
}

// Document providers share discovery, including icons rendered into portals.
const documentProviders = new Map<symbol, { selector: string; options: GlassOptions }>();
let documentController: GlassController | null = null;
let documentSelector = '';

function syncDocumentProviders(): void {
  if (!documentProviders.size) {
    documentController?.destroy();
    documentController = null;
    documentSelector = '';
    return;
  }
  const entries = [...documentProviders.values()];
  const selector = [...new Set(entries.map((entry) => entry.selector))].join(',');
  // Later-mounted providers win conflicts; removing one restores the remaining defaults.
  const options = Object.assign({}, ...entries.map((entry) => entry.options)) as GlassOptions;
  if (!documentController || selector !== documentSelector) {
    documentController?.destroy();
    documentController = auto({ selector, ...options });
    documentSelector = selector;
  } else documentController.set(options);
}

function documentProvider(selector: string, options: GlassOptions): Pick<GlassController, 'set' | 'destroy'> {
  const owner = Symbol();
  documentProviders.set(owner, { selector, options });
  syncDocumentProviders();
  return {
    set(next) {
      if (!documentProviders.has(owner)) return;
      documentProviders.set(owner, { selector, options: next });
      syncDocumentProviders();
    },
    destroy() {
      if (documentProviders.delete(owner)) syncDocumentProviders();
    },
  };
}

export interface GlassProviderProps extends GlassProps {
  /** Which elements become glass. Default `[data-glass]`. Try `svg.lucide` for every Lucide icon. */
  selector?: string;
  /** `document` discovers icons across the page, including portals, without rendering a wrapper. Default `element`. */
  scope?: 'element' | 'document';
  /** Element to render around the children in element scope. Default: a layout-neutral `<div>`. */
  as?: keyof HTMLElementTagNameMap;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Turns matching icons inside it into glass, and sets shared options for them.
 *
 * ```tsx
 * <GlassProvider>            // every <svg data-glass> below becomes glass
 *   <Calendar data-glass />
 * </GlassProvider>
 *
 * <GlassProvider selector="svg.lucide" tile interactive>…</GlassProvider>
 * ```
 *
 * Providers nest: the inner one inherits the outer options and overrides them.
 */
export function GlassProvider(props: GlassProviderProps): ReactElement {
  const { selector = '[data-glass]', scope = 'element', as = 'div', className, style, children, ...glass } = props;
  const parent = useContext(Inherited);
  const { options, key } = pickOptions(glass);
  const merged = useMemo<GlassProps>(() => ({ ...parent, ...options }), [parent, key, options.backdrop]); // eslint-disable-line react-hooks/exhaustive-deps
  const root = useRef<HTMLElement | null>(null);
  const controller = useRef<Pick<GlassController, 'set' | 'destroy'> | null>(null);

  useEffect(() => {
    if (scope !== 'document' && !root.current) return;
    const created = scope === 'document'
      ? documentProvider(selector, unwrap(merged))
      : auto({ root: root.current!, selector, ...unwrap(options) });
    controller.current = created;
    return () => {
      created.destroy();
      controller.current = null;
    };
  }, [selector, scope, as]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    controller.current?.set(unwrap(scope === 'document' ? merged : options));
  }, [merged, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  return createElement(
    Inherited.Provider,
    { value: merged },
    scope === 'document' ? children : createElement(as, { ref: root, className, style: style ?? { display: 'contents' } }, children),
  );
}

export interface GlassComponentProps extends GlassProps {
  /** One icon: a component or element that renders an `<svg>`. */
  children: ReactNode;
  /** Element to render around the icon. Default `span`. */
  as?: keyof HTMLElementTagNameMap;
  className?: string;
  style?: CSSProperties;
}

/**
 * One glass icon with its own options. Works with or without a provider.
 *
 * ```tsx
 * <Glass tile interactive depth={0.3}>
 *   <Calendar size={64} />
 * </Glass>
 * ```
 *
 * Swap the child for another icon and the glass morphs from one shape to the other.
 */
export function Glass(props: GlassComponentProps): ReactElement {
  const { children, as = 'span', className, style, ...glass } = props;
  const parent = useContext(Inherited);
  const { options, key } = pickOptions(glass);
  const host = useRef<HTMLElement | null>(null);
  const handle = useRef<GlassHandle | null>(null);

  // Runs after every commit: the child may have rendered a different <svg> node.
  useIsomorphicLayoutEffect(() => {
    const svg = host.current ? textTarget(host.current, options.text ?? readAttributes(host.current)?.text ?? parent.text) ?? findSvg(host.current) : null;
    if (handle.current && handle.current.element !== svg) inheritedOptions.delete(handle.current.element);
    if (!svg) {
      if (!handle.current && typeof console !== 'undefined')
        console.warn('glassity: <Glass> found no <svg> in its children. Pass a component that renders an <svg>.');
      handle.current?.destroy();
      handle.current = null;
      return;
    }
    inheritedOptions.set(svg, unwrap(parent));
    if (!handle.current) handle.current = glassify(svg, unwrap(options));
    else if (handle.current.element !== svg) handle.current.retarget(svg);
  });

  useEffect(() => {
    handle.current?.set(unwrap(options));
  }, [parent, key, options.backdrop]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (handle.current) inheritedOptions.delete(handle.current.element);
      handle.current?.destroy();
      handle.current = null;
    },
    [],
  );

  return createElement(
    as,
    {
      ref: host,
      className,
      'data-glassity-host': '',
      style: { display: 'inline-flex', position: 'relative', lineHeight: (options.text ?? parent.text) ? undefined : 0, verticalAlign: 'middle', ...style },
    },
    children,
  );
}

/**
 * Hook form of `<Glass>` for when you already have a ref to an `<svg>` (or to an element that contains one).
 *
 * ```tsx
 * const ref = useRef<SVGSVGElement>(null);
 * useGlass(ref, { tile: true });
 * return <svg ref={ref}>…</svg>;
 * ```
 */
export function useGlass(target: RefObject<Element | null>, props: GlassProps = {}): void {
  const parent = useContext(Inherited);
  const { options, key } = pickOptions(props);
  const handle = useRef<GlassHandle | null>(null);

  // Ref objects stay the same when React replaces their target node.
  useIsomorphicLayoutEffect(() => {
    const svg = target.current ? textTarget(target.current, options.text ?? readAttributes(target.current)?.text ?? parent.text) ?? findSvg(target.current) : null;
    if (handle.current && handle.current.element !== svg) inheritedOptions.delete(handle.current.element);
    if (!svg) {
      handle.current?.destroy();
      handle.current = null;
      return;
    }
    inheritedOptions.set(svg, unwrap(parent));
    if (!handle.current) handle.current = glassify(svg, unwrap(options));
    else if (handle.current.element !== svg) handle.current.retarget(svg);
  });

  useEffect(() => {
    handle.current?.set(unwrap(options));
  }, [parent, key, options.backdrop]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (handle.current) inheritedOptions.delete(handle.current.element);
      handle.current?.destroy();
      handle.current = null;
    },
    [],
  );
}
