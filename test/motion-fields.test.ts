import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeIcon, type RasterPlan } from '../src/core/raster';
import { captureFrame, FieldSequence, type MotionGeometry } from '../src/motion/fields';

vi.mock('../src/core/raster', () => ({ serializeIcon: vi.fn() }));

function plan(gw = 2, gh = 2): RasterPlan {
  return { boxW: 24, boxH: 24, unit: 24, bleed: 5, cssW: 34, cssH: 34, gw, gh, scale: gw / 34 };
}

function geometry(key: string, data: number[], frame = plan()): MotionGeometry {
  return { key, plan: frame, data: new Float32Array(data), empty: false, refs: 1, texture: null };
}

function solid(key: string, distance: number, thickness: number, frame = plan()): MotionGeometry {
  return geometry(key, Array.from({ length: frame.gw * frame.gh * 2 }, (_, i) => i % 2 ? thickness : distance), frame);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const shapes = [{ id: 'heart' }, { id: 'star' }, { id: 'check' }] as unknown as SVGSVGElement[];

function hooks(initial: MotionGeometry | null = null) {
  const frame = plan();
  const acquired: MotionGeometry[] = [];
  const release = vi.fn((field: MotionGeometry) => { field.refs--; });
  const acquire = vi.fn(async (key: string, _source: string, raster: RasterPlan, _padding: number) => {
    const field = solid(key, acquired.length * 0.2, 0.1, raster);
    acquired.push(field);
    return field;
  });
  return {
    plan: frame, padding: 0.12, strokeWidth: 2, initial,
    acquire, release, acquired, requestFrame: vi.fn(), reducedMotion: () => false,
    changed: vi.fn(), cancelled: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(serializeIcon).mockReset();
  vi.mocked(serializeIcon).mockImplementation(async (svg) => '<svg id="' + svg.id + '"/>');
});

describe('captureFrame', () => {
  it('bakes both interpolated field channels and the shader mid-morph swell', () => {
    const from = solid('heart', 0.2, 0.1);
    const to = solid('star', 0.6, 0.3);
    const frozen = captureFrame({ from, to, mix: 0.5 });
    for (let i = 0; i < frozen.data.length; i += 2) {
      expect(frozen.data[i]).toBeCloseTo(0.365);
      expect(frozen.data[i + 1]).toBeCloseTo(0.235);
    }
    expect(frozen.refs).toBe(1);
    expect(frozen.texture).toBeNull();
    expect(frozen.empty).toBe(false);
  });

  it('matches the shader endpoint threshold and exact completed shape', () => {
    const from = solid('heart', 0.2, 0.1);
    const to = solid('star', 0.6, 0.3);
    expect(captureFrame({ from, to, mix: 0.001 }).data).toEqual(from.data);
    expect(captureFrame({ from, to, mix: 1 }).data).toEqual(to.data);
    const almostStarted = captureFrame({ from, to, mix: 0.002 });
    expect(almostStarted.data[0]).not.toBe(from.data[0]);
  });

  it('resamples a different raster density in the same normalized frame at texel centres', () => {
    const from = geometry('coarse', [0, 4, 1, 5, 2, 6, 3, 7]);
    const target = plan(3, 3);
    const frozen = captureFrame({ from, to: from, mix: 0 }, target);
    const distances = [...frozen.data].filter((_, i) => i % 2 === 0);
    const thicknesses = [...frozen.data].filter((_, i) => i % 2 === 1);
    expect(distances).toEqual([0, 0.5, 1, 1, 1.5, 2, 2, 2.5, 3]);
    expect(thicknesses).toEqual([4, 4.5, 5, 5, 5.5, 6, 6, 6.5, 7]);
    expect(frozen.plan).toBe(target);
  });

  it('interpolates differently sized source fields and leaves every input untouched', () => {
    const from = solid('coarse', 0.2, 0.1, plan(1, 1));
    const to = solid('fine', 0.6, 0.3, plan(4, 4));
    const beforeFrom = from.data.slice();
    const beforeTo = to.data.slice();
    const frozen = captureFrame({ from, to, mix: 0.25 }, plan(3, 2));
    expect(frozen.data.length).toBe(12);
    expect(frozen.data[0]).toBeCloseTo(0.27375);
    expect(frozen.data[1]).toBeCloseTo(0.17625);
    expect(from.data).toEqual(beforeFrom);
    expect(to.data).toEqual(beforeTo);
    expect(from.refs).toBe(1);
    expect(to.refs).toBe(1);
    expect(frozen.data).not.toBe(from.data);
    expect(frozen.data).not.toBe(to.data);
    expect(frozen.key).not.toBe(from.key);
    expect(frozen.key).not.toBe(captureFrame({ from, to, mix: 0.25 }).key);
  });

  it('can freeze an already frozen visual again without adding a second swell', () => {
    const from = solid('heart', 0.2, 0.1);
    const to = solid('star', 0.6, 0.3);
    const first = captureFrame({ from, to, mix: 0.5 });
    const second = captureFrame({ from: first, to: first, mix: 0 });
    expect(second.data).toEqual(first.data);
  });
});

describe('FieldSequence ownership', () => {
  it('preloads every field into the same frame before rendering, then seeks across adjacent pairs', async () => {
    const h = hooks();
    const sequence = new FieldSequence(shapes, { autoplay: false }, h);
    await sequence.controller.ready;
    expect(h.acquire).toHaveBeenCalledTimes(3);
    for (const call of h.acquire.mock.calls) {
      expect(call[2]).toBe(h.plan);
      expect(call[3]).toBe(0.12);
    }
    expect(serializeIcon).toHaveBeenCalledWith(shapes[0], 2);
    expect(sequence.frame).toEqual({ from: h.acquired[0], to: h.acquired[1], mix: 0 });
    sequence.controller.seek(0.75);
    expect(sequence.frame).toEqual({ from: h.acquired[1], to: h.acquired[2], mix: 0.5 });
    sequence.controller.cancel();
    expect(h.release).toHaveBeenCalledTimes(3);
    expect(h.acquired.map((field) => field.refs)).toEqual([0, 0, 0]);
  });

  it('replaces the first frame with the interruption capture and releases it exactly once', async () => {
    const initial = solid('interrupted', 0.35, 0.2);
    const h = hooks(initial);
    const sequence = new FieldSequence(shapes, { autoplay: false }, h);
    await sequence.controller.ready;
    expect(sequence.frame?.from).not.toBe(initial);
    expect(sequence.frame?.from.data).toEqual(initial.data);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledWith(h.acquired[0]);
    expect(h.acquired[0].refs).toBe(0);
    sequence.controller.cancel();
    sequence.controller.cancel();
    expect(initial.refs).toBe(0);
    expect(h.release).toHaveBeenCalledTimes(5);
    expect(h.cancelled).toHaveBeenCalledTimes(1);
  });

  it('exposes the current blend to cancellation before releasing its fields', async () => {
    const h = hooks();
    let captured: MotionGeometry | null = null;
    let refsAtCancel: number[] = [];
    const sequence = new FieldSequence(shapes, { autoplay: false }, {
      ...h,
      cancelled() {
        refsAtCancel = h.acquired.map((field) => field.refs);
        if (sequence.frame) captured = captureFrame(sequence.frame);
      },
    });
    await sequence.controller.ready;
    sequence.controller.seek(0.25);
    sequence.controller.cancel();
    expect(refsAtCancel).toEqual([1, 1, 1]);
    expect(captured).not.toBeNull();
    expect(sequence.frame).toBeNull();
    expect(h.acquired.map((field) => field.refs)).toEqual([0, 0, 0]);
  });

  it('releases an acquisition that arrives after cancellation without publishing a frame', async () => {
    const h = hooks(solid('initial', 0, 0.1));
    const pending = deferred<MotionGeometry>();
    h.acquire.mockImplementationOnce(() => pending.promise);
    const sequence = new FieldSequence(shapes, { autoplay: false }, h);
    await vi.waitFor(() => expect(h.acquire).toHaveBeenCalledTimes(1));
    sequence.controller.cancel();
    const late = solid('late', 0.2, 0.1);
    pending.resolve(late);
    await vi.waitFor(() => expect(h.release).toHaveBeenCalledWith(late));
    expect(late.refs).toBe(0);
    expect(h.acquire).toHaveBeenCalledTimes(1);
    expect(h.changed).not.toHaveBeenCalled();
    expect(sequence.frame).toBeNull();
    await expect(sequence.controller.finished).resolves.toBe('cancelled');
  });

  it('stops before acquiring when serialization completes after cancellation', async () => {
    const pending = deferred<string>();
    vi.mocked(serializeIcon).mockImplementationOnce(() => pending.promise);
    const h = hooks();
    const sequence = new FieldSequence(shapes, {}, h);
    await vi.waitFor(() => expect(serializeIcon).toHaveBeenCalledTimes(1));
    sequence.controller.cancel();
    pending.resolve('<svg/>');
    await pending.promise;
    await Promise.resolve();
    expect(h.acquire).not.toHaveBeenCalled();
    expect(h.changed).not.toHaveBeenCalled();
  });

  it('releases acquired fields and the interruption capture when a later preload fails', async () => {
    const initial = solid('interrupted', 0, 0.1);
    const h = hooks(initial);
    const error = new Error('raster failed');
    h.acquire.mockImplementationOnce(async () => {
      const field = solid('first', 0.2, 0.1);
      h.acquired.push(field);
      return field;
    }).mockRejectedValueOnce(error);
    const sequence = new FieldSequence(shapes, {}, h);
    await expect(sequence.controller.ready).rejects.toBe(error);
    await expect(sequence.controller.finished).resolves.toBe('cancelled');
    expect(initial.refs).toBe(0);
    expect(h.acquired[0].refs).toBe(0);
    expect(h.release).toHaveBeenCalledTimes(2);
    expect(h.changed).not.toHaveBeenCalled();
    expect(sequence.frame).toBeNull();
  });

  it('rejects empty fields and releases their reference before cancelling the sequence', async () => {
    const h = hooks();
    const empty = { ...solid('empty', 0, 0), empty: true };
    h.acquire.mockResolvedValueOnce(empty);
    const sequence = new FieldSequence(shapes, {}, h);
    await expect(sequence.controller.ready).rejects.toThrow('draws no readable pixels');
    expect(empty.refs).toBe(0);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.cancelled).toHaveBeenCalledTimes(1);
  });

  it('reports too few shapes after construction, allowing cancellation hooks to use the owner', async () => {
    const h = hooks();
    let owner: FieldSequence | null = null;
    let seenOwner: FieldSequence | null = null;
    owner = new FieldSequence([], {}, { ...h, cancelled() { seenOwner = owner; } });
    await expect(owner.controller.ready).rejects.toThrow('at least two shapes');
    expect(seenOwner).toBe(owner);
    expect(h.acquire).not.toHaveBeenCalled();
  });
});

describe('FieldSequence reframing', () => {
  it('keeps the same controller, paused progress and old visible frame until every replacement is ready', async () => {
    const h = hooks();
    const sequence = new FieldSequence(shapes, { autoplay: false }, h);
    const controller = sequence.controller;
    await controller.ready;
    controller.seek(0.75);
    const oldFrame = sequence.frame;
    const oldFields = h.acquired.slice();
    const nextPlan = plan(4, 4);
    const pending = deferred<MotionGeometry>();
    h.acquire.mockImplementationOnce(() => pending.promise);
    sequence.reframe(nextPlan, 0.2, 3);
    await vi.waitFor(() => expect(h.acquire).toHaveBeenCalledTimes(4));
    expect(sequence.frame).toBe(oldFrame);
    expect(oldFields.map((field) => field.refs)).toEqual([1, 1, 1]);
    const first = solid('resized-first', 0, 0.1, nextPlan);
    pending.resolve(first);
    await vi.waitFor(() => expect(sequence.frame?.to.plan).toBe(nextPlan));
    expect(sequence.controller).toBe(controller);
    expect(controller.progress).toBe(0.75);
    expect(sequence.frame?.mix).toBe(0.5);
    expect(controller.tick(performance.now() + 10000)).toBe(false);
    expect(h.acquire.mock.calls.slice(3).every((call) => call[2] === nextPlan && call[3] === 0.2)).toBe(true);
    expect(serializeIcon).toHaveBeenLastCalledWith(shapes[2], 3);
    expect(oldFields.map((field) => field.refs)).toEqual([0, 0, 0]);
    sequence.controller.cancel();
    expect(first.refs).toBe(0);
  });

  it('retains the running clock when swapping fields and skips identical settings', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    try {
      const h = hooks();
      const sequence = new FieldSequence(shapes, { duration: 1000 }, h);
      await sequence.controller.ready;
      sequence.controller.tick(250);
      const nextPlan = plan(3, 3);
      sequence.reframe(nextPlan, h.padding, h.strokeWidth);
      await vi.waitFor(() => expect(sequence.frame?.to.plan).toBe(nextPlan));
      expect(sequence.controller.progress).toBe(0.25);
      sequence.controller.tick(500);
      expect(sequence.controller.progress).toBe(0.5);
      sequence.reframe({ ...nextPlan }, h.padding, h.strokeWidth);
      await Promise.resolve();
      expect(h.acquire).toHaveBeenCalledTimes(6);
      sequence.controller.cancel();
    } finally {
      now.mockRestore();
    }
  });

  it('only publishes the latest overlapping reframe and releases a superseded late field', async () => {
    const h = hooks();
    const sequence = new FieldSequence(shapes, { autoplay: false }, h);
    await sequence.controller.ready;
    const slowPlan = plan(4, 4);
    const finalPlan = plan(6, 6);
    const slow = deferred<MotionGeometry>();
    h.acquire.mockImplementationOnce(() => slow.promise);
    sequence.reframe(slowPlan, h.padding, h.strokeWidth);
    await vi.waitFor(() => expect(h.acquire).toHaveBeenCalledTimes(4));
    sequence.reframe(finalPlan, h.padding, h.strokeWidth);
    await vi.waitFor(() => expect(sequence.frame?.to.plan).toBe(finalPlan));
    const current = sequence.frame;
    const late = solid('superseded', 0, 0.1, slowPlan);
    slow.resolve(late);
    await vi.waitFor(() => expect(late.refs).toBe(0));
    expect(sequence.frame).toBe(current);
    expect(h.acquire).toHaveBeenCalledTimes(7);
    expect(h.release).toHaveBeenCalledWith(late);
    sequence.controller.cancel();
    expect(h.acquired.every((field) => field.refs === 0)).toBe(true);
  });

  it('releases old fields immediately on cancellation and releases late replacement fields when they arrive', async () => {
    const initial = solid('capture', 0.4, 0.2);
    const h = hooks(initial);
    const sequence = new FieldSequence(shapes, { autoplay: false }, h);
    await sequence.controller.ready;
    const pending = deferred<MotionGeometry>();
    h.acquire.mockImplementationOnce(() => pending.promise);
    const nextPlan = plan(4, 4);
    sequence.reframe(nextPlan, h.padding, h.strokeWidth);
    await vi.waitFor(() => expect(h.acquire).toHaveBeenCalledTimes(4));
    const changes = h.changed.mock.calls.length;
    sequence.controller.cancel();
    expect(h.acquired.every((field) => field.refs === 0)).toBe(true);
    expect(initial.refs).toBe(0);
    const late = solid('late-resize', 0.1, 0.1, nextPlan);
    pending.resolve(late);
    await vi.waitFor(() => expect(late.refs).toBe(0));
    sequence.reframe(plan(8, 8), h.padding, h.strokeWidth);
    expect(h.changed).toHaveBeenCalledTimes(changes);
    expect(h.acquire).toHaveBeenCalledTimes(4);
    expect(sequence.frame).toBeNull();
  });

  it('can supersede the initial preload before ready without activating the discarded frame', async () => {
    const h = hooks();
    const pending = deferred<MotionGeometry>();
    h.acquire.mockImplementationOnce(() => pending.promise);
    const sequence = new FieldSequence(shapes, { autoplay: false }, h);
    await vi.waitFor(() => expect(h.acquire).toHaveBeenCalledTimes(1));
    const nextPlan = plan(5, 5);
    sequence.reframe(nextPlan, h.padding, h.strokeWidth);
    await sequence.controller.ready;
    expect(sequence.frame?.to.plan).toBe(nextPlan);
    expect(h.changed).toHaveBeenCalledTimes(1);
    const late = solid('late-initial', 0.2, 0.1);
    pending.resolve(late);
    await vi.waitFor(() => expect(late.refs).toBe(0));
    expect(sequence.frame?.to.plan).toBe(nextPlan);
    sequence.controller.cancel();
  });

  it('retains the last usable fields after resize failure and retries the same requested frame later', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const h = hooks();
      const sequence = new FieldSequence(shapes, { autoplay: false }, h);
      await sequence.controller.ready;
      sequence.controller.seek(0.4);
      const old = sequence.frame;
      const oldFields = h.acquired.slice();
      const partial = solid('partial', 0, 0.1, plan(4, 4));
      h.acquire.mockResolvedValueOnce(partial).mockRejectedValueOnce(new Error('resize failed'));
      const nextPlan = plan(4, 4);
      sequence.reframe(nextPlan, h.padding, h.strokeWidth);
      await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(1));
      expect(partial.refs).toBe(0);
      expect(sequence.frame).toBe(old);
      expect(sequence.controller.progress).toBe(0.4);
      expect(oldFields.map((field) => field.refs)).toEqual([1, 1, 1]);
      await expect(sequence.controller.ready).resolves.toBeUndefined();
      sequence.reframe(nextPlan, h.padding, h.strokeWidth);
      await vi.waitFor(() => expect(sequence.frame?.to.plan).toBe(nextPlan));
      expect(sequence.controller.progress).toBe(0.4);
      expect(oldFields.map((field) => field.refs)).toEqual([0, 0, 0]);
      sequence.controller.cancel();
    } finally {
      warning.mockRestore();
    }
  });

  it('resamples each interruption first keyframe from the original capture rather than the previous resize', async () => {
    const initial = geometry('original-capture', [0, 4, 1, 5, 2, 6, 3, 7]);
    const h = hooks(initial);
    const sequence = new FieldSequence(shapes, { autoplay: false }, h);
    await sequence.controller.ready;
    const firstPlan = plan(1, 1);
    sequence.reframe(firstPlan, h.padding, h.strokeWidth);
    await vi.waitFor(() => expect(sequence.frame?.from.plan).toBe(firstPlan));
    expect(sequence.frame?.from.data[0]).toBe(1.5);
    const finalPlan = plan(3, 3);
    sequence.reframe(finalPlan, h.padding, h.strokeWidth);
    await vi.waitFor(() => expect(sequence.frame?.from.plan).toBe(finalPlan));
    const expected = captureFrame({ from: initial, to: initial, mix: 0 }, finalPlan);
    expect(sequence.frame?.from.data).toEqual(expected.data);
    expect(sequence.frame?.from.data[0]).toBe(0);
    expect(initial.data).toEqual(new Float32Array([0, 4, 1, 5, 2, 6, 3, 7]));
    expect(initial.refs).toBe(1);
    sequence.controller.cancel();
    expect(initial.refs).toBe(0);
  });
  it('releases already loaded replacement fields immediately even when the next acquisition has not settled', async () => {
    const h = hooks();
    const sequence = new FieldSequence(shapes, { autoplay: false }, h);
    await sequence.controller.ready;
    const nextPlan = plan(4, 4);
    const partial = solid('partial-before-cancel', 0.1, 0.1, nextPlan);
    const pending = deferred<MotionGeometry>();
    h.acquire.mockResolvedValueOnce(partial).mockImplementationOnce(() => pending.promise);
    sequence.reframe(nextPlan, h.padding, h.strokeWidth);
    await vi.waitFor(() => expect(h.acquire).toHaveBeenCalledTimes(5));
    sequence.controller.cancel();
    expect(partial.refs).toBe(0);
    expect(h.acquired.every((field) => field.refs === 0)).toBe(true);
    const late = solid('late-after-partial', 0.1, 0.1, nextPlan);
    pending.resolve(late);
    await vi.waitFor(() => expect(late.refs).toBe(0));
    expect(h.release.mock.calls.filter(([field]) => field === partial)).toHaveLength(1);
  });

});
