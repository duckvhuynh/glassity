import type { Backdrop, Rect } from './backdrop';
import type { RGB } from './core/legibility';

const NEUTRAL: RGB = [138 / 255, 143 / 255, 152 / 255];

/** Read a small patch of the same source uploaded to WebGL, never the DOM's guessed colour. */
export class BackdropSampler {
  private ctx: CanvasRenderingContext2D | null = null;
  private unreadable = new WeakSet<Backdrop>();

  sample(backdrop: Backdrop, area: Rect, icon: DOMRect, neutral: boolean): RGB {
    if (neutral || !backdrop.source || this.unreadable.has(backdrop)) return NEUTRAL;
    if (!this.ctx) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 8;
      this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = this.ctx;
    if (!ctx || area.w <= 0 || area.h <= 0) return NEUTRAL;
    const w = backdrop.width, h = backdrop.height;
    const size = Math.min(icon.width, icon.height);
    const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
    const x = clamp((icon.left + (icon.width - size) / 2 - area.x) / area.w * w, w - 1);
    const y = clamp((icon.top + (icon.height - size) / 2 - area.y) / area.h * h, h - 1);
    const sw = Math.max(1, Math.min(w - x, size / area.w * w));
    const sh = Math.max(1, Math.min(h - y, size / area.h * h));
    try {
      ctx.clearRect(0, 0, 8, 8);
      ctx.drawImage(backdrop.source as CanvasImageSource, x, y, sw, sh, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i + 1]; b += data[i + 2];
      }
      return [r / (64 * 255), g / (64 * 255), b / (64 * 255)];
    } catch {
      // Reset a tainted sampling canvas before another, readable source uses it.
      this.ctx = null;
      this.unreadable.add(backdrop);
      return NEUTRAL;
    }
  }
}
