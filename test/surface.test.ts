import { describe, expect, it } from 'vitest';
import { changed, fromAttributes } from '../src/adapter';
import { surfaceDpr, surfaceRadii, surfaceSource } from '../src/core/surface';
import { mapInto, type SurfaceMap } from '../src/surface-space';
import { OPTION_KEYS, optionsKey, readAttributes, resolveOptions } from '../src/options';

const el = (attrs: Record<string, string>) => ({
  getAttribute: (name: string) => attrs[name] ?? null,
  getAttributeNames: () => Object.keys(attrs),
});

describe('surface radii', () => {
  it('resolves each elliptical axis against the corresponding box dimension', () => {
    expect(surfaceRadii(200, 100, ['25% 10%', 'calc(10% + 4px) calc(20% - 2px)', '12px 30%', '8px']))
      .toEqual([[50, 10], [24, 18], [12, 30], [8, 8]]);
  });

  it('scales all corners together when a horizontal or vertical pair overlaps', () => {
    const radii = surfaceRadii(120, 80, ['100px 20px', '80px 40px', '30px 80px', '40px 50px']);
    const original = [[100, 20], [80, 40], [30, 80], [40, 50]];
    radii.forEach((corner, i) => corner.forEach((axis, j) => expect(axis).toBeCloseTo(original[i][j] * 2 / 3)));
    expect(radii[0][0] + radii[1][0]).toBeCloseTo(120);
    expect(radii[1][1] + radii[2][1]).toBeCloseTo(80);
  });

  it('also reduces horizontal radii when only a vertical pair overlaps', () => {
    expect(surfaceRadii(200, 60, ['30px 60px', '10px', '20px', '40px 60px']))
      .toEqual([[15, 30], [5, 5], [10, 10], [20, 30]]);
  });

  it('fits an oversized pill radius without changing the box size', () => {
    expect(surfaceRadii(240, 48, ['999px', '999px', '999px', '999px']))
      .toEqual([[24, 24], [24, 24], [24, 24], [24, 24]]);
  });

  it('makes a corner square when either axis is zero or clamps below zero', () => {
    expect(surfaceRadii(120, 60, ['20px 0px', '0px 20px', 'calc(10% - 20px) 8px', '5px']))
      .toEqual([[0, 0], [0, 0], [0, 0], [5, 5]]);
  });
});

describe('surface outline', () => {
  it('keeps the full border box and connects the individual elliptical corners', () => {
    const source = surfaceSource(160, 80, [[12, 8], [20, 10], [0, 0], [6, 18]]);
    expect(source).toContain('viewBox="0 0 160 80"');
    expect(source).toContain('preserveAspectRatio="none"');
    const outline = source.match(/ d="([^"]+)"/)![1];
    expect(outline).toMatch(/^M12 0H140/);
    expect(outline).toContain('A20 10 0 0 1 160 10');
    expect(outline).toContain('L160 80');
    expect(outline).toContain('A6 18 0 0 1 0 62');
    expect(outline).toMatch(/A12 8 0 0 1 12 0Z$/);
    expect(outline.match(/A/g)).toHaveLength(3);
  });

  it('uses straight edges for square corners', () => {
    const source = surfaceSource(120, 60, [[0, 0], [0, 0], [0, 0], [0, 0]]);
    const outline = source.match(/ d="([^"]+)"/)![1];
    expect(outline).not.toContain('A');
    expect(outline).toContain('L120 60');
    expect(outline).toMatch(/L0 0Z$/);
  });
});

describe('surface resolution budget', () => {
  it('caps high device DPR while respecting a lower caller limit', () => {
    expect(surfaceDpr(4, 400, 80)).toBe(1.5);
    expect(surfaceDpr(0.75, 400, 80)).toBe(0.75);
  });

  it('fits a long toolbar within the renderer texture limit', () => {
    const dpr = surfaceDpr(2, 10000, 64, 2048);
    expect(dpr).toBeCloseTo(2048 / 10000);
    expect(10000 * dpr).toBeLessThanOrEqual(2048);
  });

  it('bounds total fill area even when each side fits the texture limit', () => {
    const dpr = surfaceDpr(2, 2000, 1500, 4096);
    expect(dpr).toBeCloseTo(Math.sqrt(1_048_576 / (2000 * 1500)));
    expect(2000 * 1500 * dpr * dpr).toBeCloseTo(1_048_576);
  });

  it('does not produce an invalid ratio for a not-yet-laid-out box', () => {
    expect(surfaceDpr(2, 0, 0)).toBe(1.5);
  });
});

describe('surface options', () => {
  it('registers surface as an opt-in boolean with ordinary option precedence', () => {
    expect(OPTION_KEYS).toContain('surface');
    expect(resolveOptions().surface).toBe(false);
    expect(resolveOptions({ surface: true }).surface).toBe(true);
    expect(resolveOptions({ surface: true }, { surface: undefined }).surface).toBe(true);
    expect(resolveOptions({ surface: true }, { surface: false }).surface).toBe(false);
  });

  it('reads the shorthand alongside material attributes and preserves opt-out', () => {
    expect(readAttributes(el({ 'data-glass': ' SURFACE ', 'data-glass-look': 'frosted', 'data-glass-depth': '0.3' })))
      .toEqual({ surface: true, look: 'frosted', depth: 0.3 });
    expect(readAttributes(el({ 'data-glass': 'off', 'data-glass-surface': '' }))).toBeNull();
    expect(readAttributes(el({ 'data-glass-surface': '' }))).toEqual({ surface: true });
    expect(readAttributes(el({ 'data-glass-surface': 'false' }))).toEqual({ surface: false });
  });

  it('includes surface in adapter attributes and change detection', () => {
    expect(fromAttributes({ surface: '', look: 'clear', 'max-dpr': '1' })).toEqual({ surface: true, look: 'clear', maxDpr: 1 });
    expect(fromAttributes({ surface: 'false' })).toEqual({ surface: false });
    expect(changed({ surface: false }, { surface: true })).toBe(true);
    expect(changed({ surface: true }, { surface: true })).toBe(false);
    expect(optionsKey({ surface: true })).not.toBe(optionsKey({ surface: false }));
  });
});

describe('surface backdrop coordinates', () => {
  const closeMap = (actual: SurfaceMap, expected: SurfaceMap) => {
    actual.basis.forEach((value, i) => expect(value).toBeCloseTo(expected.basis[i]));
    actual.offset.forEach((value, i) => expect(value).toBeCloseTo(expected.offset[i]));
  };

  it('leaves viewport coordinates unchanged for an identity backdrop', () => {
    const source: SurfaceMap = { basis: [1.2, 0.3, -0.2, 0.8], offset: [150, -20] };
    closeMap(mapInto(source, { basis: [1, 0, 0, 1], offset: [0, 0] }), source);
  });

  it('cancels shared rotation, scale and skew while retaining local translation', () => {
    const bases: SurfaceMap['basis'][] = [[0, 2, -3, 0], [1.2, 0.4, 0.6, 0.9], [2, 0, 1, 3]];
    for (const basis of bases) {
      const [a, b, c, d] = basis;
      const target: SurfaceMap = { basis, offset: [90, 45] };
      const source: SurfaceMap = { basis, offset: [90 + a * 12 - c * 8, 45 + b * 12 - d * 8] };
      closeMap(mapInto(source, target), { basis: [1, 0, 0, 1], offset: [12, -8] });
    }
  });

  it('preserves a surface rotation independent of its transformed backdrop', () => {
    // A local quarter-turn and (10, 4) offset, beneath a rotated/scaled backdrop.
    const source: SurfaceMap = { basis: [-3, 0, 0, -2], offset: [58, 110] };
    const target: SurfaceMap = { basis: [0, 2, -3, 0], offset: [70, 90] };
    closeMap(mapInto(source, target), { basis: [0, 1, -1, 0], offset: [10, 4] });
  });

  it('converts independently skewed surface coordinates into a scaled backdrop', () => {
    const source: SurfaceMap = { basis: [1, 0.2, 0.4, 2], offset: [110, 180] };
    const target: SurfaceMap = { basis: [2, 0, 0, 4], offset: [90, 100] };
    closeMap(mapInto(source, target), { basis: [0.5, 0.05, 0.2, 0.5], offset: [10, 20] });
  });

  it('supports reflected coordinate systems from negative scale', () => {
    const source: SurfaceMap = { basis: [-2, 0, 0, 3], offset: [60, 41] };
    const target: SurfaceMap = { basis: [-2, 0, 0, 3], offset: [100, 20] };
    closeMap(mapInto(source, target), { basis: [1, 0, 0, 1], offset: [20, 7] });
  });

  it('keeps finite source coordinates when the backdrop collapses to a line', () => {
    const source: SurfaceMap = { basis: [1, 0, 0, 1], offset: [40, 20] };
    expect(mapInto(source, { basis: [0, 0, 0, 1], offset: [10, 15] })).toBe(source);
  });
});
