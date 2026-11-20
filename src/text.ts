import { parentOf } from './dom';
import { planTextRaster, textLines, TEXT_LIMIT, TEXT_LINE_LIMIT, TEXT_NODE_LIMIT, type TextBox } from './core/text-layout';
import type { RasterPlan } from './core/raster';
import { textFontCss, waitForTextFonts } from './text-fonts';

export type GlassElement = SVGSVGElement | HTMLElement;

/** Text is explicit, so an ordinary HTML icon wrapper still resolves to its SVG. */
export function textTarget(target: Element, text?: boolean): HTMLElement | null {
  const enabled = text ?? target.getAttribute('data-glass')?.trim().toLowerCase() === 'text';
  return enabled && target instanceof HTMLElement ? target : null;
}

export interface TextSource {
  source: string;
  plan: RasterPlan;
  parentScale: readonly [number, number];
  raster(padding: number): Promise<Uint8ClampedArray>;
}

const CONTENT = new Set(['span', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'strong', 'i', 'em', 'small', 'sub', 'sup', 'br', 'wbr', 'bdi', 'bdo', 'mark', 'a', 'code', 's', 'del', 'ins', 'u', 'label', 'button']);
const FAMILIES = /"[^"]*"|'[^']*'|[^,]+/g;

/** Read native line fragments; never split strings into separately shaped characters. */
export function measureTextLines(element: HTMLElement): TextBox[] {
  const boxes: TextBox[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = element.ownerDocument.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) boxes.push(rect);
  }
  return textLines(boxes);
}

/** Axis-aligned transforms change screen density, not the browser's layout metrics. */
function screenScale(element: Element): [number, number] {
  let x = 1, y = 1;
  for (let node: Element | null = element; node; node = parentOf(node)) {
    const cs = getComputedStyle(node);
    const transform = cs.transform === 'none' ? null : new DOMMatrixReadOnly(cs.transform);
    const rotate = cs.getPropertyValue('rotate');
    if ((transform && (!transform.is2D || Math.abs(transform.b) > 0.00001 || Math.abs(transform.c) > 0.00001)) ||
      (rotate && rotate !== 'none' && !/^0(?:deg|rad|turn)?$/.test(rotate)) || (cs.perspective && cs.perspective !== 'none'))
      throw new Error('Rotated, skewed and perspective text is not supported.');
    const scale = cs.getPropertyValue('scale');
    const parts = !scale || scale === 'none' ? [1] : scale.split(/\s+/).map(Number);
    const zoom = parseFloat(cs.getPropertyValue('zoom')) || 1;
    x *= (transform?.a ?? 1) * parts[0] * zoom;
    y *= (transform?.d ?? 1) * (parts[1] ?? parts[0]) * zoom;
    if (!(x > 0 && y > 0) || parts.length > 2) throw new Error('Reflected and 3D text is not supported.');
  }
  return [x, y];
}

/** Serialize only text and its typography; backgrounds must not become part of the mask. */
export async function prepareText(element: HTMLElement, dpr: number, grow: number, maxTextureSize: number): Promise<TextSource> {
  const doc = element.ownerDocument;
  await waitForTextFonts(doc);
  if ((element.textContent?.length ?? 0) > TEXT_LIMIT) throw new Error('Text exceeds 512 UTF-16 characters.');
  const descendants = Array.from(element.querySelectorAll('*'));
  if (descendants.length > TEXT_NODE_LIMIT) throw new Error('Text exceeds 64 descendant elements.');
  if (descendants.some((node) => !CONTENT.has(node.localName))) throw new Error('Text sources may contain text and inline formatting only.');

  const rect = element.getBoundingClientRect();
  const [scaleX, scaleY] = screenScale(element);
  const width = rect.width / scaleX;
  const height = rect.height / scaleY;
  const lines = measureTextLines(element);
  if (lines.length > TEXT_LINE_LIMIT) throw new Error('Text exceeds eight rendered lines.');
  if (!lines.length || rect.width < 2 || rect.height < 2) throw new Error('Text has no visible line boxes.');
  const families = new Set<string>();
  let fontSize = Infinity;
  const originals = [element, ...descendants];
  const clone = element.cloneNode(true) as HTMLElement;
  const copies = [clone, ...Array.from(clone.querySelectorAll('*'))] as HTMLElement[];
  for (let i = 0; i < originals.length; i++) {
    const original = originals[i];
    const copy = copies[i];
    const cs = getComputedStyle(original);
    if (cs.writingMode !== 'horizontal-tb') throw new Error('Only horizontal text is supported.');
    if (cs.display !== 'none' && Array.from(original.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
      fontSize = Math.min(fontSize, parseFloat(cs.fontSize) || 16);
    for (const family of cs.fontFamily.match(FAMILIES) ?? []) families.add(family.trim());
    // Copy metrics before dropping selectors and attributes from the detached image.
    let style = '';
    for (let j = 0; j < cs.length; j++) style += cs[j] + ':' + cs.getPropertyValue(cs[j]) + ';';
    const lang = original.getAttribute('lang');
    for (const name of copy.getAttributeNames()) copy.removeAttribute(name);
    if (lang) copy.setAttribute('lang', lang);
    copy.style.cssText = style;
    copy.style.cssText += ';animation:none;transition:none;background:transparent;box-shadow:none;text-shadow:none;border-color:transparent;outline:none;color:black;-webkit-text-fill-color:black;-webkit-text-stroke-color:black;caret-color:transparent;';
    if (i === 0) {
      copy.style.cssText += ';opacity:1;position:relative;inset:auto;margin:0;transform:none;scale:none;rotate:none;translate:none;zoom:1;box-sizing:border-box;min-width:0;min-height:0;max-width:none;max-height:none;overflow:visible;';
      copy.style.display = ['inline', 'inline-block'].includes(cs.display) ? 'block' : cs.display.replace(/^inline-/, '');
      copy.style.width = width + 'px';
      copy.style.height = height + 'px';
      // An inline glyph's box excludes line leading. Keep its baseline at the same height.
      if (cs.display === 'inline' && lines.length === 1) copy.style.lineHeight = lines[0].height / scaleY + 'px';
    }
  }

  if (!clone.hasAttribute('lang')) {
    for (let node: Element | null = element; node; node = parentOf(node)) {
      const lang = node.getAttribute('lang');
      if (lang !== null) { clone.setAttribute('lang', lang); break; }
    }
  }
  const css = await textFontCss(element, families);
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', '__W__');
  svg.setAttribute('height', '__H__');
  svg.setAttribute('viewBox', '__TEXT_VIEWBOX__');
  svg.setAttribute('preserveAspectRatio', 'none');
  const foreign = doc.createElementNS(svg.namespaceURI, 'foreignObject');
  foreign.setAttribute('width', String(width));
  foreign.setAttribute('height', String(height));
  foreign.setAttribute('style', 'overflow:visible');
  // Fonts belong inside the HTML subtree so foreignObject layout sees the face rules.
  const wrapper = doc.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.style.cssText = 'margin:0;padding:0;position:relative;';
  const sheet = doc.createElement('style');
  sheet.textContent = css;
  wrapper.append(sheet, clone);
  foreign.append(wrapper);
  svg.append(foreign);
  const source = new XMLSerializer().serializeToString(svg);
  const plan = planTextRaster(rect.width, rect.height, (Number.isFinite(fontSize) ? fontSize : 16) * Math.min(scaleX, scaleY), dpr, grow, maxTextureSize);
  const localLines = lines.map((line) => ({ ...line, left: line.left - rect.left, top: line.top - rect.top }));
  const parent = parentOf(element);
  const parentScale = parent ? screenScale(parent) : [1, 1] as const;
  return { source, plan, parentScale, raster: (padding) => rasterText(source, plan, localLines, padding, width, height) };
}

async function rasterText(source: string, plan: RasterPlan, lines: TextBox[], padding: number, width: number, height: number): Promise<Uint8ClampedArray> {
  const inset = padding * plan.unit;
  const sx = Math.max(1, plan.boxW - inset * 2) / width;
  const sy = Math.max(1, plan.boxH - inset * 2) / height;
  const viewBox = [-(plan.bleed + inset) / sx, -(plan.bleed + inset) / sy, plan.cssW / sx, plan.cssH / sy].join(' ');
  const image = new Image();
  // Include the bleed in the SVG viewport so italic overhangs and accents are not cut off.
  const markup = source.replace('__W__', String(plan.gw)).replace('__H__', String(plan.gh)).replace('__TEXT_VIEWBOX__', viewBox);
  // A data URL keeps a self-contained foreignObject readable by canvas in Chromium.
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = plan.gw;
  canvas.height = plan.gh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is unavailable.');
  // Draw line bands from the same browser-shaped layout, preserving bidi and ligatures.
  // Midpoints keep accents/descenders and avoid painting overlapping line fragments twice.
  for (let i = 0; i < lines.length; i++) {
    const project = (y: number) => Math.round((plan.bleed + inset + y / plan.boxH * height * sy) / plan.cssH * plan.gh);
    const top = i === 0 ? 0 : project((lines[i - 1].top + lines[i - 1].height + lines[i].top) / 2);
    const bottom = i === lines.length - 1 ? plan.gh : project((lines[i].top + lines[i].height + lines[i + 1].top) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, plan.gw, bottom - top);
    ctx.clip();
    ctx.drawImage(image, 0, 0, plan.gw, plan.gh);
    ctx.restore();
  }
  const rgba = ctx.getImageData(0, 0, plan.gw, plan.gh).data;
  const alpha = new Uint8ClampedArray(plan.gw * plan.gh);
  let max = 0;
  for (let i = 0; i < alpha.length; i++) max = Math.max(max, alpha[i] = rgba[i * 4 + 3]);
  if (max > 0 && max < 255) for (let i = 0; i < alpha.length; i++) alpha[i] *= 255 / max;
  return alpha;
}
