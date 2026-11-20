import { ensureStyles, parentOf, SURFACE, SURFACE_ACTIVE } from './dom';
import { surfaceRadii, surfaceSource } from './core/surface';
import type { RasterPlan } from './core/raster';
import type { GlassOptions } from './options';
import { readAttributes } from './options';
import { elementMap, type SurfaceMap } from './surface-space';

export type GlassElement = SVGSVGElement | HTMLElement;
export type { SurfaceMap } from './surface-space';

// Replaced controls do not paint children; leave their native UI untouched.
const REPLACED = new Set(['input', 'img', 'video', 'audio', 'canvas', 'select', 'textarea', 'iframe', 'object', 'embed', 'progress', 'meter', 'br', 'hr', 'area', 'base', 'col', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
export function canHostSurface(element: Element): boolean { return !REPLACED.has(element.localName); }

export function surfaceTarget(element: Element, options: Pick<GlassOptions, 'surface'> = {}): element is HTMLElement {
  return element instanceof HTMLElement && canHostSurface(element) && (options.surface ?? readAttributes(element)?.surface) === true;
}

/** Explicitly marked icons opt in; broad selectors leave a surface's ordinary icons alone. */
export function plainOnSurface(svg: SVGSVGElement): boolean {
  if (svg.hasAttribute('data-glass')) return false;
  for (let parent = parentOf(svg); parent; parent = parentOf(parent)) {
    if (parent.hasAttribute(SURFACE) || surfaceTarget(parent)) return true;
  }
  return false;
}

/** The canvas shares its host's transforms, clipping, scrolling and stacking context. */
export class SurfaceLayer {
  private positionRestore: { value: string; priority: string } | null = null;

  constructor(readonly element: HTMLElement, private canvas: HTMLCanvasElement) {}

  place(): void {
    ensureStyles(this.element);
    if (!this.element.hasAttribute(SURFACE)) this.element.setAttribute(SURFACE, '');
    if (this.element.firstChild !== this.canvas) this.element.prepend(this.canvas);
    this.canvas.style.zIndex = '-1';
    this.ensurePosition();
  }

  private ensurePosition(): void {
    const style = this.element.style;
    if (this.positionRestore && (style.position !== 'relative' || style.getPropertyPriority('position') !== 'important')) this.positionRestore = null;
    if (getComputedStyle(this.element).position !== 'static') return;
    this.positionRestore = { value: style.position, priority: style.getPropertyPriority('position') };
    style.setProperty('position', 'relative', 'important');
  }

  reveal(): void { this.element.setAttribute(SURFACE_ACTIVE, ''); }
  suspend(): void { this.element.removeAttribute(SURFACE_ACTIVE); }
  destroy(): void {
    this.suspend();
    this.element.removeAttribute(SURFACE);
    const style = this.element.style;
    if (this.positionRestore && style.position === 'relative' && style.getPropertyPriority('position') === 'important') {
      if (this.positionRestore.value) style.setProperty('position', this.positionRestore.value, this.positionRestore.priority);
      else style.removeProperty('position');
    }
    this.positionRestore = null;
  }

  measure(): { width: number; height: number; source: string; left: number; top: number } {
    const cs = getComputedStyle(this.element);
    const px = (name: string) => parseFloat(cs.getPropertyValue(name)) || 0;
    const borderX = px('border-left-width') + px('border-right-width');
    const borderY = px('border-top-width') + px('border-bottom-width');
    const content = cs.boxSizing !== 'border-box';
    const width = (px('width') + (content ? px('padding-left') + px('padding-right') + borderX : 0)) || this.element.offsetWidth;
    const height = (px('height') + (content ? px('padding-top') + px('padding-bottom') + borderY : 0)) || this.element.offsetHeight;
    const radii = surfaceRadii(width, height, [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]);
    return { width, height, source: surfaceSource(width, height, radii), left: px('border-left-width'), top: px('border-top-width') };
  }

  position(plan: RasterPlan): void {
    this.ensurePosition();
    const box = this.measure();
    this.canvas.style.left = -(plan.bleed + box.left) + 'px';
    this.canvas.style.top = -(plan.bleed + box.top) + 'px';
  }

  /** Map local slab pixels into viewport pixels before sampling the shared backdrop. */
  mapping(plan: RasterPlan, rect: DOMRect): SurfaceMap {
    return elementMap(this.element, plan.boxW, plan.boxH, rect, plan.bleed);
  }
}
