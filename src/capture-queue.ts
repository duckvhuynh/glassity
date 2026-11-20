export interface CaptureContext {
  readonly signal: AbortSignal;
  /** Check between small pieces of CPU work, including after asynchronous reads. */
  checkpoint(): Promise<void>;
}

export interface CaptureOptions {
  signal?: AbortSignal;
  /** Larger values run first. Functions are re-read when a queued job is selected. */
  priority?: number | (() => number);
}

type CaptureKey = object | string;

interface Consumer {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  priority: CaptureOptions['priority'];
  cleanup(): void;
}

interface Job {
  key: CaptureKey;
  run(context: CaptureContext): Promise<unknown>;
  controller: AbortController;
  consumers: Set<Consumer>;
}

function cancelled(): DOMException {
  return new DOMException('Capture cancelled', 'AbortError');
}

function priority(job: Job): number {
  let highest = -Infinity;
  for (const consumer of job.consumers) {
    const value = typeof consumer.priority === 'function' ? consumer.priority() : consumer.priority ?? 0;
    highest = Math.max(highest, Number.isFinite(value) ? value : 0);
  }
  return highest;
}

/** One engine's captures share a CPU budget; duplicate requests share the work. */
export class CaptureQueue {
  private readonly jobs = new Map<CaptureKey, Job>();
  private active: Job | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly sliceMs: number;

  constructor(sliceMs = 6) {
    this.sliceMs = Math.max(1, Math.min(16, sliceMs));
  }

  /** The key must include everything that changes the captured pixels, including the region. */
  enqueue<T>(key: CaptureKey, run: (context: CaptureContext) => Promise<T>, options: CaptureOptions = {}): Promise<T> {
    if (this.disposed || options.signal?.aborted) return Promise.reject(options.signal?.reason ?? cancelled());
    let job = this.jobs.get(key);
    if (!job) {
      job = { key, run, controller: new AbortController(), consumers: new Set() };
      this.jobs.set(key, job);
    }
    const current = job;
    const result = new Promise<T>((resolve, reject) => {
      const signal = options.signal;
      const consumer: Consumer = {
        resolve: (value) => resolve(value as T), reject, priority: options.priority,
        cleanup: () => signal?.removeEventListener('abort', abort),
      };
      const abort = () => {
        current.consumers.delete(consumer);
        consumer.cleanup();
        reject(signal?.reason ?? cancelled());
        if (!current.consumers.size) {
          if (this.jobs.get(key) === current) this.jobs.delete(key);
          current.controller.abort();
        }
      };
      current.consumers.add(consumer);
      signal?.addEventListener('abort', abort, { once: true });
    });
    this.schedule();
    return result;
  }

  private schedule(): void {
    if (this.disposed || this.active || this.timer !== null || !this.jobs.size) return;
    // A task boundary lets the frame render and combines requests from the same scan.
    this.timer = setTimeout(() => {
      this.timer = null;
      let next: Job | null = null;
      let highest = -Infinity;
      for (const job of this.jobs.values()) {
        const value = priority(job);
        if (!next || value > highest) { next = job; highest = value; }
      }
      if (next) void this.execute(next);
    }, 0);
  }

  private async execute(job: Job): Promise<void> {
    this.active = job;
    const signal = job.controller.signal;
    let start = performance.now();
    let stop!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      stop = () => reject(signal.reason ?? cancelled());
      signal.addEventListener('abort', stop, { once: true });
    });
    const context: CaptureContext = {
      signal,
      checkpoint: async () => {
        signal.throwIfAborted();
        if (performance.now() - start < this.sliceMs) return;
        // A resolved promise only yields to microtasks, starving paint and input.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        signal.throwIfAborted();
        start = performance.now();
      },
    };
    try {
      const value = await Promise.race([Promise.resolve().then(() => {
        signal.throwIfAborted();
        return job.run(context);
      }), aborted]);
      signal.throwIfAborted();
      for (const consumer of job.consumers) consumer.resolve(value);
    } catch (error) {
      for (const consumer of job.consumers) consumer.reject(error);
    } finally {
      signal.removeEventListener('abort', stop);
      for (const consumer of job.consumers) consumer.cleanup();
      job.consumers.clear();
      // An aborted request may already have been replaced under this key.
      if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
      if (this.active === job) this.active = null;
      this.schedule();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const job of this.jobs.values()) {
      for (const consumer of job.consumers) {
        consumer.cleanup();
        consumer.reject(cancelled());
      }
      job.consumers.clear();
      job.controller.abort();
    }
    this.jobs.clear();
  }
}
