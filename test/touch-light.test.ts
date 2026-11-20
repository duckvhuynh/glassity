import { describe, expect, it } from 'vitest';
import { TouchLight, TOUCH_LIGHT_LIFETIME } from '../src/motion/touch-light';

const rect = (left = 0) => ({ left, top: 0, width: 20, height: 20 });

describe('spreading touch light', () => {
  it('arrives later at neighbours and attenuates with distance', () => {
    const lights = new TouchLight();
    lights.emit(10, 10, 0);
    expect(lights.sample(rect(70), 30).strength).toBe(0);
    const local = lights.sample(rect(), 200);
    const neighbour = lights.sample(rect(70), 200);
    expect(local.strength).toBeGreaterThan(neighbour.strength);
    expect(neighbour.strength).toBeGreaterThan(0);
    expect(lights.sample(rect(131), 200).strength).toBe(0);
    expect([neighbour.x, neighbour.y]).toEqual([10, 10]);
  });

  it('decays over time and stops scheduling at the lifetime boundary', () => {
    const lights = new TouchLight();
    lights.emit(10, 10, 100);
    expect(lights.sample(rect(), 300).strength).toBeGreaterThan(lights.sample(rect(), 600).strength);
    expect(lights.prune(100 + TOUCH_LIGHT_LIFETIME - 1)).toBe(true);
    expect(lights.prune(100 + TOUCH_LIGHT_LIFETIME)).toBe(false);
    expect(lights.sample(rect(), 100 + TOUCH_LIGHT_LIFETIME).strength).toBe(0);
  });

  it('bounds simultaneous lights and does not keep stale light after clearing', () => {
    const lights = new TouchLight();
    for (let i = 0; i < 9; i++) lights.emit(10 + i * 300, 10, i * 10);
    expect(lights.sample(rect(), 200).strength).toBe(0);
    expect(lights.sample(rect(2400), 200).strength).toBeGreaterThan(0);
    lights.clear();
    expect(lights.prune(200)).toBe(false);
    expect(lights.sample(rect(2400), 200).strength).toBe(0);
  });

  it('coalesces the same press from icons sharing a host and ignores invalid points', () => {
    const lights = new TouchLight();
    for (let i = 0; i < 8; i++) lights.emit(10 + i * 300, 10, 0);
    lights.emit(2110, 10, 1);
    lights.emit(NaN, 0, 2);
    expect(lights.sample(rect(), 200).strength).toBeGreaterThan(0);
  });
});
