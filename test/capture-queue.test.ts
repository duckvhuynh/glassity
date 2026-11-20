import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureQueue, type CaptureContext } from '../src/capture-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('CaptureQueue', () => {
  it('deduplicates queued and running work with independent consumers', async () => {
    vi.useFakeTimers();
    const queue = new CaptureQueue();
    const capture = deferred<object>();
    const run = vi.fn(() => capture.promise);
    const ignored = vi.fn(async () => ({}));
    const a = queue.enqueue('region', run);
    const b = queue.enqueue('region', ignored);
    await vi.advanceTimersByTimeAsync(0);
    const c = queue.enqueue('region', ignored);
    const pixels = {};
    capture.resolve(pixels);
    expect(await a).toBe(pixels);
    expect(await b).toBe(pixels);
    expect(await c).toBe(pixels);
    expect(run).toHaveBeenCalledTimes(1);
    expect(ignored).not.toHaveBeenCalled();
    queue.dispose();
  });

  it('prioritizes visible consumers, re-reads priority and preserves FIFO ties', async () => {
    vi.useFakeTimers();
    const queue = new CaptureQueue();
    const order: string[] = [];
    let visible = false;
    const run = (name: string) => async () => { order.push(name); return name; };
    const a = queue.enqueue('a', run('a'));
    const b = queue.enqueue('b', run('b'), { priority: () => visible ? 10 : -10 });
    const c = queue.enqueue('c', run('c'));
    visible = true;
    await vi.runAllTimersAsync();
    await Promise.all([a, b, c]);
    expect(order).toEqual(['b', 'a', 'c']);
    queue.dispose();
  });

  it('uses the highest priority of a shared job and only runs one capture at once', async () => {
    vi.useFakeTimers();
    const queue = new CaptureQueue();
    const first = deferred<string>();
    const run = vi.fn(() => first.promise);
    const other = vi.fn(async () => 'other');
    const a = queue.enqueue('shared', run, { priority: -1 });
    const b = queue.enqueue('other', other, { priority: 5 });
    const c = queue.enqueue('shared', run, { priority: 10 });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    first.resolve('shared');
    await vi.runAllTimersAsync();
    expect(await Promise.all([a, b, c])).toEqual(['shared', 'other', 'shared']);
    queue.dispose();
  });

  it('cancels one subscriber without aborting the remaining capture', async () => {
    vi.useFakeTimers();
    const queue = new CaptureQueue();
    const controller = new AbortController();
    const capture = deferred<string>();
    let context!: CaptureContext;
    const a = queue.enqueue('a', async (next) => { context = next; return capture.promise; }, { signal: controller.signal });
    const rejected = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    const b = queue.enqueue('a', async () => 'ignored');
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    expect(context.signal.aborted).toBe(false);
    capture.resolve('kept');
    expect(await b).toBe('kept');
    queue.dispose();
  });

  it('does not start cancelled queued captures', async () => {
    vi.useFakeTimers();
    const queue = new CaptureQueue();
    const controller = new AbortController();
    const run = vi.fn(async () => 'old');
    const a = queue.enqueue('a', run, { signal: controller.signal });
    const rejected = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await vi.runAllTimersAsync();
    await rejected;
    expect(run).not.toHaveBeenCalled();
    queue.dispose();
  });

  it('aborts unused running work, releases the queue and discards stale completion', async () => {
    vi.useFakeTimers();
    const queue = new CaptureQueue();
    const controller = new AbortController();
    const stale = deferred<string>();
    let context!: CaptureContext;
    const a = queue.enqueue('a', async (next) => { context = next; return stale.promise; }, { signal: controller.signal });
    const rejected = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    const b = queue.enqueue('a', async () => 'new');
    await vi.runAllTimersAsync();
    expect(await b).toBe('new');
    expect(context.signal.aborted).toBe(true);
    stale.resolve('stale');
    await rejected;
    queue.dispose();
  });

  it('yields actual tasks when the slice budget is spent', async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const queue = new CaptureQueue(6);
    const steps: string[] = [];
    const result = queue.enqueue('a', async (context) => {
      setTimeout(() => steps.push('input'), 0);
      now += 2;
      await context.checkpoint();
      steps.push('same slice');
      now += 5;
      await context.checkpoint();
      steps.push('next slice');
      now += 7;
      setTimeout(() => steps.push('paint'), 0);
      await context.checkpoint();
      steps.push('last slice');
    });
    await vi.runAllTimersAsync();
    await result;
    expect(steps).toEqual(['same slice', 'input', 'next slice', 'paint', 'last slice']);
    queue.dispose();
  });

  it('checks cancellation before and after yielding', async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const queue = new CaptureQueue(6);
    const controller = new AbortController();
    const continued = vi.fn();
    const result = queue.enqueue('a', async (context) => {
      setTimeout(() => controller.abort(), 0);
      now += 7;
      await context.checkpoint();
      continued();
    }, { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.runAllTimersAsync();
    await rejected;
    expect(continued).not.toHaveBeenCalled();
    queue.dispose();
  });

  it('cleans up failures so they can be retried', async () => {
    vi.useFakeTimers();
    const queue = new CaptureQueue();
    const failed = queue.enqueue('a', () => { throw new Error('unreadable'); });
    const rejected = expect(failed).rejects.toThrow('unreadable');
    const next = queue.enqueue('b', async () => 'b');
    await vi.runAllTimersAsync();
    await rejected;
    expect(await next).toBe('b');
    const retried = queue.enqueue('a', async () => 'a');
    await vi.runAllTimersAsync();
    expect(await retried).toBe('a');
    queue.dispose();
  });

  it('rejects pending and active work on disposal and refuses new work', async () => {
    vi.useFakeTimers();
    const queue = new CaptureQueue();
    const active = deferred<string>();
    const a = queue.enqueue('a', () => active.promise);
    const b = queue.enqueue('b', async () => 'b');
    const assertions = [a, b].map((promise) => expect(promise).rejects.toMatchObject({ name: 'AbortError' }));
    await vi.advanceTimersByTimeAsync(0);
    queue.dispose();
    queue.dispose();
    await Promise.all(assertions);
    await expect(queue.enqueue('c', async () => 'c')).rejects.toMatchObject({ name: 'AbortError' });
    active.resolve('ignored');
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });
});
