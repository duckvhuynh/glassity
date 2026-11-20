import type { Engine } from './engine';
import { glyphSize } from './core/legibility';
import { serializeIcon, type RasterPlan } from './core/raster';
import type { GlassLayer } from './core/layers';
import type { DrawParams } from './gl/renderer';
import type { ResolvedOptions } from './options';

type Geometry = Awaited<ReturnType<Engine['acquireGeometry']>>;
const PROFILES = { squircle: 0, circle: 1, lip: 2, dome: 3 } as const;

/** Own the cache references for one complete stack; swaps never expose a partial icon. */
export class LayerStack {
  private constructor(private engine: Engine, private layers: { layer: GlassLayer; geometry: Geometry }[]) {}

  static async create(engine: Engine, layers: GlassLayer[], plan: RasterPlan, svg: SVGSVGElement, current = () => true): Promise<LayerStack> {
    const acquired: { layer: GlassLayer; geometry: Geometry }[] = [];
    try {
      // At most four layers. Sequential acquisition also bounds temporary raster memory.
      for (const layer of layers) {
        if (!current()) break;
        const source = await serializeIcon(svg, layer.options.strokeWidth, layer.element);
        if (!current()) break;
        const key = `${plan.gw}x${plan.gh}|${plan.cssW}x${plan.cssH}|${layer.options.padding}|${source}`;
        const geometry = await engine.acquireGeometry(key, source, plan, layer.options.padding);
        acquired.push({ layer, geometry });
      }
      return new LayerStack(engine, acquired);
    } catch (error) {
      for (const { geometry } of acquired) engine.releaseGeometry(geometry);
      throw error;
    }
  }

  get geometry(): Geometry | null { return this.layers[0]?.geometry ?? null; }
  get empty(): boolean { return this.layers.every(({ geometry }) => geometry.empty); }

  release(): void {
    for (const { geometry } of this.layers) this.engine.releaseGeometry(geometry);
    this.layers = [];
  }

  draw(target: CanvasRenderingContext2D, pw: number, ph: number, base: DrawParams, options: ResolvedOptions, reducedTransparency: boolean): boolean {
    const params = this.layers.filter(({ geometry }) => !geometry.empty).map(({ layer, geometry }): DrawParams => {
      const r = layer.options;
      const plan = geometry.plan;
      const field = this.engine.fieldTexture(geometry);
      const auto = r.tint === 'auto';
      const tintElement = r.appearance === 'tinted' ? layer.element.ownerSVGElement ?? layer.element : layer.element;
      const tint = auto ? [1, 1, 1, 1] : this.engine.color(r.tint === 'currentColor' ? getComputedStyle(tintElement).color : r.tint);
      const angle = (r.lightAngle - options.lightAngle) * Math.PI / 180;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      return {
        ...base,
        fieldA: field, fieldB: field, morph: 0,
        profile: PROFILES[r.profile], bevel: r.bevel * plan.unit,
        curvature: r.curvature, depth: r.depth * plan.unit, ior: r.ior,
        refraction: r.refraction, dispersion: r.dispersion, bands: r.bands,
        frost: (reducedTransparency ? Math.max(r.frost, 0.8) : r.frost) * 0.16 * plan.unit,
        saturation: r.saturation, brightness: r.brightness, contrast: r.contrast,
        tint: [tint[0], tint[1], tint[2]], tintAuto: auto ? 1 : 0,
        tintOpacity: (reducedTransparency ? Math.max(r.tintOpacity, 0.5) : r.tintOpacity) * tint[3],
        legibilityAmount: 0, glyphSize: glyphSize(plan.unit, r.padding),
        dim: r.dim === 'auto' ? -1 : r.dim, opacity: r.opacity,
        shine: r.shine, rim: r.rim, reflection: r.reflection, shadow: r.shadow,
        light: [base.light[0] * cos - base.light[1] * sin, base.light[0] * sin + base.light[1] * cos],
        scheme: r.scheme === 'auto' ? -1 : r.scheme === 'light' ? 1 : 0,
        tile: 0, weight: r.weight,
      };
    });
    return this.engine.renderer!.drawLayers(target, pw, ph, params);
  }
}
