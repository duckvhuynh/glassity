import { expect, test } from '@playwright/test';
import { glassSignature, openFixture, signatureDifference, waitForGlass } from './helpers';

test.skip(({ browserName }) => browserName !== 'chromium', 'Native HTML-in-Canvas is checked in Chromium.');

const LOOK = {
  accessibility: false, duration: 0, pointerLight: false, tile: true, frost: 0,
  legibility: 'off', glyphOpacity: 0.3, tintOpacity: 0, shine: 0, reflection: 0,
} as const;

test('an app-painted drawable backdrop follows animation without cloning its HTML', async ({ page }) => {
  const errors = await openFixture(page, '/e2e/fixtures/backdrops.html');
  const supported = await page.evaluate(() => {
    const canvas = document.createElement('canvas') as HTMLCanvasElement & { content?: string };
    canvas.setAttribute('content', 'drawable');
    return canvas.content === 'drawable' && 'requestPaint' in HTMLCanvasElement.prototype && 'drawElementImage' in CanvasRenderingContext2D.prototype;
  });
  test.skip(!supported, 'This Chromium build does not expose the native drawable-canvas API.');

  await page.evaluate((look) => {
    type DrawableCanvas = HTMLCanvasElement & { requestPaint(): void };
    type DrawableContext = CanvasRenderingContext2D & {
      drawElementImage(element: Element, x: number, y: number, width: number, height: number): void;
    };
    const owner = document.createElement('canvas') as DrawableCanvas;
    owner.id = 'html-owner';
    owner.setAttribute('content', 'drawable');
    owner.width = 400;
    owner.height = 240;
    owner.style.cssText = 'position:absolute;left:20px;top:20px;display:block;width:400px;height:240px';
    const panel = document.createElement('div');
    panel.id = 'html-source';
    panel.setAttribute('drawable', '');
    panel.style.cssText = 'width:400px;height:240px;background:rgb(230,30,40)';
    owner.append(panel);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'html-icon';
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.style.cssText = 'position:absolute;left:170px;top:90px;width:80px;height:80px;color:white';
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M4 4h16v16H4z');
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    document.body.replaceChildren(owner, svg);
    const ctx = owner.getContext('2d') as DrawableContext;
    // The application owns native rendering; glassity must never replace it.
    owner.addEventListener('paint', () => {
      ctx.clearRect(0, 0, owner.width, owner.height);
      ctx.drawElementImage(panel, 0, 0, 400, 240);
    });
    owner.requestPaint();
    window.handle = window.glassity.glassify(svg, { ...look, backdrop: panel });
  }, LOOK);

  await waitForGlass(page, { count: 1 });
  expect(await page.evaluate(() => {
    const backdrop = window.glassityTest!.instance('#html-icon')!.backdrop as unknown as { native: unknown; version: number };
    return !!backdrop.native && backdrop.version > 1;
  })).toBe(true);
  const before = await glassSignature(page, '#html-icon');
  await page.evaluate(async () => {
    const panel = document.getElementById('html-source')!;
    // Web Animations change painted pixels without changing DOM attributes.
    const animation = panel.animate([
      { backgroundColor: 'rgb(230,30,40)' },
      { backgroundColor: 'rgb(20,70,240)' },
    ], { duration: 600, fill: 'forwards' });
    await animation.finished;
  });
  await expect.poll(async () => signatureDifference(before, await glassSignature(page, '#html-icon')),
    { timeout: 8000, message: 'native paint events should update the refracted HTML animation' }).toBeGreaterThan(15);
  expect(await page.evaluate(() => document.getElementById('html-source')!.parentElement === document.getElementById('html-owner'))).toBe(true);
  expect(await page.locator('#html-source').count()).toBe(1);
  expect(errors).toEqual([]);
});

test('the internal native-off flag preserves ordinary HTML snapshot updates', async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as { __GLASSITY_DISABLE_HTML_CANVAS__?: boolean }).__GLASSITY_DISABLE_HTML_CANVAS__ = true;
  });
  const errors = await openFixture(page, '/e2e/fixtures/backdrops.html');
  await page.evaluate((look) => {
    window.handle = window.glassity.glassify(document.getElementById('i-element')!, {
      ...look, backdrop: document.getElementById('panel')!,
    });
  }, LOOK);
  await waitForGlass(page, { count: 1 });
  expect(await page.evaluate(() => (window.glassityTest!.instance('#i-element')!.backdrop as unknown as { native: unknown }).native)).toBeNull();
  const before = await glassSignature(page, '#i-element');
  await page.locator('#band').evaluate((band) => { (band as HTMLElement).style.background = '#1040ff'; });
  await expect.poll(async () => signatureDifference(before, await glassSignature(page, '#i-element')),
    { timeout: 8000, message: 'snapshot fallback should refresh after an HTML change' }).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
