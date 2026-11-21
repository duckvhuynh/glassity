import { describe, expect, it } from 'vitest';
import { approachAmount, contrastRatio, glyphSize, legibilityTarget, stableAmount, type RGB, type RGBA } from '../src/core/legibility';

const WHITE: RGB = [1, 1, 1];
const DARK: RGB = [31 / 255, 31 / 255, 31 / 255];
const LIME: RGB = [200 / 255, 230 / 255, 58 / 255];
const WHITE_INK: RGBA = [1, 1, 1, 1];
const DARK_INK: RGBA = [0.08, 0.1, 0.06, 1];

describe('glyphSize', () => {
  it('uses the inset glyph size, including the default padding of a tile', () => {
    expect(glyphSize(48, 0.22)).toBeCloseTo(26.88);
    expect(glyphSize(48, 0)).toBe(48);
    expect(glyphSize(24, 0.1)).toBeCloseTo(19.2);
  });
});

describe('contrastRatio', () => {
  it('uses linear-light luminance and is independent of argument order', () => {
    expect(contrastRatio([0, 0, 0], WHITE)).toBeCloseTo(21);
    expect(contrastRatio(LIME, LIME)).toBe(1);
    expect(contrastRatio(LIME, DARK)).toBeCloseTo(contrastRatio(DARK, LIME));
  });
});

describe('legibilityTarget', () => {
  it('leaves the existing ink on light neutral pages alone', () => {
    for (const backdrop of [WHITE, [0.94, 0.92, 0.9] as RGB]) {
      expect(legibilityTarget(16, backdrop, DARK_INK).amount).toBe(0);
      expect(legibilityTarget(24, backdrop, WHITE_INK).amount).toBe(0);
    }
  });

  it('uses the authored colour on dark and saturated surfaces when it already contrasts', () => {
    const dark = legibilityTarget(20, DARK, WHITE_INK);
    expect(dark.color).toEqual([1, 1, 1]);
    expect(dark.amount).toBeGreaterThan(0.5);
    const lime = legibilityTarget(20, LIME, DARK_INK);
    expect(lime.color).toEqual(DARK_INK.slice(0, 3));
    expect(lime.amount).toBeGreaterThan(0.5);
  });

  it('scales the correction by CSS colour alpha, including transparent colour', () => {
    const opaque = legibilityTarget(20, DARK, WHITE_INK);
    const dim = legibilityTarget(20, DARK, [1, 1, 1, 0.4]);
    expect(dim.color).toEqual(opaque.color);
    expect(dim.amount).toBeCloseTo(opaque.amount * 0.4);
    expect(legibilityTarget(20, DARK, [1, 1, 1, 0]).amount).toBe(0);
  });

  it('helps a padded 48 px tile glyph but leaves its unpadded large glyph alone', () => {
    expect(legibilityTarget(glyphSize(48, 0.22), LIME, DARK_INK).amount).toBeGreaterThan(0.4);
    expect(legibilityTarget(glyphSize(48, 0), LIME, DARK_INK).amount).toBe(0);
  });

  it('fades with size instead of switching at a small-icon cutoff', () => {
    const at = (size: number) => legibilityTarget(size, DARK, WHITE_INK).amount;
    const sizes = [20, 26, 28, 30, 34, 38, 48];
    const amounts = sizes.map(at);
    expect(amounts[0]).toBe(amounts[1]);
    for (let i = 2; i < amounts.length; i++) expect(amounts[i]).toBeLessThanOrEqual(amounts[i - 1]);
    expect(at(38)).toBe(0);
    for (const boundary of [26, 32, 38]) expect(Math.abs(at(boundary - 0.01) - at(boundary + 0.01))).toBeLessThan(0.002);
  });

  it('ramps correction strength smoothly as authored contrast increases', () => {
    const at = (gray: number) => legibilityTarget(20, DARK, [gray, gray, gray, 1]).amount;
    expect(at(0.55)).toBeGreaterThan(at(1));
    let previous = at(0.55);
    for (let gray = 0.555; gray <= 1; gray += 0.005) {
      const next = at(gray);
      // A 0.005 step may move the amount a little more than 0.005 (the ramp is steeper
      // than 1 in places); a jump would be far larger.
      expect(Math.abs(next - previous)).toBeLessThan(0.01);
      previous = next;
    }
  });

  it('ramps smoothly into the light-neutral exemption in luminance and chroma', () => {
    const neutral = (gray: number) => legibilityTarget(20, [gray, gray, gray], DARK_INK).amount;
    for (const boundary of [0.72, 0.9]) expect(Math.abs(neutral(boundary - 0.001) - neutral(boundary + 0.001))).toBeLessThan(0.01);
    const saturated = (chroma: number) => legibilityTarget(20, [0.95, 0.95 - chroma, 0.95 - chroma], DARK_INK).amount;
    for (const boundary of [0.07, 0.2]) expect(Math.abs(saturated(boundary - 0.001) - saturated(boundary + 0.001))).toBeLessThan(0.01);
  });

  it('finds contrasting ink when inherited CSS colour would disappear', () => {
    const dark = legibilityTarget(20, DARK, [0, 0, 0, 1]);
    expect(contrastRatio(dark.color, DARK)).toBeGreaterThanOrEqual(4.49);
    expect(dark.color[0]).toBeGreaterThan(0.4);
    const lime = legibilityTarget(20, LIME, [...LIME, 1]);
    expect(contrastRatio(lime.color, LIME)).toBeGreaterThanOrEqual(4.49);
    expect(lime.color[0]).toBeLessThan(LIME[0]);
  });
});

describe('legibility history', () => {
  it('keeps the ink polarity when the backdrop fluctuates around equal black/white contrast', () => {
    const first = legibilityTarget(20, [117 / 255, 117 / 255, 117 / 255], [0.46, 0.46, 0.46, 1]);
    let previous = first;
    for (const gray of [118, 117, 118, 117, 118, 117]) {
      const next = legibilityTarget(20, [gray / 255, gray / 255, gray / 255], [0.46, 0.46, 0.46, 1], previous.history);
      expect(next.history.polarity).toBe(first.history.polarity);
      expect(Math.max(...next.color.map((channel, i) => Math.abs(channel - previous.color[i])))).toBeLessThan(0.025);
      previous = next;
    }
  });

  it('switches polarity when the surface changes decisively', () => {
    const dark = legibilityTarget(20, DARK, [...DARK, 1]);
    expect(dark.history.polarity).toBe('light');
    const light = legibilityTarget(20, LIME, [...LIME, 1], dark.history);
    expect(light.history.polarity).toBe('dark');
    expect(contrastRatio(light.color, LIME)).toBeGreaterThanOrEqual(4.49);
  });

  it('uses separate thresholds for entering and leaving the low-contrast fallback', () => {
    const low = legibilityTarget(20, DARK, [0.2, 0.2, 0.2, 1]);
    expect(low.history.fallback).toBe(true);
    const middle: RGBA = [0.42, 0.42, 0.42, 1];
    expect(contrastRatio([middle[0], middle[1], middle[2]], DARK)).toBeGreaterThan(2.8);
    expect(contrastRatio([middle[0], middle[1], middle[2]], DARK)).toBeLessThan(3.4);
    expect(legibilityTarget(20, DARK, middle, low.history).history.fallback).toBe(true);
    const high = legibilityTarget(20, DARK, [0.5, 0.5, 0.5, 1], low.history);
    expect(high.history.fallback).toBe(false);
    expect(legibilityTarget(20, DARK, middle, high.history).history.fallback).toBe(false);
  });
});

describe('stableAmount', () => {
  it('accepts the first sample and ignores small reversals inside the dead band', () => {
    expect(stableAmount(null, 0.5)).toBe(0.5);
    expect(stableAmount(0.5, 0.514)).toBe(0.5);
    expect(stableAmount(0.5, 0.486)).toBe(0.5);
    expect(stableAmount(0.5, 0.53)).toBe(0.53);
    expect(stableAmount(0.5, 0.47)).toBe(0.47);
  });

  it('always reaches exact endpoints rather than retaining a faint correction', () => {
    expect(stableAmount(0.01, 0)).toBe(0);
    expect(stableAmount(0.99, 1)).toBe(1);
  });
});

describe('approachAmount', () => {
  it('approaches either target without overshooting and eventually settles exactly', () => {
    for (const [start, target] of [[0, 0.8], [0.8, 0]]) {
      let current = start;
      for (let frame = 0; frame < 120; frame++) {
        const next = approachAmount(current, target, 1 / 60);
        expect(next).toBeGreaterThanOrEqual(Math.min(current, target));
        expect(next).toBeLessThanOrEqual(Math.max(current, target));
        expect(Math.abs(target - next)).toBeLessThanOrEqual(Math.abs(target - current));
        current = next;
      }
      expect(current).toBe(target);
    }
  });

  it('does not advance for a non-positive elapsed time', () => {
    expect(approachAmount(0.2, 0.8, 0)).toBe(0.2);
    expect(approachAmount(0.2, 0.8, -0.5)).toBe(0.2);
  });
});
