import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    glassity: typeof import('../src/index');
    controller: import('../src/index').GlassController;
    bar: import('../src/index').GlassController;
  }
}

const QUIET = { accessibility: false, duration: 0, pointerLight: false } as const;
/** The canvas a group draws into is a direct child of the group's root. */
const groupCanvas = (id: string) => `#${id} > canvas[data-glassity-canvas="group"]`;

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/e2e/fixtures/group.html');
  await page.waitForFunction(() => !!window.glassity);
  return errors;
}

async function drawn(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => document.querySelector<HTMLElement>(sel)?.style.visibility === 'visible', selector);
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Opacity (0–255) of a group's canvas at a point given in viewport coordinates. */
async function alphaAt(page: Page, canvas: string, x: number, y: number): Promise<number> {
  return page.evaluate(
    ({ canvas, x, y }) => {
      const el = document.querySelector<HTMLCanvasElement>(canvas)!;
      const box = el.getBoundingClientRect();
      const px = Math.round(((x - box.left) / box.width) * el.width);
      const py = Math.round(((y - box.top) / box.height) * el.height);
      if (px < 0 || py < 0 || px >= el.width || py >= el.height) return 0;
      return el.getContext('2d')!.getImageData(px, py, 1, 1).data[3];
    },
    { canvas, x, y },
  );
}

/** The point halfway between two neighbouring icons. */
async function between(page: Page, a: string, b: string): Promise<{ x: number; y: number }> {
  const first = (await page.locator(a).boundingBox())!;
  const second = (await page.locator(b).boundingBox())!;
  return { x: (first.x + first.width + second.x) / 2, y: first.y + first.height / 2 };
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto('/e2e/fixtures/group.html');
  await page.waitForFunction(() => !!window.glassity);
  const able = await page.evaluate(() => window.glassity.isSupported() && window.glassity.canMerge());
  const needsMerge = !testInfo.title.includes('cannot merge');
  if (process.env.REQUIRE_WEBGL2 && needsMerge) expect(able, 'merging must be available in this browser').toBe(true);
  test.skip(!able && needsMerge, 'This browser build cannot merge shapes.');
});

test('a group draws all its icons on one canvas', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate((quiet) => {
    window.controller = window.glassity.auto(quiet);
  }, QUIET);
  await drawn(page, groupCanvas('tiles'));

  // One canvas for the group; the icons' own canvases stay hidden and the SVGs stay for assistive technology.
  for (const id of ['t1', 't2', 't3']) {
    await expect(page.locator(`#${id}`)).toHaveCSS('opacity', '0');
    await expect(page.locator(`#${id} + canvas`)).toHaveCSS('visibility', 'hidden');
  }
  await expect(page.getByRole('img', { name: 'Heart' }).first()).toHaveCount(1);
  // Icons without data-glass outside a group are left alone.
  await expect(page.locator('#b1')).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});

test('tiles that are close join, and come apart when moved away', async ({ page }) => {
  await open(page);
  await page.evaluate((quiet) => {
    window.controller = window.glassity.auto(quiet);
  }, QUIET);
  const canvas = groupCanvas('tiles');
  await drawn(page, canvas);
  await settle(page);

  // 10 px apart with the default spacing (0.35 of a 72 px icon): one body.
  let gap = await between(page, '#t1', '#t2');
  expect(await alphaAt(page, canvas, gap.x, gap.y)).toBeGreaterThan(200);

  // Nothing tells glassity the layout changed; it has to notice the icons moved.
  await page.evaluate(() => document.querySelector<HTMLElement>('#tiles')!.style.setProperty('--gap', '60px'));
  await settle(page);
  gap = await between(page, '#t1', '#t2');
  expect(await alphaAt(page, canvas, gap.x, gap.y)).toBeLessThan(90);

  // Back together, but with spacing 0 they stay separate.
  await page.evaluate(() => {
    const tiles = document.querySelector<HTMLElement>('#tiles')!;
    tiles.style.setProperty('--gap', '10px');
    tiles.setAttribute('data-glass-spacing', '0');
  });
  await settle(page);
  gap = await between(page, '#t1', '#t2');
  expect(await alphaAt(page, canvas, gap.x, gap.y)).toBeLessThan(90);
});

test('a bar wraps every icon in one piece of glass', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate((quiet) => {
    window.bar = window.glassity.group(document.querySelector('#bar')!, { ...quiet, bar: true });
  }, QUIET);
  const canvas = groupCanvas('bar');
  await drawn(page, canvas);
  await settle(page);

  // The icons are 40 px apart: far more than they would bridge on their own.
  const gap = await between(page, '#b1', '#b2');
  expect(await alphaAt(page, canvas, gap.x, gap.y)).toBeGreaterThan(200);

  const first = (await page.locator('#b1').boundingBox())!;
  const last = (await page.locator('#b3').boundingBox())!;
  const middle = first.y + first.height / 2;
  // Inside the padding at both ends, and clearly outside above and beyond the bar.
  expect(await alphaAt(page, canvas, first.x - 6, middle)).toBeGreaterThan(200);
  expect(await alphaAt(page, canvas, last.x + last.width + 6, middle)).toBeGreaterThan(200);
  expect(await alphaAt(page, canvas, gap.x, first.y - 40)).toBeLessThan(90);
  expect(await alphaAt(page, canvas, last.x + last.width + 50, middle)).toBeLessThan(90);

  await page.evaluate(() => window.bar.destroy());
  await expect(page.locator(groupCanvas('bar'))).toHaveCount(0);
  await expect(page.locator('#b2')).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});

test('a hidden icon leaves the group, and opting out restores it', async ({ page }) => {
  await open(page);
  await page.evaluate((quiet) => {
    window.controller = window.glassity.auto({ ...quiet, spacing: 0 });
  }, QUIET);
  const canvas = groupCanvas('tiles');
  await drawn(page, canvas);
  await settle(page);

  const heart = (await page.locator('#t2').boundingBox())!;
  const centre = { x: heart.x + heart.width / 2, y: heart.y + 8 };
  expect(await alphaAt(page, canvas, centre.x, centre.y)).toBeGreaterThan(200);

  await page.evaluate(() => document.querySelector('#t2')!.setAttribute('data-glass-visible', 'false'));
  await settle(page);
  expect(await alphaAt(page, canvas, centre.x, centre.y)).toBeLessThan(90);
  await expect(page.locator('#t2')).toHaveCSS('opacity', '0');

  await page.evaluate(() => document.querySelector('#t2')!.setAttribute('data-glass', 'off'));
  await settle(page);
  await expect(page.locator('#t2')).toHaveCSS('opacity', '1');
  await expect(page.locator('#t1')).toHaveCSS('opacity', '0');
});

test('where shapes cannot merge the icons are drawn one by one', async ({ page }) => {
  await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (this: WebGL2RenderingContext, name: string) {
      if (name === 'EXT_color_buffer_float' || name === 'EXT_color_buffer_half_float') return null;
      return original.call(this, name);
    } as typeof original;
  });
  const errors = await open(page);
  const able = await page.evaluate((quiet) => {
    window.controller = window.glassity.auto(quiet);
    return { webgl: window.glassity.isSupported(), merge: window.glassity.canMerge() };
  }, QUIET);
  test.skip(!able.webgl, 'This browser build has no WebGL2.');
  expect(able.merge).toBe(false);

  await page.waitForFunction(() => ['t1', 't2', 't3'].every((id) => (document.querySelector(`#${id} + canvas`) as HTMLElement | null)?.style.visibility === 'visible'));
  await expect(page.locator(groupCanvas('tiles'))).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#t1')).toHaveCSS('opacity', '0');
  expect(errors).toEqual([]);
});
