import type { Backdrop, Rect } from './backdrop';
import type { RGB } from './core/legibility';

const NEUTRAL: RGB = [138 / 255, 143 / 255, 152 / 255];

/** Longest side of the CPU copy of a backdrop. Legibility only needs low-frequency colour. */
const COPY = 128;
/** A live source (video, canvas) is copied again at most this often. */
const LIVE_MS = 250;

interface Copy {
  version: number;
  time: number;
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/**
 * Read the colour under an icon from the same source uploaded to WebGL, never the DOM's
 * guessed colour. Each backdrop is read back once per version into a small CPU copy, and
 * icons average their patch from that copy: reading the GPU back for every icon on every
 * frame (as scrolling moves them) made scrolling a 77-icon page drop most frames.
 */
export class BackdropSampler {
  private ctx: CanvasRenderingContext2D | null = null;
  private unreadable = new WeakSet<Backdrop>();
  private copies = new WeakMap<Backdrop, Copy>();

  private copy(backdrop: Backdrop): Copy | null {
    const now = performance.now();
    const old = this.copies.get(backdrop);
    // Same pixels: reuse. A live source changes every frame, so it is read at most every
    // LIVE_MS; any other change (a hover recaptured, a new image) is read straight away.
    if (old && (old.version === backdrop.version || (backdrop.live && now - old.time < LIVE_MS))) return old;
    const w0 = backdrop.width, h0 = backdrop.height;
    if (!(w0 > 0 && h0 > 0)) return old ?? null;
    const scale = Math.min(1, COPY / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    if (!this.ctx) {
      const canvas = document.createElement('canvas');
      this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = this.ctx;
    if (!ctx) return old ?? null;
    try {
      ctx.canvas.width = w;
      ctx.canvas.height = h;
      ctx.drawImage(backdrop.source as CanvasImageSource, 0, 0, w0, h0, 0, 0, w, h);
      const copy = { version: backdrop.version, time: now, w, h, data: ctx.getImageData(0, 0, w, h).data };
      this.copies.set(backdrop, copy);
      return copy;
    } catch {
      // Reset a tainted sampling canvas before another, readable source uses it.
      this.ctx = null;
      this.unreadable.add(backdrop);
      return null;
    }
  }

  sample(backdrop: Backdrop, area: Rect, icon: DOMRect, neutral: boolean): RGB {
    if (neutral || !backdrop.source || this.unreadable.has(backdrop)) return NEUTRAL;
    if (area.w <= 0 || area.h <= 0) return NEUTRAL;
    const copy = this.copy(backdrop);
    if (!copy) return NEUTRAL;
    const { w, h, data } = copy;
    const size = Math.min(icon.width, icon.height);
    const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
    const x0 = Math.floor(clamp(((icon.left + (icon.width - size) / 2 - area.x) / area.w) * w, w - 1));
    const y0 = Math.floor(clamp(((icon.top + (icon.height - size) / 2 - area.y) / area.h) * h, h - 1));
    const x1 = Math.max(x0 + 1, Math.min(w, Math.ceil(x0 + (size / area.w) * w)));
    const y1 = Math.max(y0 + 1, Math.min(h, Math.ceil(y0 + (size / area.h) * h)));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    return [r / (n * 255), g / (n * 255), b / (n * 255)];
  }
}
