import { pageColor, snapshot, SnapshotBudgetError } from './snapshot';

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
}

export interface SnapshotBackdropOptions {
  mode: 'background' | 'dom';
  maxSize: number;
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
  private again = false;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private readonly onResize = () => this.schedule(120);

  constructor(private el: Element, private options: SnapshotBackdropOptions) {
    super();
    this.mode = options.mode;
    this.root = el === document.body || el === document.documentElement;
    this.source = swatch(pageColor(el));
    this.width = this.height = 2;
    this.version = 1;

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.schedule(120));
      this.resizeObserver.observe(el);
    }
    this.mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => !options.isOwn(record.target))) this.schedule(250);
    });
    this.mutationObserver.observe(
      el,
      this.mode === 'dom'
        ? { subtree: true, childList: true, attributes: true, characterData: true }
        : { attributes: true, attributeFilter: ['class', 'style'] },
    );
    window.addEventListener('resize', this.onResize);
    this.capture();
  }

  private schedule(delay: number): void {
    if (this.disposed) return;
    clearTimeout(this.timer);
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
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      this.fixed = this.mode === 'background' && getComputedStyle(this.el).backgroundAttachment.includes('fixed');
      const { w, h } = this.area();
      if (w >= 1 && h >= 1) {
        let result;
        try {
          result = await snapshot(this.el, { mode: this.mode, width: w, height: h, maxSize: this.options.maxSize, hide: this.options.isOwn });
        } catch (error) {
          if (!(error instanceof SnapshotBudgetError) || this.mode !== 'dom') throw error;
          console.warn('glassity: the page behind the glass is too large to snapshot; using only its CSS background. Pass `backdrop` to choose what to refract.');
          this.mode = 'background';
          result = await snapshot(this.el, { mode: 'background', width: w, height: h, maxSize: this.options.maxSize });
        }
        if (this.disposed) return;
        this.source = result.canvas;
        this.width = result.canvas.width;
        this.height = result.canvas.height;
        this.changed();
      }
    } catch (error) {
      console.warn('glassity: could not snapshot the backdrop.', error);
    } finally {
      this.busy = false;
      if (this.again) {
        this.again = false;
        this.schedule(60);
      }
    }
  }

  rect(): Rect {
    if (this.fixed) return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    if (this.root) {
      const { w, h } = this.area();
      return { x: -window.scrollX, y: -window.scrollY, w, h };
    }
    const r = this.el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  refresh(): void {
    this.schedule(0);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    window.removeEventListener('resize', this.onResize);
  }
}

/**
 * The surface an icon sits on: the nearest ancestor that paints a background.
 * An image or gradient is refracted on its own (cheap, and the usual wallpaper
 * case). A flat colour has nothing to bend, so there the element's content is
 * what the glass should look through.
 */
export function nearestSurface(el: Element): { el: Element; mode: 'background' | 'dom' } | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return { el: node, mode: 'background' };
    const color = cs.backgroundColor;
    if (color && color !== 'transparent' && !/,\s*0\)$/.test(color) && !/\/\s*0\)$/.test(color)) return { el: node, mode: 'dom' };
  }
  return null;
}
