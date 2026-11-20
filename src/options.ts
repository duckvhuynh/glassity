export type GlassVariant = 'regular' | 'clear' | 'identity';
export type GlassProfile = 'squircle' | 'circle' | 'lip' | 'dome';
export type GlassScheme = 'auto' | 'light' | 'dark';
export type GlassLook = 'default' | 'clear' | 'frosted' | 'crystal' | 'tinted' | 'bold';

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
  /** Rasterize HTML text instead of looking for an SVG. Default `false`. */
  text?: boolean;
  /** Named recipe underneath explicit options. Default `default`. */
  look?: GlassLook;
  /** `regular` keeps content legible, `clear` is see-through, `identity` leaves the SVG untouched. Default `regular`. */
  variant?: GlassVariant;
  /**
   * Cross-section of the edge. `dome` is a ball of glass traced through both of its surfaces:
   * it magnifies, and with `depth` around 0.3 or more it shows the page upside down, like a
   * glass sphere. Best on a round tile (`tile`, `tileRadius: 0.5`). Default `squircle`.
   */
  profile?: GlassProfile;

  /** Put the icon on a rounded glass plate that fills the SVG's box. Default `false`. */
  tile?: boolean;
  /** Plate corner radius as a fraction of the box, 0–0.5. Default `0.26`. */
  tileRadius?: number;
  /** How solid the icon is when it sits on a plate, 0–1. Default `0.9`. */
  glyphOpacity?: number;
  /** Inset of the icon inside its box, as a fraction per side. Default `0` (`0.22` with `tile`). */
  padding?: number;
  /** Override the SVG's stroke width, in viewBox units. Stroked icons only. */
  strokeWidth?: number;
  /** Make the shape bolder (or thinner when negative) by this fraction of the box: works for strokes and fills alike, 0.08 to -0.03. Default `0`. */
  weight?: number;

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
  /** Glass body colour, any CSS colour or currentColor. Auto adapts small icons to their backdrop. Default auto. */
  tint?: string;
  /** Help small automatic-tint glyphs contrast with dark or saturated backdrops. Default auto. */
  legibility?: 'auto' | 'off';
  /** How much of the tint is mixed in, 0–1. Default `0.14` (`0.04` for clear). */
  tintOpacity?: number;
  /** Darkening under the glass, 0–1. `auto` darkens up to 35%, only over bright and busy backdrops (photos), never a plain light page. Default `0` (`auto` for clear). */
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
  text: boolean;
  look: GlassLook;
  variant: GlassVariant;
  profile: GlassProfile;
  tile: boolean;
  tileRadius: number;
  glyphOpacity: number;
  padding: number;
  strokeWidth: number | null;
  weight: number;
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
  legibility: 'auto' | 'off';
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

/** The key is the option name; defaults, limits and attribute discovery all come from this table. */
interface OptionDescriptor<T = unknown> {
  readonly kind: 'number' | 'boolean' | 'enum' | 'string';
  readonly default: T;
  readonly min?: number;
  readonly max?: number;
  readonly values?: readonly string[];
  readonly round?: boolean;
  readonly positive?: boolean;
  readonly zero?: number;
  readonly attribute?: boolean;
  readonly passthrough?: boolean;
}

export const OPTION_DESCRIPTORS = {
  text: { kind: 'boolean', default: false },
  look: { kind: 'enum', default: 'default', values: ['default', 'clear', 'frosted', 'crystal', 'tinted', 'bold'] },
  variant: { kind: 'enum', default: 'regular', values: ['regular', 'clear', 'identity'] },
  profile: { kind: 'enum', default: 'squircle', values: ['squircle', 'circle', 'lip', 'dome'] },
  tile: { kind: 'boolean', default: false },
  tileRadius: { kind: 'number', default: 0.26, min: 0, max: 0.5 },
  glyphOpacity: { kind: 'number', default: 0.9, min: 0, max: 1 },
  padding: { kind: 'number', default: 0, min: 0, max: 0.45 },
  strokeWidth: { kind: 'number', default: null, positive: true },
  weight: { kind: 'number', default: 0, min: -0.03, max: 0.08, zero: 0 },
  bevel: { kind: 'number', default: 0.09, min: 0.005, max: 0.5 },
  curvature: { kind: 'number', default: 1, min: 0, max: 4 },
  depth: { kind: 'number', default: 0.16, min: 0, max: 2 },
  ior: { kind: 'number', default: 1.5, min: 1, max: 2.5 },
  refraction: { kind: 'number', default: 1, min: 0, max: 8 },
  dispersion: { kind: 'number', default: 0.35, min: 0, max: 2 },
  bands: { kind: 'number', default: 6, min: 1, max: 8, round: true },
  frost: { kind: 'number', default: 0.3, min: 0, max: 1 },
  saturation: { kind: 'number', default: 1.35, min: 0, max: 3 },
  brightness: { kind: 'number', default: 1, min: 0, max: 3 },
  contrast: { kind: 'number', default: 0.9, min: 0, max: 2 },
  tint: { kind: 'string', default: 'auto' },
  legibility: { kind: 'enum', default: 'auto', values: ['auto', 'off'] },
  tintOpacity: { kind: 'number', default: 0.14, min: 0, max: 1 },
  dim: { kind: 'number', default: 0, min: 0, max: 1, values: ['auto'] },
  opacity: { kind: 'number', default: 1, min: 0, max: 1 },
  shine: { kind: 'number', default: 1, min: 0, max: 4 },
  rim: { kind: 'number', default: 1, min: 0, max: 4 },
  reflection: { kind: 'number', default: 0.6, min: 0, max: 4 },
  lightAngle: { kind: 'number', default: -45, zero: 0 },
  shadow: { kind: 'number', default: 0.3, min: 0, max: 1 },
  interactive: { kind: 'boolean', default: false },
  pointerLight: { kind: 'boolean', default: true },
  visible: { kind: 'boolean', default: true },
  duration: { kind: 'number', default: 520, min: 0, max: 10000 },
  scheme: { kind: 'enum', default: 'auto', values: ['auto', 'light', 'dark'] },
  accessibility: { kind: 'boolean', default: true },
  backdrop: { kind: 'string', default: 'auto', attribute: false, passthrough: true },
  maxDpr: { kind: 'number', default: 2, min: 0.5, max: 4, zero: 1 },
} as const satisfies { readonly [K in keyof ResolvedOptions]: OptionDescriptor<ResolvedOptions[K]> };

export const OPTION_KEYS = Object.keys(OPTION_DESCRIPTORS) as (keyof ResolvedOptions)[];
const BASE = Object.fromEntries(OPTION_KEYS.map((key) => [key, OPTION_DESCRIPTORS[key].default])) as unknown as ResolvedOptions;

const VARIANTS: Record<GlassVariant, Partial<ResolvedOptions>> = {
  regular: {},
  clear: { frost: 0, saturation: 1.1, contrast: 1, tintOpacity: 0.04, dim: 'auto', dispersion: 0.5 },
  identity: {},
};

/** Recipes never become explicit options, so switching looks also removes the previous recipe. */
export const looks = Object.freeze({
  default: Object.freeze({}),
  clear: Object.freeze({ variant: 'clear' }),
  frosted: Object.freeze({ frost: 0.8, tintOpacity: 0.32, dispersion: 0.1, shine: 0.8 }),
  crystal: Object.freeze({ variant: 'clear', depth: 0.34, curvature: 1.7, dispersion: 1.3, shine: 1.6 }),
  tinted: Object.freeze({ tint: '#2f6bef', tintOpacity: 0.55 }),
  bold: Object.freeze({ weight: 0.05, depth: 0.22 }),
} as const satisfies Readonly<Record<GlassLook, Readonly<GlassOptions>>>);

function resolveValue(descriptor: OptionDescriptor, value: unknown, fallback: unknown): unknown {
  if (descriptor.values?.includes(value as string)) return value;
  if (descriptor.kind === 'enum') return descriptor.default;
  if (descriptor.kind === 'boolean') return descriptor.default === true ? value !== false : value === true;
  if (descriptor.kind === 'string') return descriptor.passthrough || (typeof value === 'string' && value) ? value : fallback;
  const numeric = typeof value === 'string' && value.trim() === '' ? NaN : +(value as number);
  if (!Number.isFinite(numeric)) return fallback;
  if (descriptor.positive) return numeric > 0 ? numeric : null;
  const n = numeric === 0 && descriptor.zero !== undefined ? descriptor.zero : numeric;
  const clamped = Math.min(descriptor.max ?? Infinity, Math.max(descriptor.min ?? -Infinity, n));
  return descriptor.round ? Math.round(clamped) : clamped;
}

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
  const look = resolveValue(OPTION_DESCRIPTORS.look, merged.look, BASE.look) as GlassLook;
  const values = { ...looks[look], ...merged } as Record<string, unknown>;
  const variant = resolveValue(OPTION_DESCRIPTORS.variant, values.variant, BASE.variant) as GlassVariant;
  const tile = values.tile === true;
  const defaults = { ...BASE, ...VARIANTS[variant], ...(tile ? { padding: 0.22 } : null) };
  const resolved: Record<string, unknown> = {};
  for (const key of OPTION_KEYS) {
    resolved[key] = resolveValue(OPTION_DESCRIPTORS[key], values[key] === undefined ? defaults[key] : values[key], defaults[key]);
  }
  return resolved as unknown as ResolvedOptions;
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const ATTRS = new Map(OPTION_KEYS.filter((key) => (OPTION_DESCRIPTORS[key] as OptionDescriptor).attribute !== false).map((key) => ['data-glass-' + kebab(key), key]));

/** Keep the established attribute coercions shared by DOM and framework adapters. */
export function parseOptionAttribute(value: unknown, trim = true): unknown {
  if (typeof value !== 'string') return value;
  const v = trim ? value.trim() : value;
  if (v === '' || v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(v.trim())) return parseFloat(v);
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
    if (v === 'text') out.text = true;
    if (OPTION_DESCRIPTORS.variant.values.includes(v as GlassVariant)) out.variant = v;
  }
  for (const name of el.getAttributeNames()) {
    const key = ATTRS.get(name);
    if (key) out[key] = parseOptionAttribute(el.getAttribute(name) ?? '');
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
