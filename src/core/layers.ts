import { readAttributes, resolveOptions, type GlassOptions, type ResolvedOptions } from '../options';

/** Bound both field textures and the number of refraction passes per icon. */
export const MAX_LAYERS = 4;
const DEFINITIONS = 'defs, symbol, clipPath, mask, pattern, marker';
const MARKED = 'g[data-glass-layer]';
const SHAPES = 'path, rect, circle, ellipse, polygon, polyline, line, text, use';
const MATERIAL_KEYS = [
  'profile', 'padding', 'strokeWidth', 'weight', 'bevel', 'curvature', 'depth', 'ior',
  'refraction', 'dispersion', 'bands', 'frost', 'saturation', 'brightness', 'contrast',
  'tint', 'tintOpacity', 'dim', 'opacity', 'shine', 'rim', 'reflection', 'lightAngle', 'shadow', 'scheme',
] as const satisfies readonly (keyof GlassOptions)[];

export interface GlassLayer {
  element: SVGGElement;
  name: string;
  options: ResolvedOptions;
}

/** Resolve material controls without letting a group change the icon's lifecycle or backdrop. */
export function resolveLayerOptions(base: ResolvedOptions, index: number, attributes: GlassOptions = {}, sourceTint?: string): ResolvedOptions {
  const overrides: GlassOptions = {};
  for (const key of MATERIAL_KEYS) {
    const value = attributes[key];
    if (value !== undefined) (overrides as Record<string, unknown>)[key] = value;
  }
  let appearance: GlassOptions = {};
  if (base.appearance === 'dark') {
    appearance = { tint: index === 0 ? '#172033' : '#f5f7ff', tintOpacity: index === 0 ? 0.82 : 0.72 };
  } else if (base.appearance === 'clear') {
    appearance = { variant: 'clear', frost: 0, saturation: 1.1, contrast: 1, tintOpacity: 0.04, dim: 'auto', dispersion: 0.5 };
  } else if (base.appearance === 'tinted') {
    appearance = { tintOpacity: index === 0 ? 0.72 : 0.4 };
  }
  const source: GlassOptions = base.colors === 'source' && sourceTint ? { tint: sourceTint, tintOpacity: 0.55 } : {};
  const result = resolveOptions({ ...base, strokeWidth: base.strokeWidth ?? undefined }, source, appearance, overrides);
  // Layers already supply their own silhouettes, so a plate must not cover their gaps.
  result.tile = false;
  result.legibility = 'off';
  if (base.appearance === 'tinted') {
    result.tint = base.tint === 'auto' ? 'currentColor' : base.tint;
    result.saturation = 0;
  }
  return result;
}

/** Source colour is one solid paint per layer; gradients stay a glass tint, not a painted texture. */
function sourceTint(layer: SVGGElement): string | undefined {
  const shapes = Array.from(layer.querySelectorAll(SHAPES));
  let stroke: string | undefined;
  for (const shape of shapes) {
    if (shape.closest(MARKED) !== layer || shape.closest(DEFINITIONS)) continue;
    const style = getComputedStyle(shape);
    let hidden = false;
    // The root SVG is hidden by glassity itself; only its contents affect source paint.
    for (let node: Element | null = shape; node && node.localName !== 'svg'; node = node.parentElement) {
      const ancestor = node === shape ? style : getComputedStyle(node);
      if (ancestor.display === 'none' || ancestor.opacity === '0') { hidden = true; break; }
    }
    if (hidden || style.visibility === 'hidden' || style.visibility === 'collapse') continue;
    const solid = (paint: string) => paint && paint !== 'none' && paint !== 'transparent' && !paint.startsWith('url(');
    if (solid(style.fill) && style.fillOpacity !== '0') return style.fill;
    if (!stroke && solid(style.stroke) && style.strokeOpacity !== '0') stroke = style.stroke;
  }
  return stroke;
}

/** Only explicit marks are layers. Exporter groups keep the ordinary single-body path. */
export function parseLayers(svg: SVGSVGElement, options: ResolvedOptions): GlassLayer[] {
  if (!options.layers) return [];
  return Array.from(svg.querySelectorAll<SVGGElement>(MARKED))
    .filter((element) => element.closest('svg') === svg && !element.closest(DEFINITIONS))
    .slice(0, MAX_LAYERS)
    .map((element, index) => ({
      element,
      name: element.getAttribute('data-glass-layer') ?? '',
      options: resolveLayerOptions(options, index, readAttributes(element) ?? {}, options.colors === 'source' ? sourceTint(element) : undefined),
    }));
}

/** Prune a styled copy, keeping ancestor transforms and definitions needed by the chosen group. */
export function isolateLayer(svg: SVGSVGElement, clone: SVGSVGElement, layer: SVGGElement): void {
  const from = Array.from(svg.querySelectorAll('*'));
  const to = Array.from(clone.querySelectorAll('*'));
  for (let i = 0; i < from.length; i++) {
    const node = from[i];
    const copy = to[i];
    if (!copy) continue;
    const definition = node.closest(DEFINITIONS);
    const belongs = node === layer || node.contains(layer) || (layer.contains(node) && node.closest(MARKED) === layer);
    if (!definition && !belongs) copy.remove();
    // Optical changes and human-readable layer names do not invalidate cached geometry.
    for (const name of copy.getAttributeNames()) if (name.startsWith('data-glass')) copy.removeAttribute(name);
  }
}
