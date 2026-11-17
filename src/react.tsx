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

export type { BackdropSource, GlassHandle, GlassOptions, GlassProfile, GlassScheme, GlassVariant } from './index';

/** In React, `backdrop` may also be a ref to the element to refract. */
export interface GlassProps extends Omit<GlassOptions, 'backdrop'> {
  backdrop?: BackdropSource | RefObject<HTMLElement | null>;
}

const OPTION_NAMES = [
  'variant', 'profile', 'tile', 'tileRadius', 'glyphOpacity', 'padding', 'strokeWidth', 'bevel', 'curvature', 'depth',
  'ior', 'refraction', 'dispersion', 'bands', 'frost', 'saturation', 'brightness', 'contrast', 'tint', 'tintOpacity',
  'dim', 'opacity', 'shine', 'rim', 'reflection', 'lightAngle', 'shadow', 'interactive', 'pointerLight', 'visible',
  'duration', 'scheme', 'accessibility', 'backdrop', 'maxDpr',
] as const;

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

export interface GlassProviderProps extends GlassProps {
  /** Which elements become glass. Default `[data-glass]`. Try `svg.lucide` for every Lucide icon. */
  selector?: string;
  /** Element to render around the children. Default: a `<div>` that does not affect layout. */
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
  const { selector = '[data-glass]', as = 'div', className, style, children, ...glass } = props;
  const parent = useContext(Inherited);
  const { options, key } = pickOptions(glass);
  const merged = useMemo<GlassProps>(() => ({ ...parent, ...options }), [parent, key, options.backdrop]); // eslint-disable-line react-hooks/exhaustive-deps
  const root = useRef<HTMLElement | null>(null);
  const controller = useRef<GlassController | null>(null);

  useEffect(() => {
    if (!root.current) return;
    const created = auto({ root: root.current, selector, ...unwrap(merged) });
    controller.current = created;
    return () => {
      created.destroy();
      controller.current = null;
    };
  }, [selector]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    controller.current?.set(unwrap(merged));
  }, [merged]);

  return createElement(
    Inherited.Provider,
    { value: merged },
    createElement(as, { ref: root, className, style: className || style ? style : { display: 'contents' } }, children),
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
  const merged = useMemo<GlassProps>(() => ({ ...parent, ...options }), [parent, key, options.backdrop]); // eslint-disable-line react-hooks/exhaustive-deps
  const host = useRef<HTMLElement | null>(null);
  const handle = useRef<GlassHandle | null>(null);
  const latest = useRef(merged);
  latest.current = merged;

  // Runs after every commit: the child may have rendered a different <svg> node.
  useIsomorphicLayoutEffect(() => {
    const svg = host.current?.querySelector('svg') ?? null;
    if (!svg) {
      if (!handle.current && typeof console !== 'undefined')
        console.warn('glassity: <Glass> found no <svg> in its children. Pass a component that renders an <svg>.');
      return;
    }
    if (!handle.current) handle.current = glassify(svg, unwrap(latest.current));
    else if (handle.current.element !== svg) handle.current.retarget(svg);
  });

  useEffect(() => {
    handle.current?.set(unwrap(merged));
  }, [merged]);

  useEffect(
    () => () => {
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
      style: { display: 'inline-flex', position: 'relative', lineHeight: 0, verticalAlign: 'middle', ...style },
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
  const merged = useMemo<GlassProps>(() => ({ ...parent, ...options }), [parent, key, options.backdrop]); // eslint-disable-line react-hooks/exhaustive-deps
  const handle = useRef<GlassHandle | null>(null);

  useEffect(() => {
    if (!target.current) return;
    const created = glassify(target.current, unwrap(merged));
    handle.current = created;
    return () => {
      created.destroy();
      handle.current = null;
    };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    handle.current?.set(unwrap(merged));
  }, [merged]);
}
