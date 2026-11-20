import { parentOf } from './dom';

export interface SurfaceMap { basis: [number, number, number, number]; offset: [number, number] }
export interface SurfaceSpace { map: SurfaceMap; width: number; height: number }

/** Local border-box pixels to viewport pixels, including ancestor 2D transforms. */
export function elementMap(element: Element, w: number, h: number, rect: DOMRect, bleed = 0): SurfaceMap {
  let matrix = new DOMMatrix();
  for (let node: Element | null = element; node; node = parentOf(node)) {
    const cs = getComputedStyle(node);
    let own = new DOMMatrix();
    const rotate = cs.getPropertyValue('rotate');
    if (rotate && rotate !== 'none') {
      const angle = rotate.split(' ').pop()!;
      const degrees = parseFloat(angle) * (angle.endsWith('grad') ? 0.9 : angle.endsWith('rad') ? 180 / Math.PI : angle.endsWith('turn') ? 360 : 1);
      if (Number.isFinite(degrees)) own = own.rotate(degrees);
    }
    const scale = cs.getPropertyValue('scale');
    if (scale && scale !== 'none') {
      const [x, y = x] = scale.split(' ').map((value) => parseFloat(value) / (value.endsWith('%') ? 100 : 1));
      if (Number.isFinite(x) && Number.isFinite(y)) own = own.scale(x, y);
    }
    if (cs.transform && cs.transform !== 'none') own = own.multiply(new DOMMatrix(cs.transform));
    const zoom = parseFloat(cs.getPropertyValue('zoom')) || 1;
    matrix = own.scale(zoom).multiply(matrix);
  }
  const { a, b, c, d } = matrix;

  const minX = Math.min(0, a * w, c * h, a * w + c * h);
  const minY = Math.min(0, b * w, d * h, b * w + d * h);
  return { basis: [a, b, c, d], offset: [rect.left - minX - bleed * (a + c), rect.top - minY - bleed * (b + d)] };
}

/** Cancel the backdrop's transform; its snapshot contains untransformed local pixels. */
export function mapInto(source: SurfaceMap, target: SurfaceMap): SurfaceMap {
  const [a, b, c, d] = target.basis;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-8) return source;
  const [sa, sb, sc, sd] = source.basis;
  const x = source.offset[0] - target.offset[0];
  const y = source.offset[1] - target.offset[1];
  return { basis: [(d * sa - c * sb) / det, (a * sb - b * sa) / det, (d * sc - c * sd) / det, (a * sd - b * sc) / det],
    offset: [(d * x - c * y) / det, (a * y - b * x) / det] };
}
