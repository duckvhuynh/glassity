/** A small count-bounded cache; reads and replacements make an entry recent. */
export class LruCache<K, V> {
  private entries = new Map<K, V>();

  constructor(private readonly capacity: number) {}

  get size(): number { return this.entries.size; }

  peek(key: K): V | undefined { return this.entries.get(key); }

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (this.entries.has(key)) {
      this.entries.delete(key);
      this.entries.set(key, value!);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    if (this.capacity <= 0) return;
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }

  delete(key: K): void { this.entries.delete(key); }

  clear(): void { this.entries.clear(); }
}

/** Pending requests share the same limit as settled ones; a failed load can retry. */
export function cachedLoad<K, V>(cache: LruCache<K, Promise<V | null>>, key: K, load: () => Promise<V | null>): Promise<V | null> {
  const known = cache.get(key);
  if (known) return known;
  const pending = Promise.resolve().then(load);
  cache.set(key, pending);
  const discard = () => {
    // An evicted request can finish after a newer request for the same key.
    if (cache.peek(key) === pending) cache.delete(key);
  };
  void pending.then((value) => { if (value === null) discard(); }, discard);
  return pending;
}
