import { parentOf, SURFACE } from './dom';
import { elementMap, type SurfaceSpace } from './surface-space';
import { pageColor, snapshot, SnapshotBudgetError } from './snapshot';
import { CaptureQueue } from './capture-queue';
import { createHtmlCanvasCapture, type HtmlCanvasCapture } from './html-canvas';
import { captureRegion, intersects, type CaptureRegion } from './capture-region';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A source of pixels for the glass to refract, and where those pixels sit in the viewport. */
export abstract class Backdrop {
  /** Null until the first pixels are available. */
  source: TexImageSource | null = null;
  width = 1;
  height = 1;
  /** Bumped whenever the pixels change. */
  version = 0;
  /** True while the pixels change every frame (playing video, canvas). */
  live = false;
  refs = 0;
  onchange: (() => void) | null = null;

  /** Area the source covers, in viewport CSS px. */
  abstract rect(): Rect;
  /** Local source coordinates for surfaces inside transformed containers. */
  space(): SurfaceSpace | null { return null; }
  /** Called once per frame before drawing; live sources bump `version` here. */
  tick(): void {}
  /** Re-read the source now. */
  refresh(): void {}
  dispose(): void {}

  protected changed(): void {
    this.version++;
    this.onchange?.();
  }
}

function swatch(color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 2, 2);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 2, 2);
  return canvas;
}

const EVERYWHERE: Rect = { x: -50000, y: -50000, w: 100000, h: 100000 };

/** A flat colour. Used for `backdrop="none"` and as the fallback when nothing else can be read. */
export class ColorBackdrop extends Backdrop {
  constructor(color: string) {
    super();
    this.source = swatch(color);
    this.width = this.height = 2;
    this.version = 1;
  }
  rect(): Rect {
    return EVERYWHERE;
  }
}

/** Where `object-fit` puts media of size nw×nh inside box `r`. */
function fitRect(r: DOMRect, nw: number, nh: number, fit: string): Rect {
  if (!nw || !nh || fit === 'fill') return { x: r.left, y: r.top, w: r.width, h: r.height };
  const cover = Math.max(r.width / nw, r.height / nh);
  const contain = Math.min(r.width / nw, r.height / nh);
  const scale = fit === 'cover' ? cover : fit === 'contain' ? contain : fit === 'none' ? 1 : fit === 'scale-down' ? Math.min(1, contain) : -1;
  if (scale < 0) return { x: r.left, y: r.top, w: r.width, h: r.height };
  const w = nw * scale;
  const h = nh * scale;
  return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h };
}

function fittedSpace(el: HTMLElement, nw: number, nh: number, fit: string): SurfaceSpace {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const fitted = fitRect(new DOMRect(0, 0, w, h), nw, nh, fit);
  const map = elementMap(el, w, h, el.getBoundingClientRect());
  const [a, b, c, d] = map.basis;
  map.offset = [map.offset[0] + a * fitted.x + c * fitted.y, map.offset[1] + b * fitted.x + d * fitted.y];
  return { map, width: fitted.w, height: fitted.h };
}

/** An <img>, <video> or <canvas> already on the page, used as is. */
export class MediaBackdrop extends Backdrop {
  private lastTime = -1;
  private fit = 'fill';
  private readonly listener = () => this.sync();

  constructor(private el: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement) {
    super();
    if (el instanceof HTMLVideoElement) for (const type of ['loadeddata', 'play', 'pause', 'seeked', 'resize']) el.addEventListener(type, this.listener);
    else if (el instanceof HTMLImageElement) el.addEventListener('load', this.listener);
    this.sync();
  }

  private sync(): void {
    const el = this.el;
    this.fit = el instanceof HTMLCanvasElement ? 'fill' : getComputedStyle(el).objectFit || 'fill';
    if (el instanceof HTMLVideoElement) {
      this.width = el.videoWidth;
      this.height = el.videoHeight;
      this.live = !el.paused && !el.ended;
      this.source = el.readyState >= 2 && this.width > 0 ? el : null;
    } else if (el instanceof HTMLImageElement) {
      this.width = el.naturalWidth;
      this.height = el.naturalHeight;
      this.source = el.complete && this.width > 0 ? el : null;
    } else {
      this.width = el.width;
      this.height = el.height;
      this.live = true;
      this.source = this.width > 0 && this.height > 0 ? el : null;
    }
    this.changed();
  }

  rect(): Rect {
    return fitRect(this.el.getBoundingClientRect(), this.width, this.height, this.fit);
  }

  space(): SurfaceSpace {
    return fittedSpace(this.el, this.width, this.height, this.fit);
  }

  tick(): void {
    const el = this.el;
    if (el instanceof HTMLVideoElement) {
      if (el.readyState >= 2 && el.currentTime !== this.lastTime) {
        this.lastTime = el.currentTime;
        this.source = el;
        this.version++;
      }
    } else if (el instanceof HTMLCanvasElement) {
      if (el.width !== this.width || el.height !== this.height) this.sync();
      else this.version++;
    }
  }

  refresh(): void {
    this.sync();
  }

  dispose(): void {
    for (const type of ['loadeddata', 'play', 'pause', 'seeked', 'resize', 'load']) this.el.removeEventListener(type, this.listener);
  }
}

/** An image URL stretched to cover a container (or the viewport). */
export class UrlBackdrop extends Backdrop {
  constructor(url: string, private container: Element | null) {
    super();
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      this.source = image;
      this.width = image.naturalWidth;
      this.height = image.naturalHeight;
      this.changed();
    };
    image.onerror = () => console.warn(`glassity: could not load backdrop image "${url}".`);
    image.src = url;
  }

  rect(): Rect {
    const box = this.container ? this.container.getBoundingClientRect() : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    return fitRect(box, this.width, this.height, 'cover');
  }

  space(): SurfaceSpace | null {
    return this.container instanceof HTMLElement ? fittedSpace(this.container, this.width, this.height, 'cover') : null;
  }
}

export interface SnapshotBackdropOptions {
  mode: 'background' | 'dom';
  maxSize: number;
  queue: CaptureQueue;
  region?: CaptureRegion;
  priority: () => number;
  /** True for nodes glassity itself writes to; their mutations must not trigger a new snapshot. */
  isOwn: (node: Node) => boolean;
}

/** A rendering of an element (or only its CSS background), refreshed when it changes. */
export class SnapshotBackdrop extends Backdrop {
  private mode: 'background' | 'dom';
  private fixed = false;
  private root: boolean;
  private timer = 0;
  private busy = false;
  private pending: AbortController | null = null;
  private capturedRect: Rect | null = null;
  private capturedFixed = false;
  /** A local-region capture: where its pixels sit in the element's own untransformed box. */
  private capturedCrop: Rect | null = null;
  /** Pixels kept from another element's capture; only its viewport rect describes them. */
  private borrowed = false;
  private native: HtmlCanvasCapture | null = null;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private readonly onResize = () => this.schedule(120);
  private readonly onScroll = () => { if (this.mode === 'dom') this.schedule(80); };

  constructor(private el: Element, private options: SnapshotBackdropOptions) {
    super();
    this.mode = options.mode;
    this.root = el === document.body || el === document.documentElement;
    if (this.mode === 'dom') this.native = createHtmlCanvasCapture(el, () => this.schedule(0), options.isOwn);
    this.source = swatch(pageColor(el));
    this.width = this.height = 2;
    this.version = 1;

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.schedule(120));
      this.resizeObserver.observe(el);
    }
    this.mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => !options.isOwn(record.target) &&
        (record.type !== 'childList' || [...record.addedNodes, ...record.removedNodes].some((node) => !options.isOwn(node))))) this.schedule(120);
    });
    this.mutationObserver.observe(
      el,
      this.mode === 'dom'
        ? { subtree: true, childList: true, attributes: true, characterData: true }
        : { attributes: true, attributeFilter: ['class', 'style'] },
    );
    window.addEventListener('resize', this.onResize);
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    this.capture();
  }

  private schedule(delay: number): void {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.pending?.abort();
    this.timer = window.setTimeout(() => this.capture(), delay);
  }

  private area(): { w: number; h: number } {
    if (this.fixed) return { w: window.innerWidth, h: window.innerHeight };
    if (this.root) {
      const doc = document.documentElement;
      return { w: Math.max(doc.scrollWidth, doc.clientWidth), h: Math.max(doc.scrollHeight, doc.clientHeight) };
    }
    const box = this.el as HTMLElement;
    return { w: box.offsetWidth || box.getBoundingClientRect().width, h: box.offsetHeight || box.getBoundingClientRect().height };
  }

  private async capture(): Promise<void> {
    if (this.disposed) return;
    this.pending?.abort();
    const pending = this.pending = new AbortController();
    this.busy = true;
    try {
      const captured = await this.options.queue.enqueue(this, async (work) => {
        this.fixed = this.mode === 'background' && getComputedStyle(this.el).backgroundAttachment.includes('fixed');
        const { w, h } = this.area();
        if (w < 1 || h < 1) return null;
        const region = this.options.region;
        const box = this.el.getBoundingClientRect();
        const fixed = this.fixed;
        const rect = region ? { x: region.x, y: region.y, w: region.w, h: region.h } : {
          x: fixed || this.root ? 0 : box.left + scrollX,
          y: fixed || this.root ? 0 : box.top + scrollY, w, h,
        };
        // The snapshot draws the element's untransformed box offset by its bounding box origin.
        const crop = region && !fixed && !this.root ? { x: region.x - box.left - scrollX, y: region.y - box.top - scrollY, w: region.w, h: region.h } : null;
        const request = { width: w, height: h, maxSize: this.options.maxSize, region, work, hide: this.options.isOwn };
        let result;
        try {
          result = (region && this.native?.capture(region, this.options.maxSize)) || await snapshot(this.el, { ...request, mode: this.mode });
        } catch (error) {
          if (!(error instanceof SnapshotBudgetError) || this.mode !== 'dom') throw error;
          // Keep trying DOM on the next refresh: this region may become simpler.
          result = await snapshot(this.el, { ...request, mode: 'background' });
        }
        return { result, rect, fixed, crop };
      }, { priority: this.options.priority, signal: pending.signal });
      if (!captured || pending.signal.aborted || this.disposed || this.pending !== pending) return;
      this.source = captured.result.canvas;
      this.width = captured.result.canvas.width;
      this.height = captured.result.canvas.height;
      this.capturedRect = captured.rect;
      this.capturedFixed = captured.fixed;
      this.capturedCrop = captured.crop;
      this.borrowed = false;
      this.changed();
    } catch (error) {
      if (!pending.signal.aborted) console.warn('glassity: could not snapshot the backdrop.', error);
    } finally {
      if (this.pending === pending) {
        this.busy = false;
        this.pending = null;
      }
    }
  }

  /** A moving icon changes cells only after crossing the shared core, not on every scroll. */
  needsRegion(rect: DOMRect): boolean {
    const region = this.options.region;
    return !!region && captureRegion({ x: rect.left + scrollX, y: rect.top + scrollY, w: rect.width, h: rect.height },
      this.options.maxSize, devicePixelRatio).key !== region.key;
  }

  /** True when this capture may hold `element`'s paint: it is inside the captured DOM and region. */
  covers(element: Element): boolean {
    if (this.mode !== 'dom' || this.disposed || !this.el.contains(element)) return false;
    const region = this.options.region;
    if (!region) return true;
    const box = element.getBoundingClientRect();
    return intersects(region, { x: box.left + scrollX, y: box.top + scrollY, w: box.width, h: box.height });
  }

  keepLast(previous: SnapshotBackdrop): void {
    if (this.version !== 1 || previous.version < 2 || !previous.source) return;
    this.source = previous.source;
    this.width = previous.width;
    this.height = previous.height;
    const rect = previous.rect();
    this.capturedRect = { ...rect, x: rect.x + scrollX, y: rect.y + scrollY };
    this.capturedFixed = false;
    this.capturedCrop = previous.capturedCrop;
    this.borrowed = previous.el !== this.el || previous.borrowed;
    this.changed();
  }

  rect(): Rect {
    if (this.capturedRect && this.capturedFixed) return this.capturedRect;
    if (this.capturedRect) return { ...this.capturedRect, x: this.capturedRect.x - scrollX, y: this.capturedRect.y - scrollY };
    if (this.fixed) return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    if (this.root) {
      const { w, h } = this.area();
      return { x: -window.scrollX, y: -window.scrollY, w, h };
    }
    const r = this.el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  /**
   * The source in the element's local pixels. A local-region capture holds only part of
   * the element: map that crop, not the whole box, or surfaces sample the wrong place
   * (text above a toolbar was stretched into it).
   */
  space(): SurfaceSpace | null {
    if (this.fixed || this.root || this.borrowed) return null;
    const { w, h } = this.area();
    const map = elementMap(this.el, w, h, this.el.getBoundingClientRect());
    const crop = this.capturedCrop;
    if (!crop) return { map, width: w, height: h };
    const [a, b, c, d] = map.basis;
    map.offset = [map.offset[0] + a * crop.x + c * crop.y, map.offset[1] + b * crop.x + d * crop.y];
    return { map, width: crop.w, height: crop.h };
  }

  refresh(): void {
    this.schedule(0);
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.abort();
    this.native?.dispose();
    clearTimeout(this.timer);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('scroll', this.onScroll, { capture: true });
  }
}

/**
 * The surface an icon sits on: the nearest ancestor that paints a background.
 * An image or gradient is refracted on its own (cheap, and the usual wallpaper
 * case). A flat colour has nothing to bend, so there the element's content is
 * what the glass should look through.
 */
export function nearestSurface(el: Element): { el: Element; mode: 'background' | 'dom' } | null {
  for (let node = parentOf(el); node; node = parentOf(node)) {
    if (node.hasAttribute(SURFACE)) continue;
    const cs = getComputedStyle(node);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return { el: node, mode: 'background' };
    const color = cs.backgroundColor;
    if (color && color !== 'transparent' && !/,\s*0\)$/.test(color) && !/\/\s*0\)$/.test(color)) return { el: node, mode: 'dom' };
  }
  return null;
}
