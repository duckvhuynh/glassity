/** Browser-only: turn a mounted <svg> into alpha coverage at a chosen resolution. */

/** Space kept around the icon box for the shadow and the outside of the distance field, as a fraction of the box. */
export const BLEED = 0.2;

export interface RasterPlan {
  /** Icon box in CSS px. */
  boxW: number;
  boxH: number;
  /** Reference size: the shorter side of the box, CSS px. */
  unit: number;
  /** Margin around the box, CSS px. */
  bleed: number;
  /** Canvas (box + margins) in CSS px. */
  cssW: number;
  cssH: number;
  /** Field texture size in raster px, and raster px per CSS px. */
  gw: number;
  gh: number;
  scale: number;
}

export function planRaster(boxW: number, boxH: number, dpr: number): RasterPlan {
  const unit = Math.min(boxW, boxH);
  const bleed = Math.ceil(unit * BLEED);
  const cssW = boxW + bleed * 2;
  const cssH = boxH + bleed * 2;
  const longest = Math.max(cssW, cssH);
  // Small icons are rasterized well above screen resolution: the field is
  // magnified smoothly by the GPU, and a coarse field gives stair-stepped normals.
  const wanted = dpr * (unit < 40 ? 3 : unit < 90 ? 2 : 1.25);
  const scale = Math.max(Math.min(wanted, 512 / longest), Math.min(96 / longest, 8));
  return { boxW, boxH, unit, bleed, cssW, cssH, gw: Math.max(8, Math.round(cssW * scale)), gh: Math.max(8, Math.round(cssH * scale)), scale };
}

const PAINT = [
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset', 'fill-rule', 'clip-rule', 'fill-opacity', 'stroke-opacity',
  'vector-effect', 'paint-order',
];
const PAINT_INNER = [...PAINT, 'opacity', 'display', 'visibility'];
const KEEP_ON_ROOT = new Set(['viewbox', 'preserveaspectratio', 'xmlns', 'xmlns:xlink', 'fill', 'stroke']);

/**
 * Serialize the icon as a self-contained SVG document.
 * Page CSS does not reach an SVG drawn as an image, so the resolved paint of
 * every node is written inline first. `__W__`/`__H__` are filled in per raster.
 */
export function serializeIcon(svg: SVGSVGElement, strokeWidth: number | null): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const to = [clone, ...Array.from(clone.querySelectorAll('*'))];

  for (let i = 0; i < from.length; i++) {
    const src = from[i];
    const dst = to[i] as SVGElement;
    if (!(src instanceof SVGElement) || !dst) continue;
    const cs = getComputedStyle(src);
    let style = '';
    for (const prop of i === 0 ? PAINT : PAINT_INNER) {
      const value = cs.getPropertyValue(prop);
      if (value) style += prop + ':' + value + ';';
    }
    if (strokeWidth != null && cs.getPropertyValue('stroke') !== 'none') style += 'stroke-width:' + strokeWidth + ';';
    dst.setAttribute('style', style);
    dst.removeAttribute('class');
  }

  for (const name of clone.getAttributeNames()) if (!KEEP_ON_ROOT.has(name.toLowerCase()) && name !== 'style') clone.removeAttribute(name);
  if (!clone.getAttribute('viewBox')) {
    const w = svg.width.baseVal.value || svg.clientWidth || 24;
    const h = svg.height.baseVal.value || svg.clientHeight || 24;
    clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone).replace(/^<svg/, '<svg width="__W__" height="__H__"');
}

/** Draw the serialized icon into the plan's raster and return its alpha channel. */
export async function rasterAlpha(source: string, plan: RasterPlan, padding: number): Promise<Uint8ClampedArray> {
  const inset = padding * plan.unit;
  const x = (plan.bleed + inset) * plan.scale;
  const y = (plan.bleed + inset) * plan.scale;
  const w = Math.max(1, (plan.boxW - inset * 2) * plan.scale);
  const h = Math.max(1, (plan.boxH - inset * 2) * plan.scale);

  const text = source.replace('__W__', String(Math.ceil(w))).replace('__H__', String(Math.ceil(h)));
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
  } finally {
    URL.revokeObjectURL(url);
  }

  const canvas = document.createElement('canvas');
  canvas.width = plan.gw;
  canvas.height = plan.gh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('glassity: 2D canvas is not available');
  ctx.drawImage(image, x, y, w, h);
  const rgba = ctx.getImageData(0, 0, plan.gw, plan.gh).data;
  const alpha = new Uint8ClampedArray(plan.gw * plan.gh);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  return alpha;
}
