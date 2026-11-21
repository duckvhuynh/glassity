/**
 * HTML-in-Canvas is not a general DOM screenshot API. Chrome's drawable elements
 * and ElementImages are bound to their owning canvas, including on workers.
 * Reuse that canvas's painted bitmap; never move framework DOM into a new canvas.
 * Ordinary HTML, unsupported builds and unreadable canvases use snapshots instead.
 * API: https://developer.chrome.com/docs/web-platform/html-in-canvas/concepts
 */

interface DrawableCanvas extends HTMLCanvasElement {
  content: string;
  requestPaint(): void;
}

export interface HtmlCanvasRegion {
  /** Document CSS coordinates, not viewport coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HtmlCanvasCapture {
  capture(region: HtmlCanvasRegion, maxSize: number): { canvas: HTMLCanvasElement; scale: number } | null;
  dispose(): void;
}

/** Internal test switch. Deliberately not re-exported by any package entry point. */
export const htmlCanvasTesting = { forceOff: false };

/** All native API detection lives here; version strings are never consulted. */
export function supportsHtmlCanvas(): boolean {
  if (htmlCanvasTesting.forceOff || (globalThis as { __GLASSITY_DISABLE_HTML_CANVAS__?: boolean }).__GLASSITY_DISABLE_HTML_CANVAS__) return false;
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined' || typeof CanvasRenderingContext2D === 'undefined') return false;
  const prototype = HTMLCanvasElement.prototype as Partial<DrawableCanvas>;
  const context = CanvasRenderingContext2D.prototype as CanvasRenderingContext2D & { drawElementImage?: unknown };
  if (typeof prototype.requestPaint !== 'function' || typeof context.drawElementImage !== 'function') return false;
  const probe = document.createElement('canvas') as DrawableCanvas;
  probe.setAttribute('content', 'drawable');
  return probe.content === 'drawable';
}

/**
 * Only an already-painted drawable subtree can be live without taking over the
 * page's renderer. Copying its owner's bitmap also preserves its drawn transforms.
 * Native snapshots cannot omit our icons, so reject any owner containing glass.
 */
export function createHtmlCanvasCapture(
  el: Element,
  onchange: () => void,
  isOwn?: (node: Node) => boolean,
): HtmlCanvasCapture | null {
  if (!supportsHtmlCanvas() || !el.hasAttribute('drawable')) return null;
  const owner = el.parentElement?.closest('canvas') as DrawableCanvas | null;
  if (!owner || owner.content !== 'drawable') return null;
  const containsGlass = () => !!owner.querySelector('[data-glass], [data-glassity-hidden], [data-glassity-canvas]') ||
    !!isOwn && (isOwn(owner) || Array.from(owner.querySelectorAll('svg, canvas')).some(isOwn));
  if (containsGlass()) return null;
  let disposed = false;
  let painted = false;
  let queued = false;
  const dispose = () => {
    disposed = true;
    owner.removeEventListener('paint', onPaint);
  };
  const onPaint = () => {
    if (disposed || queued) return;
    queued = true;
    // App paint listeners must finish drawing before the capture queue reads it.
    queueMicrotask(() => {
      queued = false;
      if (disposed) return;
      painted = true;
      onchange();
    });
  };
  owner.addEventListener('paint', onPaint);
  try {
    owner.requestPaint();
  } catch {
    dispose();
    return null;
  }
  return {
    capture(region, maxSize) {
      if (disposed || !painted || !supportsHtmlCanvas()) return null;
      if (!el.isConnected || el.parentElement?.closest('canvas') !== owner || owner.content !== 'drawable' || containsGlass()) {
        dispose();
        return null;
      }
      const box = owner.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0 || owner.width <= 0 || owner.height <= 0 || region.w <= 0 || region.h <= 0 || maxSize <= 0) return null;
      const style = getComputedStyle(owner);
      const px = (value: string) => parseFloat(value) || 0;
      // The bitmap fills the content box, excluding the canvas border and padding.
      const left = px(style.borderLeftWidth) + px(style.paddingLeft);
      const top = px(style.borderTopWidth) + px(style.paddingTop);
      const right = px(style.borderRightWidth) + px(style.paddingRight);
      const bottom = px(style.borderBottomWidth) + px(style.paddingBottom);
      const cssScaleX = owner.offsetWidth ? box.width / owner.offsetWidth : 1;
      const cssScaleY = owner.offsetHeight ? box.height / owner.offsetHeight : 1;
      const contentW = box.width - (left + right) * cssScaleX;
      const contentH = box.height - (top + bottom) * cssScaleY;
      if (contentW <= 0 || contentH <= 0) return null;
      const scale = Math.min(window.devicePixelRatio || 1, 2, maxSize / Math.max(region.w, region.h), Math.sqrt(4_194_304 / (region.w * region.h)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(region.w * scale));
      canvas.height = Math.max(1, Math.round(region.h * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      try {
        const x = box.left + window.scrollX + left * cssScaleX;
        const y = box.top + window.scrollY + top * cssScaleY;
        ctx.drawImage(owner,
          (region.x - x) * owner.width / contentW, (region.y - y) * owner.height / contentH,
          region.w * owner.width / contentW, region.h * owner.height / contentH,
          0, 0, canvas.width, canvas.height);
        // Fail here instead of replacing the last good texture with a tainted one.
        ctx.getImageData(0, 0, 1, 1);
        return { canvas, scale };
      } catch {
        dispose();
        return null;
      }
    },
    dispose,
  };
}
