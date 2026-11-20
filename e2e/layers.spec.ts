import { expect, test, type Page } from '@playwright/test';
import type { Engine } from '../src/engine';
import { glassSignature, openFixture, signatureDifference } from './helpers';

/** Layer stacks publish their canvas only after every field is ready. */
async function drawn(page: Page, count: number): Promise<void> {
  await page.waitForFunction((count) => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-glassity-canvas]')];
    return canvases.length === count && canvases.every((canvas) => {
      if (canvas.style.visibility !== 'visible' || canvas.width < 2) return false;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, index) => index % 4 === 3 && value > 128);
    });
  }, count);
}

async function redEnergy(page: Page): Promise<number> {
  return page.locator('#two-default + canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += Math.max(0, data[i] - data[i + 1]) * data[i + 3] / 255;
    return sum / (data.length / 4);
  });
}

test('draws two and three layers in every appearance', async ({ page }) => {
  const errors = await openFixture(page, '/e2e/fixtures/layers.html');
  await drawn(page, 8);
  for (const appearance of ['default', 'dark', 'clear', 'tinted']) {
    for (const count of ['two', 'three']) {
      await expect(page.locator('#' + count + '-' + appearance)).toHaveCSS('opacity', '0');
      await expect(page.locator('#' + count + '-' + appearance + ' + canvas')).toHaveAttribute('aria-hidden', 'true');
    }
  }
  expect(errors).toEqual([]);
});

test('the upper layer refracts the lower layer and removing it updates the glass', async ({ page }) => {
  const errors = await openFixture(page, '/e2e/fixtures/layers.html');
  await page.evaluate(() => {
    window.controller.destroy();
    const svg = document.querySelector<SVGSVGElement>('#two-default')!;
    for (const name of svg.getAttributeNames()) if (name.startsWith('data-glass-')) svg.removeAttribute(name);
    svg.setAttribute('data-glass-layers', '');
    svg.innerHTML = '<g data-glass-layer="base" data-glass-tint="#ef2020" data-glass-tint-opacity="1">'
      + '<path d="M17 12h9v76h-9zM35 12h9v76h-9zM53 12h9v76h-9zM71 12h9v76h-9z"/></g>'
      + '<g data-glass-layer="mark" data-glass-depth="0.3" data-glass-curvature="1" data-glass-refraction="0" data-glass-tint-opacity="0"><circle cx="50" cy="50" r="33"/></g>';
    // A uniform external backdrop cannot produce a pattern when refracted.
    const backdrop = document.createElement('canvas');
    backdrop.width = backdrop.height = 16;
    const context = backdrop.getContext('2d')!;
    context.fillStyle = '#808080';
    context.fillRect(0, 0, 16, 16);
    window.handle = window.glassity.glassify(svg, {
      layers: true, backdrop, accessibility: false, duration: 0, pointerLight: false,
      refraction: 0, curvature: 0, dispersion: 0, bands: 1, frost: 0,
      tint: '#ffffff', tintOpacity: 0, dim: 0, saturation: 1, contrast: 1,
      brightness: 1, shine: 0, rim: 0, reflection: 0, shadow: 0, scheme: 'dark',
    });
  });
  await drawn(page, 1);
  expect(await redEnergy(page)).toBeGreaterThan(5);
  const flat = await glassSignature(page, '#two-default', 32);

  await page.locator('#two-default [data-glass-layer="mark"]').evaluate((el) => el.setAttribute('data-glass-refraction', '1'));
  // Lighting, tint and the backdrop stay fixed: the changed detail is the lower glass.
  await expect.poll(async () => signatureDifference(flat, await glassSignature(page, '#two-default', 32))).toBeGreaterThan(1);

  await page.locator('#two-default [data-glass-layer="base"]').evaluate((el) => el.remove());
  await expect.poll(() => redEnergy(page)).toBeLessThan(1);
  await drawn(page, 1);
  await expect(page.locator('#two-default')).toHaveCSS('opacity', '0');
  expect(errors).toEqual([]);
});


test('isolates nested marked groups while preserving clip definitions', async ({ page }) => {
  const errors = await openFixture(page, '/e2e/fixtures/layers.html');
  await page.evaluate(() => {
    window.controller.destroy();
    const svg = document.querySelector<SVGSVGElement>('#two-default')!;
    for (const name of svg.getAttributeNames()) if (name.startsWith('data-glass-')) svg.removeAttribute(name);
    svg.innerHTML = '<defs><clipPath id="layer-clip"><rect x="10" y="10" width="30" height="80"/></clipPath></defs>'
      + '<g data-glass-layer="base" data-glass-tint="#ef2020">'
      + '<rect width="100" height="100" clip-path="url(#layer-clip)"/>'
      + '<g data-glass-layer="mark" data-glass-tint="#2050ef" data-glass-opacity="0"><circle cx="75" cy="50" r="15"/></g></g>'
      + '<rect x="48" y="10" width="10" height="80"/>';
    window.handle = window.glassity.glassify(svg, {
      layers: true, backdrop: 'none', accessibility: false, duration: 0, pointerLight: false,
      refraction: 0, curvature: 0, dispersion: 0, frost: 0, tintOpacity: 1,
      shine: 0, rim: 0, reflection: 0, shadow: 0, scheme: 'dark',
    });
  });
  await drawn(page, 1);
  const pixel = (x: number) => page.locator('#two-default').evaluate((svg, x) => {
    const canvas = svg.nextElementSibling as HTMLCanvasElement;
    const iconRect = svg.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const px = Math.floor((iconRect.left + iconRect.width * x / 100 - canvasRect.left) * canvas.width / canvasRect.width);
    const py = Math.floor((iconRect.top + iconRect.height / 2 - canvasRect.top) * canvas.height / canvasRect.height);
    return [...canvas.getContext('2d')!.getImageData(px, py, 1, 1).data];
  }, x);
  expect((await pixel(20))[3]).toBeGreaterThan(250);
  expect((await pixel(5))[3]).toBeLessThan(5); // The copied clip definition still clips the base.
  expect((await pixel(53))[3]).toBeLessThan(5); // Unmarked artwork is not a layer.
  expect((await pixel(75))[3]).toBeLessThan(5); // Hidden nested layer is excluded from the base.
  await page.locator('#two-default [data-glass-layer="mark"]').evaluate((el) => el.setAttribute('data-glass-opacity', '1'));
  await expect.poll(async () => (await pixel(75))[3]).toBeGreaterThan(250);
  const mark = await pixel(75);
  expect(mark[2] - mark[0]).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('layer textures recover after context loss and are released after disposal', async ({ page }) => {
  const errors = await openFixture(page, '/e2e/fixtures/layers.html');
  await drawn(page, 8);
  const supported = await page.evaluate(() => {
    const key = Object.getOwnPropertySymbols(globalThis).find((key) => key.description?.startsWith('glassity.engine@'))!;
    const engine = (globalThis as unknown as Record<symbol, Engine>)[key];
    return !!engine.renderer!.canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context');
  });
  test.skip(!supported, 'WEBGL_lose_context is unavailable.');
  const rendererState = () => page.evaluate(() => {
    const key = Object.getOwnPropertySymbols(globalThis).find((key) => key.description?.startsWith('glassity.engine@'))!;
    const renderer = (globalThis as unknown as Record<symbol, Engine>)[key].renderer!;
    return { state: renderer.state, bytes: renderer.textureBytes };
  });
  const before = await rendererState();
  expect(before.bytes).toBeGreaterThan(0);
  await page.evaluate(() => {
    const key = Object.getOwnPropertySymbols(globalThis).find((key) => key.description?.startsWith('glassity.engine@'))!;
    const renderer = (globalThis as unknown as Record<symbol, Engine>)[key].renderer!;
    // Keep the extension: a lost context returns null from getExtension().
    const lose = renderer.canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    (window as unknown as { loseExt: WEBGL_lose_context }).loseExt = lose;
    lose.loseContext();
  });
  await expect.poll(rendererState).toEqual({ state: 'lost', bytes: 0 });
  await expect(page.locator('#three-default')).toHaveCSS('opacity', '1');
  await page.evaluate(() => {
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-glassity-canvas]'))
      canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    (window as unknown as { loseExt: WEBGL_lose_context }).loseExt.restoreContext();
  });
  await drawn(page, 8);
  await expect.poll(rendererState).toEqual(before);
  await page.evaluate(() => window.controller.destroy());
  await expect(page.locator('canvas[data-glassity-canvas]')).toHaveCount(0);
  expect((await rendererState()).bytes).toBe(0);
  expect(errors).toEqual([]);
});
