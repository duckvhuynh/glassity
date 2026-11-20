import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotBackdrop } from '../src/backdrop';
import { CaptureQueue } from '../src/capture-queue';
import { snapshot, SnapshotBudgetError, type SnapshotResult } from '../src/snapshot';

vi.mock('../src/snapshot', () => ({
  snapshot: vi.fn(),
  pageColor: () => '#fff',
  SnapshotBudgetError: class extends Error {},
}));
vi.mock('../src/html-canvas', () => ({ createHtmlCanvasCapture: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function pixels(size = 768): SnapshotResult {
  return { canvas: { width: size, height: size } as HTMLCanvasElement, scale: 1 };
}

function fixture() {
  const events = new EventTarget();
  const removeEventListener = vi.spyOn(events, 'removeEventListener');
  vi.stubGlobal('window', Object.assign(events, { setTimeout, scrollX: 0, scrollY: 0, innerWidth: 1024, innerHeight: 768 }));
  vi.stubGlobal('scrollX', 0);
  vi.stubGlobal('scrollY', 0);
  vi.stubGlobal('devicePixelRatio', 1);
  const resizeDisconnect = vi.fn();
  const mutationDisconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = resizeDisconnect; });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect = mutationDisconnect; });
  vi.stubGlobal('document', {
    body: {}, documentElement: {},
    createElement: () => ({ width: 2, height: 2, getContext: () => ({ fillStyle: '', fillRect() {} }) }),
  });
  vi.stubGlobal('getComputedStyle', () => ({ backgroundAttachment: 'scroll' }));
  const el = {
    offsetWidth: 1024, offsetHeight: 12000,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1024, height: 12000 }),
  } as unknown as Element;
  const queue = new CaptureQueue();
  const create = (y = 1000) => new SnapshotBackdrop(el, {
    mode: 'dom', maxSize: 2560, queue, priority: () => 1, isOwn: () => false,
    region: { x: 100, y, w: 768, h: 768, key: `100,${y},768` },
  });
  return { queue, create, events, removeEventListener, resizeDisconnect, mutationDisconnect };
}

beforeEach(() => { vi.useFakeTimers(); vi.mocked(snapshot).mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('SnapshotBackdrop capture lifecycle', () => {
  it('keeps the last good capture while refreshing and ignores superseded results', async () => {
    const f = fixture();
    const first = pixels();
    const stale = deferred<SnapshotResult>();
    const latest = deferred<SnapshotResult>();
    vi.mocked(snapshot).mockResolvedValueOnce(first).mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
    const backdrop = f.create();
    await vi.runAllTimersAsync();
    expect(backdrop.source).toBe(first.canvas);
    backdrop.refresh();
    await vi.runAllTimersAsync();
    const staleSignal = vi.mocked(snapshot).mock.calls[1][1].work!.signal;
    expect(backdrop.source).toBe(first.canvas);
    backdrop.refresh();
    expect(staleSignal.aborted).toBe(true);
    await vi.runAllTimersAsync();
    const next = pixels(512);
    latest.resolve(next);
    await vi.runAllTimersAsync();
    expect(backdrop.source).toBe(next.canvas);
    expect(backdrop.width).toBe(512);
    const version = backdrop.version;
    stale.resolve(pixels(128));
    await vi.runAllTimersAsync();
    expect(backdrop.source).toBe(next.canvas);
    expect(backdrop.version).toBe(version);
    backdrop.dispose();
    f.queue.dispose();
  });

  it('cancels on disposal, removes observers/listeners and never publishes late pixels', async () => {
    const f = fixture();
    const capture = deferred<SnapshotResult>();
    vi.mocked(snapshot).mockReturnValue(capture.promise);
    const backdrop = f.create();
    const onchange = backdrop.onchange = vi.fn();
    await vi.runAllTimersAsync();
    const signal = vi.mocked(snapshot).mock.calls[0][1].work!.signal;
    const previous = backdrop.source;
    backdrop.dispose();
    expect(signal.aborted).toBe(true);
    capture.resolve(pixels());
    await vi.runAllTimersAsync();
    expect(backdrop.source).toBe(previous);
    expect(onchange).not.toHaveBeenCalled();
    expect(f.resizeDisconnect).toHaveBeenCalled();
    expect(f.mutationDisconnect).toHaveBeenCalled();
    expect(f.removeEventListener.mock.calls.map(([type]) => type)).toEqual(['resize', 'scroll']);
    f.queue.dispose();
  });

  it('carries the old capture and its document coordinates across a region change', async () => {
    const f = fixture();
    const capture = pixels();
    vi.mocked(snapshot).mockResolvedValueOnce(capture).mockReturnValueOnce(new Promise(() => {}));
    const previous = f.create();
    await vi.runAllTimersAsync();
    const next = f.create(1512);
    next.keepLast(previous);
    expect(next.source).toBe(capture.canvas);
    expect(next.rect()).toEqual({ x: 100, y: 1000, w: 768, h: 768 });
    vi.stubGlobal('scrollX', 40);
    vi.stubGlobal('scrollY', 900);
    expect(next.rect()).toEqual({ x: 60, y: 100, w: 768, h: 768 });
    previous.dispose();
    next.dispose();
    f.queue.dispose();
    await vi.runAllTimersAsync();
  });

  it('falls back only for the failed capture and retries DOM on the next refresh', async () => {
    const f = fixture();
    const background = pixels();
    vi.mocked(snapshot).mockRejectedValueOnce(new SnapshotBudgetError()).mockResolvedValueOnce(background).mockResolvedValueOnce(pixels());
    const backdrop = f.create();
    await vi.runAllTimersAsync();
    expect(backdrop.source).toBe(background.canvas);
    expect(vi.mocked(snapshot).mock.calls.map(([, request]) => request.mode)).toEqual(['dom', 'background']);
    expect(vi.mocked(snapshot).mock.calls[1][1].region).toMatchObject({ x: 100, y: 1000, w: 768, h: 768 });
    backdrop.refresh();
    await vi.runAllTimersAsync();
    expect(vi.mocked(snapshot).mock.calls[2][1].mode).toBe('dom');
    backdrop.dispose();
    f.queue.dispose();
  });

  it('debounces scroll recapture while retaining the current image', async () => {
    const f = fixture();
    const capture = pixels();
    vi.mocked(snapshot).mockResolvedValue(capture);
    const backdrop = f.create();
    await vi.runAllTimersAsync();
    f.events.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(60);
    f.events.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(60);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(backdrop.source).toBe(capture.canvas);
    await vi.runAllTimersAsync();
    expect(snapshot).toHaveBeenCalledTimes(2);
    backdrop.dispose();
    f.queue.dispose();
  });
});
