import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Backdrop } from '../src/backdrop';
import { rasterAlpha, type RasterPlan } from '../src/core/raster';
import { Engine } from '../src/engine';
import { Renderer, type BackTexture, type FieldTexture } from '../src/gl/renderer';

vi.mock('../src/core/raster', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/core/raster')>(),
  rasterAlpha: vi.fn(),
}));

class ImageSource {
  currentSrc = 'https://example.test/first.png';
  src = this.currentSrc;
}

class TestBackdrop extends Backdrop {
  constructor(source: TexImageSource) {
    super();
    this.source = source;
    this.width = 8;
    this.height = 4;
    this.version = 1;
  }
  rect() { return { x: 0, y: 0, w: 8, h: 4 }; }
  dispose = vi.fn();
}

function fixture() {
  let now = 0;
  let nextId = 0;
  const failing = new Set<TexImageSource>();
  const renderer = {
    ready: true,
    state: 'ready',
    generation: 1,
    maxTextureSize: 2048,
    onstatechange: null as (() => void) | null,
    onrestore: null as (() => void) | null,
    release: vi.fn(),
    createField: vi.fn((_data: Float32Array, w: number, h: number): FieldTexture => ({
      texture: { id: ++nextId } as WebGLTexture, w, h, generation: renderer.generation,
    })),
    uploadBack: vi.fn((_existing: BackTexture | null, source: TexImageSource, w: number, h: number): BackTexture => {
      if (failing.has(source)) throw new Error('upload failed');
      return { texture: { id: ++nextId } as WebGLTexture, w, h, maxLod: 1, generation: renderer.generation };
    }),
  };
  vi.spyOn(Renderer, 'create').mockReturnValue(renderer as unknown as Renderer);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('HTMLImageElement', ImageSource);
  vi.stubGlobal('HTMLVideoElement', class {});
  class Canvas {
    width = 0;
    height = 0;
    getContext() { return { fillStyle: '', fillRect() {} }; }
  }
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('matchMedia', undefined);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const engine = new Engine();
  const image = new ImageSource();
  const source = image as unknown as HTMLImageElement;
  const backdrop = new TestBackdrop(source);
  return {
    engine, renderer, image, source, backdrop, failing,
    time(value: number) { now = value; },
    attempts(media: TexImageSource = source) {
      return renderer.uploadBack.mock.calls.filter(([, candidate]) => candidate === media).length;
    },
  };
}

// Subscribe without mounting DOM icons: these tests exercise resource ownership and scheduling.
function subscribers(engine: Engine, backdrop: Backdrop) {
  const first = { element: {} as SVGSVGElement, backdrop, dirty: false, onscreen: true, suspend: vi.fn() };
  const second = { element: {} as SVGSVGElement, backdrop, dirty: false, onscreen: false, suspend: vi.fn() };
  const instances = (engine as unknown as { instances: Map<SVGSVGElement, typeof first> }).instances;
  instances.set(first.element, first);
  instances.set(second.element, second);
  return [first, second];
}

const plan: RasterPlan = {
  boxW: 4, boxH: 4, unit: 4, bleed: 0, cssW: 4, cssH: 4, gw: 4, gh: 4, scale: 1,
};
const alpha = new Uint8ClampedArray([
  0, 0, 0, 0,
  0, 255, 255, 0,
  0, 255, 255, 0,
  0, 0, 0, 0,
]);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(rasterAlpha).mockReset().mockResolvedValue(alpha);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('engine backdrop retries', () => {
  it('makes a static failed backdrop eligible again and invalidates every sharing icon on recovery', () => {
    const f = fixture();
    const icons = subscribers(f.engine, f.backdrop);
    f.failing.add(f.source);
    const fallback = f.engine.backTexture(f.backdrop);
    expect(fallback.neutral).toBe(true);
    expect(f.attempts()).toBe(1);
    expect(f.engine.backdropNeedsRetry(f.backdrop, 249)).toBe(false);
    f.time(249);
    expect(f.engine.backTexture(f.backdrop).texture).toBe(fallback.texture);
    expect(f.attempts()).toBe(1);
    expect(icons.every((icon) => !icon.dirty)).toBe(true);
    // No version change or animation is needed to wake a static failed backdrop.
    expect(f.engine.backdropNeedsRetry(f.backdrop, 250)).toBe(true);
    f.time(250);
    f.failing.delete(f.source);
    const recovered = f.engine.backTexture(f.backdrop);
    expect(recovered.neutral).toBe(false);
    expect(f.attempts()).toBe(2);
    expect(icons.every((icon) => icon.dirty)).toBe(true);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(f.engine.backdropNeedsRetry(f.backdrop, 1000)).toBe(false);
    expect(f.engine.backTexture(f.backdrop).texture).toBe(recovered.texture);
    expect(f.attempts()).toBe(2);
  });

  it('keeps the last good texture and exponential backoff despite live version churn', () => {
    const f = fixture();
    const original = f.engine.backTexture(f.backdrop);
    f.failing.add(f.source);
    f.backdrop.live = true;
    f.backdrop.version++;
    expect(f.engine.backTexture(f.backdrop)).toEqual(original);
    expect(f.attempts()).toBe(2);
    for (const now of [1, 16, 100, 249]) {
      f.time(now);
      f.backdrop.version++;
      expect(f.engine.backTexture(f.backdrop)).toEqual(original);
    }
    expect(f.attempts()).toBe(2);
    f.time(250);
    f.engine.backTexture(f.backdrop);
    expect(f.attempts()).toBe(3);
    f.time(749);
    f.backdrop.version++;
    f.engine.backTexture(f.backdrop);
    expect(f.attempts()).toBe(3);
    expect(f.engine.backdropNeedsRetry(f.backdrop, 749)).toBe(false);
    expect(f.engine.backdropNeedsRetry(f.backdrop, 750)).toBe(true);
    f.time(750);
    f.engine.backTexture(f.backdrop);
    expect(f.attempts()).toBe(4);
    expect(f.engine.backdropNeedsRetry(f.backdrop, 1749)).toBe(false);
    expect(f.engine.backdropNeedsRetry(f.backdrop, 1750)).toBe(true);
  });

  it('retries a changed currentSrc on the same element and a replaced source before the old delay expires', () => {
    const f = fixture();
    f.failing.add(f.source);
    f.engine.backTexture(f.backdrop);
    f.time(10);
    f.image.currentSrc = 'https://example.test/second.png';
    f.failing.delete(f.source);
    expect(f.engine.backTexture(f.backdrop).neutral).toBe(false);
    expect(f.attempts()).toBe(2);
    f.failing.add(f.source);
    f.backdrop.version++;
    f.engine.backTexture(f.backdrop);
    expect(f.attempts()).toBe(3);
    const replacement = new ImageSource() as unknown as HTMLImageElement;
    f.backdrop.source = replacement;
    f.time(20);
    expect(f.engine.backTexture(f.backdrop).neutral).toBe(false);
    expect(f.attempts(replacement)).toBe(1);
    expect(f.engine.backdropNeedsRetry(f.backdrop, 20)).toBe(false);
  });

  it('allows refresh and context restoration to retry unchanged pixels immediately', () => {
    const f = fixture();
    const icons = subscribers(f.engine, f.backdrop);
    f.failing.add(f.source);
    f.engine.backTexture(f.backdrop);
    f.time(10);
    f.engine.retryBackdrop(f.backdrop); // The reset used by GlassHandle.refresh().
    f.engine.backTexture(f.backdrop);
    expect(f.attempts()).toBe(2);
    expect(f.engine.backdropNeedsRetry(f.backdrop, 259)).toBe(false);
    expect(f.engine.backdropNeedsRetry(f.backdrop, 260)).toBe(true);
    f.renderer.ready = false;
    f.renderer.state = 'lost';
    f.renderer.onstatechange?.();
    expect(icons.every((icon) => icon.suspend.mock.calls.length === 1)).toBe(true);
    f.renderer.generation++;
    f.renderer.ready = true;
    f.renderer.state = 'ready';
    f.renderer.onrestore?.();
    expect(icons.every((icon) => icon.dirty)).toBe(true);
    f.failing.delete(f.source);
    const recovered = f.engine.backTexture(f.backdrop);
    expect(f.attempts()).toBe(3);
    expect(recovered.neutral).toBe(false);
    expect(recovered.texture.generation).toBe(2);
  });
});

describe('engine resource ownership', () => {
  it('shares asynchronous geometry, reuploads retained field data, and releases only the last owner', async () => {
    const f = fixture();
    let complete!: (value: Uint8ClampedArray) => void;
    vi.mocked(rasterAlpha).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    const first = f.engine.acquireGeometry('shared', '<svg/>', plan, 0);
    const second = f.engine.acquireGeometry('shared', '<svg/>', plan, 0);
    expect(rasterAlpha).toHaveBeenCalledTimes(1);
    complete(alpha);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(a.refs).toBe(2);
    const initial = f.engine.fieldTexture(a);
    expect(f.engine.fieldTexture(b)).toBe(initial);
    expect(f.renderer.createField).toHaveBeenCalledTimes(1);
    f.renderer.generation++;
    const restored = f.engine.fieldTexture(a);
    expect(restored.generation).toBe(2);
    expect(f.renderer.createField).toHaveBeenLastCalledWith(a.data, plan.gw, plan.gh);
    expect(f.engine.fieldTexture(b)).toBe(restored);
    expect(f.renderer.createField).toHaveBeenCalledTimes(2);
    f.engine.releaseGeometry(a);
    expect(a.refs).toBe(1);
    expect(f.renderer.release).not.toHaveBeenCalled();
    f.engine.releaseGeometry(b);
    f.engine.releaseGeometry(b);
    expect(a.refs).toBe(0);
    expect(a.texture).toBeNull();
    expect(f.renderer.release.mock.calls).toEqual([[restored]]);
    const next = await f.engine.acquireGeometry('shared', '<svg/>', plan, 0);
    expect(next).not.toBe(a);
    expect(rasterAlpha).toHaveBeenCalledTimes(2);
    f.engine.releaseGeometry(next);
  });

  it('reserves a pending reacquisition before the last resolved owner releases', async () => {
    const f = fixture();
    const original = await f.engine.acquireGeometry('shared', '<svg/>', plan, 0);
    const texture = f.engine.fieldTexture(original);
    const pending = f.engine.acquireGeometry('shared', '<svg/>', plan, 0);
    f.engine.releaseGeometry(original);
    // The await in acquireGeometry has not resumed, but its lease must already exist.
    expect(f.renderer.release).not.toHaveBeenCalled();
    const another = f.engine.acquireGeometry('shared', '<svg/>', plan, 0);
    const [a, b] = await Promise.all([pending, another]);
    expect(a).toBe(original);
    expect(b).toBe(original);
    expect(a.refs).toBe(2);
    expect(rasterAlpha).toHaveBeenCalledTimes(1);
    expect(f.engine.fieldTexture(a)).toBe(texture);
    f.engine.releaseGeometry(a);
    expect(f.renderer.release).not.toHaveBeenCalled();
    f.engine.releaseGeometry(b);
    f.engine.releaseGeometry(original);
    expect(f.renderer.release.mock.calls).toEqual([[texture]]);
  });

  it('drops a rejected shared geometry request so a later acquisition can succeed', async () => {
    const f = fixture();
    vi.mocked(rasterAlpha).mockRejectedValueOnce(new Error('image decode failed'));
    const results = await Promise.allSettled([
      f.engine.acquireGeometry('retry', '<svg/>', plan, 0),
      f.engine.acquireGeometry('retry', '<svg/>', plan, 0),
    ]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(rasterAlpha).toHaveBeenCalledTimes(1);
    const recovered = await f.engine.acquireGeometry('retry', '<svg/>', plan, 0);
    expect(recovered.refs).toBe(1);
    expect(recovered.empty).toBe(false);
    expect(rasterAlpha).toHaveBeenCalledTimes(2);
    f.engine.releaseGeometry(recovered);
  });

  it('disposes a shared backdrop and its texture exactly once at the last release', () => {
    const f = fixture();
    f.backdrop.refs = 2;
    f.backdrop.onchange = vi.fn();
    const uploaded = f.engine.backTexture(f.backdrop);
    f.engine.releaseBackdrop(f.backdrop);
    expect(f.backdrop.refs).toBe(1);
    expect(f.renderer.release).not.toHaveBeenCalled();
    expect(f.backdrop.dispose).not.toHaveBeenCalled();
    f.engine.releaseBackdrop(f.backdrop);
    f.engine.releaseBackdrop(f.backdrop);
    expect(f.backdrop.refs).toBe(0);
    expect(f.backdrop.onchange).toBeNull();
    expect(f.renderer.release.mock.calls).toEqual([[uploaded.texture]]);
    expect(f.backdrop.dispose).toHaveBeenCalledTimes(1);
  });
});
