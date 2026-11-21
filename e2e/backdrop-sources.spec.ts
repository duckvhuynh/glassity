import { expect, test, type Page } from '@playwright/test';
import { glassSignature, openFixture, signatureDifference, waitForGlass } from './helpers';

/**
 * Every kind of `backdrop` the README lists. Each test checks that the glass shows the
 * source: its output changes when the source changes. Chromium only for now; the video
 * and canvas cases have not been checked in Firefox and WebKit.
 */

declare global {
  interface Window {
    drawPattern: (canvas: HTMLCanvasElement, kind: 'a' | 'b') => void;
    videoPattern: 'a' | 'b';
  }
}

test.skip(({ browserName }) => browserName !== 'chromium', 'Backdrop sources are checked in Chromium.');

/** A tile with no frost: the plate shows the backdrop sharply across the whole icon box. */
const LOOK = { accessibility: false, duration: 0, pointerLight: false, tile: true, frost: 0, glyphOpacity: 0.4 };
/** Mean channel difference below which two pictures of the glass count as the same. */
const STILL = 3;
/** Mean channel difference above which the glass clearly shows something else. */
const CHANGED = 12;

const FIXTURE = '/e2e/fixtures/backdrops.html';

/** The glass holds still while its source does, then shows the change. */
async function expectGlassToFollow(page: Page, svg: string, change: () => Promise<unknown>): Promise<void> {
  const before = await glassSignature(page, svg);
  expect(signatureDifference(before, await glassSignature(page, svg))).toBeLessThan(STILL);
  await change();
  await expect
    .poll(async () => signatureDifference(before, await glassSignature(page, svg)), { timeout: 8000, message: 'the glass should show the new source' })
    .toBeGreaterThan(CHANGED);
}

test('an image URL', async ({ page }) => {
  const errors = await openFixture(page, FIXTURE);
  await page.evaluate((look) => {
    window.glassHandles = { url: window.glassity.glassify(document.querySelector('#i-url')!, { ...look, backdrop: '/e2e/fixtures/backdrop-a.svg' }) };
  }, LOOK);
  // Waits for the image to load too: an image that has not loaded has no pixels.
  await waitForGlass(page, { count: 1 });
  await expectGlassToFollow(page, '#i-url', async () => {
    await page.evaluate(() => window.glassHandles.url.update({ backdrop: '/e2e/fixtures/backdrop-b.svg' }));
    await waitForGlass(page, { count: 1 });
  });
  expect(errors).toEqual([]);
});

test('an <img> element, followed when its src changes', async ({ page }) => {
  const errors = await openFixture(page, FIXTURE);
  await page.locator('#img').evaluate((img: HTMLImageElement) => img.decode());
  await page.evaluate((look) => {
    window.glassHandles = { img: window.glassity.glassify(document.querySelector('#i-img')!, { ...look, backdrop: document.querySelector<HTMLImageElement>('#img')! }) };
  }, LOOK);
  await waitForGlass(page, { count: 1 });
  await expectGlassToFollow(page, '#i-img', () =>
    page.locator('#img').evaluate((img: HTMLImageElement) => {
      img.src = '/e2e/fixtures/backdrop-b.svg';
      return img.decode();
    }),
  );
  expect(errors).toEqual([]);
});

test('a playing <video>, refracted frame by frame', async ({ page }) => {
  const errors = await openFixture(page, FIXTURE);
  // A tiny generated video: a canvas painted every frame, streamed into the <video>.
  await page.evaluate(async (look) => {
    const source = document.createElement('canvas');
    source.width = source.height = 200;
    window.videoPattern = 'a';
    const paint = () => {
      window.drawPattern(source, window.videoPattern);
      requestAnimationFrame(paint);
    };
    paint();
    const video = document.querySelector<HTMLVideoElement>('#video')!;
    video.muted = true;
    video.srcObject = source.captureStream(30);
    await video.play();
    window.glassHandles = { video: window.glassity.glassify(document.querySelector('#i-video')!, { ...look, backdrop: video }) };
  }, LOOK);
  await waitForGlass(page, { count: 1 });
  await expectGlassToFollow(page, '#i-video', () =>
    page.evaluate(() => {
      window.videoPattern = 'b';
    }),
  );
  expect(errors).toEqual([]);
});

test('a <canvas>, live: drawing on it changes the glass', async ({ page }) => {
  const errors = await openFixture(page, FIXTURE);
  await page.evaluate((look) => {
    window.glassHandles = { canvas: window.glassity.glassify(document.querySelector('#i-canvas')!, { ...look, backdrop: document.querySelector<HTMLCanvasElement>('#live')! }) };
  }, LOOK);
  await waitForGlass(page, { count: 1 });
  // No event, no refresh(): the next frame picks the new drawing up.
  await expectGlassToFollow(page, '#i-canvas', () => page.evaluate(() => window.drawPattern(document.querySelector<HTMLCanvasElement>('#live')!, 'b')));
  expect(errors).toEqual([]);
});

test('an element, snapshotted again when its content changes', async ({ page }) => {
  const errors = await openFixture(page, FIXTURE);
  await page.evaluate((look) => {
    window.glassHandles = { element: window.glassity.glassify(document.querySelector('#i-element')!, { ...look, backdrop: document.querySelector<HTMLElement>('#panel')! }) };
  }, LOOK);
  // Waits for the first snapshot of #panel to land.
  await waitForGlass(page, { count: 1 });
  // The yellow band right under the icon turns blue.
  await expectGlassToFollow(page, '#i-element', () =>
    page.evaluate(() => {
      document.querySelector<HTMLElement>('#band')!.style.background = '#00b4ff';
    }),
  );
  expect(errors).toEqual([]);
});

test("'none': only the page colour, whatever is drawn behind", async ({ page }) => {
  const errors = await openFixture(page, FIXTURE);
  const mount = () =>
    page.evaluate((look) => {
      window.glassHandles = { none: window.glassity.glassify(document.querySelector('#i-none')!, { ...look, backdrop: 'none' }) };
    }, LOOK);
  await mount();
  await waitForGlass(page, { count: 1 });
  const dark = await glassSignature(page, '#i-none');

  // The busy stripes behind the icon are left out: 'auto' shows them, 'none' does not.
  await page.evaluate(() => window.glassHandles.none.update({ backdrop: 'auto' }));
  await waitForGlass(page, { count: 1 });
  expect(signatureDifference(dark, await glassSignature(page, '#i-none'))).toBeGreaterThan(CHANGED);

  // The page colour is the source. It is read when the glass is made (a later change of
  // the colour alone is not followed), so make the glass again over a light page colour.
  await page.evaluate(() => {
    window.glassHandles.none.destroy();
    document.querySelector<HTMLElement>('#s-none')!.style.backgroundColor = '#f2f2f2';
  });
  await mount();
  await waitForGlass(page, { count: 1 });
  expect(signatureDifference(dark, await glassSignature(page, '#i-none'))).toBeGreaterThan(CHANGED);
  expect(errors).toEqual([]);
});
