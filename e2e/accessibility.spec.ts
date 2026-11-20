import { expect, test, type Page } from '@playwright/test';
import { frames, glassStats, openFixture, waitForGlass, waitForMedia } from './helpers';

/**
 * The system settings in the README's "Accessibility" table, each checked for the
 * effect it documents. Forced colours are covered in glass.spec.ts.
 * Chromium only for now: reduced transparency can only be emulated through the
 * Chrome DevTools Protocol, and the other two have not been checked in Firefox and WebKit.
 */

test.skip(({ browserName }) => browserName !== 'chromium', 'Media emulation for these settings is checked in Chromium.');

/** The default light direction (-45°), as src/engine.ts computes it. */
const BASE_LIGHT = [Math.sin((-45 * Math.PI) / 180), -Math.cos((-45 * Math.PI) / 180)];

const lightOf = (page: Page, svg: string) => page.evaluate((svg) => window.glassityTest!.instance(svg)!.lightTarget, svg);
const offBase = (light: number[]) => Math.abs(light[0] - BASE_LIGHT[0]) + Math.abs(light[1] - BASE_LIGHT[1]);

/** Replace the outline of #a and report whether the glass morphed to it. */
function swapShape(page: Page, shape: string): Promise<{ changed: boolean; morphed: boolean }> {
  return page.evaluate(async (shape) => {
    const glass = window.glassityTest!.instance('#a')!;
    const before = glass.geometry?.key;
    document.querySelector('#a')!.innerHTML = shape;
    let morphed = false;
    let after = 0;
    const start = performance.now();
    // Watch every frame until the new shape has been in place for a few frames.
    while (performance.now() - start < 3000) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (glass.previous) morphed = true;
      if (glass.geometry?.key !== before && ++after >= 4) break;
    }
    return { changed: glass.geometry?.key !== before, morphed };
  }, shape);
}

/** Hold the pointer down on the interactive tile and record a few frames. */
async function pressTile(page: Page): Promise<{ transform: string; scale: number; glow: number }[]> {
  const box = (await page.locator('#press').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const samples = await page.evaluate(async () => {
    const glass = window.glassityTest!.instance('#t')!;
    const out: { transform: string; scale: number; glow: number }[] = [];
    for (let i = 0; i < 12; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      out.push({ transform: glass.canvas.style.transform, scale: glass.interaction.scale, glow: glass.interaction.glow });
    }
    return out;
  });
  await page.mouse.up();
  return samples;
}

test.describe('reduce motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('no pointer light, no bounce, and transitions are instant', async ({ page }) => {
    const errors = await openFixture(page, '/e2e/fixtures/basic.html');
    // A real duration and the pointer light on: only the system setting may switch them off.
    await page.evaluate(() => {
      const options = { duration: 400 };
      window.glassHandles = {
        a: window.glassity.glassify(document.querySelector('#a')!, options),
        t: window.glassity.glassify(document.querySelector('#t')!, options), // data-glass-tile, data-glass-interactive
      };
    });
    await waitForGlass(page, { count: 2 });
    expect(await page.evaluate(() => window.glassityTest!.engine()!.media.reducedMotion)).toBe(true);

    // No pointer light: the highlight stays where the light angle puts it.
    const a = (await page.locator('#a').boundingBox())!;
    await page.mouse.move(a.x + a.width + 30, a.y + a.height / 2);
    await page.mouse.move(a.x + a.width + 40, a.y + a.height / 2 + 10);
    await frames(page, 3);
    expect(offBase(await lightOf(page, '#a'))).toBeLessThan(1e-6);

    // No bounce: the press registers, but the glass never swells.
    const pressed = await pressTile(page);
    expect(pressed.some((s) => s.glow === 1)).toBe(true);
    expect(pressed.every((s) => s.transform === '' && s.scale === 1)).toBe(true);

    // Hiding is instant: the lens is gone by the next frame instead of taking 400 ms.
    const lens = await page.evaluate(async () => {
      const glass = window.glassityTest!.instance('#a')!;
      window.glassHandles.a.update({ visible: false });
      const seen: number[] = [];
      for (let i = 0; i < 4; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        seen.push(glass.lens);
      }
      return seen;
    });
    expect(lens.slice(1)).toEqual([0, 0, 0]);
    await expect(page.locator('#a + canvas')).toHaveCSS('visibility', 'hidden');
    await page.evaluate(() => window.glassHandles.a.update({ visible: true }));
    await waitForGlass(page, { count: 2 });

    // No morph: a new outline replaces the old one at once.
    const calm = await swapShape(page, '<circle cx="12" cy="12" r="9"></circle>');
    expect(calm).toEqual({ changed: true, morphed: false });

    // The same steps with `accessibility: false` do animate, so the checks above can see motion.
    await page.evaluate(() => {
      for (const handle of Object.values(window.glassHandles)) handle.update({ accessibility: false });
    });
    await waitForGlass(page, { count: 2 });
    expect(await swapShape(page, '<rect x="4" y="4" width="16" height="16" rx="3"></rect>')).toEqual({ changed: true, morphed: true });
    expect((await pressTile(page)).some((s) => s.scale > 1.02)).toBe(true);
    await page.mouse.move(a.x + a.width + 30, a.y + a.height / 2);
    await page.mouse.move(a.x + a.width + 40, a.y + a.height / 2 + 10);
    await expect.poll(async () => offBase(await lightOf(page, '#a'))).toBeGreaterThan(0.05);
    expect(errors).toEqual([]);
  });
});

test('reduce transparency makes the glass frostier and more tinted', async ({ page }) => {
  const errors = await openFixture(page, '/e2e/fixtures/basic.html');
  // A tile with no mark: the whole plate shows what is behind it, sharp stripes and a gradient.
  await page.evaluate(() => {
    window.glassHandles = {
      t: window.glassity.glassify(document.querySelector('#t')!, { duration: 0, pointerLight: false, glyphOpacity: 0, scheme: 'dark' }),
    };
  });
  await waitForGlass(page, { count: 1 });
  const normal = await glassStats(page, '#t');
  expect(normal.opaque).toBeGreaterThan(1000);

  // Playwright has no option for this media feature; Chromium takes it through CDP.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(true);
  await waitForMedia(page, 'reducedTransparency');
  await waitForGlass(page, { count: 1 });
  const reduced = await glassStats(page, '#t');

  // More tint (white here) washes the colour out; more frost blurs the stripes away.
  expect(reduced.saturation).toBeLessThan(normal.saturation * 0.8);
  expect(reduced.detail).toBeLessThan(normal.detail * 0.85);

  // With `accessibility: false` the glass ignores the setting.
  await page.evaluate(() => window.glassHandles.t.update({ accessibility: false }));
  await waitForGlass(page, { count: 1 });
  const ignored = await glassStats(page, '#t');
  expect(ignored.saturation).toBeGreaterThan(reduced.saturation * 1.15);
  expect(errors).toEqual([]);
});

test('more contrast makes the icons solid black or white', async ({ page }) => {
  const errors = await openFixture(page, '/e2e/fixtures/basic.html');
  // #a sits on a dark, colourful wall (white ink); #c on a light page of text (black ink).
  await page.evaluate(() => {
    const options = { duration: 0, pointerLight: false };
    window.glassHandles = {
      a: window.glassity.glassify(document.querySelector('#a')!, { ...options, scheme: 'dark' }),
      c: window.glassity.glassify(document.querySelector('#c')!, { ...options, scheme: 'light' }),
    };
  });
  await waitForGlass(page, { count: 2 });
  const darkBefore = await glassStats(page, '#a');
  const lightBefore = await glassStats(page, '#c');
  expect(darkBefore.opaque).toBeGreaterThan(100);
  expect(lightBefore.opaque).toBeGreaterThan(100);
  // Normally the glass shows what is behind it.
  expect(darkBefore.white).toBeLessThan(0.5);
  expect(lightBefore.ink).toBeLessThan(0.3);

  await page.emulateMedia({ contrast: 'more' });
  await waitForMedia(page, 'moreContrast');
  await waitForGlass(page, { count: 2 });
  const darkAfter = await glassStats(page, '#a');
  const lightAfter = await glassStats(page, '#c');
  // The edge ring keeps a little of the shadow, so not every opaque pixel is pure ink.
  expect(darkAfter.white).toBeGreaterThan(0.9);
  expect(lightAfter.ink).toBeGreaterThan(0.9);
  expect(errors).toEqual([]);
});
