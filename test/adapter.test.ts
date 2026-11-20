import { describe, expect, it } from 'vitest';
import { fromAttributes } from '../src/adapter';
import { OPTION_KEYS, resolveOptions } from '../src/options';

describe('adapter options', () => {
  it('picks every option, including weight, from template attributes', () => {
    expect(fromAttributes({ weight: '0.03', 'light-angle': '10', tile: '', unknown: 'x' })).toEqual({ weight: 0.03, lightAngle: 10, tile: true });
  });

  it('knows every option the core resolves', () => {
    expect([...OPTION_KEYS].sort()).toEqual(Object.keys(resolveOptions()).sort());
    for (const key of OPTION_KEYS) {
      const name = key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
      expect(Object.keys(fromAttributes({ [name]: '1' })), key).toEqual([key]);
    }
  });
});
