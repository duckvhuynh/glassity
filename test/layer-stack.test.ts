import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from '../src/engine';
import { LayerStack } from '../src/layers';
import { resolveOptions } from '../src/options';
import { planRaster, serializeIcon } from '../src/core/raster';
import type { GlassLayer } from '../src/core/layers';

vi.mock('../src/core/raster', async (original) => ({
  ...await original<typeof import('../src/core/raster')>(),
  serializeIcon: vi.fn(),
}));

function setup() {
  const plan = planRaster(64, 64, 1);
  const layers: GlassLayer[] = ['base', 'mark'].map((name) => ({
    name, element: {} as SVGGElement, options: resolveOptions({ layers: true }),
  }));
  const geometries = layers.map((layer) => ({
    key: layer.name, plan, data: new Float32Array(), empty: false, refs: 1, texture: null,
  }));
  const acquireGeometry = vi.fn().mockResolvedValueOnce(geometries[0]).mockResolvedValueOnce(geometries[1]);
  const releaseGeometry = vi.fn();
  const engine = { acquireGeometry, releaseGeometry } as unknown as Engine;
  return { plan, layers, geometries, acquireGeometry, releaseGeometry, engine, svg: {} as SVGSVGElement };
}

beforeEach(() => { vi.mocked(serializeIcon).mockReset().mockResolvedValue('<svg/>'); });

describe('layer stack ownership', () => {
  it('releases every acquired cache reference once, including an empty layer', async () => {
    const f = setup();
    f.geometries[0].empty = true;
    const stack = await LayerStack.create(f.engine, f.layers, f.plan, f.svg);
    expect(stack.empty).toBe(false);
    expect(stack.geometry).toBe(f.geometries[0]);
    expect(serializeIcon).toHaveBeenNthCalledWith(1, f.svg, null, f.layers[0].element);
    expect(serializeIcon).toHaveBeenNthCalledWith(2, f.svg, null, f.layers[1].element);
    stack.release();
    stack.release();
    expect(f.releaseGeometry.mock.calls).toEqual([[f.geometries[0]], [f.geometries[1]]]);
    expect(stack.geometry).toBeNull();
  });

  it('rolls back earlier references when a later layer cannot be rasterized', async () => {
    const f = setup();
    f.acquireGeometry.mockReset().mockResolvedValueOnce(f.geometries[0]).mockRejectedValueOnce(new Error('raster failed'));
    await expect(LayerStack.create(f.engine, f.layers, f.plan, f.svg)).rejects.toThrow('raster failed');
    expect(f.releaseGeometry.mock.calls).toEqual([[f.geometries[0]]]);
  });

  it('rolls back earlier references when a later SVG reference cannot be read', async () => {
    const f = setup();
    vi.mocked(serializeIcon).mockReset().mockResolvedValueOnce('<svg/>').mockRejectedValueOnce(new Error('read failed'));
    await expect(LayerStack.create(f.engine, f.layers, f.plan, f.svg)).rejects.toThrow('read failed');
    expect(f.acquireGeometry).toHaveBeenCalledTimes(1);
    expect(f.releaseGeometry.mock.calls).toEqual([[f.geometries[0]]]);
  });

  it('stops a superseded job before acquiring another layer', async () => {
    const f = setup();
    let current = true;
    vi.mocked(serializeIcon).mockReset().mockResolvedValueOnce('<svg/>').mockImplementationOnce(async () => {
      current = false;
      return '<svg/>';
    });
    const stack = await LayerStack.create(f.engine, f.layers, f.plan, f.svg, () => current);
    expect(f.acquireGeometry).toHaveBeenCalledTimes(1);
    stack.release();
    expect(f.releaseGeometry.mock.calls).toEqual([[f.geometries[0]]]);
  });

});
