import { describe, expect, it } from 'vitest';
import { buildField, distanceToSites } from '../src/core/field';

function bruteDistance(sites: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++)
          if (sites[j * w + i]) best = Math.min(best, Math.hypot(x - i, y - j));
      out[y * w + x] = best;
    }
  return out;
}

function alphaFrom(w: number, h: number, inside: (x: number, y: number) => boolean): Float32Array {
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = inside(x, y) ? 1 : 0;
  return a;
}

describe('distanceToSites', () => {
  it('matches brute force on a mask with several regions and a hole', () => {
    const w = 31, h = 23;
    const sites = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const ring = Math.hypot(x - 9, y - 11);
        if ((ring < 7 && ring > 3) || (x > 20 && x < 27 && y > 4 && y < 9) || (x === 29 && y === 21))
          sites[y * w + x] = 1;
      }
    const fast = distanceToSites(sites, w, h);
    const slow = bruteDistance(sites, w, h);
    for (let i = 0; i < fast.length; i++) expect(fast[i]).toBeCloseTo(slow[i], 3);
  });

  it('returns a large distance everywhere when there are no sites', () => {
    const d = distanceToSites(new Uint8Array(16), 4, 4);
    for (const v of d) expect(v).toBeGreaterThan(1e3);
  });
});

describe('buildField', () => {
  it('is negative inside, positive outside, near zero on the edge', () => {
    const w = 64, h = 64;
    const alpha = alphaFrom(w, h, (x, y) => Math.hypot(x - 31.5, y - 31.5) < 20);
    const f = buildField(alpha, w, h, 64);
    const sd = (x: number, y: number) => f[(y * w + x) * 2] * 64;
    expect(sd(32, 32)).toBeLessThan(-17);
    expect(sd(2, 2)).toBeGreaterThan(15);
    expect(Math.abs(sd(32 + 20, 32))).toBeLessThan(1.5);
  });

  it('reports the disc radius as local thickness across a filled disc', () => {
    const w = 64, h = 64, r = 20;
    const alpha = alphaFrom(w, h, (x, y) => Math.hypot(x - 31.5, y - 31.5) < r);
    const f = buildField(alpha, w, h, 64);
    const t = (x: number, y: number) => f[(y * w + x) * 2 + 1] * 64;
    expect(t(32, 32)).toBeGreaterThan(r - 2);
    expect(t(32, 32)).toBeLessThan(r + 2);
    // A point near the rim still belongs to the same big inscribed disc.
    expect(t(32 + 15, 32)).toBeGreaterThan(r - 3);
  });

  it('gives a thin stroke its own half-width, not the width of a nearby blob', () => {
    const w = 96, h = 64;
    // Horizontal bar 8px thick joined to nothing; plus a separate 30px square.
    const alpha = alphaFrom(w, h, (x, y) => (x > 4 && x < 50 && y >= 10 && y < 18) || (x >= 60 && x < 90 && y >= 25 && y < 55));
    const f = buildField(alpha, w, h, 64);
    const t = (x: number, y: number) => f[(y * w + x) * 2 + 1] * 64;
    expect(t(25, 14)).toBeGreaterThan(3);
    expect(t(25, 14)).toBeLessThan(5.6);
    expect(t(75, 40)).toBeGreaterThan(13);
  });

  it('keeps holes outside the shape', () => {
    const w = 64, h = 64;
    const alpha = alphaFrom(w, h, (x, y) => {
      const d = Math.hypot(x - 31.5, y - 31.5);
      return d < 24 && d > 10;
    });
    const f = buildField(alpha, w, h, 64);
    expect(f[(32 * w + 32) * 2]).toBeGreaterThan(0);
    expect(f[(32 * w + 32 + 17) * 2]).toBeLessThan(0);
  });

  it('uses partial alpha to place the edge between pixels', () => {
    const w = 32, h = 8;
    const alpha = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) alpha[y * w + x] = x < 15 ? 1 : x === 15 ? 0.25 : 0;
    const f = buildField(alpha, w, h, 32);
    // Pixel 15 is a quarter covered, so its centre sits about a quarter pixel outside.
    const sd = f[(4 * w + 15) * 2] * 32;
    expect(sd).toBeGreaterThan(0);
    expect(sd).toBeLessThan(0.6);
  });
});
