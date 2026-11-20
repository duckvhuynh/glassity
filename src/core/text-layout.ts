import { BLEED, type RasterPlan } from './raster';

export const TEXT_LIMIT = 512;
export const TEXT_LINE_LIMIT = 8;
export const TEXT_NODE_LIMIT = 64;

export interface TextBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Range rectangles arrive in logical order, which is not visual order in RTL text. */
export function textLines(boxes: readonly TextBox[]): TextBox[] {
  const lines: TextBox[] = [];
  for (const box of [...boxes].filter((box) => box.width > 0 && box.height > 0).sort((a, b) => a.top - b.top || a.left - b.left)) {
    const middle = box.top + box.height / 2;
    const line = lines.find((candidate) => {
      const overlap = Math.min(candidate.top + candidate.height, box.top + box.height) - Math.max(candidate.top, box.top);
      return overlap > Math.min(candidate.height, box.height) / 2 && Math.abs(candidate.top + candidate.height / 2 - middle) < Math.max(candidate.height, box.height) / 2;
    });
    if (!line) lines.push({ left: box.left, top: box.top, width: box.width, height: box.height });
    else {
      const right = Math.max(line.left + line.width, box.left + box.width);
      const bottom = Math.max(line.top + line.height, box.top + box.height);
      line.left = Math.min(line.left, box.left);
      line.top = Math.min(line.top, box.top);
      line.width = right - line.left;
      line.height = bottom - line.top;
    }
  }
  return lines;
}

/** Font size sets the field density and optical depth, even for a very wide heading. */
export function planTextRaster(boxW: number, boxH: number, fontSize: number, dpr: number, grow = 0, maxTextureSize = 4096): RasterPlan {
  const unit = Math.max(1, fontSize);
  const bleed = Math.ceil(unit * (BLEED + Math.max(grow, 0)));
  const cssW = boxW + bleed * 2;
  const cssH = boxH + bleed * 2;
  const wanted = dpr * (unit < 40 ? 3 : unit < 90 ? 2 : 1.25);
  // Text needs more than the icon's 512px longest-side budget, but remains bounded.
  const scale = Math.min(wanted, Math.min(4096, maxTextureSize) / Math.max(cssW, cssH), Math.sqrt(2_097_152 / (cssW * cssH)));
  return { boxW, boxH, unit, bleed, cssW, cssH, gw: Math.max(1, Math.floor(cssW * scale)), gh: Math.max(1, Math.floor(cssH * scale)), scale };
}
