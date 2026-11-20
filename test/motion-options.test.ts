import { describe, expect, it } from 'vitest';
import { fromAttributes } from '../src/adapter';
import { readAttributes, resolveOptions } from '../src/options';

describe('interaction options', () => {
  it('uses subtle when interactive is enabled and keeps the existing opt-in', () => {
    expect(resolveOptions()).toMatchObject({ interactive: false, interaction: 'subtle' });
    expect(resolveOptions({ interactive: true })).toMatchObject({ interactive: true, interaction: 'subtle' });
  });

  it('inherits presets and lets explicit none disable feedback', () => {
    expect(resolveOptions({ interactive: true, interaction: 'bouncy' }, { interaction: 'none' }).interaction).toBe('none');
    expect(resolveOptions({ interaction: 'invalid' as never }).interaction).toBe('subtle');
  });

  it('reads the preset through DOM and adapter attributes', () => {
    const attrs = { 'data-glass-interaction': 'bouncy', 'data-glass-interactive': '' };
    const read = readAttributes({ getAttribute: (key) => attrs[key as keyof typeof attrs] ?? null, getAttributeNames: () => Object.keys(attrs) });
    expect(resolveOptions(read)).toMatchObject({ interactive: true, interaction: 'bouncy' });
    expect(fromAttributes({ interaction: 'none', interactive: true })).toEqual({ interaction: 'none', interactive: true });
  });
});
