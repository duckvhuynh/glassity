/** Border radii in CSS pixels, clockwise from the top left. */
export type Corner = [number, number];
export type SurfaceRadii = [Corner, Corner, Corner, Corner];

function length(value: string, size: number): number {
  // Computed radii can retain percentages, including calc(percentage + pixels).
  const expression = value.replace(/^calc\((.*)\)$/, '$1').replace(/\s/g, '');
  const terms = expression.match(/[+-]?(?:\d*\.)?\d+(?:px|%)?/g) ?? [];
  if (terms.join('') !== expression) return 0;
  return Math.max(0, terms.reduce((sum, term) => sum + parseFloat(term) * (term.endsWith('%') ? size / 100 : 1), 0));
}

export function surfaceRadii(width: number, height: number, corners: readonly string[]): SurfaceRadii {
  const radii = corners.map((corner) => {
    const parts = corner.match(/calc\([^)]*\)|[^\s]+/g) ?? ['0'];
    const x = length(parts[0], width);
    const y = length(parts[1] ?? parts[0], height);
    return x && y ? [x, y] : [0, 0];
  }) as SurfaceRadii;
  const [tl, tr, br, bl] = radii;
  // CSS scales all corners together when any pair would overlap.
  const factor = Math.min(1, width / (tl[0] + tr[0] || 1), width / (bl[0] + br[0] || 1),
    height / (tl[1] + bl[1] || 1), height / (tr[1] + br[1] || 1));
  return radii.map(([x, y]) => [x * factor, y * factor]) as SurfaceRadii;
}

/** A self-contained outline for the existing alpha/distance-field pipeline. */
export function surfaceSource(width: number, height: number, radii: SurfaceRadii): string {
  const [tl, tr, br, bl] = radii;
  const arc = ([x, y]: Corner, endX: number, endY: number) => x && y ? `A${x} ${y} 0 0 1 ${endX} ${endY}` : `L${endX} ${endY}`;
  const d = `M${tl[0]} 0H${width - tr[0]}${arc(tr, width, tr[1])}V${height - br[1]}${arc(br, width - br[0], height)}H${bl[0]}${arc(bl, 0, height - bl[1])}V${tl[1]}${arc(tl, tl[0], 0)}Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="__W__" height="__H__" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><path fill="white" d="${d}"/></svg>`;
}

/** Bound both fill rate and the shared drawing buffer for large bars. */
export function surfaceDpr(dpr: number, width: number, height: number, maxSize = 2048): number {
  return Math.min(dpr, 1.5, maxSize / Math.max(width, height, 1), Math.sqrt(1_048_576 / Math.max(1, width * height)));
}
