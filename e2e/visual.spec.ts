import { expect, test } from '@playwright/test';
import { openFixture, waitForGlass } from './helpers';

/**
 * Golden images of the glass. A change to the shader, the field or the options that
 * alters how glass looks fails here until the images are updated on purpose; see
 * e2e/README.md for how. Chromium only: each engine rasterizes a little differently,
 * and one set of images is enough to catch a change in the look.
 */

test.skip(({ browserName }) => browserName !== 'chromium', 'Golden images are kept for Chromium only.');

// Always draw with SwiftShader, as CI does, so a local GPU cannot change the pixels.
test.use({
  launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader'] },
});

/**
 * SwiftShader is deterministic on one machine, but its JIT can round differently on
 * another CPU: allow a soft per-pixel colour distance and a small share of pixels off.
 */
const TOLERANCE = { maxDiffPixelRatio: 0.015, threshold: 0.25 } as const;

/** Cells of the fixture: every edge profile, a tile, the clear variant, both schemes, a filled and a stroked icon. */
const CELLS = ['squircle', 'circle', 'lip', 'dome', 'tile', 'clear', 'scheme-dark', 'scheme-light', 'filled', 'stroked'];

test('glass matches the golden images', async ({ page }) => {
  // Each icon draws a little grain from Math.random(); seed it so every run draws the same.
  await page.addInitScript(() => {
    let state = 0x2f6b1d;
    Math.random = () => {
      // mulberry32
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  const errors = await openFixture(page, '/e2e/fixtures/visual.html');
  // Nothing time-based: no transitions, no pointer light, a fixed light, and no system settings.
  await page.evaluate(() => {
    window.controller = window.glassity.auto({ accessibility: false, duration: 0, pointerLight: false, lightAngle: -45 });
  });
  await waitForGlass(page, { count: CELLS.length + 12 });

  for (const cell of CELLS) await expect.soft(page.locator('#' + cell)).toHaveScreenshot(cell + '.png', TOLERANCE);
  await expect.soft(page.locator('#matrix')).toHaveScreenshot('small-icons.png', TOLERANCE);
  expect(errors).toEqual([]);
});
