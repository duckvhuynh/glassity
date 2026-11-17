export type GlassVariant = 'regular' | 'clear' | 'identity';
export type GlassProfile = 'squircle' | 'circle' | 'lip';
export type GlassScheme = 'auto' | 'light' | 'dark';

/**
 * What the glass refracts.
 * - `'auto'`: the nearest ancestor with a CSS background image or gradient; if none, a snapshot of the surrounding HTML.
 * - `'none'`: only the page colour.
 * - a URL string: an image stretched to cover the surrounding container.
 * - an `<img>`, `<video>` or `<canvas>`: used directly (video and canvas update live).
 * - any other element: a snapshot of that element and its contents.
 */
export type BackdropSource = 'auto' | 'none' | string | HTMLElement;

export interface GlassOptions {
  /** `regular` keeps content legible, `clear` is see-through, `identity` leaves the SVG untouched. Default `regular`. */
  variant?: GlassVariant;
  /** Cross-section of the edge. Default `squircle`. */
  profile?: GlassProfile;

  /** Put the icon on a rounded glass plate that fills the SVG's box. Default `false`. */
  tile?: boolean;
  /** Plate corner radius as a fraction of the box, 0–0.5. Default `0.26`. */
  tileRadius?: number;
  /** How solid the icon is when it sits on a plate, 0–1. Default `0.9`. */
  glyphOpacity?: number;
  /** Inset of the icon inside its box, as a fraction per side. Default `0` (`0.22` with `tile`). */
  padding?: number;
  /** Override the SVG's stroke width, in viewBox units. */
  strokeWidth?: number;

  /** Width of the curved edge as a fraction of the box. Thin strokes use their own half-width. Default `0.09`. */
  bevel?: number;
  /** How steep the curved edge is. `0` is flat glass. Default `1`. */
  curvature?: number;
  /** Optical depth as a fraction of the box: how far light travels after bending. Default `0.16`. */
  depth?: number;
  /** Index of refraction. Default `1.5`. */
  ior?: number;
  /** Overall strength of the bending. `0` turns it off. Default `1`. */
  refraction?: number;
  /** Colour separation at the edges, 0–2. Default `0.35` (`0.5` for clear). */
  dispersion?: number;
  /** Number of wavelength bands sampled for dispersion, 1–8. Default `6`. */
  bands?: number;
  /** Blur of what is seen through the glass, 0–1. Default `0.3` (`0` for clear). */
  frost?: number;
  /** Saturation of what is seen through the glass. Default `1.35`. */
  saturation?: number;
  /** Brightness of what is seen through the glass. Default `1`. */
  brightness?: number;
  /** Contrast of what is seen through the glass. Default `0.9`. */
  contrast?: number;
  /** Glass body colour, any CSS colour. `auto` picks white or near-black from the backdrop. Default `auto`. */
  tint?: string;
  /** How much of the tint is mixed in, 0–1. Default `0.14` (`0.04` for clear). */
  tintOpacity?: number;
  /** Darkening under the glass, 0–1. `auto` darkens up to 35% only over bright backdrops. Default `0` (`auto` for clear). */
  dim?: number | 'auto';
  /** Overall opacity, 0–1. Default `1`. */
  opacity?: number;

  /** Strength of the specular highlight. Default `1`. */
  shine?: number;
  /** Strength of the thin light along the edge. Default `1`. */
  rim?: number;
  /** Strength of the reflected surroundings. Default `0.6`. */
  reflection?: number;
  /** Direction the light comes from, in degrees clockwise from the top. Default `-45` (top left). */
  lightAngle?: number;
  /** Strength of the drop shadow, 0–1. Default `0.3`. */
  shadow?: number;

  /** Swell, bounce and glow when pressed. Default `false`. */
  interactive?: boolean;
  /** Let the highlight follow the pointer. Default `true`. */
  pointerLight?: boolean;
  /** Show or hide the glass. It materialises by bending light in and out. Default `true`. */
  visible?: boolean;
  /** Length of the materialise and morph transitions in milliseconds. Default `520`. */
  duration?: number;
  /** `auto` reads the backdrop under the icon; `dark` forces light glass for dark pages, `light` the reverse. Default `auto`. */
  scheme?: GlassScheme;

  /**
   * Follow the system's accessibility settings: reduced motion stops the pointer light and the bounce,
   * reduced transparency makes the glass frostier, more contrast makes it solid, forced colours leave the SVG as it is.
   * Default `true`.
   */
  accessibility?: boolean;

  /** What the glass refracts. Default `auto`. */
  backdrop?: BackdropSource;
  /** Upper limit for the device pixel ratio. Default `2`. */
  maxDpr?: number;
}

export interface ResolvedOptions {
  variant: GlassVariant;
  profile: GlassProfile;
  tile: boolean;
  tileRadius: number;
  glyphOpacity: number;
  padding: number;
  strokeWidth: number | null;
  bevel: number;
  curvature: number;
  depth: number;
  ior: number;
  refraction: number;
  dispersion: number;
  bands: number;
  frost: number;
  saturation: number;
  brightness: number;
  contrast: number;
  tint: string;
  tintOpacity: number;
  dim: number | 'auto';
  opacity: number;
  shine: number;
  rim: number;
  reflection: number;
  lightAngle: number;
  shadow: number;
  interactive: boolean;
  pointerLight: boolean;
  visible: boolean;
  duration: number;
  scheme: GlassScheme;
  accessibility: boolean;
  backdrop: BackdropSource;
  maxDpr: number;
}

const BASE: ResolvedOptions = {
  variant: 'regular',
  profile: 'squircle',
  tile: false,
  tileRadius: 0.26,
  glyphOpacity: 0.9,
  padding: 0,
  strokeWidth: null,
  bevel: 0.09,
  curvature: 1,
  depth: 0.16,
  ior: 1.5,
  refraction: 1,
  dispersion: 0.35,
  bands: 6,
  frost: 0.3,
  saturation: 1.35,
  brightness: 1,
  contrast: 0.9,
  tint: 'auto',
  tintOpacity: 0.14,
  dim: 0,
  opacity: 1,
  shine: 1,
  rim: 1,
  reflection: 0.6,
  lightAngle: -45,
  shadow: 0.3,
  interactive: false,
  pointerLight: true,
  visible: true,
  duration: 520,
  scheme: 'auto',
  accessibility: true,
  backdrop: 'auto',
  maxDpr: 2,
};

const VARIANTS: Record<GlassVariant, Partial<ResolvedOptions>> = {
  regular: {},
  clear: { frost: 0, saturation: 1.1, contrast: 1, tintOpacity: 0.04, dim: 'auto', dispersion: 0.5 },
  identity: {},
};

export const OPTION_KEYS = Object.keys(BASE) as (keyof ResolvedOptions)[];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Merge option layers (later layers win; `undefined` never overrides) into a complete, clamped set. */
export function resolveOptions(...layers: (GlassOptions | undefined | null)[]): ResolvedOptions {
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const key of OPTION_KEYS) {
      const value = (layer as Record<string, unknown>)[key];
      if (value !== undefined) merged[key] = value;
    }
  }
  const variant: GlassVariant = merged.variant === 'clear' || merged.variant === 'identity' ? merged.variant : 'regular';
  const tile = merged.tile === true;
  const o = { ...BASE, ...VARIANTS[variant], ...(tile ? { padding: 0.22 } : null), ...merged, variant, tile } as ResolvedOptions;

  o.profile = o.profile === 'circle' || o.profile === 'lip' ? o.profile : 'squircle';
  o.scheme = o.scheme === 'light' || o.scheme === 'dark' ? o.scheme : 'auto';
  o.tileRadius = clamp(+o.tileRadius || 0, 0, 0.5);
  o.glyphOpacity = clamp(+o.glyphOpacity, 0, 1);
  o.padding = clamp(+o.padding || 0, 0, 0.45);
  o.strokeWidth = o.strokeWidth == null || !(+o.strokeWidth > 0) ? null : +o.strokeWidth;
  o.bevel = clamp(+o.bevel, 0.005, 0.5);
  o.curvature = clamp(+o.curvature, 0, 4);
  o.depth = clamp(+o.depth, 0, 2);
  o.ior = clamp(+o.ior, 1, 2.5);
  o.refraction = clamp(+o.refraction, 0, 8);
  o.dispersion = clamp(+o.dispersion, 0, 2);
  o.bands = Math.round(clamp(+o.bands || 1, 1, 8));
  o.frost = clamp(+o.frost, 0, 1);
  o.saturation = clamp(+o.saturation, 0, 3);
  o.brightness = clamp(+o.brightness, 0, 3);
  o.contrast = clamp(+o.contrast, 0, 2);
  o.tintOpacity = clamp(+o.tintOpacity, 0, 1);
  o.dim = o.dim === 'auto' ? 'auto' : clamp(+o.dim || 0, 0, 1);
  o.opacity = clamp(+o.opacity, 0, 1);
  o.shine = clamp(+o.shine, 0, 4);
  o.rim = clamp(+o.rim, 0, 4);
  o.reflection = clamp(+o.reflection, 0, 4);
  o.lightAngle = +o.lightAngle || 0;
  o.shadow = clamp(+o.shadow, 0, 1);
  o.duration = clamp(+o.duration || 0, 0, 10000);
  o.maxDpr = clamp(+o.maxDpr || 1, 0.5, 4);
  o.interactive = o.interactive === true;
  o.pointerLight = o.pointerLight !== false;
  o.visible = o.visible !== false;
  o.accessibility = o.accessibility !== false;
  o.tint = typeof o.tint === 'string' && o.tint ? o.tint : 'auto';
  return o;
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const ATTRS = new Map(OPTION_KEYS.filter((k) => k !== 'backdrop').map((k) => ['data-glass-' + kebab(k), k]));

function parseValue(raw: string): unknown {
  const v = raw.trim();
  if (v === '' || v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(v)) return parseFloat(v);
  return v;
}

/**
 * Read per-element options from attributes.
 * `data-glass` alone uses the defaults, `data-glass="clear"` picks a variant,
 * `data-glass="off"` opts out (returns `null`); `data-glass-depth="0.3"` etc. set single options.
 */
export function readAttributes(el: { getAttribute(name: string): string | null; getAttributeNames(): string[] }): GlassOptions | null {
  const out: Record<string, unknown> = {};
  const main = el.getAttribute('data-glass');
  if (main != null) {
    const v = main.trim().toLowerCase();
    if (v === 'off' || v === 'false' || v === 'none') return null;
    if (v === 'regular' || v === 'clear' || v === 'identity') out.variant = v;
  }
  for (const name of el.getAttributeNames()) {
    const key = ATTRS.get(name);
    if (key) out[key] = parseValue(el.getAttribute(name) ?? '');
  }
  return out as GlassOptions;
}

/** Stable string for change detection of an options object (ignores element-valued backdrops). */
export function optionsKey(options: GlassOptions | undefined | null): string {
  if (!options) return '';
  let key = '';
  for (const k of OPTION_KEYS) {
    const v = (options as Record<string, unknown>)[k];
    if (v === undefined || (k === 'backdrop' && typeof v !== 'string')) continue;
    key += k + '=' + String(v) + ';';
  }
  return key;
}
