import type { Rect } from './backdrop';

export interface CaptureRegion extends Rect {
  key: string;
}

/** Nearby icons share a cell; the guard covers lens displacement and blur. */
export function captureRegion(icon: Rect, maxSize: number, dpr: number, guard = 128): CaptureRegion {
  const span = Math.max(128, Math.min(768, Math.floor(maxSize / Math.min(2, dpr || 1))));
  const margin = Math.min(span / 3, Math.max(guard, icon.w, icon.h));
  const cell = Math.max(64, span - margin * 2);
  const x = Math.floor((icon.x + icon.w / 2) / cell) * cell - margin;
  const y = Math.floor((icon.y + icon.h / 2) / cell) * cell - margin;
  return { x, y, w: span, h: span, key: `${x},${y},${span}` };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
