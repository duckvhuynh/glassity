import { describe, expect, expectTypeOf, it } from 'vitest';
import { fromAttributes } from '../src/adapter';
import type { GlassEnvironment, GlassOptions } from '../src/index';
import { OPTION_KEYS, looks, optionsKey, readAttributes, resolveOptions, type GlassLook } from '../src/options';

const element = (attributes: Record<string, string>) => ({
  getAttribute: (name: string) => attributes[name] ?? null,
  getAttributeNames: () => Object.keys(attributes),
});

const environments: GlassEnvironment[] = ['auto', 'studio', 'none'];

describe('reflection environment options', () => {
  it('exports the environment type through the public API', () => {
    expectTypeOf<GlassEnvironment>().toEqualTypeOf<'auto' | 'studio' | 'none'>();
    expectTypeOf<GlassOptions['environment']>().toEqualTypeOf<GlassEnvironment | undefined>();
  });

  it('defaults to auto for every named look and variant', () => {
    expect(resolveOptions().environment).toBe('auto');
    expect(OPTION_KEYS).toContain('environment');
    for (const look of Object.keys(looks) as GlassLook[]) {
      expect(resolveOptions({ look }).environment, look).toBe('auto');
    }
    for (const variant of ['regular', 'clear', 'identity'] as const) {
      expect(resolveOptions({ variant }).environment, variant).toBe('auto');
    }
  });

  it.each(environments)('accepts %s without changing other optical options', (environment) => {
    const defaults = resolveOptions();
    expect(resolveOptions({ environment })).toEqual({ ...defaults, environment });
    expect(resolveOptions({ environment, reflection: 0, frost: 0.8 }))
      .toMatchObject({ environment, reflection: 0, frost: 0.8 });
  });

  it('resolves overrides and ignores undefined layers', () => {
    expect(resolveOptions({ environment: 'studio' }, { environment: undefined }).environment).toBe('studio');
    expect(resolveOptions({ environment: 'studio' }, { environment: 'none' }).environment).toBe('none');
    expect(resolveOptions({ environment: 'none' }, { environment: 'auto' }).environment).toBe('auto');
  });

  it('falls back to auto for invalid values', () => {
    for (const value of ['room', 'STUDIO', '', null, false, true, 1]) {
      expect(resolveOptions({ environment: value as never }).environment).toBe('auto');
    }
  });

  it.each(environments)('reads %s from DOM and framework attributes', (environment) => {
    const attributes = readAttributes(element({ 'data-glass': '', 'data-glass-environment': environment }));
    expect(attributes).toEqual({ environment });
    expect(resolveOptions(attributes).environment).toBe(environment);
    expect(fromAttributes({ environment })).toEqual({ environment });
  });

  it('trims DOM attributes and leaves none as a lighting option, not an opt-out', () => {
    expect(readAttributes(element({ 'data-glass': '', 'data-glass-environment': ' none ' })))
      .toEqual({ environment: 'none' });
    expect(readAttributes(element({ 'data-glass': 'off', 'data-glass-environment': 'studio' }))).toBeNull();
    expect(resolveOptions(readAttributes(element({ 'data-glass-environment': 'invalid' }))).environment).toBe('auto');
  });

  it('detects changes between all three environments', () => {
    const keys = environments.map((environment) => optionsKey({ environment }));
    expect(new Set(keys).size).toBe(environments.length);
    for (const key of keys) expect(key).not.toBe(optionsKey({}));
  });
});
