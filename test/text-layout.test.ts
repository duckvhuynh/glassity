import { describe, expect, it, vi } from 'vitest';
import { planTextRaster, textLines, TEXT_LIMIT, TEXT_LINE_LIMIT, TEXT_NODE_LIMIT } from '../src/core/text-layout';
import { measureTextLines } from '../src/text';
import { readAttributes, resolveOptions } from '../src/options';
import { fromAttributes } from '../src/adapter';

const box = (left: number, top: number, width = 20, height = 20) => ({ left, top, width, height });

describe('browser text line boxes', () => {
  it('groups bidi fragments by physical line without changing text order', () => {
    expect(textLines([box(60, 0), box(0, 30), box(20, 0), box(40, 30)]))
      .toEqual([box(20, 0, 60), box(0, 30, 60)]);
  });

  it('merges duplicate and nested inline fragments on the same baseline', () => {
    expect(textLines([box(0, 0, 100, 30), box(10, 5, 20, 20), box(0, 0, 100, 30)]))
      .toEqual([box(0, 0, 100, 30)]);
  });

  it('keeps tightly spaced lines separate and ignores collapsed whitespace', () => {
    expect(textLines([box(0, 18), box(0, 0), box(30, 0, 0), box(0, 40, 10, 0)]))
      .toEqual([box(0, 0), box(0, 18)]);
  });

  it('copies native DOMRect prototype accessors explicitly', () => {
    const native = Object.create({ left: 10, top: 20, width: 30, height: 40 });
    expect(Object.keys(native)).toEqual([]);
    expect(textLines([native])).toEqual([box(10, 20, 30, 40)]);
  });

  it('does not mutate native rectangle inputs', () => {
    const first = Object.freeze(box(0, 0));
    expect(textLines([first, box(20, 0)])).toEqual([box(0, 0, 40)]);
    expect(first.width).toBe(20);
  });

  it('reads complete text-node ranges instead of breaking ligatures into characters', () => {
    const nodes = [{ textContent: 'home' }, { textContent: 'مرحبا' }];
    let current = -1;
    const selected: unknown[] = [];
    const range = {
      selectNodeContents: (node: unknown) => { selected.push(node); },
      getClientRects: () => current === 0 ? [box(80, 0, 48, 48)] : [box(0, 60, 96, 48)],
    };
    const element = {
      ownerDocument: {
        createRange: () => range,
        createTreeWalker: () => ({ nextNode: () => nodes[++current] ?? null }),
      },
    } as unknown as HTMLElement;
    vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
    try {
      expect(measureTextLines(element)).toEqual([box(80, 0, 48, 48), box(0, 60, 96, 48)]);
      expect(selected).toEqual(nodes);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('text field resolution', () => {
  it('uses font size for wide multiline text and retains more than 512 raster pixels', () => {
    const plan = planTextRaster(1000, 150, 24, 2);
    expect(plan.unit).toBe(24);
    expect(plan.gw).toBeGreaterThan(512);
    expect(plan.scale).toBeGreaterThan(2);
  });

  it('preserves per-line resolution when a heading gains another line', () => {
    const one = planTextRaster(600, 80, 64, 1);
    const two = planTextRaster(600, 160, 64, 1);
    expect(two.unit).toBe(one.unit);
    expect(two.scale).toBe(one.scale);
    expect(two.gh).toBeGreaterThan(one.gh);
  });

  it('bounds the field by the GPU limit and a two-megapixel allocation budget', () => {
    for (const size of [1024, 2048, 8192]) {
      const plan = planTextRaster(8000, 2000, 16, 4, 0.08, size);
      expect(Math.max(plan.gw, plan.gh)).toBeLessThanOrEqual(Math.min(size, 4096));
      expect(plan.gw * plan.gh).toBeLessThanOrEqual(2_097_152);
      expect(plan.bleed).toBe(5);
    }
  });

  it('does not mistake a narrow large letter for small text', () => {
    expect(planTextRaster(18, 72, 64, 1).unit).toBe(64);
  });

  it('makes small text eligible for the existing icon legibility policy', () => {
    const plan = planTextRaster(600, 80, 20, 1);
    expect(plan.unit).toBe(20);
  });

  it('publishes bounded short-text limits without truncating strings', () => {
    expect([TEXT_LIMIT, TEXT_LINE_LIMIT, TEXT_NODE_LIMIT]).toEqual([512, 8, 64]);
  });
});

describe('text source options', () => {
  const el = (attrs: Record<string, string>) => ({
    getAttribute: (name: string) => attrs[name] ?? null,
    getAttributeNames: () => Object.keys(attrs),
  });
  it('opts in through the main attribute, code, or registered framework attributes', () => {
    expect(resolveOptions().text).toBe(false);
    expect(resolveOptions({ text: true }).text).toBe(true);
    expect(readAttributes(el({ 'data-glass': ' TEXT ', 'data-glass-look': 'crystal' }))).toEqual({ text: true, look: 'crystal' });
    expect(fromAttributes({ text: '' })).toEqual({ text: true });
  });
  it('preserves explicit false and the existing opt-out values', () => {
    expect(readAttributes(el({ 'data-glass': 'text', 'data-glass-text': 'false' }))).toEqual({ text: false });
    expect(readAttributes(el({ 'data-glass': 'off' }))).toBeNull();
  });
});
