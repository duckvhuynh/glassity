import { describe, expect, it, vi } from 'vitest';
import { buildField } from '../src/core/field';
import { buildFieldAsync } from '../src/core/field-work';

describe('sliced field builds', () => {
  it.each([32, 96, 300])('matches synchronous fields exactly at size %i, including coarse thickness', async (size) => {
    const alpha = new Uint8ClampedArray(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2, y - size / 2);
      alpha[y * size + x] = d < size * 0.36 && d > size * 0.12 ? 255 : d < size * 0.37 ? 64 : 0;
    }
    const expected = buildField(alpha, size, size, size);
    const actual = await buildFieldAsync(alpha, size, size, size);
    expect(actual).toEqual(expected);
  });

  it('crosses a task boundary before reading alpha, and slices expensive filled shapes', async () => {
    let reads = 0;
    let time = 0;
    const source = new Float32Array(128 * 128).fill(1);
    const alpha = new Proxy(source, {
      get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, target);
      },
    });
    const pause = vi.fn(async () => {});
    const pending = buildFieldAsync(alpha, 128, 128, 128, { now: () => time++, sliceMs: 1, yieldTask: pause });
    expect(reads).toBe(0);
    await pending;
    expect(reads).toBeGreaterThan(0);
    expect(pause.mock.calls.length).toBeGreaterThan(10);
  });

  it('cancels before starting and between slices', async () => {
    const controller = new AbortController();
    const reason = new Error('stale geometry');
    const pause = vi.fn(async () => { controller.abort(reason); });
    await expect(buildFieldAsync(new Uint8Array(64), 8, 8, 8, {
      signal: controller.signal, yieldTask: pause,
    })).rejects.toBe(reason);
    expect(pause).toHaveBeenCalledTimes(1);
    pause.mockClear();
    await expect(buildFieldAsync(new Uint8Array(64), 8, 8, 8, {
      signal: controller.signal, yieldTask: pause,
    })).rejects.toBe(reason);
    expect(pause).not.toHaveBeenCalled();
  });

  it('lets another task run before a large field finishes', async () => {
    let ran = false;
    const timer = setTimeout(() => { ran = true; }, 0);
    const alpha = new Uint8Array(512 * 512).fill(255);
    await buildFieldAsync(alpha, 512, 512, 512);
    expect(ran).toBe(true);
    clearTimeout(timer);
  });
});
