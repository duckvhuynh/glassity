import { describe, expect, it, vi } from 'vitest';
import { cachedLoad, LruCache } from '../src/core/lru';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('LruCache', () => {
  it('evicts the least recently read entry', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('refreshes a replacement without evicting another entry', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 4);
    expect(cache.size).toBe(2);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(4);
  });

  it('peeks without changing recency', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.peek('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it('stays bounded through repeated additions and can release entries', () => {
    const cache = new LruCache<number, object>(32);
    for (let i = 0; i < 1000; i++) {
      cache.set(i, { i });
      expect(cache.size).toBeLessThanOrEqual(32);
    }
    expect(cache.peek(967)).toBeUndefined();
    expect(cache.peek(968)).toEqual({ i: 968 });
    cache.delete(999);
    cache.delete(999);
    expect(cache.size).toBe(31);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('can disable retention with a zero capacity', () => {
    const cache = new LruCache<string, number>(0);
    cache.set('a', 1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});

describe('cachedLoad', () => {
  it('deduplicates both pending and successful loads', async () => {
    const cache = new LruCache<string, Promise<string | null>>(2);
    const request = deferred<string | null>();
    const load = vi.fn(() => request.promise);
    const first = cachedLoad(cache, 'a', load);
    expect(cachedLoad(cache, 'a', load)).toBe(first);
    request.resolve('data');
    expect(await first).toBe('data');
    expect(cachedLoad(cache, 'a', load)).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts null and rejected results so a later refresh can retry', async () => {
    const cache = new LruCache<string, Promise<string | null>>(2);
    expect(await cachedLoad(cache, 'a', async () => null)).toBeNull();
    expect(cache.size).toBe(0);
    await expect(cachedLoad(cache, 'a', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(cache.size).toBe(0);
    expect(await cachedLoad(cache, 'a', async () => 'recovered')).toBe('recovered');
    expect(cache.size).toBe(1);
  });

  it('handles a synchronously throwing loader without retaining it', async () => {
    const cache = new LruCache<string, Promise<string | null>>(2);
    await expect(cachedLoad(cache, 'a', () => { throw new Error('blocked'); })).rejects.toThrow('blocked');
    expect(cache.size).toBe(0);
  });

  it('bounds pending loads without cancelling requests already in use', async () => {
    const cache = new LruCache<string, Promise<string | null>>(1);
    const a = deferred<string | null>();
    const b = deferred<string | null>();
    const first = cachedLoad(cache, 'a', () => a.promise);
    const second = cachedLoad(cache, 'b', () => b.promise);
    expect(cache.size).toBe(1);
    expect(cache.peek('a')).toBeUndefined();
    a.resolve('a');
    b.resolve('b');
    expect(await first).toBe('a');
    expect(await second).toBe('b');
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.peek('b')).toBe(second);
  });

  it('does not let an old failure evict a newer request for the same key', async () => {
    const cache = new LruCache<string, Promise<string | null>>(1);
    const old = deferred<string | null>();
    const first = cachedLoad(cache, 'a', () => old.promise);
    await cachedLoad(cache, 'b', async () => 'b');
    const replacement = cachedLoad(cache, 'a', async () => 'new');
    old.resolve(null);
    await first;
    expect(await replacement).toBe('new');
    expect(cache.peek('a')).toBe(replacement);
  });
});
