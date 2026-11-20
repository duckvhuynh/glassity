import { OPTION_KEYS, optionsKey, parseOptionAttribute, type GlassOptions } from './options';

/**
 * Small helpers shared by the framework adapters (Vue, Svelte, Solid). They live
 * in their own module so each adapter stays a thin layer over `glassify`/`auto`.
 */

/** Tell whether new options differ from the last ones applied, including an element-valued backdrop. */
export function changed(previous: GlassOptions | undefined, next: GlassOptions | undefined): boolean {
  if (previous === next) return false;
  return optionsKey(previous) !== optionsKey(next) || previous?.backdrop !== next?.backdrop;
}

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Every option name (from the registry), for picking options out of a bag of attributes. */
const NAMES = new Set<string>(OPTION_KEYS);

/**
 * Read glass options from attributes as a template writes them: `tile` (present,
 * empty) is true, `depth="0.3"` is a number, `light-angle` is `lightAngle`.
 */
export function fromAttributes(attrs: Record<string, unknown>): GlassOptions {
  const out: Record<string, unknown> = {};
  for (const [raw, value] of Object.entries(attrs)) {
    const name = camel(raw);
    if (!NAMES.has(name) || value === undefined) continue;
    out[name] = parseOptionAttribute(value, false);
  }
  return out as GlassOptions;
}
