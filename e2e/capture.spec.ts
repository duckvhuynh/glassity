import { expect, test } from '@playwright/test';
import { glassSignature, glassStats, installGlassHooks, openFixture, signatureDifference, waitForGlass } from './helpers';

test('a small icon on a long page receives sharp local pixels without sliding', async ({ page }) => {
  await page.addInitScript(() => { (globalThis as any).__GLASSITY_DISABLE_HTML_CANVAS__ = true; });
  const errors = await openFixture(page, '/e2e/fixtures/capture.html');
  await page.evaluate(() => {
    window.controller = window.glassity.auto({ duration: 0, pointerLight: false, tile: true, frost: 0, legibility: 'off', glyphOpacity: 0 });
  });
  await waitForGlass(page, { count: 1 });
  const pixels = await page.evaluate(() => {
    const instance = window.glassityTest!.instance('#icon')!;
    const backdrop = instance.backdrop as any;
    const region = backdrop.rect();
    const source = backdrop.source as HTMLCanvasElement;
    const density = source.width / region.w;
    const y = Math.round((12325 - scrollY - region.y) * density);
    const x = Math.round((160 - region.x) * density);
    const data = source.getContext('2d')!.getImageData(x, y, 24, 1).data;
    const red = Array.from({ length: 24 }, (_, i) => data[i * 4]);
    return { density, height: region.h, contrast: Math.max(...red) - Math.min(...red), version: backdrop.version, drawn: instance.drawnVersion };
  });
  expect(pixels.height).toBeLessThan(1000);
  expect(pixels.density).toBeGreaterThanOrEqual(1);
  expect(pixels.contrast).toBeGreaterThan(150);
  expect(pixels.version).toBeGreaterThan(1);
  expect(pixels.drawn).toBe(pixels.version);
  expect((await glassStats(page, '#icon')).detail).toBeGreaterThan(2);
  const before = await glassSignature(page, '#icon');
  await page.evaluate(() => scrollBy(0, 120));
  await waitForGlass(page, { count: 1, quiet: 250 });
  expect(signatureDifference(before, await glassSignature(page, '#icon'))).toBeLessThan(3);
  expect(errors).toEqual([]);
});

test('77 image-backed icons draw their first real glass within three seconds', async ({ page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto('/bench/fixture.html?count=77&shapes=repeated&backdrop=image');
  await page.waitForFunction(() => (window as any).bench?.ready);
  const result = await page.evaluate(() => (window as any).bench.mount());
  // The benchmark excludes the temporary flat swatch and lens=0 draws.
  expect(result.firstMs).toBeLessThan(3000);
  await page.evaluate(() => (window as any).bench.settle());
  await page.evaluate(installGlassHooks);
  expect(await page.evaluate(() => window.glassityTest!.instances().length)).toBe(77);
});

test('local snapshots retain nested scroll offsets', async ({ page }) => {
  await openFixture(page, '/e2e/fixtures/backdrops.html');
  await page.evaluate(() => {
    const scroller = document.createElement('div');
    scroller.id = 'scroller';
    scroller.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:120px;overflow:auto;background:white';
    for (const color of ['rgb(240,20,20)', 'rgb(20,20,240)']) {
      const band = document.createElement('div');
      band.style.cssText = `height:120px;background:${color}`;
      scroller.appendChild(band);
    }
    const svg = document.querySelector<SVGSVGElement>('#i-element')!;
    svg.style.cssText = 'position:absolute;left:50px;top:40px;width:24px;height:24px';
    document.body.replaceChildren(scroller, svg);
    scroller.scrollTop = 120;
    window.handle = window.glassity.glassify(svg, { backdrop: scroller, duration: 0, pointerLight: false });
  });
  await waitForGlass(page, { count: 1 });
  const sample = () => page.evaluate(() => {
    const b = window.glassityTest!.instance('#i-element')!.backdrop as any;
    const rect = b.rect();
    const canvas = b.source as HTMLCanvasElement;
    const scale = canvas.width / rect.w;
    return Array.from(canvas.getContext('2d')!.getImageData(Math.round((60 - rect.x) * scale), Math.round((60 - rect.y) * scale), 1, 1).data);
  });
  const blue = await sample();
  expect(blue[2] - blue[0]).toBeGreaterThan(150);
  await page.locator('#scroller').evaluate((el) => { el.scrollTop = 0; });
  await waitForGlass(page, { count: 1, quiet: 250 });
  const red = await sample();
  expect(red[0] - red[2]).toBeGreaterThan(150);
});

test('auto starts before an unrelated slow image finishes loading', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/unrelated-slow-image.svg', async (route) => {
    await held;
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  });
  await page.route('**/slow-start.html', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <style>body{background:linear-gradient(90deg,#e2272e,#ffd400)}svg{width:48px;height:48px}</style>
    <svg data-glass viewBox="0 0 24 24"><path d="M4 4H20V20H4Z"/></svg>
    <img src="/unrelated-slow-image.svg" alt="">
    <script type="module">import * as glassity from '/dist/index.js';window.glassity=glassity;window.controller=glassity.auto({duration:0});</script>` }));
  try {
    await page.goto('/slow-start.html', { waitUntil: 'domcontentloaded' });
    await waitForGlass(page, { count: 1 });
    expect(await page.evaluate(() => document.readyState)).not.toBe('complete');
  } finally {
    release();
  }
});
