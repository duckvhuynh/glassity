export type RGB = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (lo: number, hi: number, v: number) => {
  const t = clamp01((v - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

export function glyphSize(unit: number, padding: number): number {
  return unit * (1 - 2 * padding);
}

const linear = (v: number) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const luminance = (c: RGB) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
export function contrastRatio(a: RGB, b: RGB): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
];

export interface LegibilityHistory {
  polarity: 'dark' | 'light';
  fallback: boolean;
}

/** A glyph-only correction; light neutral pages keep the shader's existing dark ink. */
export function legibilityTarget(
  size: number,
  backdrop: RGB,
  color: RGBA,
  previous: LegibilityHistory | null = null,
): { color: RGB; amount: number; history: LegibilityHistory } {
  const small = 1 - smoothstep(26, 38, size);
  const luma = 0.2126 * backdrop[0] + 0.7152 * backdrop[1] + 0.0722 * backdrop[2];
  const chroma = Math.max(...backdrop) - Math.min(...backdrop);
  const lightNeutral = smoothstep(0.72, 0.9, luma) * (1 - smoothstep(0.07, 0.2, chroma));
  let ink: RGB = [color[0], color[1], color[2]];
  const contrast = contrastRatio(ink, backdrop);
  // Inherited black on a dark toolbar is common. Keep the hue when possible,
  // but move toward contrasting ink when the authored colour cannot be read.
  const darkContrast = contrastRatio([0, 0, 0], backdrop);
  const lightContrast = contrastRatio([1, 1, 1], backdrop);
  let polarity = previous?.polarity ?? (darkContrast > lightContrast ? 'dark' : 'light');
  if ((polarity === 'dark' ? darkContrast : lightContrast) < 4) polarity = polarity === 'dark' ? 'light' : 'dark';
  // Different entry/exit thresholds keep a changing backdrop from flipping the ink.
  const history: LegibilityHistory = { polarity, fallback: contrast < (previous?.fallback ? 3.4 : 2.8) };
  if (history.fallback) {
    const fallback: RGB = polarity === 'dark' ? [0, 0, 0] : [1, 1, 1];
    let lo = 0, hi = 1;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(mix(ink, fallback, mid), backdrop) < 4.5) lo = mid;
      else hi = mid;
    }
    ink = mix(ink, fallback, hi);
  }
  const strength = 0.72 + 0.16 * (1 - smoothstep(4.5, 9, contrastRatio(ink, backdrop)));
  return { color: ink, amount: small * (1 - lightNeutral) * strength * clamp01(color[3]), history };
}

/** A dead band prevents tiny backdrop changes from repeatedly reversing the correction. */
export function stableAmount(previous: number | null, next: number): number {
  if (previous === null || next === 0 || next === 1) return next;
  return Math.abs(next - previous) < 0.025 ? previous : next;
}

export function approachAmount(current: number, target: number, dt: number): number {
  if (Math.abs(target - current) < 0.002) return target;
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dt) * 14));
}
