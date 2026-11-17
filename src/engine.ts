import { Backdrop, ColorBackdrop, MediaBackdrop, nearestSurface, SnapshotBackdrop, UrlBackdrop, type Rect } from './backdrop';
import { buildField } from './core/field';
import { planRaster, rasterAlpha, serializeIcon, type RasterPlan } from './core/raster';
import { Renderer, type BackTexture, type FieldTexture } from './gl/renderer';
import { readAttributes, resolveOptions, type GlassOptions, type ResolvedOptions } from './options';
import { pageColor } from './snapshot';
import { ensureStyles, HIDDEN, OWN } from './dom';

/** Control over one glass icon. */
export interface GlassHandle {
  /** The SVG this glass is drawn for. */
  readonly element: SVGSVGElement;
  /** Change some options; the rest keep their current values. */
  update(options: GlassOptions): void;
  /** Replace all options given in code (attributes and provider options still apply). */
  set(options: GlassOptions): void;
  /** Move the glass to another SVG; the shape morphs from the old icon to the new one. */
  retarget(svg: SVGSVGElement): void;
  /** Re-read the icon and the backdrop. */
  refresh(): void;
  /** Remove the glass and show the original SVG again. */
  destroy(): void;
}

/** Options shared by a group of icons (a provider or an `auto()` root). */
export interface Scope {
  root: Element | null;
  options: GlassOptions;
}

interface Geometry {
  key: string;
  plan: RasterPlan;
  data: Float32Array;
  /** The raster had no opaque pixel. */
  empty: boolean;
  refs: number;
  texture: FieldTexture | null;
}

interface BackState {
  texture: BackTexture | null;
  version: number;
  failed: boolean;
}

const PRESS_HOSTS = 'button,a,[role="button"],summary,label';
const NO_PREFERENCES = { reducedMotion: false, reducedTransparency: false, moreContrast: false, forcedColors: false };
const PROFILES = { squircle: 0, circle: 1, lip: 2 } as const;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function lightVector(degrees: number): [number, number] {
  const a = (degrees * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

let bevelId = 0;

/** Without WebGL2 the icon stays a plain SVG with a soft highlight, so nothing disappears. */
function applyBevel(svg: SVGSVGElement): () => void {
  const ns = 'http://www.w3.org/2000/svg';
  const id = 'glassity-bevel-' + ++bevelId;
  const node = (name: string, attributes: Record<string, string>, ...children: Element[]) => {
    const el = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
    el.append(...children);
    return el;
  };
  // Built node by node: pages that enforce Trusted Types refuse innerHTML.
  const defs = node(
    'defs',
    { [OWN]: '' },
    node(
      'filter',
      { id, x: '-25%', y: '-25%', width: '150%', height: '150%', 'color-interpolation-filters': 'sRGB' },
      node('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: '.3', result: 'h' }),
      node(
        'feSpecularLighting',
        { in: 'h', surfaceScale: '1.8', specularConstant: '1', specularExponent: '24', 'lighting-color': 'white', result: 's' },
        node('feDistantLight', { azimuth: '225', elevation: '50' }),
      ),
      node('feComposite', { in: 's', in2: 'SourceAlpha', operator: 'in', result: 'shine' }),
      node('feMerge', {}, node('feMergeNode', { in: 'SourceGraphic' }), node('feMergeNode', { in: 'shine' })),
    ),
  );
  const previous = svg.getAttribute('filter');
  svg.prepend(defs);
  svg.setAttribute('filter', `url(#${id})`);
  return () => {
    defs.remove();
    if (previous === null) svg.removeAttribute('filter');
    else svg.setAttribute('filter', previous);
  };
}

class Instance implements GlassHandle {
  element: SVGSVGElement;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  own: GlassOptions;
  scope: Scope | null;
  r: ResolvedOptions;

  backdrop: Backdrop | null = null;
  private backdropSource: unknown = undefined;
  private geometry: Geometry | null = null;
  private previous: Geometry | null = null;
  private geometryKey = '';
  private token = 0;
  private sizeTimer = 0;
  private mutationQueued = false;

  private left = 0;
  private top = 0;
  private lens = 0;
  private lensFrom = 0;
  private lensTo = 1;
  private lensStart = -1;
  private morph = 1;
  private morphStart = -1;
  private press = 0;
  private pressVelocity = 0;
  private pressTarget = 0;
  private glow = 0;
  private glowTarget = 0;
  private touch: [number, number] = [0, 0];
  private light: [number, number];
  lightTarget: [number, number];
  private readonly seed = Math.random() * 100;

  onscreen = true;
  dirty = true;
  destroyed = false;
  private revealed = false;
  private drawnVersion = -1;
  private relation = '';
  /** True while the stylesheet hides the original SVG. */
  private hidden = false;
  /** The icon rasterized to nothing (an unresolved reference, say): leave the SVG alone. */
  private blank = false;
  private pressHost: Element | null = null;
  private readonly observer: MutationObserver;

  /** Layout read at the start of a frame, used when the frame writes. */
  rect: DOMRect | null = null;
  canvasRect: DOMRect | null = null;

  constructor(private engine: Engine, svg: SVGSVGElement, own: GlassOptions, scope: Scope | null) {
    this.element = svg;
    this.own = own;
    this.scope = scope;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute(OWN, '');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.width = this.canvas.height = 1;
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;visibility:hidden;transform-origin:50% 50%;max-width:none;max-height:none;margin:0;';
    this.ctx = this.canvas.getContext('2d')!;
    this.r = resolveOptions();
    this.light = lightVector(this.r.lightAngle);
    this.lightTarget = this.light;
    this.observer = new MutationObserver((records) => this.onMutation(records));
    this.attach(svg);
    this.configure();
  }

  private attach(svg: SVGSVGElement): void {
    svg.after(this.canvas);
    this.observer.observe(svg, { subtree: true, childList: true, attributes: true });
    this.engine.observe(svg);
  }

  private detach(): void {
    this.observer.disconnect();
    this.engine.unobserve(this.element);
    this.showSvg();
    this.bindPress(false);
  }

  private onMutation(records: MutationRecord[]): void {
    let rebuild = false;
    for (const record of records) {
      if (record.target === this.element && record.type === 'attributes') {
        // The icon's own style changes when a framework re-renders or an animation runs.
        // It does not change the shape; only its opacity is carried over to the glass.
        if (record.attributeName === 'style') {
          this.syncOpacity();
          continue;
        }
        // Something removed our marker (a framework replacing all attributes): put it back.
        if (record.attributeName === HIDDEN) {
          if (this.hidden && !this.element.hasAttribute(HIDDEN)) this.element.setAttribute(HIDDEN, '');
          continue;
        }
      }
      rebuild = true;
    }
    if (!rebuild || this.mutationQueued) return;
    this.mutationQueued = true;
    queueMicrotask(() => {
      this.mutationQueued = false;
      if (!this.destroyed) this.configure();
    });
  }

  /** The system settings this icon follows; all off when `accessibility` is false. */
  get system(): Engine['media'] {
    return this.r.accessibility ? this.engine.media : NO_PREFERENCES;
  }

  get inert(): boolean {
    return this.r.variant === 'identity' || this.system.forcedColors;
  }

  /** Resolve options from every layer and react to what changed. */
  configure(): void {
    const before = this.r;
    this.r = resolveOptions(this.scope?.options, readAttributes(this.element) ?? undefined, this.own);
    const r = this.r;

    const target = r.visible ? 1 : 0;
    if (target !== this.lensTo) {
      this.lensFrom = this.lens;
      this.lensTo = target;
      this.lensStart = -1;
    }
    if (before.lightAngle !== r.lightAngle || !r.pointerLight) this.lightTarget = lightVector(r.lightAngle);
    this.bindPress(r.interactive && !this.inert);
    this.bindBackdrop();
    if (this.inert) {
      this.showSvg();
      this.canvas.style.visibility = 'hidden';
    } else {
      void this.prepare();
    }
    this.dirty = true;
    this.engine.requestFrame();
  }

  private bindBackdrop(): void {
    const source = this.r.backdrop;
    if (this.backdrop && source === this.backdropSource && source !== 'auto') return;
    const next = this.inert ? null : this.engine.backdropFor(this.element, source, this.scope);
    if (next === this.backdrop) return;
    if (next) next.refs++;
    this.engine.releaseBackdrop(this.backdrop);
    this.backdrop = next;
    this.backdropSource = source;
    this.drawnVersion = -1;
  }

  private readonly onPress = (event: Event) => {
    const down = event.type === 'pointerdown';
    this.pressTarget = down ? 1 : 0;
    this.glowTarget = down ? 1 : 0;
    if (down && this.rect && this.geometry) {
      const pointer = event as PointerEvent;
      const plan = this.geometry.plan;
      this.touch = [
        pointer.clientX - (this.rect.left + this.rect.width / 2 - plan.cssW / 2),
        pointer.clientY - (this.rect.top + this.rect.height / 2 - plan.cssH / 2),
      ];
    }
    this.engine.requestFrame();
  };

  private bindPress(on: boolean): void {
    const host = on ? this.element.closest(PRESS_HOSTS) ?? this.element : null;
    if (host === this.pressHost) return;
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'pointerleave']) {
      this.pressHost?.removeEventListener(type, this.onPress);
      host?.addEventListener(type, this.onPress, { passive: true });
    }
    this.pressHost = host;
    if (!host) this.pressTarget = this.glowTarget = 0;
  }

  private hideSvg(): void {
    if (this.hidden) return;
    this.hidden = true;
    ensureStyles(this.element);
    this.element.setAttribute(HIDDEN, '');
    this.syncOpacity();
  }

  /**
   * An opacity written on the icon itself (GSAP, Motion, the Web Animations API, a
   * framework binding) applies to the glass instead. Opacity on ancestors already
   * reaches the canvas, which sits next to the icon.
   */
  private syncOpacity(): void {
    const own = parseFloat(this.element.style.opacity);
    const value = Number.isFinite(own) ? String(Math.min(1, Math.max(0, own))) : '';
    if (this.canvas.style.opacity !== value) this.canvas.style.opacity = value;
  }

  private showSvg(): void {
    if (!this.hidden) return;
    this.hidden = false;
    this.element.removeAttribute(HIDDEN);
    this.revealed = false;
  }

  /** Rasterize the icon and build its distance field. Cheap when nothing changed. */
  private async prepare(): Promise<void> {
    if (this.destroyed || this.inert) return;
    const rect = this.element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return; // not laid out yet; the resize observer calls again
    const plan = planRaster(rect.width, rect.height, this.engine.dpr(this.r.maxDpr));
    let source: string;
    try {
      source = await serializeIcon(this.element, this.r.strokeWidth);
      if (this.destroyed) return;
    } catch (error) {
      console.warn('glassity: could not read this SVG; it is left as it is.', this.element, error);
      return;
    }
    const key = `${plan.gw}x${plan.gh}|${plan.cssW}x${plan.cssH}|${this.r.padding}|${source}`;
    if (key === this.geometryKey) return;
    this.geometryKey = key;
    const token = ++this.token;

    let geometry: Geometry;
    try {
      geometry = await this.engine.acquireGeometry(key, source, plan, this.r.padding);
    } catch (error) {
      if (token === this.token) {
        this.geometryKey = '';
        console.warn('glassity: could not rasterize this SVG; it is left as it is.', this.element, error);
      }
      return;
    }
    if (token !== this.token || this.destroyed) {
      this.engine.releaseGeometry(geometry);
      return;
    }
    // Nothing drawn (a reference that cannot be resolved, an empty icon): hiding the
    // original would make the icon vanish, so it stays as it is.
    this.blank = geometry.empty;
    if (geometry.empty) {
      this.engine.releaseGeometry(geometry);
      this.engine.releaseGeometry(this.geometry);
      this.engine.releaseGeometry(this.previous);
      this.geometry = this.previous = null;
      this.showSvg();
      this.canvas.style.visibility = 'hidden';
      console.warn('glassity: this SVG draws nothing that glassity can read (an unresolved <use> or url(#…)?), so it is left as it is.', this.element);
      return;
    }

    const old = this.geometry;
    const sameFrame = old && old.plan.cssW === plan.cssW && old.plan.cssH === plan.cssH;
    this.engine.releaseGeometry(this.previous);
    this.previous = null;
    if (old && sameFrame && this.revealed && this.r.duration > 0 && !this.system.reducedMotion) {
      this.previous = old; // keep it as the shape to morph from
      this.morph = 0;
      this.morphStart = -1;
    } else {
      this.engine.releaseGeometry(old);
      this.morph = 1;
    }
    this.geometry = geometry;
    this.canvas.style.width = plan.cssW + 'px';
    this.canvas.style.height = plan.cssH + 'px';
    this.dirty = true;
    this.engine.requestFrame();
  }

  /** The SVG's box changed size. */
  resized(): void {
    clearTimeout(this.sizeTimer);
    this.sizeTimer = window.setTimeout(() => void this.prepare(), 60);
  }

  /** Advance animations and redraw if anything changed. Returns true while still animating. */
  step(now: number, dt: number, back: Rect | null): boolean {
    const rect = this.rect;
    const geometry = this.geometry;
    if (this.destroyed || this.inert || this.blank || !rect || !geometry || !this.backdrop || !back || rect.width < 1) return false;
    const { engine, r } = this;
    const plan = geometry.plan;
    const calm = this.system.reducedMotion;
    let animating = false;

    // Keep the canvas centred on the SVG by measuring, so any containing block works.
    if (this.canvasRect) {
      const dx = rect.left + rect.width / 2 - (this.canvasRect.left + this.canvasRect.width / 2);
      const dy = rect.top + rect.height / 2 - (this.canvasRect.top + this.canvasRect.height / 2);
      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
        this.left += dx;
        this.top += dy;
        this.canvas.style.left = this.left + 'px';
        this.canvas.style.top = this.top + 'px';
      }
    }

    if (this.lens !== this.lensTo) {
      if (this.lensStart < 0) this.lensStart = now;
      const t = calm || r.duration <= 0 ? 1 : clamp01((now - this.lensStart) / r.duration);
      this.lens = this.lensFrom + (this.lensTo - this.lensFrom) * ease(t);
      if (t >= 1) this.lens = this.lensTo;
      else animating = true;
      this.dirty = true;
    }

    if (this.previous) {
      if (this.morphStart < 0) this.morphStart = now;
      const t = clamp01((now - this.morphStart) / r.duration);
      this.morph = ease(t);
      this.dirty = true;
      if (t >= 1) {
        engine.releaseGeometry(this.previous);
        this.previous = null;
        this.morph = 1;
      } else animating = true;
    }

    if (calm) {
      this.press = 0;
      this.pressVelocity = 0;
    } else if (Math.abs(this.pressTarget - this.press) > 0.001 || Math.abs(this.pressVelocity) > 0.01) {
      // An underdamped spring: the glass overshoots a little and settles.
      const accel = 420 * (this.pressTarget - this.press) - 22 * this.pressVelocity;
      this.pressVelocity += accel * dt;
      this.press += this.pressVelocity * dt;
      animating = true;
    } else if (this.press !== this.pressTarget) {
      this.press = this.pressTarget;
      this.pressVelocity = 0;
    }
    const scale = 1 + 0.07 * this.press;
    this.canvas.style.transform = Math.abs(scale - 1) > 0.0005 ? `scale(${scale.toFixed(4)})` : '';

    if (Math.abs(this.glowTarget - this.glow) > 0.004) {
      this.glow += (this.glowTarget - this.glow) * (1 - Math.exp(-dt * (this.glowTarget > this.glow ? 26 : 5)));
      animating = true;
      this.dirty = true;
    } else if (this.glow !== this.glowTarget) {
      this.glow = this.glowTarget;
      this.dirty = true;
    }

    const lx = this.lightTarget[0] - this.light[0];
    const ly = this.lightTarget[1] - this.light[1];
    if (Math.abs(lx) + Math.abs(ly) > 0.003) {
      const k = calm ? 1 : 1 - Math.exp(-dt * 10);
      this.light = [this.light[0] + lx * k, this.light[1] + ly * k];
      animating = !calm;
      this.dirty = true;
    }

    const originX = rect.left + rect.width / 2 - plan.cssW / 2;
    const originY = rect.top + rect.height / 2 - plan.cssH / 2;
    const relation = `${(back.x - originX).toFixed(1)},${(back.y - originY).toFixed(1)},${back.w.toFixed(1)},${back.h.toFixed(1)}`;
    if (relation !== this.relation || this.backdrop.version !== this.drawnVersion) this.dirty = true;
    if (!this.dirty) return animating;

    if (this.lens <= 0 && this.lensTo <= 0) {
      this.canvas.style.visibility = 'hidden';
      this.hideSvg(); // `visible: false` hides the icon itself
      this.dirty = false;
      return animating;
    }

    const backTexture = engine.backTexture(this.backdrop);
    const dpr = engine.dpr(r.maxDpr);
    const pw = Math.max(1, Math.round(plan.cssW * dpr));
    const ph = Math.max(1, Math.round(plan.cssH * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }

    const { reducedTransparency, moreContrast } = this.system;
    const tintAuto = r.tint === 'auto';
    const tint = tintAuto ? ([1, 1, 1, 1] as const) : engine.color(r.tint);
    const glyphScale = 1 - 2 * r.padding;
    const fieldB = engine.fieldTexture(geometry);
    const light = this.light;
    const length = Math.hypot(light[0], light[1]) || 1;

    const ok = engine.renderer!.draw(this.ctx, pw, ph, {
      fieldA: this.previous ? engine.fieldTexture(this.previous) : fieldB,
      fieldB,
      morph: this.previous ? this.morph : 0,
      back: backTexture.texture,
      backRect: backTexture.neutral ? [-50000, -50000, 100000, 100000] : [back.x - originX, back.y - originY, back.w, back.h],
      backDensity: backTexture.neutral ? 0.00002 : this.backdrop.width / Math.max(back.w, 1),
      canvas: [plan.cssW, plan.cssH],
      box: [plan.boxW, plan.boxH],
      unit: plan.unit,
      dpr,
      profile: PROFILES[r.profile],
      bevel: r.bevel * plan.unit * (r.tile ? glyphScale : 1),
      curvature: r.curvature,
      depth: r.depth * plan.unit,
      ior: r.ior,
      refraction: r.refraction,
      dispersion: r.dispersion,
      bands: r.bands,
      frost: (reducedTransparency ? Math.max(r.frost, 0.8) : r.frost) * 0.16 * plan.unit,
      saturation: r.saturation,
      brightness: r.brightness,
      contrast: r.contrast,
      tint: [tint[0], tint[1], tint[2]],
      tintAuto: tintAuto ? 1 : 0,
      tintOpacity: (reducedTransparency ? Math.max(r.tintOpacity, 0.5) : r.tintOpacity) * tint[3],
      dim: r.dim === 'auto' ? -1 : r.dim,
      opacity: r.opacity,
      shine: r.shine,
      rim: r.rim,
      reflection: r.reflection,
      shadow: r.shadow,
      light: [light[0] / length, light[1] / length],
      scheme: r.scheme === 'auto' ? -1 : r.scheme === 'light' ? 1 : 0,
      lens: this.lens,
      touch: [this.touch[0], this.touch[1], this.glow],
      tile: r.tile ? 1 : 0,
      tileRadius: r.tileRadius * plan.unit,
      tileBevel: r.bevel * plan.unit,
      glyphOpacity: r.glyphOpacity,
      highContrast: moreContrast ? 1 : 0,
      seed: this.seed,
    });
    if (!ok) return animating;

    this.dirty = false;
    this.relation = relation;
    this.drawnVersion = this.backdrop.version;
    this.canvas.style.visibility = 'visible';
    if (!this.revealed) {
      this.revealed = true;
      this.hideSvg(); // only once the glass is really on screen
    }
    return animating;
  }

  update(options: GlassOptions): void {
    this.own = { ...this.own, ...options };
    this.configure();
  }

  set(options: GlassOptions): void {
    this.own = { ...options };
    this.configure();
  }

  retarget(svg: SVGSVGElement): void {
    if (svg === this.element || this.destroyed) return;
    const wasRevealed = this.revealed;
    this.detach();
    this.engine.rename(this.element, svg, this);
    this.element = svg;
    this.attach(svg);
    if (wasRevealed) {
      this.revealed = true;
      this.hideSvg();
    }
    this.left = this.top = 0;
    this.canvas.style.left = this.canvas.style.top = '0px';
    this.configure();
  }

  refresh(): void {
    this.geometryKey = '';
    this.backdrop?.refresh();
    this.configure();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.sizeTimer);
    this.detach();
    // A framework that is unmounting this icon may be holding the canvas as the
    // anchor for its next insertBefore (Vue does). Take it away a moment later.
    this.canvas.style.visibility = 'hidden';
    const canvas = this.canvas;
    queueMicrotask(() => canvas.remove());
    this.engine.releaseGeometry(this.geometry);
    this.engine.releaseGeometry(this.previous);
    this.engine.releaseBackdrop(this.backdrop);
    this.geometry = this.previous = null;
    this.backdrop = null;
    this.engine.forget(this);
  }
}

/** Stand-in handle when WebGL2 is missing: the SVG stays, with a soft highlight. */
class PlainHandle implements GlassHandle {
  private undo: (() => void) | null;
  constructor(public element: SVGSVGElement) {
    this.undo = applyBevel(element);
  }
  update(): void {}
  set(): void {}
  retarget(svg: SVGSVGElement): void {
    this.undo?.();
    this.element = svg;
    this.undo = applyBevel(svg);
  }
  refresh(): void {}
  destroy(): void {
    this.undo?.();
    this.undo = null;
  }
}

/** One per page: owns the WebGL context, the caches and the frame loop. */
export class Engine {
  renderer: Renderer | null;
  readonly media = { reducedMotion: false, reducedTransparency: false, moreContrast: false, forcedColors: false };
  private instances = new Map<SVGSVGElement, Instance>();
  private plain = new Map<SVGSVGElement, PlainHandle>();
  private geometries = new Map<string, Promise<Geometry>>();
  private backdrops = new WeakMap<object, Map<string, Backdrop>>();
  private backdropHomes = new WeakMap<Backdrop, { owner: object; key: string }>();
  private backStates = new WeakMap<Backdrop, BackState>();
  private neutral: { backdrop: ColorBackdrop; texture: BackTexture | null } | null = null;
  private colors = new Map<string, readonly [number, number, number, number]>();
  private colorCtx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private last = 0;
  /** Frames left to keep following something that is moving without an event. */
  private hot = 0;
  private watch = 0;
  private listening = false;
  private pointer: [number, number] | null = null;
  private intersection: IntersectionObserver | null = null;
  private resize: ResizeObserver | null = null;
  private warnedTaint = false;

  constructor() {
    this.renderer = Renderer.create();
    if (this.renderer) this.renderer.onrestore = () => this.invalidate();
    if (typeof matchMedia === 'function') {
      const watch = (query: string, key: keyof Engine['media']) => {
        const list = matchMedia(query);
        this.media[key] = list.matches;
        list.addEventListener?.('change', () => {
          this.media[key] = list.matches;
          for (const instance of this.instances.values()) instance.configure();
        });
      };
      watch('(prefers-reduced-motion: reduce)', 'reducedMotion');
      watch('(prefers-reduced-transparency: reduce)', 'reducedTransparency');
      watch('(prefers-contrast: more)', 'moreContrast');
      watch('(forced-colors: active)', 'forcedColors');
    }
  }

  // ── instances ────────────────────────────────────────────────────────────

  mount(svg: SVGSVGElement, options: GlassOptions, scope: Scope | null): GlassHandle {
    const existing = this.instances.get(svg);
    if (!existing) {
      // A copied page brings a stale canvas and marker along with the icon.
      const next = svg.nextElementSibling;
      if (next instanceof HTMLCanvasElement && next.hasAttribute(OWN)) next.remove();
      svg.removeAttribute(HIDDEN);
    }
    if (existing) {
      existing.scope = scope ?? existing.scope;
      existing.set(options);
      return existing;
    }
    if (!this.renderer) {
      let handle = this.plain.get(svg);
      if (!handle) this.plain.set(svg, (handle = new PlainHandle(svg)));
      return handle;
    }
    this.listen();
    const instance = new Instance(this, svg, options, scope);
    this.instances.set(svg, instance);
    return instance;
  }

  get(svg: SVGSVGElement): GlassHandle | undefined {
    return this.instances.get(svg) ?? this.plain.get(svg);
  }

  /** Every glass that belongs to `scope`. */
  inScope(scope: Scope): Instance[] {
    return [...this.instances.values()].filter((instance) => instance.scope === scope);
  }

  rename(from: SVGSVGElement, to: SVGSVGElement, instance: Instance): void {
    this.instances.delete(from);
    this.instances.set(to, instance);
  }

  forget(instance: Instance): void {
    if (this.instances.get(instance.element) === instance) this.instances.delete(instance.element);
    if (!this.instances.size) this.unlisten();
  }

  /**
   * Remove what a copy of the page left behind (Turbo, swup and Barba cache pages by
   * cloning them): canvases no glass owns, and hidden markers on icons no glass draws.
   */
  sweep(root: ParentNode): void {
    const owned = new Set<Element>();
    for (const instance of this.instances.values()) owned.add(instance.canvas);
    for (const canvas of Array.from(root.querySelectorAll(`canvas[${OWN}]`))) if (!owned.has(canvas)) canvas.remove();
    for (const el of Array.from(root.querySelectorAll(`[${HIDDEN}]`)))
      if (!(el instanceof SVGSVGElement && this.instances.has(el))) el.removeAttribute(HIDDEN);
  }

  /** True for nodes glassity writes to itself. */
  readonly isOwn = (node: Node): boolean => {
    if (!(node instanceof Element)) return node.parentElement ? this.isOwn(node.parentElement) : false;
    return node.hasAttribute(OWN) || (node instanceof SVGSVGElement && this.instances.has(node));
  };

  observe(svg: SVGSVGElement): void {
    this.intersection?.observe(svg);
    this.resize?.observe(svg);
  }

  unobserve(svg: SVGSVGElement): void {
    this.intersection?.unobserve(svg);
    this.resize?.unobserve(svg);
  }

  dpr(max: number): number {
    return Math.min(window.devicePixelRatio || 1, max);
  }

  // ── frame loop ───────────────────────────────────────────────────────────

  readonly requestFrame = (): void => {
    if (!this.raf && this.instances.size) this.raf = requestAnimationFrame(this.frame);
  };

  invalidate(): void {
    for (const instance of this.instances.values()) instance.dirty = true;
    this.requestFrame();
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;

    // Read all layout first, then write, so the browser lays out once per frame.
    const active: Instance[] = [];
    const rects = new Map<Backdrop, Rect>();
    let live = false;
    let moved = false;
    for (const instance of this.instances.values()) {
      if (!instance.onscreen || instance.inert) continue;
      const rect = instance.element.getBoundingClientRect();
      const was = instance.rect;
      if (was && (Math.abs(was.left - rect.left) > 0.2 || Math.abs(was.top - rect.top) > 0.2 || Math.abs(was.width - rect.width) > 0.2)) moved = true;
      instance.rect = rect;
      instance.canvasRect = instance.canvas.getBoundingClientRect();
      const backdrop = instance.backdrop;
      if (backdrop && !rects.has(backdrop)) {
        backdrop.tick();
        rects.set(backdrop, backdrop.rect());
        live = live || backdrop.live;
      }
      active.push(instance);
    }

    let again = live;
    for (const instance of active) {
      const back = instance.backdrop ? rects.get(instance.backdrop) ?? null : null;
      again = instance.step(now, dt, back) || again;
    }
    // Layout can move an icon without any event (a sibling grows, a CSS transition
    // runs). Once movement is seen it is followed every frame for a moment; when
    // all is still, a slow check keeps watching.
    if (moved) this.hot = 20;
    else if (this.hot > 0) this.hot--;
    if (again || this.hot > 0) this.requestFrame();
    else {
      this.last = 0;
      clearTimeout(this.watch);
      if (this.instances.size && !document.hidden) this.watch = window.setTimeout(this.requestFrame, 160);
    }
  };

  private readonly onPointer = (event: PointerEvent): void => {
    this.pointer = event.type === 'pointerleave' || event.type === 'blur' ? null : [event.clientX, event.clientY];
    let changed = false;
    for (const instance of this.instances.values()) {
      if (!instance.onscreen || !instance.r.pointerLight || !instance.rect || instance.system.reducedMotion) continue;
      const base = lightVector(instance.r.lightAngle);
      let target = base;
      if (this.pointer) {
        const rect = instance.rect;
        const dx = this.pointer[0] - (rect.left + rect.width / 2);
        const dy = this.pointer[1] - (rect.top + rect.height / 2);
        const distance = Math.hypot(dx, dy);
        const reach = Math.max(180, Math.min(rect.width, rect.height) * 4);
        let near = distance < 1 ? 0 : clamp01(1 - distance / reach);
        near = near * near * (3 - 2 * near) * 0.85;
        if (near > 0) target = [base[0] + (dx / distance - base[0]) * near, base[1] + (dy / distance - base[1]) * near];
      }
      if (Math.abs(target[0] - instance.lightTarget[0]) + Math.abs(target[1] - instance.lightTarget[1]) > 0.002) {
        instance.lightTarget = target;
        changed = true;
      }
    }
    if (changed) this.requestFrame();
  };

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('scroll', this.requestFrame, { capture: true, passive: true });
    window.addEventListener('resize', this.requestFrame, { passive: true });
    document.addEventListener('visibilitychange', this.requestFrame);
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    document.documentElement.addEventListener('pointerleave', this.onPointer, { passive: true });
    if (typeof IntersectionObserver !== 'undefined')
      this.intersection = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const instance = this.instances.get(entry.target as SVGSVGElement);
            if (!instance) continue;
            instance.onscreen = entry.isIntersecting;
            if (entry.isIntersecting) instance.dirty = true;
          }
          this.requestFrame();
        },
        { rootMargin: '120px' },
      );
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver((entries) => {
        for (const entry of entries) this.instances.get(entry.target as SVGSVGElement)?.resized();
        this.requestFrame(); // also fires for <html>: content moved without a scroll event
      });
      this.resize.observe(document.documentElement);
    }
  }

  private unlisten(): void {
    if (!this.listening) return;
    this.listening = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('scroll', this.requestFrame, { capture: true });
    window.removeEventListener('resize', this.requestFrame);
    document.removeEventListener('visibilitychange', this.requestFrame);
    clearTimeout(this.watch);
    window.removeEventListener('pointermove', this.onPointer);
    document.documentElement.removeEventListener('pointerleave', this.onPointer);
    this.intersection?.disconnect();
    this.resize?.disconnect();
    this.intersection = null;
    this.resize = null;
  }

  // ── geometry cache ───────────────────────────────────────────────────────

  async acquireGeometry(key: string, source: string, plan: RasterPlan, padding: number): Promise<Geometry> {
    let pending = this.geometries.get(key);
    if (!pending) {
      pending = rasterAlpha(source, plan, padding).then((alpha) => {
        let opaque = false;
        for (let i = 0; i < alpha.length && !opaque; i++) opaque = alpha[i] > 127;
        return {
          key,
          plan,
          data: buildField(alpha, plan.gw, plan.gh, plan.unit * plan.scale),
          empty: !opaque,
          refs: 0,
          texture: null,
        };
      });
      this.geometries.set(key, pending);
      pending.catch(() => this.geometries.delete(key));
    }
    const geometry = await pending;
    geometry.refs++;
    return geometry;
  }

  releaseGeometry(geometry: Geometry | null): void {
    if (!geometry || --geometry.refs > 0) return;
    this.geometries.delete(geometry.key);
    this.renderer?.release(geometry.texture);
    geometry.texture = null;
  }

  fieldTexture(geometry: Geometry): FieldTexture {
    const renderer = this.renderer!;
    if (!geometry.texture || geometry.texture.generation !== renderer.generation)
      geometry.texture = renderer.createField(geometry.data, geometry.plan.gw, geometry.plan.gh);
    return geometry.texture;
  }

  // ── backdrops ────────────────────────────────────────────────────────────

  private cachedBackdrop(owner: object, key: string, make: () => Backdrop): Backdrop {
    let byKey = this.backdrops.get(owner);
    if (!byKey) this.backdrops.set(owner, (byKey = new Map()));
    let backdrop = byKey.get(key);
    if (!backdrop) {
      backdrop = make();
      backdrop.onchange = () => this.invalidate();
      byKey.set(key, backdrop);
      this.backdropHomes.set(backdrop, { owner, key });
    }
    return backdrop;
  }

  /** Decide what an icon refracts. See `BackdropSource`. */
  backdropFor(svg: SVGSVGElement, source: ResolvedOptions['backdrop'], scope: Scope | null): Backdrop {
    const maxSize = Math.min(this.renderer?.maxTextureSize ?? 2048, 2560);
    const snap = (el: Element, mode: 'background' | 'dom') =>
      this.cachedBackdrop(el, mode, () => new SnapshotBackdrop(el, { mode, maxSize, isOwn: this.isOwn }));
    const container = scope?.root ?? null;

    if (source === 'none') {
      const color = pageColor(svg);
      return this.cachedBackdrop(this, 'color:' + color, () => new ColorBackdrop(color));
    }
    if (typeof source === 'string' && source !== 'auto')
      return this.cachedBackdrop(container ?? this, 'url:' + source, () => new UrlBackdrop(source, container));
    if (source instanceof HTMLImageElement || source instanceof HTMLVideoElement || source instanceof HTMLCanvasElement)
      return this.cachedBackdrop(source, 'media', () => new MediaBackdrop(source));
    if (source instanceof Element) return snap(source, 'dom');

    const surface = nearestSurface(svg);
    if (surface) return snap(surface.el, surface.mode);
    return snap(container ?? document.body, 'dom');
  }

  releaseBackdrop(backdrop: Backdrop | null): void {
    if (!backdrop || --backdrop.refs > 0) return;
    const home = this.backdropHomes.get(backdrop);
    if (home) this.backdrops.get(home.owner)?.delete(home.key);
    this.renderer?.release(this.backStates.get(backdrop)?.texture ?? null);
    this.backStates.delete(backdrop);
    backdrop.dispose();
  }

  /** The GPU texture for a backdrop, uploaded again only when its pixels changed. */
  backTexture(backdrop: Backdrop): { texture: BackTexture; neutral: boolean } {
    const renderer = this.renderer!;
    let state = this.backStates.get(backdrop);
    if (!state) this.backStates.set(backdrop, (state = { texture: null, version: -1, failed: false }));
    if (backdrop.source && !state.failed) {
      const stale = !state.texture || state.texture.generation !== renderer.generation || state.version !== backdrop.version;
      if (stale) {
        try {
          state.texture = renderer.uploadBack(state.texture, backdrop.source, backdrop.width, backdrop.height);
          state.version = backdrop.version;
        } catch (error) {
          state.failed = true;
          if (!this.warnedTaint) {
            this.warnedTaint = true;
            console.warn('glassity: the backdrop cannot be read (cross-origin without CORS?). Using a flat colour instead.', error);
          }
        }
      }
      if (state.texture && !state.failed) return { texture: state.texture, neutral: false };
    }
    if (!this.neutral) this.neutral = { backdrop: new ColorBackdrop('#8a8f98'), texture: null };
    if (!this.neutral.texture || this.neutral.texture.generation !== renderer.generation)
      this.neutral.texture = renderer.uploadBack(null, this.neutral.backdrop.source!, 2, 2);
    return { texture: this.neutral.texture, neutral: true };
  }

  // ── colours ──────────────────────────────────────────────────────────────

  /** Parse any CSS colour to 0–1 RGBA. Unknown colours come back white. */
  color(css: string): readonly [number, number, number, number] {
    let known = this.colors.get(css);
    if (known) return known;
    if (!this.colorCtx) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      this.colorCtx = canvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = this.colorCtx;
    known = [1, 1, 1, 1];
    if (ctx) {
      ctx.fillStyle = '#010203';
      ctx.fillStyle = css;
      if (ctx.fillStyle !== '#010203' || css.replace(/\s/g, '').toLowerCase() === '#010203') {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        known = [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
      } else console.warn(`glassity: "${css}" is not a colour; using white.`);
    }
    this.colors.set(css, known);
    return known;
  }
}

const KEY = Symbol.for('glassity.engine@' + __VERSION__);

/** The page's engine, created on first use. Shared by every entry point of the package. */
export function getEngine(): Engine {
  const store = globalThis as unknown as Record<symbol, Engine | undefined>;
  return (store[KEY] ??= new Engine());
}
