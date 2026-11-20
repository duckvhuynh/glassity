// Named library looks and profiles applied as data-glass-* attributes to every icon.
// Explicit options on providers or icons still override the selected look's recipe.
import type { GlassLook } from 'glassity';
export const LOOKS = {
  default: { label: 'Default', options: { look: 'default' } },
  clear: { label: 'Clear', options: { look: 'clear' } },
  frosted: { label: 'Frosted', options: { look: 'frosted' } },
  crystal: { label: 'Crystal', options: { look: 'crystal' } },
  tinted: { label: 'Tinted', options: { look: 'tinted' } },
  bold: { label: 'Bold', options: { look: 'bold' } },
} as const satisfies Record<GlassLook, { label: string; options: { look: GlassLook } }>;

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
