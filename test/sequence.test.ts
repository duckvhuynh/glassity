import { describe, expect, it, vi } from 'vitest';
import { sequenceSegment, SequenceTimeline, type SequenceOptions } from '../src/motion/sequence';

function clock(options: SequenceOptions = {}) {
  let now = 0;
  let reduced = false;
  const render = vi.fn();
  const requestFrame = vi.fn();
  const cancel = vi.fn();
  const timeline = new SequenceTimeline(options, {
    render, requestFrame, cancel, now: () => now, reducedMotion: () => reduced,
  });
  return {
    timeline, render, requestFrame, cancel,
    time(value: number) { now = value; },
    reduced(value: boolean) { reduced = value; },
    tick(value: number) { now = value; return timeline.tick(value); },
  };
}

describe('sequenceSegment', () => {
  it('divides the whole duration equally among adjacent pairs', () => {
    expect(sequenceSegment(0, 3)).toEqual({ from: 0, to: 1, mix: 0 });
    expect(sequenceSegment(0.25, 3)).toEqual({ from: 0, to: 1, mix: 0.5 });
    expect(sequenceSegment(0.5, 3)).toEqual({ from: 1, to: 2, mix: 0 });
    expect(sequenceSegment(0.75, 3)).toEqual({ from: 1, to: 2, mix: 0.5 });
    expect(sequenceSegment(1, 3)).toEqual({ from: 1, to: 2, mix: 1 });
  });

  it('supports a single shape and clamps either endpoint', () => {
    expect(sequenceSegment(0.5, 1)).toEqual({ from: 0, to: 0, mix: 0 });
    expect(sequenceSegment(-2, 2)).toEqual({ from: 0, to: 1, mix: 0 });
    expect(sequenceSegment(2, 2)).toEqual({ from: 0, to: 1, mix: 1 });
  });

  it('rejects unusable counts and non-finite progress', () => {
    for (const count of [0, -1, 1.5, Infinity, NaN]) expect(() => sequenceSegment(0, count)).toThrow(RangeError);
    for (const progress of [NaN, Infinity, -Infinity]) expect(() => sequenceSegment(progress, 3)).toThrow(RangeError);
  });
});

describe('SequenceTimeline', () => {
  it('waits for preload, then plays one total duration and completes exactly once', async () => {
    const c = clock({ duration: 2000 });
    expect(c.tick(10000)).toBe(false);
    expect(c.render).not.toHaveBeenCalled();
    c.timeline.activate();
    await c.timeline.ready;
    expect(c.render).toHaveBeenLastCalledWith(0);
    expect(c.tick(10500)).toBe(true);
    expect(c.timeline.progress).toBe(0.25);
    expect(c.tick(12000)).toBe(false);
    expect(c.timeline.progress).toBe(1);
    await expect(c.timeline.finished).resolves.toBe('completed');
    c.timeline.cancel();
    await expect(c.timeline.finished).resolves.toBe('completed');
  });

  it('seeks before loading and does not start when autoplay is false', async () => {
    const c = clock({ autoplay: false });
    c.timeline.seek(0.75);
    expect(c.render).not.toHaveBeenCalled();
    c.timeline.activate();
    await c.timeline.ready;
    expect(c.render).toHaveBeenLastCalledWith(0.75);
    expect(c.tick(5000)).toBe(false);
    expect(c.timeline.progress).toBe(0.75);
    c.timeline.seek(0.2);
    expect(c.render).toHaveBeenLastCalledWith(0.2);
    expect(c.tick(6000)).toBe(false);
  });

  it('pauses the last rendered frame and resumes without counting paused time', () => {
    const c = clock();
    c.timeline.activate();
    c.tick(250);
    c.time(300);
    c.timeline.pause();
    expect(c.timeline.progress).toBe(0.25);
    expect(c.tick(5000)).toBe(false);
    c.timeline.play();
    expect(c.tick(5250)).toBe(true);
    expect(c.timeline.progress).toBe(0.5);
  });

  it('rebases an active seek without stopping playback or jumping to its old clock', () => {
    const c = clock();
    c.timeline.activate();
    c.tick(250);
    c.timeline.seek(0.6);
    expect(c.render).toHaveBeenLastCalledWith(0.6);
    c.tick(350);
    expect(c.timeline.progress).toBeCloseTo(0.7);
    c.timeline.seek(0.1);
    c.tick(450);
    expect(c.timeline.progress).toBeCloseTo(0.2);
  });

  it('clamps seeks and rejects invalid values without damaging the current state', () => {
    const c = clock({ autoplay: false });
    c.timeline.activate();
    c.timeline.seek(-3);
    expect(c.timeline.progress).toBe(0);
    c.timeline.seek(4);
    expect(c.timeline.progress).toBe(1);
    expect(() => c.timeline.seek(NaN)).toThrow(RangeError);
    expect(c.timeline.progress).toBe(1);
  });

  it('loops across long gaps without accumulating frame rounding error', () => {
    const c = clock({ duration: 1000, loop: true });
    c.timeline.activate();
    c.tick(1250);
    expect(c.timeline.progress).toBe(0.25);
    c.tick(10250);
    expect(c.timeline.progress).toBe(0.25);
    c.tick(11000);
    expect(c.timeline.progress).toBe(0);
    expect(c.tick(11500)).toBe(true);
    expect(c.timeline.progress).toBe(0.5);
  });

  it('keeps the last visual on interruption and ignores late loads and control calls', async () => {
    const c = clock();
    c.timeline.activate();
    c.tick(370);
    const rendered = c.render.mock.calls.length;
    c.timeline.cancel();
    c.timeline.cancel();
    c.timeline.seek(1);
    c.timeline.play();
    c.timeline.activate();
    expect(c.tick(2000)).toBe(false);
    expect(c.timeline.progress).toBe(0.37);
    expect(c.render).toHaveBeenCalledTimes(rendered);
    expect(c.cancel).toHaveBeenCalledTimes(1);
    await expect(c.timeline.finished).resolves.toBe('cancelled');
  });

  it('settles cancellation during preload without allowing a late activation to draw', async () => {
    const c = clock();
    c.timeline.cancel();
    c.timeline.activate();
    await expect(c.timeline.ready).resolves.toBeUndefined();
    await expect(c.timeline.finished).resolves.toBe('cancelled');
    expect(c.render).not.toHaveBeenCalled();
  });

  it('reports a loading error and releases pending work once', async () => {
    const c = clock();
    const error = new Error('invalid shape');
    c.timeline.fail(error);
    await expect(c.timeline.ready).rejects.toBe(error);
    await expect(c.timeline.finished).resolves.toBe('cancelled');
    expect(c.cancel).toHaveBeenCalledTimes(1);
    c.timeline.activate();
    expect(c.render).not.toHaveBeenCalled();
  });

  it('jumps to the end under reduced motion, including looping playback', async () => {
    const c = clock({ autoplay: false, loop: true });
    c.reduced(true);
    c.timeline.activate();
    c.timeline.seek(0.4);
    expect(c.render).toHaveBeenLastCalledWith(0.4);
    c.timeline.play();
    expect(c.render).toHaveBeenLastCalledWith(1);
    expect(c.tick(1000)).toBe(false);
    await expect(c.timeline.finished).resolves.toBe('completed');
    c.timeline.seek(0.2);
    expect(c.render).toHaveBeenLastCalledWith(0.2);
    expect(c.tick(2000)).toBe(false);
  });

  it('honors reduced motion switched on during playback and before loading', () => {
    const c = clock();
    c.timeline.activate();
    c.tick(300);
    c.reduced(true);
    expect(c.tick(400)).toBe(false);
    expect(c.timeline.progress).toBe(1);
    const alreadyPlaying = clock();
    alreadyPlaying.timeline.activate();
    alreadyPlaying.reduced(true);
    alreadyPlaying.timeline.play();
    expect(alreadyPlaying.timeline.progress).toBe(1);
    const pending = clock();
    pending.reduced(true);
    pending.timeline.activate();
    expect(pending.timeline.progress).toBe(1);
  });

  it('allows a pause during preload to override autoplay', () => {
    const c = clock();
    c.timeline.pause();
    c.timeline.activate();
    expect(c.tick(1000)).toBe(false);
    expect(c.timeline.progress).toBe(0);
  });

  it('restarts after completion while finished remains a once-settled promise', async () => {
    const c = clock();
    c.timeline.activate();
    c.tick(1000);
    c.timeline.play();
    expect(c.timeline.progress).toBe(0);
    c.tick(1250);
    expect(c.timeline.progress).toBe(0.25);
    await expect(c.timeline.finished).resolves.toBe('completed');
  });

  it('completes zero duration even when looping and rejects invalid durations', () => {
    const c = clock({ duration: 0, loop: true });
    c.timeline.activate();
    expect(c.timeline.progress).toBe(1);
    expect(c.tick(1000)).toBe(false);
    for (const duration of [-1, NaN, Infinity]) expect(() => clock({ duration })).toThrow(RangeError);
  });
});
