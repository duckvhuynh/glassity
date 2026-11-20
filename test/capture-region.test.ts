import { describe, expect, it } from 'vitest';
import { captureRegion, intersects } from '../src/capture-region';

describe('local capture regions', () => {
  it('shares nearby icons and gives small icons screen density on long pages', () => {
    const a = captureRegion({ x: 30, y: 12020, w: 24, h: 24 }, 2560, 2);
    const b = captureRegion({ x: 80, y: 12020, w: 24, h: 24 }, 2560, 2);
    expect(a).toEqual(b);
    expect(a.w * 2).toBeLessThanOrEqual(2560);
    expect(a.h).toBeLessThan(1000);
    expect(a.y).toBeGreaterThan(11000);
    expect(a.x).toBeLessThanOrEqual(30 - 100);
    expect(a.x + a.w).toBeGreaterThan(30 + 24 + 100);
  });

  it('keeps document cells stable through window scrolling and separates distant clusters', () => {
    const before = captureRegion({ x: 100, y: 12200, w: 24, h: 24 }, 2048, 1);
    const after = captureRegion({ x: 100, y: 200 + 12000, w: 24, h: 24 }, 2048, 1);
    expect(before.key).toBe(after.key);
    expect(captureRegion({ x: 100, y: 15000, w: 24, h: 24 }, 2048, 1).key).not.toBe(before.key);
    expect(intersects(before, { x: 0, y: 12000, w: 800, h: 700 })).toBe(true);
    expect(intersects(before, { x: 0, y: 0, w: 800, h: 700 })).toBe(false);
  });
});
