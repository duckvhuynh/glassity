import {
  afterNextRender,
  DestroyRef,
  ElementRef,
  inject,
  makeEnvironmentProviders,
  NgZone,
  PLATFORM_ID,
  provideEnvironmentInitializer,
  effect,
  untracked,
  type EnvironmentProviders,
} from '@angular/core';
import { auto, glassify, type AutoOptions, type GlassController, type GlassHandle, type GlassOptions } from './index';
import { changed } from './adapter';

export type { AutoOptions, GlassController, GlassHandle, GlassOptions } from './index';

/*
 * Angular helpers are plain functions on Angular's runtime API (inject, afterNextRender,
 * DestroyRef, effect), not decorated classes: decorators would need the Angular compiler
 * to build this package. Everything runs outside the zone, so glassity's animation
 * frames and observers do not trigger change detection, and nothing runs on the server.
 */

/** Options as a plain object, or a signal / function that returns them (read reactively). */
export type GlassOptionsSource<T extends GlassOptions = GlassOptions> = T | (() => T);

const browser = () => inject(PLATFORM_ID) === 'browser';
const read = <T,>(source: GlassOptionsSource<T & GlassOptions> | undefined): T => (typeof source === 'function' ? source() : (source ?? {})) as T;

/**
 * Turn every `[data-glass]` icon of the app into glass, now and as views change.
 *
 * ```ts
 * bootstrapApplication(App, { providers: [provideGlassity({ tile: true })] });
 * ```
 */
export function provideGlassity(options: AutoOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      if (!browser()) return;
      const zone = inject(NgZone);
      const controller = zone.runOutsideAngular(() => auto(options));
      inject(DestroyRef).onDestroy(() => controller.destroy());
    }),
  ]);
}

/** What `injectGlass` and `injectGlassProvider` return. */
export interface GlassRef<T> {
  /** The handle or controller, once the view has rendered (null before, and on the server). */
  readonly current: T | null;
}

/**
 * Turn an element into glass for the life of the component or directive. Call it in
 * an injection context (a constructor or a field initializer). By default the target
 * is the host element; it may be an `<svg>` or contain one.
 *
 * ```ts
 * @Directive({ selector: '[glass]' })
 * export class GlassDirective {
 *   glass = input<GlassOptions | ''>('');
 *   constructor() {
 *     injectGlass(() => this.glass() || {});
 *   }
 * }
 * ```
 */
export function injectGlass(options?: GlassOptionsSource, target?: ElementRef<Element> | (() => Element | null | undefined)): GlassRef<GlassHandle> {
  const ref: { current: GlassHandle | null } = { current: null };
  if (!browser()) return ref;
  const host = inject(ElementRef) as ElementRef<Element>;
  const zone = inject(NgZone);
  let current: GlassOptions | undefined;
  const element = () => (typeof target === 'function' ? target() : (target ?? host).nativeElement);

  afterNextRender(() => {
    const el = element();
    if (!el) return;
    current = untracked(() => read<GlassOptions>(options));
    ref.current = zone.runOutsideAngular(() => glassify(el, current));
  });
  if (typeof options === 'function')
    effect(() => {
      const next = read<GlassOptions>(options);
      if (!ref.current || !changed(current, next)) return;
      current = next;
      zone.runOutsideAngular(() => ref.current!.set(next));
    });
  inject(DestroyRef).onDestroy(() => ref.current?.destroy());
  return ref;
}

/**
 * Turn every matching icon inside the host element (or `target`) into glass, now and as
 * its content changes. Default selector `[data-glass]`.
 *
 * ```ts
 * @Component({ selector: 'app-toolbar', template: '…' })
 * export class Toolbar {
 *   constructor() {
 *     injectGlassProvider({ selector: 'svg', tile: true });
 *   }
 * }
 * ```
 */
export function injectGlassProvider(
  options?: GlassOptionsSource<AutoOptions>,
  target?: ElementRef<Element> | (() => Element | null | undefined),
): GlassRef<GlassController> {
  const ref: { current: GlassController | null } = { current: null };
  if (!browser()) return ref;
  const host = inject(ElementRef) as ElementRef<Element>;
  const zone = inject(NgZone);
  let current: GlassOptions | undefined;
  const element = () => (typeof target === 'function' ? target() : (target ?? host).nativeElement);
  const shared = (o: AutoOptions): GlassOptions => {
    const { root: _root, selector: _selector, ...rest } = o;
    return rest;
  };

  afterNextRender(() => {
    const el = element();
    if (!el) return;
    const all = untracked(() => read<AutoOptions>(options));
    current = shared(all);
    ref.current = zone.runOutsideAngular(() => auto({ ...all, root: el }));
  });
  if (typeof options === 'function')
    effect(() => {
      const next = shared(read<AutoOptions>(options));
      if (!ref.current || !changed(current, next)) return;
      current = next;
      zone.runOutsideAngular(() => ref.current!.set(next));
    });
  inject(DestroyRef).onDestroy(() => ref.current?.destroy());
  return ref;
}
