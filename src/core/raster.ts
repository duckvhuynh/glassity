import { cachedLoad, LruCache } from './lru';

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

export function planRaster(boxW: number, boxH: number, dpr: number, grow = 0): RasterPlan {
  const unit = Math.min(boxW, boxH);
  // A shape made bolder (`weight`) needs that much more room for its edge and shadow.
  const bleed = Math.ceil(unit * (BLEED + Math.max(grow, 0)));
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

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
/** `url(...)` in an attribute or style value, with the part after `#`. */
const URL_REF = /url\(\s*(['"]?)([^)'"]*?)#([^)'"\s]+)\1\s*\)/g;
const REF_ATTRS = ['fill', 'stroke', 'clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end', 'style'];

const externalDocuments = new LruCache<string, Promise<Document | null>>(32);

/** Fetch and parse a sprite once while it remains in the bounded cache. */
function externalDocument(url: string): Promise<Document | null> {
  return cachedLoad(externalDocuments, url, () => fetch(url)
    .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
    .then((text) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      if (doc.querySelector('parsererror')) throw new Error('Invalid SVG');
      return doc;
    })
    .catch(() => {
      console.warn(`glassity: could not load the sprite "${url}" (missing, invalid, or blocked by CORS).`);
      return null;
    }));
}

function hrefOf(el: Element): string | null {
  return el.getAttribute('href') ?? el.getAttributeNS(XLINK_NS, 'href');
}

/** Find what an `href` points at: in the icon's own document (or shadow root), or in an external file. */
async function lookup(href: string, original: SVGSVGElement): Promise<Element | null> {
  const hash = href.indexOf('#');
  if (hash < 0) return null;
  const id = decodeURIComponent(href.slice(hash + 1));
  const file = href.slice(0, hash);
  const page = document.baseURI.split('#')[0];
  const here = !file || new URL(file, document.baseURI).href.split('#')[0] === page;
  if (here) {
    const root = original.getRootNode() as Document | ShadowRoot;
    return (root.getElementById?.(id) as Element | null) ?? document.getElementById(id);
  }
  const doc = await externalDocument(new URL(file, document.baseURI).href);
  return doc?.getElementById(id) ?? null;
}

/**
 * Bring into the copy what the icon only references: sprite symbols drawn with
 * `<use>`, and gradients, masks or clip paths defined in another SVG on the page.
 * An SVG drawn as an image cannot see the page, so without this those parts
 * would be missing and the icon would come out empty.
 */
async function inlineReferences(original: SVGSVGElement, clone: SVGSVGElement): Promise<void> {
  const local = (id: string) => clone.querySelector(`[id="${CSS.escape(id)}"]`);

  // <use>: replace each one whose target is outside the copy by the target itself.
  for (let pass = 0; pass < 4; pass++) {
    const uses = Array.from(clone.querySelectorAll('use')).filter((use) => {
      const href = hrefOf(use);
      return !!href && !(href.startsWith('#') && local(href.slice(1)));
    });
    if (!uses.length) break;
    let changed = false;
    for (const use of uses) {
      const target = await lookup(hrefOf(use)!, original);
      if (!target) continue;
      changed = true;
      const wrap = document.createElementNS(SVG_NS, 'g');
      for (const name of use.getAttributeNames())
        if (!['href', 'xlink:href', 'x', 'y', 'width', 'height', 'id'].includes(name)) wrap.setAttribute(name, use.getAttribute(name)!);
      const x = use.getAttribute('x') ?? '0';
      const y = use.getAttribute('y') ?? '0';
      let body: Element;
      if (target.localName === 'symbol' || target.localName === 'svg') {
        // A symbol becomes a nested viewport, as <use> itself would make it.
        body = document.createElementNS(SVG_NS, 'svg');
        for (const name of ['viewBox', 'preserveAspectRatio']) {
          const value = target.getAttribute(name);
          if (value) body.setAttribute(name, value);
        }
        body.setAttribute('x', x);
        body.setAttribute('y', y);
        body.setAttribute('width', use.getAttribute('width') ?? target.getAttribute('width') ?? '100%');
        body.setAttribute('height', use.getAttribute('height') ?? target.getAttribute('height') ?? '100%');
        body.setAttribute('overflow', 'visible');
        for (const child of Array.from(target.childNodes)) body.appendChild(document.importNode(child, true));
      } else {
        body = document.createElementNS(SVG_NS, 'g');
        body.setAttribute('transform', `translate(${x} ${y})`);
        const copy = document.importNode(target, true) as Element;
        copy.removeAttribute('id');
        body.appendChild(copy);
      }
      wrap.appendChild(body);
      use.replaceWith(wrap);
    }
    if (!changed) break;
  }

  // url(#id): point every reference at a local id, and copy in what lives elsewhere.
  let defs: Element | null = null;
  for (let pass = 0; pass < 4; pass++) {
    const missing = new Set<string>();
    for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
      for (const name of REF_ATTRS) {
        const value = el.getAttribute(name);
        if (!value || !value.includes('url(')) continue;
        // Computed styles carry absolute URLs ("page.html#g"), which an image cannot follow.
        const fixed = value.replace(URL_REF, (_whole: string, _quote: string, _file: string, id: string) => {
          if (!local(id)) missing.add(id);
          return `url(#${id})`;
        });
        if (fixed !== value) el.setAttribute(name, fixed);
      }
      // Gradients and patterns can inherit from another one through href.
      const href = el.localName === 'use' ? null : hrefOf(el);
      if (href && href.startsWith('#') && !local(href.slice(1))) missing.add(href.slice(1));
    }
    if (!missing.size) break;
    let added = false;
    for (const id of missing) {
      const target = await lookup('#' + id, original);
      if (!target) continue;
      if (!defs) {
        defs = document.createElementNS(SVG_NS, 'defs');
        clone.prepend(defs);
      }
      defs.appendChild(document.importNode(target, true));
      added = true;
    }
    if (!added) break;
  }
}

/**
 * Serialize the icon as a self-contained SVG document.
 * Page CSS does not reach an SVG drawn as an image, so the resolved paint of
 * every node is written inline first, and referenced parts are copied in.
 * `__W__`/`__H__` are filled in per raster.
 */
export async function serializeIcon(svg: SVGSVGElement, strokeWidth: number | null): Promise<string> {
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

  await inlineReferences(svg, clone);

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
  let max = 0;
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = rgba[i * 4 + 3];
    if (alpha[i] > max) max = alpha[i];
  }
  // The alpha is the shape, not how strong it looks: an icon painted in a see-through
  // colour (Tailwind's text-white/40) would otherwise fall under the edge threshold and
  // erode to dots. Scale so the most solid part is solid; a duotone icon keeps its layers.
  if (max > 0 && max < 255) {
    const k = 255 / max;
    for (let i = 0; i < alpha.length; i++) alpha[i] = alpha[i] * k;
  }
  return alpha;
}
