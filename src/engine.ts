import { Backdrop, ColorBackdrop, MediaBackdrop, nearestSurface, SnapshotBackdrop, UrlBackdrop, type Rect } from './backdrop';
import { buildFieldAsync } from './core/field-work';
import { CaptureQueue } from './capture-queue';
import { captureRegion, intersects } from './capture-region';
import { canHostSurface, SurfaceLayer, type GlassElement, type SurfaceMap } from './surface';
import { mapInto } from './surface-space';
import { surfaceDpr } from './core/surface';
import { parseLayers } from './core/layers';
import { LayerStack } from './layers';
import { buildField } from './core/field';
import { planRaster, rasterAlpha, serializeIcon, type RasterPlan } from './core/raster';
import { Renderer, type BackTexture, type FieldTexture, type DrawParams } from './gl/renderer';
import { readAttributes, resolveOptions, type GlassOptions, type ResolvedOptions } from './options';
import { pageColor } from './snapshot';
import { approachAmount, glyphSize, legibilityTarget, stableAmount, type LegibilityHistory, type RGB, type RGBA } from './core/legibility';
import { BackdropSampler } from './backdrop-sample';
import { StyleWatch } from './style-watch';
import { ScopeRegistry, type Scope } from './scopes';
import { FieldSequence, captureFrame } from './motion/fields';
import { SequenceTimeline, type SequenceController, type SequenceOptions, type SequenceShape } from './motion/sequence';
import { InteractionState } from './motion/interaction';
import { TouchLight } from './motion/touch-light';
import { prepareText, textTarget, type TextSource } from './text';
import { watchTextFonts } from './text-fonts';

export type { Scope } from './scopes';
import { ensureStyles, HIDDEN, OWN, SURFACE, SURFACE_ACTIVE, parentOf } from './dom';

/** Control over one glass icon or HTML surface. */
export interface GlassHandle {
  /** The SVG, HTML surface or text element this glass is drawn for. */
  readonly element: GlassElement;
  /** Change some options; the rest keep their current values. */
  update(options: GlassOptions): void;
  /** Replace all options given in code (attributes and provider options still apply). */
  set(options: GlassOptions): void;
  /** Move to another SVG, HTML surface or text element; shapes morph when their boxes match. */
  retarget(svg: GlassElement): void;
  /** Re-read the icon and the backdrop. */
  refresh(): void;
  /** Preload and control a morph sequence without changing the source SVG. */
  sequence(shapes: readonly SequenceShape[], options?: SequenceOptions): SequenceController;
  /** Remove the glass and restore the original paint. */
  destroy(): void;
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
  failures: number;
  retryAt: number;
  generation: number;
  source: TexImageSource | null;
  sourceKey: string;
}

const PRESS_HOSTS = 'button,a,[role="button"],summary,label';
const NO_PREFERENCES = { reducedMotion: false, reducedTransparency: false, moreContrast: false, forcedColors: false };
const PROFILES = { squircle: 0, circle: 1, lip: 2, dome: 3 } as const;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function lightVector(degrees: number): [number, number] {
  const a = (degrees * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

let bevelId = 0;

/** Without WebGL2 the icon stays a plain SVG with a soft highlight, so nothing disappears. */
function applyBevel(svg: GlassElement): () => void {
  if (!(svg instanceof SVGSVGElement)) return () => {};
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
  element: GlassElement;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private surface: SurfaceLayer | null = null;
  private surfaceShape = '';
  private surfaceMap: SurfaceMap | undefined;
  private surfaceBackRect: Rect | undefined;
  own: GlassOptions;
  scope: Scope | null;
  r: ResolvedOptions;
  private optionLayers: GlassOptions[] = [];

  backdrop: Backdrop | null = null;
  private backdropSource: unknown = undefined;
  private geometry: Geometry | null = null;
  private layerStack: LayerStack | null = null;
  private previous: Geometry | null = null;
  private geometryKey = '';
  private token = 0;
  /** Counts prepare() calls, so an older one that finishes reading the SVG late cannot win. */
  private request = 0;
  private sizeTimer = 0;
  private stopFonts: (() => void) | null = null;
  private mutationQueued = false;
  styleDirty = true;
  private surroundingsDirty = true;
  private currentColor: RGBA = [0, 0, 0, 1];
  private legibilityColor: RGB = [0, 0, 0];
  private legibilityColorGoal: RGB = [0, 0, 0];
  private legibilityHistory: LegibilityHistory | null = null;
  private legibilityMoving = false;
  private legibilityAmount = 0;
  private legibilityGoal: number | null = null;
  private legibilitySample = '';


  private textScale: readonly [number, number] = [1, 1];
  private left = 0;
  private top = 0;
  private lens = 0;
  private lensFrom = 0;
  private lensTo = 1;
  private lensStart = -1;
  private morph = 1;
  private morphStart = -1;
  private motionSequence: FieldSequence | null = null;
  private sequenceSource: Promise<string> | null = null;
  private sequenceVisual = false;
  private readonly interaction = new InteractionState(
    () => { this.dirty = true; this.engine.requestFrame(); },
    ({ x, y }) => {
      if (!this.system.reducedMotion) this.engine.touchLight.emit(x, y, performance.now());
      this.engine.requestFrame();
    },
  );
  private touchLightStrength = 0;
  private interactionMoving = false;
  private light: [number, number];
  lightTarget: [number, number];
  private readonly seed = Math.random() * 100;

  onscreen = true;
  dirty = true;
  destroyed = false;
  private revealed = false;
  private drawnVersion = -1;
  private relation = '';
  /**
   * Keep the canvas next to the icon. Some frameworks hand over an element before it
   * is in the page (Solid directives, ref callbacks), and an icon can be moved to
   * another parent; the canvas follows once there is a parent to follow into.
   */
  place(): void {
    if (this.surface) { this.surface.place(); return; }
    const parent = this.element.parentNode;
    if (parent && this.canvas.parentNode !== parent) this.element.after(this.canvas);
  }

  /** True while the stylesheet hides the original SVG. */
  private hidden = false;
  /** The icon rasterized to nothing (an unresolved reference, say): leave the SVG alone. */
  private blank = false;
  private readonly observer: MutationObserver;

  /** Layout read at the start of a frame, used when the frame writes. */
  rect: DOMRect | null = null;
  canvasRect: DOMRect | null = null;

  constructor(private engine: Engine, svg: GlassElement, own: GlassOptions, scope: Scope | null) {
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

  private attach(svg: GlassElement): void {
    // An HTML element is a surface unless it is marked as text.
    const isText = this.isText(svg);
    this.surface = svg instanceof HTMLElement && !isText ? new SurfaceLayer(svg, this.canvas) : null;
    this.surfaceShape = '';
    this.surfaceMap = undefined;
    this.surfaceBackRect = undefined;
    this.canvas.style.zIndex = '';
    // A new target (retarget) may sit elsewhere in the same parent, for example after
    // React replaced the node: keep the canvas right after the icon it draws.
    if (!this.surface && svg.parentNode && svg.nextSibling !== this.canvas) svg.after(this.canvas);
    else this.place();
    this.observer.observe(svg, { subtree: true, childList: true, attributes: true, characterData: true });
    if (svg instanceof HTMLElement) this.stopFonts = watchTextFonts(svg.ownerDocument, () => this.refresh());
    this.engine.observe(svg);
  }

  /** Text is chosen by every layer (page, scope, attributes, own), as glassify() and auto() choose it. */
  private isText(svg: GlassElement): svg is HTMLElement {
    if (!(svg instanceof HTMLElement)) return false;
    const text = resolveOptions(...this.engine.scopes.layers(svg), readAttributes(svg) ?? undefined, this.own).text;
    return !!textTarget(svg, text);
  }

  private detach(): void {
    this.observer.disconnect();
    this.stopFonts?.();
    this.stopFonts = null;
    this.engine.unobserve(this.element);
    this.showSvg();
    this.surface?.destroy();
    this.interaction.bind(null);
  }

  private onMutation(records: MutationRecord[]): void {
    let rebuild = false;
    for (const record of records) {
      if (record.target instanceof Element && record.target.hasAttribute(OWN)) continue;
      if (record.attributeName === SURFACE || record.attributeName === SURFACE_ACTIVE) continue;
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every((node) => node instanceof Element && node.hasAttribute(OWN))) continue;
      if (record.target === this.element && record.type === 'attributes') {
        // The icon's own style changes when a framework re-renders or an animation runs.
        // It does not change the shape; only its opacity is carried over to the glass.
        if (record.attributeName === 'style') {
          this.syncOpacity();
          if (this.element instanceof SVGSVGElement) continue;
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

  /**
   * The system settings this icon follows; all off when `accessibility` is false,
   * except forced colours: a High Contrast user's colours always win over the glass.
   */
  get system(): Engine['media'] {
    if (this.r.accessibility) return this.engine.media;
    return this.engine.media.forcedColors ? { ...NO_PREFERENCES, forcedColors: true } : NO_PREFERENCES;
  }

  get inert(): boolean {
    return this.r.variant === 'identity' || this.system.forcedColors || (!!this.surface && !this.r.surface) || (this.element instanceof HTMLElement && !this.surface && !this.r.text);
  }

  /** Moving an icon or a scope can change inheritance without changing its own attributes. */
  syncScope(): void {
    const layers = this.engine.scopes.layers(this.element);
    if (layers.length !== this.optionLayers.length || layers.some((layer, i) => layer !== this.optionLayers[i])) this.configure();
  }

  /** Resolve options from every layer and react to what changed. */
  configure(): void {
    this.styleDirty = true;
    this.legibilitySample = '';
    const before = this.r;
    this.optionLayers = this.engine.scopes.layers(this.element);
    this.r = resolveOptions(...this.optionLayers, readAttributes(this.element) ?? undefined, this.own);
    const r = this.r;

    const target = r.visible ? 1 : 0;
    if (target !== this.lensTo) {
      this.lensFrom = this.lens;
      this.lensTo = target;
      this.lensStart = -1;
    }
    if (before.lightAngle !== r.lightAngle || !r.pointerLight) this.lightTarget = lightVector(r.lightAngle);
    this.interaction.bind(r.interactive && r.interaction !== 'none' && !this.inert ? this.element.closest(PRESS_HOSTS) ?? this.element : null);
    this.bindBackdrop();
    if (this.inert) {
      this.request++;
      this.token++;
      this.showSvg();
      this.surface?.destroy();
      this.canvas.style.visibility = 'hidden';
    } else {
      void this.prepare();
    }
    this.dirty = true;
    this.engine.requestFrame();
  }

  private bindBackdrop(): void {
    const source = this.r.backdrop;
    if (this.backdrop && source === this.backdropSource && source !== 'auto' && source !== 'none' && !(this.backdrop instanceof SnapshotBackdrop)) return;
    const next = this.inert ? null : this.engine.backdropFor(this.element, source, this.scope);
    if (next === this.backdrop) return;
    if (next instanceof SnapshotBackdrop && this.backdrop instanceof SnapshotBackdrop) next.keepLast(this.backdrop);
    if (next) next.refs++;
    this.engine.releaseBackdrop(this.backdrop);
    this.backdrop = next;
    this.backdropSource = source;
    this.drawnVersion = -1;
  }

  syncRegion(rect: DOMRect): void {
    if (this.backdrop instanceof SnapshotBackdrop && this.backdrop.needsRegion(rect)) this.bindBackdrop();
  }

  styleChanged(surroundings: boolean): void {
    this.styleDirty = true;
    this.surroundingsDirty ||= surroundings;
    if (this.element instanceof HTMLElement) {
      clearTimeout(this.sizeTimer);
      this.sizeTimer = window.setTimeout(() => void this.prepare(), 60);
    }
  }

  /** Read event-invalidated colour and surroundings before the frame writes. */
  syncStyle(): boolean {
    this.styleDirty = false;
    if (this.r.tint === 'currentColor' || (this.r.tint === 'auto' && this.r.legibility === 'auto'))
      this.currentColor = this.engine.color(getComputedStyle(this.element).color);
    const surroundings = this.surroundingsDirty;
    if (surroundings) this.bindBackdrop();
    this.surroundingsDirty = false;
    this.legibilitySample = '';
    if (this.r.layers) void this.prepare();
    this.dirty = true;
    return surroundings;
  }

  private hideSvg(): void {
    if (this.surface) { this.surface.reveal(); return; }
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
    if (this.surface) { this.canvas.style.opacity = ''; return; }
    const own = parseFloat(this.element.style.opacity);
    const value = Number.isFinite(own) ? String(Math.min(1, Math.max(0, own))) : '';
    if (this.canvas.style.opacity !== value) this.canvas.style.opacity = value;
  }

  private showSvg(): void {
    if (this.surface) { this.surface.suspend(); this.revealed = false; return; }
    if (!this.hidden) return;
    this.hidden = false;
    this.element.removeAttribute(HIDDEN);
    this.revealed = false;
  }

  /** Keep the original visible until a complete GPU draw succeeds again. */
  suspend(): void {
    this.showSvg();
    this.surface?.destroy();
    this.canvas.style.visibility = 'hidden';
    this.dirty = true;
  }

  /** Rasterize the icon and build its distance field. Cheap when nothing changed. */
  private async prepare(): Promise<void> {
    if (this.destroyed || this.inert) return;
    const request = ++this.request;
    this.place();
    const rect = this.element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      if (this.element instanceof HTMLElement && !this.surface) {
        this.request++;
        this.clearText();
      }
      return; // not laid out yet; the resize observer calls again
    }
    const layers = this.surface || this.element instanceof HTMLElement ? [] : parseLayers(this.element as SVGSVGElement, this.r);
    const weight = Math.max(this.r.weight, ...layers.map((layer) => layer.options.weight));
    const surface = this.surface?.measure();
    let plan: RasterPlan = planRaster(surface?.width ?? rect.width, surface?.height ?? rect.height, this.engine.dpr(this.surface ? Math.min(1.5, this.r.maxDpr) : this.r.maxDpr), weight);
    const padding = this.surface ? 0 : this.r.padding;
    if (layers.length) {
      ++this.token;
      let stack: LayerStack;
      try {
        stack = await LayerStack.create(this.engine, layers, plan, this.element as SVGSVGElement, () => !this.destroyed && request === this.request);
      } catch (error) {
        if (request === this.request) console.warn('glassity: could not rasterize the layers; keeping the current icon.', error);
        return;
      }
      if (this.destroyed || request !== this.request) {
        stack.release();
        return;
      }
      this.layerStack?.release();
      this.engine.releaseGeometry(this.geometry);
      this.engine.releaseGeometry(this.previous);
      this.geometry = this.previous = null;
      this.geometryKey = '';
      this.layerStack = stack;
      this.blank = stack.empty;
      this.morph = 1;
      this.canvas.style.width = plan.cssW + 'px';
      this.canvas.style.height = plan.cssH + 'px';
      if (stack.empty) this.suspend();
      this.dirty = true;
      this.engine.requestFrame();
      return;
    }
    let source: string;
    let text: TextSource | undefined;
    try {
      if (surface) source = surface.source;
      else if (this.element instanceof HTMLElement) {
        text = await prepareText(this.element, this.engine.dpr(this.r.maxDpr), this.r.weight, this.engine.renderer?.maxTextureSize ?? 2048);
        ({ source, plan } = text);
      } else source = await serializeIcon(this.element, this.r.strokeWidth);
      // A newer read owns the current content (a slow SVG reference, a font or layout change).
      if (this.destroyed || request !== this.request) return;
    } catch (error) {
      if (this.destroyed || request !== this.request) return;
      if (this.element instanceof HTMLElement && !this.surface) this.clearText();
      console.warn('glassity: could not read this source; it is left as it is.', this.element, error);
      return;
    }
    const key = `${plan.gw}x${plan.gh}|${plan.cssW}x${plan.cssH}|${padding}|${source}`;
    if (key === this.geometryKey && this.geometry?.key === key && !this.layerStack && !this.motionSequence) return;
    const sequence = this.motionSequence;
    if ((sequence || this.sequenceVisual) && this.sequenceSource) {
      const original = await this.sequenceSource;
      if (this.destroyed || request !== this.request || sequence !== this.motionSequence) return;
      // The first ResizeObserver notification can arrive after sequence() preloads.
      if (source === original) {
        sequence?.reframe(plan, this.r.padding, this.r.strokeWidth);
        if (!sequence && this.geometry) {
          const frozen = captureFrame({ from: this.geometry, to: this.geometry, mix: 0 }, plan);
          this.engine.releaseGeometry(this.geometry);
          this.geometry = frozen;
          this.canvas.style.width = plan.cssW + 'px';
          this.canvas.style.height = plan.cssH + 'px';
          this.dirty = true;
          this.engine.requestFrame();
        }
        this.geometryKey = key;
        return;
      }
    }
    this.motionSequence?.controller.cancel();
    this.sequenceVisual = false;
    this.geometryKey = key;
    const token = ++this.token;

    let geometry: Geometry;
    try {
      geometry = await this.engine.acquireGeometry(key, source, plan, padding, text ? () => text!.raster(padding) : undefined);
    } catch (error) {
      if (token === this.token) {
        this.geometryKey = '';
        if (this.element instanceof HTMLElement && !this.surface) this.clearText();
        console.warn('glassity: could not rasterize this source; it is left as it is.', this.element, error);
      }
      return;
    }
    if (token !== this.token || request !== this.request || this.destroyed) {
      this.engine.releaseGeometry(geometry);
      return;
    }
    // Nothing drawn (a reference that cannot be resolved, an empty icon): hiding the
    // original would make the icon vanish, so it stays as it is.
    this.layerStack?.release();
    this.layerStack = null;
    this.blank = geometry.empty;
    if (geometry.empty) {
      this.engine.releaseGeometry(geometry);
      this.engine.releaseGeometry(this.geometry);
      this.engine.releaseGeometry(this.previous);
      this.geometry = this.previous = null;
      this.showSvg();
      this.canvas.style.visibility = 'hidden';
      console.warn('glassity: this source draws nothing that glassity can read, so it is left as it is.', this.element);
      return;
    }

    this.freezeMorph();
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
    this.textScale = text?.parentScale ?? [1, 1];
    this.canvas.style.width = plan.cssW / this.textScale[0] + 'px';
    this.canvas.style.height = plan.cssH / this.textScale[1] + 'px';
    this.surface?.position(plan);
    this.dirty = true;
    this.engine.requestFrame();
  }

  /** Read local geometry even when only a corner radius or CSS transform changed. */
  syncSurface(rect: DOMRect): void {
    if (!this.surface) return;
    const box = this.surface.measure();
    const shape = box.source + '|' + this.engine.dpr(this.r.maxDpr);
    if (shape !== this.surfaceShape) {
      this.surfaceShape = shape;
      void this.prepare();
    }
    if (this.geometry) {
      this.surface.position(this.geometry.plan);
      const viewport = this.surface.mapping(this.geometry.plan, rect);
      const space = this.backdrop?.space();
      this.surfaceMap = space ? mapInto(viewport, space.map) : viewport;
      this.surfaceBackRect = space ? { x: 0, y: 0, w: space.width, h: space.height } : undefined;
    }
  }

  /** A failed text update must reveal the current DOM, not keep an obsolete word. */
  private clearText(): void {
    this.token++;
    this.geometryKey = '';
    this.blank = true;
    this.engine.releaseGeometry(this.geometry);
    this.engine.releaseGeometry(this.previous);
    this.geometry = this.previous = null;
    this.suspend();
  }

  /** The source's box changed size. */
  resized(): void {
    this.styleChanged(true);
    clearTimeout(this.sizeTimer);
    this.sizeTimer = window.setTimeout(() => void this.prepare(), 60);
  }

  /** Advance animations and redraw if anything changed. Returns true while still animating. */
  step(now: number, dt: number, back: Rect | null): boolean {
    const rect = this.rect;
    const sequenceFrame = this.motionSequence?.frame;
    const geometry = sequenceFrame?.to ?? this.layerStack?.geometry ?? this.geometry;
    if (this.destroyed || this.inert || this.blank || !rect || !geometry || !this.backdrop || !back || rect.width < 1) return false;
    if (this.surfaceBackRect) back = this.surfaceBackRect;
    const { engine, r } = this;
    const plan = geometry.plan;
    const calm = this.system.reducedMotion;
    this.place();
    let animating = false;

    // Keep the canvas centred on the SVG by measuring, so any containing block works.
    if (!this.surface && this.canvasRect) {
      const dx = rect.left + rect.width / 2 - (this.canvasRect.left + this.canvasRect.width / 2);
      const dy = rect.top + rect.height / 2 - (this.canvasRect.top + this.canvasRect.height / 2);
      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
        this.left += dx / this.textScale[0];
        this.top += dy / this.textScale[1];
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

    if (this.previous && !sequenceFrame) {
      if (this.morphStart < 0) this.morphStart = now;
      const t = calm || r.duration <= 0 ? 1 : clamp01((now - this.morphStart) / r.duration);
      this.morph = ease(t);
      this.dirty = true;
      if (t >= 1) {
        engine.releaseGeometry(this.previous);
        this.previous = null;
        this.morph = 1;
      } else animating = true;
    }

    this.interactionMoving = this.interaction.step(dt, calm, r.interaction);
    if (this.interactionMoving) {
      animating = true;
      this.dirty = true;
    }

    const lx = this.lightTarget[0] - this.light[0];
    const ly = this.lightTarget[1] - this.light[1];
    if (Math.abs(lx) + Math.abs(ly) > 0.003) {
      const k = calm ? 1 : 1 - Math.exp(-dt * 10);
      this.light = [this.light[0] + lx * k, this.light[1] + ly * k];
      animating ||= !calm;
      this.dirty = true;
    }

    const originX = rect.left + rect.width / 2 - plan.cssW / 2;
    const originY = rect.top + rect.height / 2 - plan.cssH / 2;
    const touchLight = calm ? { x: 0, y: 0, strength: 0 } : engine.touchLight.sample(rect, now);
    if (touchLight.strength !== this.touchLightStrength) this.dirty = true;
    this.touchLightStrength = touchLight.strength;
    const mapping = this.surfaceMap;
    const relation = (mapping ? [...mapping.basis, ...mapping.offset].join(',') + '|' : '') + `${(back.x - originX).toFixed(1)},${(back.y - originY).toFixed(1)},${back.w.toFixed(1)},${back.h.toFixed(1)}`;
    if (relation !== this.relation || this.backdrop.version !== this.drawnVersion || engine.backdropNeedsRetry(this.backdrop, now)) this.dirty = true;
    if (!this.dirty) return animating;

    if (this.lens <= 0 && this.lensTo <= 0) {
      this.canvas.style.visibility = 'hidden';
      this.hideSvg(); // `visible: false` hides the icon itself
      this.dirty = false;
      return animating;
    }

    const backTexture = engine.backTexture(this.backdrop);
    const dpr = this.surface ? surfaceDpr(engine.dpr(r.maxDpr), plan.cssW, plan.cssH, Math.min(2048, engine.renderer!.maxTextureSize)) : engine.dpr(r.maxDpr);
    const pw = Math.max(1, Math.round(plan.cssW * dpr));
    const ph = Math.max(1, Math.round(plan.cssH * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }

    const { reducedTransparency, moreContrast } = this.system;
    const tintAuto = r.tint === 'auto';
    const tint = tintAuto ? ([1, 1, 1, 1] as const) : r.tint === 'currentColor' ? this.currentColor : engine.color(r.tint);
    const glyphScale = 1 - 2 * r.padding;
    const effectiveSize = glyphSize(plan.unit, r.padding);
    if (!this.surface && tintAuto && r.legibility === 'auto' && effectiveSize < 38) {
      const sampleKey = relation + '|' + this.backdrop.version + '|' + backTexture.neutral + '|' + effectiveSize;
      if (sampleKey !== this.legibilitySample) {
        const ambient = engine.sampler.sample(this.backdrop, back, rect, backTexture.neutral);
        const target = legibilityTarget(effectiveSize, ambient, this.currentColor, this.legibilityHistory);
        this.legibilityHistory = target.history;
        this.legibilityColorGoal = target.color;
        this.legibilityGoal = stableAmount(this.legibilityGoal, target.amount);
        this.legibilitySample = sampleKey;
        if (!this.revealed) {
          this.legibilityAmount = this.legibilityGoal;
          this.legibilityColor = this.legibilityColorGoal;
        }
      }
      this.legibilityAmount = approachAmount(this.legibilityAmount, this.legibilityGoal ?? 0, dt);
      this.legibilityColor = [
        approachAmount(this.legibilityColor[0], this.legibilityColorGoal[0], dt),
        approachAmount(this.legibilityColor[1], this.legibilityColorGoal[1], dt),
        approachAmount(this.legibilityColor[2], this.legibilityColorGoal[2], dt),
      ];
      this.legibilityMoving = this.legibilityAmount !== this.legibilityGoal || this.legibilityColor.some((value, i) => value !== this.legibilityColorGoal[i]);
      if (this.legibilityMoving) animating = true;
    } else {
      this.legibilityAmount = 0;
      this.legibilityGoal = null;
      this.legibilityHistory = null;
      this.legibilityMoving = false;
    }
    const fieldB = engine.fieldTexture(geometry);
    const light = this.light;
    const length = Math.hypot(light[0], light[1]) || 1;

    const params: DrawParams = {
      fieldA: sequenceFrame ? engine.fieldTexture(sequenceFrame.from) : this.previous ? engine.fieldTexture(this.previous) : fieldB,
      fieldB,
      morph: sequenceFrame ? sequenceFrame.mix : this.previous ? this.morph : 0,
      back: backTexture.texture,
      backRect: backTexture.neutral ? [-50000, -50000, 100000, 100000] : [back.x - (mapping ? 0 : originX), back.y - (mapping ? 0 : originY), back.w, back.h],
      surface: this.surface ? 1 : 0,
      backMap: backTexture.neutral ? undefined : mapping,
      backDensity: backTexture.neutral ? 0.00002 : backTexture.texture.w / Math.max(back.w, 1),
      canvas: [plan.cssW, plan.cssH],
      box: [plan.boxW, plan.boxH],
      unit: plan.unit,
      glyphSize: effectiveSize,
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
      legibilityColor: this.legibilityColor,
      legibilityAmount: this.legibilityAmount,
      tintOpacity: (reducedTransparency ? Math.max(r.tintOpacity, 0.5) : r.tintOpacity) * tint[3],
      dim: r.dim === 'auto' ? -1 : r.dim,
      opacity: r.opacity,
      shine: r.shine,
      rim: r.rim,
      reflection: r.reflection,
      environment: r.environment,
      shadow: r.shadow,
      light: [light[0] / length, light[1] / length],
      scheme: r.scheme === 'auto' ? -1 : r.scheme === 'light' ? 1 : 0,
      lens: this.lens,
      touch: [this.interaction.touch.x - originX, this.interaction.touch.y - originY, this.interaction.glow],
      motion: [this.interaction.scale, this.interaction.highlight],
      touchLight: [touchLight.x - originX, touchLight.y - originY, touchLight.strength],
      tile: r.tile || this.surface ? 1 : 0,
      tileRadius: r.tileRadius * plan.unit,
      tileBevel: r.bevel * plan.unit,
      // The field is in units of the reference size; a tile's glyph is drawn smaller.
      weight: r.weight * (r.tile ? glyphScale : 1),
      glyphOpacity: this.surface ? 0 : r.glyphOpacity,
      highContrast: moreContrast ? 1 : 0,
      seed: this.seed,
    };
    const ok = this.layerStack
      ? this.layerStack.draw(this.ctx, pw, ph, params, r, reducedTransparency)
      : engine.renderer!.draw(this.ctx, pw, ph, params);
    if (!ok) {
      this.suspend();
      return animating;
    }

    this.dirty = this.legibilityMoving;
    this.relation = relation;
    this.drawnVersion = this.backdrop.version;
    this.canvas.style.visibility = 'visible';
    if (!this.revealed) {
      this.revealed = true;
      this.hideSvg(); // only once the glass is really on screen
    }
    return animating;
  }

  private freezeMorph(): void {
    if (!this.geometry || !this.previous) return;
    const frozen = captureFrame({ from: this.previous, to: this.geometry, mix: this.morph });
    this.engine.releaseGeometry(this.previous);
    this.engine.releaseGeometry(this.geometry);
    this.geometry = frozen;
    this.previous = null;
    this.morph = 1;
  }

  sequence(shapes: readonly SequenceShape[], options: SequenceOptions = {}): SequenceController {
    // Morph sequences are made of SVG shapes: a surface or a text element has none.
    if (this.destroyed || this.inert || !(this.element instanceof SVGSVGElement)) return inactiveSequence(options);
    const svg = this.element;
    if (options.duration !== undefined && (!Number.isFinite(options.duration) || options.duration < 0))
      throw new RangeError('glassity: sequence duration must be a finite non-negative number');
    const interrupted = !!this.motionSequence || !!this.previous || this.sequenceVisual;
    this.motionSequence?.controller.cancel();
    this.freezeMorph();
    if (interrupted && this.geometry) this.sequenceVisual = true;
    // Retire pending SVG reads; a late result must not replace a sequence frame.
    this.request++;
    this.token++;
    const rect = this.element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      const failed = inactiveSequence(options, new Error('glassity: lay out the SVG before starting a sequence'));
      return failed;
    }
    const plan = planRaster(rect.width, rect.height, this.engine.dpr(this.r.maxDpr), this.r.weight);
    const initial = interrupted && this.geometry ? captureFrame({ from: this.geometry, to: this.geometry, mix: 0 }, plan) : null;
    this.sequenceSource = serializeIcon(svg, this.r.strokeWidth).catch(() => null).then((source) => source ?? '');
    const sequence = new FieldSequence(shapes, options, {
      plan,
      padding: this.r.padding,
      strokeWidth: this.r.strokeWidth,
      initial,
      acquire: (key, source, frame, padding) => this.engine.acquireGeometry(key, source, frame, padding),
      release: (field) => this.engine.releaseGeometry(field),
      requestFrame: this.engine.requestFrame,
      reducedMotion: () => this.system.reducedMotion,
      changed: () => {
        this.blank = false;
        const frame = sequence.frame!.to.plan;
        this.canvas.style.width = frame.cssW + 'px';
        this.canvas.style.height = frame.cssH + 'px';
        this.dirty = true;
        this.engine.requestFrame();
      },
      cancelled: () => {
        if (this.motionSequence !== sequence) return;
        if (sequence.frame) {
          const frozen = captureFrame(sequence.frame);
          this.engine.releaseGeometry(this.geometry);
          this.engine.releaseGeometry(this.previous);
          this.geometry = frozen;
          this.previous = null;
          this.morph = 1;
          this.sequenceVisual = true;
        }
        this.motionSequence = null;
        if (!this.sequenceVisual) this.sequenceSource = null;
        if (!this.geometry) {
          this.geometryKey = '';
          queueMicrotask(() => { if (!this.destroyed && !this.motionSequence) void this.prepare(); });
        }
        this.dirty = true;
        this.engine.requestFrame();
      },
    });
    this.motionSequence = sequence;
    return sequence.controller;
  }

  /** Timelines finish even when their icon has scrolled out of view. */
  advanceSequence(now: number): boolean {
    return this.motionSequence?.controller.tick(now) ?? false;
  }

  update(options: GlassOptions): void {
    this.own = { ...this.own, ...options };
    this.configure();
  }

  set(options: GlassOptions): void {
    this.own = { ...options };
    this.configure();
  }

  retarget(svg: GlassElement): void {
    if (svg === this.element || this.destroyed || (svg instanceof HTMLElement && !canHostSurface(svg) && !this.isText(svg))) return;
    this.motionSequence?.controller.cancel();
    if (!this.surface && (svg instanceof HTMLElement || this.element instanceof HTMLElement)) {
      this.request++;
      this.clearText();
    }
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
    this.motionSequence?.controller.cancel();
    this.sequenceVisual = false;
    this.sequenceSource = null;
    this.geometryKey = '';
    if (this.backdrop) {
      this.engine.retryBackdrop(this.backdrop);
      this.backdrop.refresh();
    }
    this.configure();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.motionSequence?.controller.cancel();
    this.destroyed = true;
    this.interaction.dispose();
    clearTimeout(this.sizeTimer);
    this.detach();
    // A framework that is unmounting this icon may be holding the canvas as the
    // anchor for its next insertBefore (Vue does). Take it away a moment later.
    this.canvas.style.visibility = 'hidden';
    const canvas = this.canvas;
    queueMicrotask(() => canvas.remove());
    this.layerStack?.release();
    this.layerStack = null;
    this.engine.releaseGeometry(this.geometry);
    this.engine.releaseGeometry(this.previous);
    if (this.surface) this.backdrop?.refresh();
    this.engine.releaseBackdrop(this.backdrop);
    this.geometry = this.previous = null;
    this.backdrop = null;
    this.engine.forget(this);
  }
}

export function inactiveSequence(options: SequenceOptions = {}, error?: Error): SequenceController {
  const controller = new SequenceTimeline(options, { render() {}, requestFrame() {}, reducedMotion: () => true });
  if (error) controller.fail(error);
  else controller.cancel();
  return controller;
}

/** Stand-in handle when WebGL2 is missing: the SVG stays, with a soft highlight. */
class PlainHandle implements GlassHandle {
  private undo: (() => void) | null;
  constructor(
    private engine: Engine,
    public element: GlassElement,
    public scope: Scope | null = null,
  ) {
    this.undo = element instanceof SVGSVGElement ? applyBevel(element) : null;
  }
  update(): void {}
  set(): void {}
  configure(): void {}
  retarget(svg: GlassElement): void {
    if (svg === this.element) return;
    this.undo?.();
    this.engine.renamePlain(this.element, svg, this);
    this.element = svg;
    this.undo = svg instanceof SVGSVGElement ? applyBevel(svg) : null;
  }
  refresh(): void {}
  sequence(_shapes: readonly SequenceShape[], options?: SequenceOptions): SequenceController { return inactiveSequence(options); }
  destroy(): void {
    this.undo?.();
    this.undo = null;
    // Unregister like a glass instance does, so the icon can be mounted again and
    // a controller's cleanup finds it.
    this.engine.forgetPlain(this);
  }
}

/** One per page: owns the WebGL context, the caches and the frame loop. */
export class Engine {
  readonly scopes = new ScopeRegistry();
  readonly captures = new CaptureQueue();
  readonly touchLight = new TouchLight();
  renderer: Renderer | null;
  readonly media = { reducedMotion: false, reducedTransparency: false, moreContrast: false, forcedColors: false };
  private instances = new Map<GlassElement, Instance>();
  private plain = new Map<GlassElement, PlainHandle>();
  private geometries = new Map<string, { pending: Promise<Geometry>; refs: number }>();
  private backdrops = new WeakMap<object, Map<string, Backdrop>>();
  private backdropHomes = new WeakMap<Backdrop, { owner: object; key: string }>();
  private backStates = new WeakMap<Backdrop, BackState>();
  private neutral: { backdrop: ColorBackdrop; texture: BackTexture | null } | null = null;
  private drawCursor = 0;
  private colors = new Map<string, readonly [number, number, number, number]>();
  private colorCtx: CanvasRenderingContext2D | null = null;
  readonly sampler = new BackdropSampler();
  private readonly styles = new StyleWatch((icon, surroundings) => {
    this.instances.get(icon as GlassElement)?.styleChanged(surroundings);
    this.requestFrame();
  });
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
    if (this.renderer) {
      this.renderer.onstatechange = () => {
        if (this.renderer?.state === 'ready') { this.invalidate(); return; }
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        clearTimeout(this.watch);
        this.last = 0;
        for (const instance of this.instances.values()) instance.suspend();
      };
      // Geometry keeps its float field and backdrops retain their source pixels.
      // The next draw uploads them into the new generation before hiding the SVG.
      this.renderer.onrestore = () => this.invalidate();
    }
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

  /** Apply page or scope changes to every icon, including nested and hand-placed icons. */
  configure(): void {
    for (const instance of this.instances.values()) instance.configure();
  }

  syncScopes(): void {
    for (const instance of this.instances.values()) instance.syncScope();
  }

  // ── instances ────────────────────────────────────────────────────────────

  mount(svg: GlassElement, options: GlassOptions, scope: Scope | null): GlassHandle {
    const existing = this.instances.get(svg);
    if (!existing) {
      // A copied page brings a stale canvas and marker along with the icon.
      const next = svg.nextElementSibling;
      if (next instanceof HTMLCanvasElement && next.hasAttribute(OWN)) next.remove();
      svg.removeAttribute(HIDDEN);
      svg.removeAttribute(SURFACE_ACTIVE);
    }
    if (existing) {
      existing.scope = scope ?? existing.scope;
      existing.set(options);
      return existing;
    }
    if (!this.renderer) {
      let handle = this.plain.get(svg);
      if (handle) handle.scope = scope ?? handle.scope;
      else this.plain.set(svg, (handle = new PlainHandle(this, svg, scope)));
      return handle;
    }
    this.listen();
    const instance = new Instance(this, svg, options, scope);
    this.instances.set(svg, instance);
    if (svg instanceof HTMLElement) this.recaptureAround(svg, instance);
    return instance;
  }

  /**
   * Existing captures were taken while this element still painted as ordinary DOM. Its
   * own backdrop may be reused, and with local regions other cells of the same container
   * may also hold its paint: re-read every one that covers it so no glass refracts it.
   */
  private recaptureAround(element: HTMLElement, instance: Instance): void {
    const stale = new Set<Backdrop>();
    if (instance.backdrop) stale.add(instance.backdrop);
    for (const other of this.instances.values())
      if (other.backdrop instanceof SnapshotBackdrop && other.backdrop.covers(element)) stale.add(other.backdrop);
    for (const backdrop of stale) backdrop.refresh();
  }

  get(svg: GlassElement): GlassHandle | undefined {
    return this.instances.get(svg) ?? this.plain.get(svg);
  }

  /**
   * Give an icon that is already glass to `scope`. A provider that starts after the
   * page-wide auto mode has picked up its icons must own them: otherwise the page-wide
   * scan later drops them (they now sit inside the provider) and nobody puts them back.
   */
  claim(svg: GlassElement, scope: Scope): void {
    const plain = this.plain.get(svg);
    if (plain) plain.scope = scope;
    const instance = this.instances.get(svg);
    if (!instance || instance.scope === scope) return;
    instance.scope = scope;
    instance.configure();
  }

  /** Every glass that belongs to `scope`, including plain stand-ins where WebGL2 is missing. */
  inScope(scope: Scope): (Instance | PlainHandle)[] {
    const all: (Instance | PlainHandle)[] = [...this.instances.values(), ...this.plain.values()];
    return all.filter((handle) => handle.scope === scope);
  }

  renamePlain(from: GlassElement, to: GlassElement, handle: PlainHandle): void {
    if (this.plain.get(from) === handle) this.plain.delete(from);
    this.plain.set(to, handle);
  }

  forgetPlain(handle: PlainHandle): void {
    if (this.plain.get(handle.element) === handle) this.plain.delete(handle.element);
  }

  rename(from: GlassElement, to: GlassElement, instance: Instance): void {
    this.instances.delete(from);
    this.instances.set(to, instance);
  }

  forget(instance: Instance): void {
    if (this.instances.get(instance.element) === instance) this.instances.delete(instance.element);
    if (!this.instances.size) {
      this.unlisten();
      this.renderer?.release(this.neutral?.texture ?? null);
      this.neutral = null;
      this.renderer?.releaseLayers();
    }
  }

  /**
   * Remove what a copy of the page left behind (Turbo, swup and Barba cache pages by
   * cloning them): canvases no glass owns, and hidden markers on icons no glass draws.
   */
  sweep(root: ParentNode): void {
    const owned = new Set<Element>();
    for (const instance of this.instances.values()) owned.add(instance.canvas);
    for (const canvas of Array.from(root.querySelectorAll(`canvas[${OWN}]`))) if (!owned.has(canvas)) canvas.remove();
    for (const el of Array.from(root.querySelectorAll(`[${SURFACE}]`))) {
      if (!this.instances.has(el as GlassElement)) { el.removeAttribute(SURFACE); el.removeAttribute(SURFACE_ACTIVE); }
    }
    for (const el of Array.from(root.querySelectorAll(`[${HIDDEN}]`)))
      if (!this.instances.has(el as GlassElement)) el.removeAttribute(HIDDEN);
  }

  /** True for nodes glassity writes to itself. */
  readonly isOwn = (node: Node): boolean => {
    if (!(node instanceof Element)) return node.parentElement ? this.isOwn(node.parentElement) : false;
    return node.hasAttribute(OWN) || this.instances.has(node as GlassElement);
  };

  observe(svg: GlassElement): void {
    this.styles.observe(svg);
    this.intersection?.observe(svg);
    this.resize?.observe(svg);
  }

  unobserve(svg: GlassElement): void {
    this.styles.unobserve(svg);
    this.intersection?.unobserve(svg);
    this.resize?.unobserve(svg);
  }

  dpr(max: number): number {
    return Math.min(window.devicePixelRatio || 1, max);
  }

  // ── frame loop ───────────────────────────────────────────────────────────

  readonly requestFrame = (): void => {
    if (!this.raf && this.instances.size && this.renderer?.ready) this.raf = requestAnimationFrame(this.frame);
  };

  invalidate(): void {
    for (const instance of this.instances.values()) instance.dirty = true;
    this.requestFrame();
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    if (!this.renderer?.ready) return;
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;

    // Read all layout first, then write, so the browser lays out once per frame.
    const active: Instance[] = [];
    const rects = new Map<Backdrop, Rect>();
    let live = this.touchLight.prune(now);
    let moved = false;
    const refresh = new Set<Backdrop>();
    for (const instance of this.instances.values()) {
      live = instance.advanceSequence(now) || live;
      if (!instance.onscreen || instance.inert) continue;
      this.styles.observe(instance.element);
      if (instance.styleDirty) {
        if (instance.syncStyle() && instance.backdrop) refresh.add(instance.backdrop);
      }
      const rect = instance.element.getBoundingClientRect();
      instance.syncSurface(rect);
      const was = instance.rect;
      if (was && (Math.abs(was.left - rect.left) > 0.2 || Math.abs(was.top - rect.top) > 0.2 || Math.abs(was.width - rect.width) > 0.2)) moved = true;
      instance.rect = rect;
      instance.canvasRect = instance.canvas.getBoundingClientRect();
      instance.syncRegion(rect);
      const backdrop = instance.backdrop;
      if (backdrop && !rects.has(backdrop)) {
        backdrop.tick();
        rects.set(backdrop, backdrop.rect());
        live = live || backdrop.live;
      }
      active.push(instance);
    }

    for (const backdrop of refresh) backdrop.refresh();

    let again = live;
    const drawingStarted = performance.now();
    const first = this.drawCursor % Math.max(1, active.length);
    for (let drawn = 0; drawn < active.length; drawn++) {
      const index = (first + drawn) % active.length;
      const instance = active[index];
      const back = instance.backdrop ? rects.get(instance.backdrop) ?? null : null;
      try {
        again = instance.step(now, dt, back) || again;
      } catch (error) {
        this.renderer.fail(error);
        return;
      }
      if (!this.renderer.ready) return;
      this.drawCursor = index + 1;
      if (drawn + 1 < active.length && performance.now() - drawingStarted >= 6) {
        again = true;
        break;
      }
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
            const instance = this.instances.get(entry.target as GlassElement);
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
        for (const entry of entries) this.instances.get(entry.target as GlassElement)?.resized();
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

  async acquireGeometry(key: string, source: string, plan: RasterPlan, padding: number, raster?: () => Promise<Uint8ClampedArray>): Promise<Geometry> {
    let entry = this.geometries.get(key);
    if (!entry) {
      const pending = (raster ? raster() : rasterAlpha(source, plan, padding)).then(async (alpha) => {
        let opaque = false;
        for (let i = 0; i < alpha.length && !opaque; i++) opaque = alpha[i] > 127;
        return {
          key,
          plan,
          data: await buildFieldAsync(alpha, plan.gw, plan.gh, plan.unit * plan.scale),
          empty: !opaque,
          refs: 0,
          texture: null,
        };
      });
      entry = { pending, refs: 0 };
      this.geometries.set(key, entry);
      pending.catch(() => {
        if (this.geometries.get(key)?.pending === pending) this.geometries.delete(key);
      });
    }
    // Reserve before yielding: the last owner may unmount while this await resumes.
    entry.refs++;
    try {
      const geometry = await entry.pending;
      geometry.refs++;
      return geometry;
    } catch (error) {
      entry.refs--;
      throw error;
    }
  }

  releaseGeometry(geometry: Geometry | null): void {
    if (!geometry || geometry.refs <= 0) return;
    geometry.refs--;
    const entry = this.geometries.get(geometry.key);
    if ((entry ? --entry.refs : geometry.refs) > 0) return;
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
  backdropFor(svg: GlassElement, source: ResolvedOptions['backdrop'], scope: Scope | null): Backdrop {
    const maxSize = Math.min(this.renderer?.maxTextureSize ?? 2048, 2560);
    const snap = (el: Element, mode: 'background' | 'dom') => {
      const box = svg.getBoundingClientRect();
      const region = mode === 'dom' ? captureRegion({ x: box.left + scrollX, y: box.top + scrollY, w: box.width, h: box.height }, maxSize, devicePixelRatio) : undefined;
      return this.cachedBackdrop(el, mode + (region ? ':' + region.key : ''), () => new SnapshotBackdrop(el, {
        mode, maxSize, region, queue: this.captures, isOwn: this.isOwn,
        priority: () => !region || intersects(region, { x: scrollX, y: scrollY, w: innerWidth, h: innerHeight }) ? 1 : 0,
      }));
    };
    const container = scope?.root ?? null;

    if (source === 'none') {
      const color = pageColor(svg instanceof HTMLElement ? parentOf(svg) : svg);
      return this.cachedBackdrop(this, 'color:' + color, () => new ColorBackdrop(color));
    }
    if (typeof source === 'string' && source !== 'auto')
      return this.cachedBackdrop(container ?? this, 'url:' + source, () => new UrlBackdrop(source, container));
    if (source instanceof HTMLImageElement || source instanceof HTMLVideoElement || source instanceof HTMLCanvasElement)
      return this.cachedBackdrop(source, 'media', () => new MediaBackdrop(source));
    if (source instanceof Element && source !== svg) return snap(source, 'dom');

    const surface = nearestSurface(svg);
    if (surface) return snap(surface.el, surface.mode);
    return snap(container === svg ? parentOf(svg) ?? document.body : container ?? document.body, 'dom');
  }

  releaseBackdrop(backdrop: Backdrop | null): void {
    if (!backdrop || backdrop.refs <= 0 || --backdrop.refs > 0) return;
    const home = this.backdropHomes.get(backdrop);
    if (home) this.backdrops.get(home.owner)?.delete(home.key);
    this.renderer?.release(this.backStates.get(backdrop)?.texture ?? null);
    this.backStates.delete(backdrop);
    this.backdropHomes.delete(backdrop);
    backdrop.onchange = null;
    backdrop.dispose();
  }

  /** Explicit refresh is allowed to retry immediately, even if the pixels did not change. */
  retryBackdrop(backdrop: Backdrop): void {
    const state = this.backStates.get(backdrop);
    if (!state) return;
    state.version = -1;
    state.failures = 0;
    state.retryAt = 0;
  }

  backdropNeedsRetry(backdrop: Backdrop, now: number): boolean {
    const state = this.backStates.get(backdrop);
    return !!state?.failed && now >= state.retryAt;
  }

  /** The GPU texture for a backdrop, uploaded again only when its pixels changed. */
  backTexture(backdrop: Backdrop): { texture: BackTexture; neutral: boolean } {
    const renderer = this.renderer!;
    if (!renderer.ready) throw new Error('glassity: WebGL2 is unavailable');
    let state = this.backStates.get(backdrop);
    if (!state) this.backStates.set(backdrop, (state = {
      texture: null, version: -1, failed: false, failures: 0, retryAt: 0,
      generation: renderer.generation, source: null, sourceKey: '',
    }));
    const source = backdrop.source;
    const url = source instanceof HTMLImageElement || source instanceof HTMLVideoElement ? source.currentSrc || source.src : '';
    const sourceKey = url + '|' + backdrop.width + 'x' + backdrop.height;
    if (state.generation !== renderer.generation || state.source !== source || state.sourceKey !== sourceKey) {
      this.retryBackdrop(backdrop);
      state.generation = renderer.generation;
      state.source = source;
      state.sourceKey = sourceKey;
    }
    // Live frames change version continuously; they must not reset the failure delay.
    const stale = !state.texture || state.texture.generation !== renderer.generation || state.version !== backdrop.version || state.failed;
    if (source && stale && performance.now() >= state.retryAt) {
      try {
        state.texture = renderer.uploadBack(state.texture, source, backdrop.width, backdrop.height);
        state.version = backdrop.version;
        if (state.failed) this.invalidate(); // All icons sharing this backdrop need its recovered pixels.
        state.failed = false;
        state.failures = 0;
        state.retryAt = 0;
      } catch (error) {
        if (!renderer.ready) throw error;
        state.failed = true;
        state.failures++;
        state.retryAt = performance.now() + Math.min(30_000, 250 * 2 ** Math.min(state.failures - 1, 7));
        if (!this.warnedTaint) {
          this.warnedTaint = true;
          console.warn('glassity: the backdrop cannot be read (cross-origin without CORS?). Keeping the last image or using a flat colour until it can be retried.', error);
        }
      }
    }
    if (state.texture && state.texture.generation === renderer.generation) return { texture: state.texture, neutral: false };
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
