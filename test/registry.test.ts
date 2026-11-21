import { describe, expect, it } from 'vitest';
import { fromAttributes } from '../src/adapter';
import { OPTION_DESCRIPTORS, OPTION_KEYS, looks, readAttributes, resolveOptions, type GlassLook } from '../src/options';

const el = (attrs: Record<string, string>) => ({
  getAttribute: (name: string) => attrs[name] ?? null,
  getAttributeNames: () => Object.keys(attrs),
});

describe('option registry', () => {
  it('describes every resolved option and supplies its default', () => {
    const defaults = resolveOptions();
    expect(Object.keys(OPTION_DESCRIPTORS)).toEqual(OPTION_KEYS);
    expect(Object.keys(defaults)).toEqual(OPTION_KEYS);
    for (const key of OPTION_KEYS) expect(defaults[key], key).toEqual(OPTION_DESCRIPTORS[key].default);
  });

  it('discovers every registered option in framework attributes and supported DOM attributes', () => {
    for (const key of OPTION_KEYS) {
      const descriptor = OPTION_DESCRIPTORS[key];
      const name = key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
      const value = descriptor.kind === 'boolean' ? true : descriptor.kind === 'number' ? 0.25
        : descriptor.kind === 'enum' ? descriptor.values[1] : '#2f6bef';
      const raw = value === true ? '' : String(value);
      expect(fromAttributes({ [name]: raw }), key).toEqual({ [key]: value });
      if ('attribute' in descriptor && descriptor.attribute === false) {
        expect(readAttributes(el({ ['data-glass-' + name]: raw }))).toEqual({});
      } else {
        expect(readAttributes(el({ ['data-glass-' + name]: raw })), key).toEqual({ [key]: value });
      }
    }
  });

  it('preserves boolean, nullable stroke and numeric edge behavior', () => {
    expect(resolveOptions({ interactive: 'true', pointerLight: 'false', tile: 'true' } as never))
      .toMatchObject({ interactive: false, pointerLight: true, tile: false });
    expect(resolveOptions({ strokeWidth: 0, maxDpr: 0, bands: 2.6 }))
      .toMatchObject({ strokeWidth: null, maxDpr: 1, bands: 3 });
    expect(resolveOptions({ weight: -0, lightAngle: -0 })).toMatchObject({ weight: 0, lightAngle: 0 });
    expect(resolveOptions({ variant: 'clear', frost: Infinity, dim: NaN }))
      .toMatchObject({ frost: 0, dim: 'auto' });
  });

  it('shares legacy attribute coercions without trimming framework string values', () => {
    expect(fromAttributes({ tint: ' #f80 ', tile: ' true ', depth: ' .3 ' }))
      .toEqual({ tint: ' #f80 ', tile: ' true ', depth: 0.3 });
    expect(readAttributes(el({ 'data-glass-tint': ' #f80 ', 'data-glass-tile': ' true ' })))
      .toEqual({ tint: '#f80', tile: true });
  });
});

describe('named looks', () => {
  it('exports immutable recipes with the specified values', () => {
    expect(looks).toEqual({
      default: {},
      clear: { variant: 'clear' },
      frosted: { frost: 0.8, tintOpacity: 0.32, dispersion: 0.1, shine: 0.8 },
      crystal: { variant: 'clear', depth: 0.34, curvature: 1.7, dispersion: 1.3, shine: 1.6 },
      tinted: { tint: '#2f6bef', tintOpacity: 0.55 },
      bold: { weight: 0.05, depth: 0.22 },
    });
    expect(Object.isFrozen(looks)).toBe(true);
    for (const recipe of Object.values(looks)) expect(Object.isFrozen(recipe)).toBe(true);
  });

  it('resolves recipes, including the clear variant defaults', () => {
    expect(resolveOptions({ look: 'crystal' }))
      .toMatchObject({ variant: 'clear', frost: 0, depth: 0.34, curvature: 1.7, dispersion: 1.3, shine: 1.6 });
    expect(resolveOptions({ look: 'frosted' }))
      .toMatchObject({ variant: 'regular', frost: 0.8, tintOpacity: 0.32, dispersion: 0.1, shine: 0.8 });
    expect(resolveOptions({ look: 'tinted' })).toMatchObject({ tint: '#2f6bef', tintOpacity: 0.55 });
    expect(resolveOptions({ look: 'bold' })).toMatchObject({ weight: 0.05, depth: 0.22 });
  });

  it('puts all explicit option layers above the winning recipe', () => {
    expect(resolveOptions({ depth: 0.7, frost: 0.2 }, { look: 'crystal' }, { shine: 2 }))
      .toMatchObject({ look: 'crystal', depth: 0.7, frost: 0.2, shine: 2, curvature: 1.7 });
    expect(resolveOptions({ variant: 'regular' }, { look: 'clear' }))
      .toMatchObject({ variant: 'regular', frost: 0.3 });
    expect(resolveOptions({ look: 'crystal' }, { look: undefined }).look).toBe('crystal');
  });

  it('switches every recipe without retaining values from an earlier look', () => {
    const names = Object.keys(looks) as GlassLook[];
    for (const before of names) {
      for (const after of names) {
        expect(resolveOptions({ look: before }, { look: after }), before + ' to ' + after)
          .toEqual(resolveOptions({ look: after }));
      }
    }
    expect(resolveOptions({ look: 'unknown' as never })).toEqual(resolveOptions());
  });

  it('reads look from DOM and framework attributes', () => {
    expect(readAttributes(el({ 'data-glass-look': 'frosted' }))).toEqual({ look: 'frosted' });
    expect(fromAttributes({ look: 'crystal' })).toEqual({ look: 'crystal' });
  });
});
