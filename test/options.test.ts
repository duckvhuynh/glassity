import { describe, expect, it } from 'vitest';
import { optionsKey, readAttributes, resolveOptions } from '../src/options';

const el = (attrs: Record<string, string>) => ({
  getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
  getAttributeNames: () => Object.keys(attrs),
});

describe('resolveOptions', () => {
  it('fills every option with a default', () => {
    const o = resolveOptions();
    expect(o.variant).toBe('regular');
    expect(o.profile).toBe('squircle');
    expect(o.frost).toBeGreaterThan(0);
    expect(o.backdrop).toBe('auto');
    expect(o.visible).toBe(true);
  });

  it('applies the clear preset, and lets explicit values beat the preset', () => {
    expect(resolveOptions({ variant: 'clear' }).frost).toBe(0);
    expect(resolveOptions({ variant: 'clear' }).dim).toBe('auto');
    expect(resolveOptions({ variant: 'clear', frost: 0.5 }).frost).toBe(0.5);
  });

  it('lets later layers win but ignores undefined', () => {
    const o = resolveOptions({ depth: 0.5, shine: 2 }, { depth: 0.2, shine: undefined });
    expect(o.depth).toBe(0.2);
    expect(o.shine).toBe(2);
  });

  it('picks the variant preset from the winning layer, not the first', () => {
    const o = resolveOptions({ variant: 'regular' }, { variant: 'clear' });
    expect(o.variant).toBe('clear');
    expect(o.frost).toBe(0);
  });

  it('insets the icon when it sits on a tile, unless padding is given', () => {
    expect(resolveOptions({ tile: true }).padding).toBeCloseTo(0.22);
    expect(resolveOptions({ tile: true, padding: 0.1 }).padding).toBeCloseTo(0.1);
    expect(resolveOptions().padding).toBe(0);
  });

  it('clamps out-of-range and garbage values', () => {
    const o = resolveOptions({ bands: 99, frost: -3, ior: 0.2, variant: 'nope' as never, profile: 'x' as never });
    expect(o.bands).toBe(8);
    expect(o.frost).toBe(0);
    expect(o.ior).toBe(1);
    expect(o.variant).toBe('regular');
    expect(o.profile).toBe('squircle');
  });

  it('falls back to the default for values that are not numbers', () => {
    const d = resolveOptions();
    const o = resolveOptions({ depth: 'deep', ior: 'x', glyphOpacity: 'a', shine: NaN, frost: Infinity, lightAngle: 'up', maxDpr: '' } as never);
    expect(o.depth).toBe(d.depth);
    expect(o.ior).toBe(d.ior);
    expect(o.glyphOpacity).toBe(d.glyphOpacity);
    expect(o.shine).toBe(d.shine);
    expect(o.frost).toBe(d.frost);
    expect(o.lightAngle).toBe(d.lightAngle);
    expect(o.maxDpr).toBe(d.maxDpr);
  });

  it('never resolves a numeric option to NaN or Infinity', () => {
    const garbage = ['x', NaN, Infinity, -Infinity, '', {}] as const;
    const numeric = Object.entries(resolveOptions()).filter(([, v]) => typeof v === 'number').map(([k]) => k);
    expect(numeric.length).toBeGreaterThan(20);
    for (const value of garbage) {
      const o = resolveOptions(Object.fromEntries(numeric.map((k) => [k, value])) as never) as unknown as Record<string, unknown>;
      for (const key of numeric) expect(Number.isFinite(o[key]), `${key} = ${String(value)}`).toBe(true);
    }
  });

  it('reads a non-numeric attribute as the default', () => {
    expect(resolveOptions(readAttributes(el({ 'data-glass-depth': 'deep' })) ?? undefined).depth).toBe(resolveOptions().depth);
  });

  it('accepts the dome profile', () => {
    expect(resolveOptions({ profile: 'dome' }).profile).toBe('dome');
  });

  it('keeps weight in a range where the shape stays inside its canvas', () => {
    expect(resolveOptions().weight).toBe(0);
    expect(resolveOptions({ weight: 0.5 }).weight).toBe(0.08);
    expect(resolveOptions({ weight: -1 }).weight).toBe(-0.03);
    expect(resolveOptions({ weight: 'x' as never }).weight).toBe(0);
  });
});

describe('readAttributes', () => {
  it('reads a bare data-glass as defaults', () => {
    expect(readAttributes(el({ 'data-glass': '' }))).toEqual({});
  });

  it('reads the variant shorthand', () => {
    expect(readAttributes(el({ 'data-glass': 'clear' }))).toEqual({ variant: 'clear' });
  });

  it('opts out with off', () => {
    expect(readAttributes(el({ 'data-glass': 'off' }))).toBeNull();
  });

  it('reads numbers, booleans and strings from data-glass-* in kebab case', () => {
    const o = readAttributes(
      el({ 'data-glass': '', 'data-glass-depth': '0.3', 'data-glass-tile': '', 'data-glass-interactive': 'false', 'data-glass-tint': '#f80', 'data-glass-light-angle': '-90', 'data-glass-tile-radius': '.3' }),
    );
    expect(o).toEqual({ depth: 0.3, tile: true, interactive: false, tint: '#f80', lightAngle: -90, tileRadius: 0.3 });
  });

  it('ignores unknown attributes', () => {
    expect(readAttributes(el({ 'data-glass-nonsense': '1', class: 'x' }))).toEqual({});
  });
});

describe('optionsKey', () => {
  it('is equal for equal options and different when a value changes', () => {
    expect(optionsKey({ depth: 1, tile: true })).toBe(optionsKey({ tile: true, depth: 1 }));
    expect(optionsKey({ depth: 1 })).not.toBe(optionsKey({ depth: 2 }));
  });
});
