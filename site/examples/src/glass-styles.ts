// Glass looks and profiles the playground can switch the examples between. Each look is a set
// of glassity options; they are applied as data-glass-* attributes, which override what a
// <GlassProvider> sets, so one switch reaches every icon on the page.
export const LOOKS = {
  default: { label: 'Default', options: {} },
  clear: { label: 'Clear', options: { variant: 'clear' } },
  frosted: { label: 'Frosted', options: { frost: 0.8, tintOpacity: 0.32, dispersion: 0.1, shine: 0.8 } },
  crystal: { label: 'Crystal', options: { variant: 'clear', depth: 0.34, curvature: 1.7, dispersion: 1.3, shine: 1.6 } },
  tinted: { label: 'Tinted', options: { tint: '#2f6bef', tintOpacity: 0.55 } },
  bold: { label: 'Bold', options: { weight: 0.05, depth: 0.22 } },
} as const satisfies Record<string, { label: string; options: Record<string, string | number> }>;

export const PROFILES = {
  default: { label: 'As designed', options: {} },
  squircle: { label: 'Squircle', options: { profile: 'squircle' } },
  circle: { label: 'Circle', options: { profile: 'circle' } },
  lip: { label: 'Lip', options: { profile: 'lip' } },
  dome: { label: 'Dome', options: { profile: 'dome' } },
} as const satisfies Record<string, { label: string; options: Record<string, string | number> }>;

export type Look = keyof typeof LOOKS;
export type Profile = keyof typeof PROFILES;

export const isLook = (v: unknown): v is Look => typeof v === 'string' && Object.hasOwn(LOOKS, v);
export const isProfile = (v: unknown): v is Profile => typeof v === 'string' && Object.hasOwn(PROFILES, v);

/** The message the playground sends into an example's frame. */
export interface StyleMessage {
  type: 'glassity-style';
  look: Look;
  profile: Profile;
}
