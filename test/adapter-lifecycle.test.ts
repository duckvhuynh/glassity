import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlassOptions } from '../src/options';

const state = vi.hoisted(() => ({
  mounts: [] as (() => void)[],
  effects: [] as (() => void)[],
  cleanups: [] as (() => void)[],
  watches: [] as ((options: GlassOptions) => void)[],
  host: {} as Element,
  textTargets: new Set<Element>(),
  react: null as null | { refs: { current: unknown }[]; effects: { deps?: unknown[]; cleanup?: () => void }[]; cursor: number; pending: (() => void)[] },
  inherited: {} as GlassOptions,
  controllers: [] as { set: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[],
  handles: [] as { element: Element; set: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; retarget: ReturnType<typeof vi.fn> }[],
}));

vi.mock('../src/index', () => ({
  auto: vi.fn(() => {
    const controller = { set: vi.fn(), destroy: vi.fn() };
    state.controllers.push(controller);
    return controller;
  }),
  glassify: vi.fn((element: Element) => {
    const handle = { element, set: vi.fn(), destroy: vi.fn(), retarget: vi.fn((next: Element) => { handle.element = next; }) };
    state.handles.push(handle);
    return handle;
  }),
}));
vi.mock('../src/dom', () => ({ findSvg: (element: Element) => state.textTargets.has(element) ? null : element }));
vi.mock('vue', () => ({
  defineComponent: (component: unknown) => component,
  onMounted: (fn: () => void) => state.mounts.push(fn),
  onBeforeUnmount: (fn: () => void) => state.cleanups.push(fn),
  watch: (_source: unknown, fn: (options: GlassOptions) => void) => state.watches.push(fn),
  unref: (value: { value?: unknown }) => value.value ?? value,
}));
vi.mock('solid-js', () => ({
  onMount: (fn: () => void) => state.mounts.push(fn),
  createEffect: (fn: () => void) => state.effects.push(fn),
  onCleanup: (fn: () => void) => state.cleanups.push(fn),
}));
vi.mock('@angular/core', () => ({
  PLATFORM_ID: 'platform', ElementRef: 'element', NgZone: 'zone', DestroyRef: 'destroy',
  inject: (token: string) => token === 'platform' ? 'browser' : token === 'element' ? { nativeElement: state.host }
    : token === 'zone' ? { runOutsideAngular: (fn: () => unknown) => fn() } : { onDestroy: (fn: () => void) => state.cleanups.push(fn) },
  afterNextRender: (fn: () => void) => state.mounts.push(fn),
  effect: (fn: () => void) => state.effects.push(fn),
  untracked: (fn: () => unknown) => fn(),
}));
vi.mock('remix/component', () => ({ createMixin: (setup: unknown) => setup }));
vi.mock('react', () => {
  const effect = (fn: () => void | (() => void), deps?: unknown[]) => {
    const current = state.react!;
    const index = current.cursor++;
    const previous = current.effects[index];
    if (!previous || !deps || !previous.deps || deps.some((value, i) => !Object.is(value, previous.deps![i]))) {
      current.pending.push(() => {
        previous?.cleanup?.();
        const cleanup = fn();
        current.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
      });
    }
  };
  return {
    createContext: () => ({ Provider: 'context' }),
    createElement: (type: unknown, props: object, ...children: unknown[]) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
    useContext: () => state.inherited,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (value: unknown) => {
      const current = state.react!;
      return current.refs[current.cursor++] ??= { current: value };
    },
    useEffect: effect,
    useLayoutEffect: effect,
  };
});

import { auto, glassify } from '../src/index';
import { GlassProvider, useGlass as useReactGlass } from '../src/react';
import { useGlass as useVueGlass, vGlass } from '../src/vue';
import { glassProvider as solidProvider } from '../src/solid';
import { injectGlassProvider } from '../src/angular';
import { glassProvider as remixProvider } from '../src/remix';
import { inheritedOptions } from '../src/scopes';

function reactComponent() {
  const hooks: NonNullable<typeof state.react> = { refs: [], effects: [], cursor: 0, pending: [] };
  return {
    render<T>(fn: () => T): T {
      hooks.cursor = 0;
      state.react = hooks;
      return fn();
    },
    commit() { hooks.pending.splice(0).forEach((fn) => fn()); },
    unmount() { hooks.effects.forEach((effect) => effect.cleanup?.()); },
  };
}

const bareElement = () => ({ getAttribute: () => null, getAttributeNames: () => [] }) as unknown as Element;

beforeEach(() => {
  vi.clearAllMocks();
  state.mounts = [];
  state.effects = [];
  state.cleanups = [];
  state.watches = [];
  state.controllers = [];
  state.handles = [];
  state.inherited = {};
  state.host = bareElement();
  state.textTargets.clear();
});

describe('React lifecycles', () => {
  it('document providers render only children and share discovery until the last unmount', () => {
    const first = reactComponent();
    const second = reactComponent();
    const tree = first.render(() => GlassProvider({ scope: 'document', children: 'first', depth: 0.2 }));
    expect(tree.props).toEqual({ value: { depth: 0.2 }, children: 'first' });
    first.commit();
    second.render(() => GlassProvider({ scope: 'document', children: 'second', frost: 0.8 }));
    second.commit();
    expect(auto).toHaveBeenCalledTimes(1);
    expect(state.controllers[0].set).toHaveBeenLastCalledWith({ depth: 0.2, frost: 0.8 });
    first.unmount();
    expect(state.controllers[0].destroy).not.toHaveBeenCalled();
    expect(state.controllers[0].set).toHaveBeenLastCalledWith({ frost: 0.8 });
    second.unmount();
    expect(state.controllers[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('a class alone keeps the provider layout neutral', () => {
    const component = reactComponent();
    const tree = component.render(() => GlassProvider({ className: 'toolbar' }));
    const child = (tree.props as { children: { props: { style: unknown } } }).children;
    expect(child.props.style).toEqual({ display: 'contents' });
  });

  it('follows a stable ref when the SVG changes or disappears, keeping inherited options below own options', () => {
    const component = reactComponent();
    const first = bareElement() as SVGSVGElement;
    const second = bareElement() as SVGSVGElement;
    const ref: { current: Element | null } = { current: first };
    state.inherited = { depth: 0.2, frost: 0.4 };
    component.render(() => useReactGlass(ref, { frost: 0.8 }));
    component.commit();
    expect(glassify).toHaveBeenCalledWith(first, { frost: 0.8 });
    expect(inheritedOptions.get(first)).toEqual(state.inherited);
    ref.current = second;
    component.render(() => useReactGlass(ref, { frost: 0.8 }));
    component.commit();
    expect(state.handles[0].retarget).toHaveBeenCalledWith(second);
    expect(inheritedOptions.has(first)).toBe(false);
    expect(inheritedOptions.get(second)).toEqual(state.inherited);
    ref.current = null;
    component.render(() => useReactGlass(ref));
    component.commit();
    expect(state.handles[0].destroy).toHaveBeenCalledTimes(1);
    expect(inheritedOptions.has(second)).toBe(false);
    component.unmount();
  });
});

describe('text adapter targets', () => {
  it('React mounts and retargets HTML refs without looking for an SVG', () => {
    class Html {
      tagName = 'H1';
      localName = 'h1';
      getAttribute() { return null; }
      getAttributeNames() { return []; }
    }
    const realHtml = (globalThis as { HTMLElement?: unknown }).HTMLElement;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = Html;
    const first = new Html() as unknown as HTMLElement;
    const second = new Html() as unknown as HTMLElement;
    state.textTargets.add(first);
    state.textTargets.add(second);
    const component = reactComponent();
    const ref = { current: first };
    try {
      component.render(() => useReactGlass(ref, { text: true }));
      component.commit();
      // Identity checks: chai cannot print these fake elements in a failure message.
      expect(vi.mocked(glassify).mock.calls.length).toBe(1);
      expect(vi.mocked(glassify).mock.calls[0][0] === first).toBe(true);
      expect(vi.mocked(glassify).mock.calls[0][1]).toEqual({ text: true });
      ref.current = second;
      component.render(() => useReactGlass(ref, { text: true }));
      component.commit();
      expect(vi.mocked(state.handles[0].retarget).mock.calls.at(-1)?.[0] === second).toBe(true);
      component.unmount();
    } finally { (globalThis as { HTMLElement?: unknown }).HTMLElement = realHtml; }
  });

  it('Vue keeps text as the directive source when its options change', () => {
    class Html {
      tagName = 'H1';
      localName = 'h1';
      getAttribute() { return null; }
      getAttributeNames() { return []; }
    }
    const realHtml = (globalThis as { HTMLElement?: unknown }).HTMLElement;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = Html;
    const element = new Html() as unknown as HTMLElement;
    state.textTargets.add(element);
    const directive = vGlass as { mounted(el: Element, binding: { value: GlassOptions }): void; updated(el: Element, binding: { value: GlassOptions }): void };
    try {
      directive.mounted(element, { value: { text: true } });
      directive.updated(element, { value: { text: true, depth: 0.4 } });
      expect(vi.mocked(glassify).mock.calls.length).toBe(1);
      expect(vi.mocked(glassify).mock.calls[0][0] === element).toBe(true);
      expect(vi.mocked(glassify).mock.calls[0][1]).toEqual({ text: true });
      expect(state.handles[0].set).toHaveBeenCalledWith({ text: true, depth: 0.4 });
      expect(state.handles[0].retarget).not.toHaveBeenCalled();
    } finally { (globalThis as { HTMLElement?: unknown }).HTMLElement = realHtml; }
  });
});

describe('Vue option snapshots', () => {
  it('detects in-place directive option mutations without redundant writes', () => {
    const directive = vGlass as { mounted(el: Element, binding: { value: GlassOptions }): void; updated(el: Element, binding: { value: GlassOptions }): void };
    const options = { depth: 0.2 };
    directive.mounted(state.host, { value: options });
    options.depth = 0.4;
    directive.updated(state.host, { value: options });
    expect(state.handles[0].set).toHaveBeenCalledWith({ depth: 0.4 });
    directive.updated(state.host, { value: options });
    expect(state.handles[0].set).toHaveBeenCalledTimes(1);
  });

  it('detects in-place composable option mutations', () => {
    const options = { depth: 0.2 };
    useVueGlass({ value: state.host } as Parameters<typeof useVueGlass>[0], options);
    state.mounts.forEach((fn) => fn());
    options.depth = 0.5;
    state.watches[0](options);
    expect(state.handles[0].set).toHaveBeenCalledWith({ depth: 0.5 });
  });
});

describe('provider selectors', () => {
  it.each(['solid', 'angular'] as const)('%s restarts discovery when only its selector changes', (adapter) => {
    let options = { selector: '.first', depth: 0.2 };
    if (adapter === 'solid') solidProvider(state.host, () => options);
    else injectGlassProvider(() => options);
    state.mounts.forEach((fn) => fn());
    state.effects.forEach((fn) => fn());
    options = { ...options, selector: '.second' };
    state.effects.forEach((fn) => fn());
    expect(state.controllers[0].destroy).toHaveBeenCalledTimes(1);
    expect(auto).toHaveBeenLastCalledWith({ root: state.host, selector: '.second', depth: 0.2 });
    state.cleanups.forEach((fn) => fn());
    expect(state.controllers[1].destroy).toHaveBeenCalledTimes(1);
  });

  it('Remix restarts discovery even when its options object is mutated in place', () => {
    const events = new Map<string, (event: { node: Element }) => void>();
    const setup = remixProvider as unknown as (handle: object) => (options: { selector: string; depth: number }) => unknown;
    const render = setup({ element: state.host, addEventListener: (event: string, listener: (event: { node: Element }) => void) => events.set(event, listener) });
    const options = { selector: '.first', depth: 0.2 };
    render(options);
    events.get('insert')!({ node: state.host });
    options.selector = '.second';
    render(options);
    expect(state.controllers[0].destroy).toHaveBeenCalledTimes(1);
    expect(auto).toHaveBeenLastCalledWith({ root: state.host, selector: '.second', depth: 0.2 });
    events.get('remove')!({ node: state.host });
    expect(state.controllers[1].destroy).toHaveBeenCalledTimes(1);
  });
});
