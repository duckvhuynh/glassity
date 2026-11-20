import { expect, test, type Page } from '@playwright/test';
import type { GlassOptions } from '../src/options';
import { waitForGlass } from './helpers';

declare global {
  interface Window {
    lightingHandles: Record<string, import('../src/index').GlassHandle>;
  }
}

interface GlyphPixels {
  width: number;
  height: number;
  data: number[];
}

const REFLECTION_ONLY = { shine: 0, rim: 0, shadow: 0, legibility: 'off' } as const;

async function update(page: Page, id: string, options: Omit<GlassOptions, 'backdrop'>): Promise<void> {
  await page.evaluate(({ id, options }) => window.lightingHandles[id].update(options), { id, options });
  await waitForGlass(page, { count: 18 });
}

async function pixels(page: Page, id: string): Promise<GlyphPixels> {
  return page.locator('#' + id).evaluate((svg) => {
    const canvas = svg.nextElementSibling;
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.hasAttribute('data-glassity-canvas')) throw new Error('Missing glass canvas');
    return {
      width: canvas.width,
      height: canvas.height,
      data: Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data),
    };
  });
}

/** Opaque glyph pixels exclude the transparent margin and antialiased silhouette. */
function luminances(image: GlyphPixels): number[] {
  const values: number[] = [];
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] !== 255) continue;
    values.push(image.data[i] * 0.2126 + image.data[i + 1] * 0.7152 + image.data[i + 2] * 0.0722);
  }
  return values;
}

function variance(image: GlyphPixels): number {
  const values = luminances(image);
  expect(values.length, 'The test must measure rendered glyph pixels').toBeGreaterThan(200);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function compare(a: GlyphPixels, b: GlyphPixels): { mean: number; brighter: number; peak: number } {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let sum = 0;
  let brighter = 0;
  let peak = 0;
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i + 3] !== 255 || b.data[i + 3] !== 255) continue;
    const delta = (b.data[i] - a.data[i]) * 0.2126 + (b.data[i + 1] - a.data[i + 1]) * 0.7152 + (b.data[i + 2] - a.data[i + 2]) * 0.0722;
    sum += Math.abs(delta);
    if (delta > 3) brighter++;
    peak = Math.max(peak, delta);
    count++;
  }
  expect(count).toBeGreaterThan(200);
  return { mean: sum / count, brighter: brighter / count, peak };
}

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Lighting pixel thresholds are checked in Chromium.');
  await page.setViewportSize({ width: 800, height: 760 });
  await page.goto('/e2e/fixtures/lighting.html');
  await page.waitForFunction(() => !!window.glassity && Object.keys(window.lightingHandles ?? {}).length === 18);
  expect(await page.evaluate(() => window.glassity.isSupported()), 'This suite needs real WebGL2 rendering').toBe(true);
  await waitForGlass(page, { count: 18 });
});

test('studio adds visible reflection highlights on a flat #1f2430 surface', async ({ page }) => {
  const id = 'dark-none-stroke';
  await expect(page.locator('#' + id).locator('..')).toHaveCSS('background-color', 'rgb(31, 36, 48)');
  // Keep one instance so grain, geometry and the backdrop are identical between modes.
  await update(page, id, { ...REFLECTION_ONLY, environment: 'none' });
  const none = await pixels(page, id);
  await update(page, id, { environment: 'studio' });
  const studio = await pixels(page, id);
  const change = compare(none, studio);

  expect(variance(studio), 'The reflection must add shape, not a uniform tint').toBeGreaterThan(variance(none) + 2);
  expect(change.brighter, 'Highlights must cover a visible part of the glyph').toBeGreaterThan(0.01);
  expect(change.peak, 'Highlights must be visibly brighter').toBeGreaterThan(6);
});

test('auto matches studio on flat dark and light surfaces', async ({ page }) => {
  for (const id of ['dark-none-filled', 'light-none-stroke']) {
    await update(page, id, { ...REFLECTION_ONLY, environment: 'studio' });
    const studio = await pixels(page, id);
    await update(page, id, { environment: 'auto' });
    expect(compare(studio, await pixels(page, id)).mean, id).toBeLessThan(0.25);
  }
});

test('auto keeps the photograph close to the existing reflection', async ({ page }) => {
  for (const kind of ['filled', 'stroke']) {
    const id = 'photo-none-' + kind;
    await update(page, id, { environment: 'none' });
    const none = await pixels(page, id);
    await update(page, id, { environment: 'auto' });
    const automatic = compare(none, await pixels(page, id)).mean;
    await update(page, id, { environment: 'studio' });
    const studio = compare(none, await pixels(page, id)).mean;

    expect(studio, 'Forced studio must still work over photos').toBeGreaterThan(0.2);
    expect(automatic, 'Automatic lighting should be faint over photo detail').toBeLessThan(studio * 0.25 + 0.1);
    expect(automatic, 'Default photo appearance should remain essentially unchanged').toBeLessThan(1);
  }
});

test('none restores the previous pixels and reflection zero disables studio', async ({ page }) => {
  const id = 'dark-none-filled';
  await update(page, id, { environment: 'none' });
  const none = await pixels(page, id);
  await update(page, id, { environment: 'studio' });
  await update(page, id, { environment: 'none' });
  expect(await pixels(page, id)).toEqual(none);

  await update(page, id, { environment: 'none', reflection: 0 });
  const noReflection = await pixels(page, id);
  await update(page, id, { environment: 'studio' });
  expect(await pixels(page, id)).toEqual(noReflection);
});

test('data-glass-environment updates an existing icon', async ({ page }) => {
  const id = 'dark-none-stroke';
  await update(page, id, REFLECTION_ONLY);
  const none = await pixels(page, id);
  await page.locator('#' + id).evaluate((svg) => svg.setAttribute('data-glass-environment', 'studio'));
  await waitForGlass(page, { count: 18 });
  expect(compare(none, await pixels(page, id)).peak).toBeGreaterThan(6);
  await page.locator('#' + id).evaluate((svg) => svg.setAttribute('data-glass-environment', 'none'));
  await waitForGlass(page, { count: 18 });
  expect(await pixels(page, id)).toEqual(none);
});
