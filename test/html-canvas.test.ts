import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHtmlCanvasCapture, htmlCanvasTesting, supportsHtmlCanvas } from '../src/html-canvas';

function fixture() {
  class Context {
    drawElementImage() {}
    drawImage = vi.fn();
    getImageData = vi.fn(() => ({}));
  }
  class Canvas extends EventTarget {
    content = 'fallback';
    width = 800;
    height = 400;
    offsetWidth = 400;
    offsetHeight = 200;
    ctx = new Context();
    requestPaint = vi.fn();
    glass: object | null = null;
    children: object[] = [];
    setAttribute(name: string, value: string) { if (name === 'content') this.content = value; }
    getContext = vi.fn(() => this.ctx);
    querySelector = vi.fn(() => this.glass);
    querySelectorAll = vi.fn(() => this.children);
    getBoundingClientRect = vi.fn(() => ({ left: 10, top: 20, width: 400, height: 200 }));
  }
  // requestPaint is checked on the platform prototype, as in a real browser.
  Canvas.prototype.requestPaint = vi.fn();
  const canvases: Canvas[] = [];
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('CanvasRenderingContext2D', Context);
  vi.stubGlobal('document', { createElement: () => { const canvas = new Canvas(); canvases.push(canvas); return canvas; } });
  vi.stubGlobal('window', { scrollX: 30, scrollY: 500, devicePixelRatio: 2 });
  vi.stubGlobal('getComputedStyle', () => ({}));
  const owner = new Canvas();
  owner.content = 'drawable';
  let drawable = true;
  const el = {
    hasAttribute: () => drawable,
    isConnected: true,
    parentElement: { closest: () => owner },
  } as unknown as Element;
  const onchange = vi.fn();
  return {
    owner, el, onchange, canvases,
    setDrawable(value: boolean) { drawable = value; },
    create(isOwn?: (node: Node) => boolean) { return createHtmlCanvasCapture(el, onchange, isOwn); },
    async paint() { owner.dispatchEvent(new Event('paint')); await Promise.resolve(); },
  };
}

afterEach(() => {
  htmlCanvasTesting.forceOff = false;
  vi.unstubAllGlobals();
});

describe('native HTML canvas detection', () => {
  it('is safe without a DOM and requires the runtime methods and reflected opt-in', () => {
    expect(supportsHtmlCanvas()).toBe(false);
    const f = fixture();
    expect(supportsHtmlCanvas()).toBe(true);
    vi.stubGlobal('CanvasRenderingContext2D', class {});
    expect(supportsHtmlCanvas()).toBe(false);
    expect(f.create()).toBeNull();
  });

  it('can be forced off through the internal switch or browser test flag', () => {
    fixture();
    htmlCanvasTesting.forceOff = true;
    expect(supportsHtmlCanvas()).toBe(false);
    htmlCanvasTesting.forceOff = false;
    vi.stubGlobal('__GLASSITY_DISABLE_HTML_CANVAS__', true);
    expect(supportsHtmlCanvas()).toBe(false);
  });

  it('leaves ordinary HTML alone even on a supporting browser', () => {
    const f = fixture();
    f.setDrawable(false);
    expect(f.create()).toBeNull();
    f.setDrawable(true);
    f.owner.content = 'fallback';
    expect(f.create()).toBeNull();
    expect(f.owner.requestPaint).not.toHaveBeenCalled();
    expect(f.owner.getContext).not.toHaveBeenCalled();
  });

  it('rejects owners containing glass, including icons found by custom selectors', () => {
    const f = fixture();
    f.owner.glass = {};
    expect(f.create()).toBeNull();
    f.owner.glass = null;
    const icon = {};
    f.owner.children = [icon];
    expect(f.create(node => node === icon)).toBeNull();
  });
});

describe('native HTML canvas capture', () => {
  const region = { x: 50, y: 540, w: 40, h: 30 };

  it('waits for paint and copies a sharp local region in document coordinates', async () => {
    const f = fixture();
    const capture = f.create()!;
    expect(f.owner.requestPaint).toHaveBeenCalledOnce();
    expect(capture.capture(region, 1024)).toBeNull();
    await f.paint();
    expect(f.onchange).toHaveBeenCalledOnce();
    const result = capture.capture(region, 1024)!;
    expect(result.scale).toBe(2);
    expect(result.canvas.width).toBe(80);
    expect(result.canvas.height).toBe(60);
    const ctx = f.canvases[f.canvases.length - 1].ctx;
    expect(ctx.drawImage).toHaveBeenCalledWith(f.owner, 20, 40, 80, 60, 0, 0, 80, 60);
    expect(ctx.getImageData).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(f.owner.getContext).not.toHaveBeenCalled();
    capture.dispose();
  });

  it('notifies after all application paint handlers and cancels queued notifications on disposal', async () => {
    const f = fixture();
    const capture = f.create()!;
    const order: string[] = [];
    f.onchange.mockImplementation(() => order.push('capture'));
    f.owner.addEventListener('paint', () => order.push('app'));
    f.owner.dispatchEvent(new Event('paint'));
    expect(order).toEqual(['app']);
    await Promise.resolve();
    expect(order).toEqual(['app', 'capture']);
    f.owner.dispatchEvent(new Event('paint'));
    capture.dispose();
    await Promise.resolve();
    expect(f.onchange).toHaveBeenCalledOnce();
    await f.paint();
    expect(f.onchange).toHaveBeenCalledOnce();
    expect(capture.capture(region, 1024)).toBeNull();
  });

  it('stops native capture if glass is inserted later', async () => {
    const f = fixture();
    const capture = f.create()!;
    await f.paint();
    f.owner.glass = {};
    expect(capture.capture(region, 1024)).toBeNull();
    await f.paint();
    expect(f.onchange).toHaveBeenCalledOnce();
  });

  it('returns null after a readback failure and stops requesting updates', async () => {
    const f = fixture();
    const capture = f.create()!;
    await f.paint();
    const originalCreate = document.createElement;
    vi.spyOn(document, 'createElement').mockImplementation((() => {
      const canvas = originalCreate('canvas');
      const ctx = canvas.getContext('2d')!;
      vi.spyOn(ctx, 'getImageData').mockImplementation(() => { throw new Error('tainted'); });
      return canvas;
    }) as typeof document.createElement);
    expect(capture.capture(region, 1024)).toBeNull();
    await f.paint();
    expect(f.onchange).toHaveBeenCalledOnce();
  });

  it('cleans up after a requestPaint failure', async () => {
    const f = fixture();
    f.owner.requestPaint.mockImplementation(() => { throw new Error('unavailable'); });
    expect(f.create()).toBeNull();
    await f.paint();
    expect(f.onchange).not.toHaveBeenCalled();
  });
});
