import { expect, test, type Page } from '@playwright/test';

const icon = (id: string, extra = '') =>
  '<svg id="' + id + '" data-glass ' + extra + ' width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="7"/></svg>';
const defaults = { accessibility: false, duration: 0, pointerLight: false, backdrop: 'none' as const };

async function serve(page: Page, body: string): Promise<void> {
  await page.route('**/api.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><body style="background:#242638"><div style="display:flex;gap:24px;padding:30px">' + body + '</div><script type="module">import * as g from "/dist/index.js";window.glassity=g;</script>',
  }));
  await page.goto('/api.html');
  await page.waitForFunction(() => !!window.glassity);
  const supported = await page.evaluate(() => window.glassity.isSupported());
  if (process.env.REQUIRE_WEBGL2) expect(supported).toBe(true);
  test.skip(!supported, 'This browser build has no WebGL2.');
}

async function drawn(page: Page, id: string): Promise<void> {
  await expect(page.locator('#' + id + ' + canvas')).toHaveCSS('visibility', 'visible');
  await expect.poll(() => page.locator('#' + id + ' + canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(1);
}

const pixels = (page: Page, id: string) => page.locator('#' + id + ' + canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
const coverage = (page: Page, id: string) => page.locator('#' + id + ' + canvas').evaluate((canvas) => {
  const c = canvas as HTMLCanvasElement;
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let covered = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 128) covered++;
  return covered / (data.length / 4);
});

test('configure updates existing and future icons, then resets page defaults', async ({ page }) => {
  await serve(page, icon('existing'));
  await page.evaluate((defaults) => {
    window.glassity.configure({ ...defaults, look: 'frosted', tile: true });
    window.controller = window.glassity.auto();
  }, defaults);
  await drawn(page, 'existing');
  expect(await coverage(page, 'existing')).toBeGreaterThan(0.4);
  await page.evaluate((html) => document.querySelector('body > div')!.insertAdjacentHTML('beforeend', html), icon('future'));
  await drawn(page, 'future');
  expect(await coverage(page, 'future')).toBeGreaterThan(0.4);
  await page.evaluate(() => window.glassity.configure({}));
  await expect.poll(() => coverage(page, 'existing')).toBeLessThan(0.4);
  await expect.poll(() => coverage(page, 'future')).toBeLessThan(0.4);
});

test('switching a look on a handle or an attribute removes the previous recipe', async ({ page }) => {
  await serve(page, icon('a'));
  await page.evaluate((defaults) => {
    window.glassity.configure(defaults);
    window.handle = window.glassity.glassify(document.getElementById('a')!);
  }, defaults);
  await drawn(page, 'a');
  const baseline = await pixels(page, 'a');
  await page.evaluate(() => window.handle.update({ look: 'crystal' }));
  await expect.poll(() => pixels(page, 'a')).not.toBe(baseline);
  const crystal = await pixels(page, 'a');
  await page.evaluate(() => window.handle.update({ look: 'frosted' }));
  await expect.poll(() => pixels(page, 'a')).not.toBe(crystal);
  await page.evaluate(() => window.handle.update({ look: 'crystal' }));
  await expect.poll(() => pixels(page, 'a')).toBe(crystal);
  await page.evaluate(() => window.handle.set({}));
  await expect.poll(() => pixels(page, 'a')).toBe(baseline);
  await page.evaluate(() => document.getElementById('a')!.setAttribute('data-glass-look', 'tinted'));
  await expect.poll(() => pixels(page, 'a')).not.toBe(baseline);
  await page.evaluate(() => document.getElementById('a')!.setAttribute('data-glass-look', 'default'));
  await expect.poll(() => pixels(page, 'a')).toBe(baseline);
});

test('nested auto roots inherit outer changes while attributes and own options win', async ({ page }) => {
  await serve(page, '<section id="outer"><section id="inner">' + icon('inherited') + icon('attribute', 'data-glass-tile="false"') + icon('own') + '</section></section>');
  await page.evaluate((defaults) => {
    window.glassity.configure(defaults);
    window.glassity.auto({ root: document.getElementById('inner')! });
    window.controller = window.glassity.auto({ root: document.getElementById('outer')!, tile: true });
    window.handle = window.glassity.glassify(document.getElementById('own')!, { tile: false });
  }, defaults);
  for (const id of ['inherited', 'attribute', 'own']) await drawn(page, id);
  expect(await coverage(page, 'inherited')).toBeGreaterThan(0.4);
  expect(await coverage(page, 'attribute')).toBeLessThan(0.4);
  expect(await coverage(page, 'own')).toBeLessThan(0.4);
  await page.evaluate(() => window.controller.set({ tile: false }));
  await expect.poll(() => coverage(page, 'inherited')).toBeLessThan(0.4);
  await page.evaluate(() => window.controller.update({ tile: true }));
  await expect.poll(() => coverage(page, 'inherited')).toBeGreaterThan(0.4);
  await page.evaluate(() => window.controller.destroy());
  await expect.poll(() => coverage(page, 'inherited')).toBeLessThan(0.4);
});

for (const sharedRoot of ['document', 'element'] as const) {
  test('a surviving auto controller reclaims icons at a shared ' + sharedRoot + ' root', async ({ page }) => {
    await serve(page, '<section id="shared">' + icon('a') + '</section>');
    await page.evaluate(({ defaults, sharedRoot }) => {
      window.glassity.configure(defaults);
      const root = sharedRoot === 'document' ? document : document.getElementById('shared')!;
      window.controller = window.glassity.auto({ root });
      window.controller.refresh();
      const later = window.glassity.auto({ root, tile: true });
      later.refresh();
      // Reuse the handle slot to keep the later controller alive until after drawing.
      window.handle = later as never;
    }, { defaults, sharedRoot });
    await drawn(page, 'a');
    expect(await coverage(page, 'a')).toBeGreaterThan(0.4);
    await page.evaluate(() => window.handle.destroy());
    await drawn(page, 'a');
    await expect.poll(() => coverage(page, 'a')).toBeLessThan(0.4);
    await expect(page.locator('canvas[data-glassity-canvas]')).toHaveCount(1);
    await page.evaluate(() => window.controller.destroy());
    await expect(page.locator('canvas[data-glassity-canvas]')).toHaveCount(0);
  });
}
