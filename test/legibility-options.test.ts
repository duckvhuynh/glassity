import { describe, expect, it } from 'vitest';
import { OPTION_KEYS, optionsKey, readAttributes, resolveOptions } from '../src/options';

const element = (attributes: Record<string, string>) => ({
  getAttribute: (name: string) => attributes[name] ?? null,
  getAttributeNames: () => Object.keys(attributes),
});

describe('legibility options', () => {
  it('defaults to automatic legibility without changing the automatic tint default', () => {
    expect(resolveOptions().legibility).toBe('auto');
    expect(resolveOptions().tint).toBe('auto');
    expect(resolveOptions({ variant: 'clear' }).legibility).toBe('auto');
    expect(OPTION_KEYS).toContain('legibility');
  });

  it('accepts off, resolves layers and normalises invalid values to auto', () => {
    expect(resolveOptions({ legibility: 'off' }).legibility).toBe('off');
    expect(resolveOptions({ legibility: 'off' }, { legibility: undefined }).legibility).toBe('off');
    expect(resolveOptions({ legibility: 'off' }, { legibility: 'auto' }).legibility).toBe('auto');
    for (const value of ['invalid', '', null, false, 1]) {
      expect(resolveOptions({ legibility: value as never }).legibility).toBe('auto');
    }
  });

  it('preserves currentColor for resolution against the mounted icon', () => {
    expect(resolveOptions({ tint: 'currentColor' }).tint).toBe('currentColor');
    expect(resolveOptions({ tint: 'currentColor', legibility: 'off' }).tint).toBe('currentColor');
  });

  it('reads both new behaviours from data-glass attributes', () => {
    const attributes = readAttributes(element({ 'data-glass': '', 'data-glass-legibility': 'off', 'data-glass-tint': 'currentColor' }));
    expect(attributes).toEqual({ legibility: 'off', tint: 'currentColor' });
    const resolved = resolveOptions(attributes);
    expect(resolved.legibility).toBe('off');
    expect(resolved.tint).toBe('currentColor');
  });

  it('includes legibility in option change detection', () => {
    expect(optionsKey({ legibility: 'auto' })).not.toBe(optionsKey({ legibility: 'off' }));
  });
});
