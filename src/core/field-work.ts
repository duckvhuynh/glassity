import { buildFieldSteps } from './field';

interface FieldWorkOptions {
  signal?: AbortSignal;
  sliceMs?: number;
  /** Injectable clock and task boundary for deterministic scheduling tests. */
  now?: () => number;
  yieldTask?: () => Promise<void>;
}

function yieldTask(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
}

/** Build the same field without keeping the main thread through all the disc painting. */
export async function buildFieldAsync(
  alpha: ArrayLike<number>, w: number, h: number, unit: number, options: FieldWorkOptions = {},
): Promise<Float32Array> {
  const now = options.now ?? (() => performance.now());
  const pause = options.yieldTask ?? yieldTask;
  const budget = Math.max(1, Math.min(8, options.sliceMs ?? 4));
  const work = buildFieldSteps(alpha, w, h, unit);
  options.signal?.throwIfAborted();
  // Raster decodes can resolve together. Even their first slices need separate tasks.
  await pause();
  for (;;) {
    options.signal?.throwIfAborted();
    const deadline = now() + budget;
    let steps = 0;
    for (;;) {
      const next = work.next();
      if (next.done) return next.value;
      // Each step is a scanline or at most 2048 simple pixel operations.
      if (++steps % 16 === 0 && now() >= deadline) break;
    }
    await pause();
  }
}
