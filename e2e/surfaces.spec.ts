import { expect, test, type Page } from '@playwright/test';
import { openFixture, waitForGlass, waitForMedia } from './helpers';

declare global {
  interface Window {
    surfaceDemo: {
      controller: import('../src/index').GlassController;
      flatHandle: import('../src/index').GlassHandle;
      clicks: number;
      copyClicks: number;
      resize(width: number): void;
    };
  }
}

const fixture = '/e2e/fixtures/surfaces.html';
const canvasOf = (page: Page, selector: string) => page.locator(selector + ' > canvas[data-glassity-canvas]');

test.use({ viewport: { width: 1000, height: 1100 } });
test.skip(({ browserName }) => browserName !== 'chromium', 'Surface rendering is checked in Chromium.');

/** Sample the actual rendered slab in element-local CSS pixels, excluding its bleed. */
async function samples(page: Page, selector: string, points: [number, number][]): Promise<number[][]> {
  return page.locator(selector).evaluate((node, points) => {
    const el = node as HTMLElement;
    const canvas = el.querySelector<HTMLCanvasElement>(':scope > canvas[data-glassity-canvas]')!;
    const cssW = parseFloat(canvas.style.width);
    const cssH = parseFloat(canvas.style.height);
    const bleedX = (cssW - el.offsetWidth) / 2;
    const bleedY = (cssH - el.offsetHeight) / 2;
    const ctx = canvas.getContext('2d')!;
    return points.map(([x, y]) => Array.from(ctx.getImageData(
      Math.floor((x + bleedX) * canvas.width / cssW),
      Math.floor((y + bleedY) * canvas.height / cssH), 1, 1,
    ).data));
  }, points);
}

async function aligned(page: Page, selector: string): Promise<void> {
  await expect.poll(() => page.locator(selector).evaluate((el) => {
    const body = el.getBoundingClientRect();
    const canvas = el.querySelector<HTMLCanvasElement>(':scope > canvas[data-glassity-canvas]')!.getBoundingClientRect();
    return Math.hypot(body.x + body.width / 2 - canvas.x - canvas.width / 2, body.y + body.height / 2 - canvas.y - canvas.height / 2);
  })).toBeLessThan(1.5);
}

test('the slab is behind ordinary clickable, focusable and selectable DOM content', async ({ page }) => {
  const errors = await openFixture(page, fixture);
  await waitForGlass(page, { count: 5 });
  for (const selector of ['#pill', '#tabbar', '#photo-toolbar', '#flat-toolbar']) {
    const canvas = canvasOf(page, selector);
    await expect(canvas).toHaveCSS('visibility', 'visible');
    await expect(canvas).toHaveCSS('pointer-events', 'none');
    await expect(canvas).toHaveCSS('z-index', '-1');
    await expect(page.locator(selector)).toHaveCSS('isolation', 'isolate');
    expect(await page.locator(selector).evaluate((el) => el.firstElementChild?.matches('canvas[data-glassity-canvas]'))).toBe(true);
    await expect(page.locator(selector)).toHaveCSS('opacity', '1');
  }
  await expect(page.locator('#pill-label')).toHaveCSS('visibility', 'visible');
  await page.locator('#pill-label').click();
  expect(await page.evaluate(() => window.surfaceDemo.clicks)).toBe(1);
  await page.locator('#pill').focus();
  await expect(page.locator('#pill')).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.surfaceDemo.clicks)).toBe(2);
  await expect(page.locator('#pill')).toHaveCSS('outline-style', 'solid');
  await page.locator('#copy-button').click();
  expect(await page.evaluate(() => window.surfaceDemo.copyClicks)).toBe(1);

  const label = page.locator('#selectable-label');
  await label.scrollIntoViewIfNeeded();
  const box = (await label.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('Select this');
  expect(errors).toEqual([]);
});

test('automatic SVG selection leaves surface icons plain unless explicitly marked', async ({ page }) => {
  await openFixture(page, fixture);
  await waitForGlass(page, { count: 5 });
  await expect(page.locator('#plain-icon')).not.toHaveAttribute('data-glassity-hidden');
  await expect(page.locator('#plain-icon + canvas[data-glassity-canvas]')).toHaveCount(0);
  await expect(page.locator('#glass-icon')).toHaveAttribute('data-glassity-hidden', '');
  await expect(page.locator('#glass-icon + canvas[data-glassity-canvas]')).toHaveCSS('visibility', 'visible');
  await page.locator('#glass-icon').evaluate((el) => el.removeAttribute('data-glass'));
  await waitForGlass(page, { count: 4 });
  await expect(page.locator('#glass-icon')).not.toHaveAttribute('data-glassity-hidden');
  await page.locator('#glass-icon').evaluate((el) => el.setAttribute('data-glass', ''));
  await waitForGlass(page, { count: 5 });
});

test('ResizeObserver updates an imperative surface without changing its content', async ({ page }) => {
  await openFixture(page, fixture);
  await waitForGlass(page, { count: 5 });
  const canvas = canvasOf(page, '#flat-toolbar');
  const before = await canvas.evaluate((el) => ({ width: (el as HTMLCanvasElement).width, cssWidth: parseFloat((el as HTMLCanvasElement).style.width) }));
  const text = await page.locator('#selectable-label').textContent();
  await page.evaluate(() => window.surfaceDemo.resize(560));
  await expect.poll(() => canvas.evaluate((el) => parseFloat((el as HTMLCanvasElement).style.width))).toBeCloseTo(before.cssWidth + 120, 0);
  await expect.poll(() => canvas.evaluate((el) => (el as HTMLCanvasElement).width)).toBeGreaterThan(before.width);
  await waitForGlass(page, { count: 5 });
  await aligned(page, '#flat-toolbar');
  expect(await page.locator('#selectable-label').textContent()).toBe(text);
  expect(await page.evaluate(() => window.surfaceDemo.flatHandle.element === document.getElementById('flat-toolbar'))).toBe(true);
});

test('pixels follow pill, independent elliptical corners and radius-only changes', async ({ page }) => {
  await openFixture(page, fixture);
  await waitForGlass(page, { count: 5 });
  const pill = await samples(page, '#pill', [[3, 3], [92, 27]]);
  expect(pill[0][3]).toBeLessThan(80);
  expect(pill[1][3]).toBeGreaterThan(245);
  // The toolbar has TL 24x16, TR 8x8, BR 20x12, BL 4x4 corners.
  const corners = await samples(page, '#photo-toolbar', [[4, 4], [436, 4], [438, 62], [4, 60]]);
  expect(corners[0][3]).toBeLessThan(120);
  expect(corners[1][3]).toBeGreaterThan(200);
  expect(corners[2][3]).toBeLessThan(120);
  expect(corners[3][3]).toBeGreaterThan(200);
  await page.locator('#photo-toolbar').evaluate((el) => (el as HTMLElement).style.borderRadius = '0px');
  await expect.poll(async () => (await samples(page, '#photo-toolbar', [[4, 4]]))[0][3]).toBeGreaterThan(245);
  await page.locator('#photo-toolbar').evaluate((el) => (el as HTMLElement).style.borderRadius = '50%');
  await expect.poll(async () => (await samples(page, '#photo-toolbar', [[4, 4]]))[0][3]).toBeLessThan(80);
});

test('surface placement follows ancestor transforms and scrolling in local dimensions', async ({ page }) => {
  await openFixture(page, fixture);
  await waitForGlass(page, { count: 5 });
  const canvas = canvasOf(page, '#photo-toolbar');
  const width = await canvas.evaluate((el) => (el as HTMLCanvasElement).style.width);
  await page.locator('#photo-panel').evaluate((el) => (el as HTMLElement).style.transform = 'translate(23px, 17px) rotate(8deg) scale(.85)');
  await waitForGlass(page, { count: 5 });
  await aligned(page, '#photo-toolbar');
  expect(await canvas.evaluate((el) => (el as HTMLCanvasElement).style.width)).toBe(width);
  await page.evaluate(() => {
    document.body.style.minHeight = '2000px';
    window.scrollTo(0, 150);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(150);
  await aligned(page, '#photo-toolbar');
});

test('a reused backdrop omits a newly mounted surface own background and label', async ({ page }) => {
  await openFixture(page, fixture);
  await page.evaluate(() => {
    const wall = document.createElement('section');
    wall.id = 'exclusion-wall';
    wall.style.cssText = 'background:rgb(20,60,120);padding:30px;width:300px';
    const anchor = document.createElement('div');
    anchor.id = 'exclusion-anchor';
    anchor.style.cssText = 'width:80px;height:40px;border-radius:10px';
    const slab = document.createElement('div');
    slab.id = 'exclusion';
    slab.style.cssText = 'width:240px;height:80px;border-radius:12px;background:red;display:grid;place-items:center;color:yellow;font:40px sans-serif';
    slab.textContent = 'LABEL';
    wall.append(anchor, slab);
    document.body.append(wall);
    window.glassHandles = {
      anchor: window.glassity.glassify(anchor, { surface: true, duration: 0, pointerLight: false }),
    };
    slab.scrollIntoView();
  });
  await waitForGlass(page, { count: 6 });
  // Establish that the shared snapshot really contains the ordinary red element first.
  const previousPixel = await page.evaluate(() => {
    const source = window.glassityTest!.instance('#exclusion-anchor')!.backdrop!.source as HTMLCanvasElement;
    const wall = document.getElementById('exclusion-wall')!;
    const slab = document.getElementById('exclusion')!;
    const outer = wall.getBoundingClientRect();
    const inner = slab.getBoundingClientRect();
    const scaleX = source.width / wall.offsetWidth;
    const scaleY = source.height / wall.offsetHeight;
    return Array.from(source.getContext('2d')!.getImageData(
      Math.floor((inner.left - outer.left + 12) * scaleX),
      Math.floor((inner.top - outer.top + 40) * scaleY), 1, 1,
    ).data);
  });
  expect(previousPixel[0]).toBeGreaterThan(240);
  expect(previousPixel[1]).toBeLessThan(15);
  expect(previousPixel[2]).toBeLessThan(15);
  const reused = await page.evaluate(() => {
    const backdrop = window.glassityTest!.instance('#exclusion-anchor')!.backdrop;
    window.handle = window.glassity.glassify(document.getElementById('exclusion')!, {
      surface: true, duration: 0, pointerLight: false, accessibility: false,
      depth: 0, refraction: 0, frost: 0, tintOpacity: 0, shine: 0, rim: 0, reflection: 0,
      shadow: 0, saturation: 1, brightness: 1, contrast: 1, dim: 0,
    });
    return window.glassityTest!.instance('#exclusion')!.backdrop === backdrop;
  });
  expect(reused).toBe(true);
  await waitForGlass(page, { count: 7 });
  const [pixel] = await samples(page, '#exclusion', [[120, 40]]);
  for (const [channel, expected] of [20, 60, 120].entries()) expect(Math.abs(pixel[channel] - expected)).toBeLessThan(12);
  expect(pixel[3]).toBeGreaterThan(245);
});

test('destroy and attribute opt-out restore paint while retaining labels and handlers', async ({ page }) => {
  await openFixture(page, fixture);
  await waitForGlass(page, { count: 5 });
  await page.locator('#flat-toolbar').evaluate((el) => (el as HTMLElement).style.background = 'rgb(12, 34, 56)');
  await page.evaluate(() => window.surfaceDemo.flatHandle.destroy());
  await expect(canvasOf(page, '#flat-toolbar')).toHaveCount(0);
  await expect(page.locator('#flat-toolbar')).not.toHaveAttribute('data-glassity-surface');
  await expect(page.locator('#flat-toolbar')).not.toHaveAttribute('data-glassity-surface-active');
  await expect(page.locator('#flat-toolbar')).toHaveCSS('background-color', 'rgb(12, 34, 56)');
  expect(await page.locator('#flat-toolbar').evaluate((el) => (el as HTMLElement).style.position)).toBe('');
  await expect(page.locator('#flat-toolbar')).toHaveCSS('width', '440px');
  await page.locator('#pill').evaluate((el) => el.setAttribute('data-glass', 'off'));
  await expect(canvasOf(page, '#pill')).toHaveCount(0);
  await expect(page.locator('#pill')).not.toHaveAttribute('data-glassity-surface-active');
  await page.locator('#pill-label').click();
  expect(await page.evaluate(() => window.surfaceDemo.clicks)).toBe(1);
  await expect(page.locator('#selectable-label')).toHaveText('Select this label');
});

test('forced colors restores the original surface and keeps controls usable', async ({ page }) => {
  await openFixture(page, fixture);
  await waitForGlass(page, { count: 5 });
  await page.emulateMedia({ forcedColors: 'active' });
  await waitForMedia(page, 'forcedColors');
  await expect(canvasOf(page, '#pill')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#pill')).not.toHaveAttribute('data-glassity-surface-active');
  await expect(page.locator('#pill-label')).toHaveCSS('visibility', 'visible');
  await page.locator('#pill').focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.surfaceDemo.clicks)).toBe(1);
  await page.emulateMedia({ forcedColors: 'none' });
  await waitForGlass(page, { count: 5 });
  await expect(canvasOf(page, '#pill')).toHaveCSS('visibility', 'visible');
});

test.describe('surface pixel budget', () => {
  test.use({ deviceScaleFactor: 3 });

  test('caps DPR even when the page requests a higher maximum', async ({ page }) => {
    await openFixture(page, fixture);
    await page.evaluate(() => window.surfaceDemo.flatHandle.update({ maxDpr: 4 }));
    await waitForGlass(page, { count: 5 });
    const density = await canvasOf(page, '#flat-toolbar').evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      return canvas.width / parseFloat(canvas.style.width);
    });
    expect(density).toBeGreaterThan(1);
    expect(density).toBeLessThanOrEqual(1.51);
  });
});


test('an explicitly static host gets a local containing block and restores author positioning', async ({ page }) => {
  await openFixture(page, fixture);
  await page.evaluate(() => {
    const wall = document.createElement('section');
    wall.style.cssText = 'position:relative;margin:30px;padding:24px;width:360px;background:#4a635e';
    const slab = document.createElement('div');
    slab.id = 'static-surface';
    slab.style.cssText = 'position:static!important;margin:15px 20px;width:220px;height:64px;padding:8px;border:3px solid #31443f;border-radius:17px;background:#f0e8dc';
    slab.textContent = 'Static positioned surface';
    wall.append(slab);
    document.body.append(wall);
    window.handle = window.glassity.glassify(slab, { surface: true, duration: 0, pointerLight: false });
    slab.scrollIntoView();
  });
  await waitForGlass(page, { count: 6 });
  await expect(page.locator('#static-surface')).toHaveCSS('position', 'relative');
  await aligned(page, '#static-surface');
  await page.evaluate(() => window.handle.destroy());
  await expect(canvasOf(page, '#static-surface')).toHaveCount(0);
  const restored = await page.locator('#static-surface').evaluate((el) => {
    const style = (el as HTMLElement).style;
    return { position: style.position, priority: style.getPropertyPriority('position'), background: getComputedStyle(el).backgroundColor };
  });
  expect(restored).toEqual({ position: 'static', priority: 'important', background: 'rgb(240, 232, 220)' });

  // A framework's later authored position must survive cleanup too.
  await page.evaluate(() => {
    const slab = document.getElementById('static-surface')!;
    window.handle = window.glassity.glassify(slab, { surface: true, duration: 0, pointerLight: false });
    slab.style.setProperty('position', 'absolute');
  });
  await waitForGlass(page, { count: 6 });
  await page.evaluate(() => window.handle.destroy());
  await expect(page.locator('#static-surface')).toHaveCSS('position', 'absolute');
});

test('a transformed backdrop keeps the same local photo coordinates', async ({ page }) => {
  await openFixture(page, fixture);
  await page.evaluate(() => {
    const wall = document.createElement('section');
    wall.id = 'transformed-backdrop';
    wall.style.cssText = 'position:relative;margin:50px;width:480px;height:180px;background:linear-gradient(90deg,rgb(20,60,120),rgb(180,100,30));transform-origin:0 0';
    const slab = document.createElement('div');
    slab.id = 'mapped-surface';
    slab.style.cssText = 'position:absolute;left:80px;top:50px;width:240px;height:80px;border-radius:12px;background:red';
    wall.append(slab);
    document.body.append(wall);
    window.handle = window.glassity.glassify(slab, {
      surface: true, duration: 0, pointerLight: false, accessibility: false,
      curvature: 0, depth: 0, refraction: 0, frost: 0, tintOpacity: 0,
      shine: 0, rim: 0, reflection: 0, shadow: 0, saturation: 1, brightness: 1, contrast: 1, dim: 0,
    });
    slab.scrollIntoView();
  });
  await waitForGlass(page, { count: 6 });
  await expect(canvasOf(page, '#mapped-surface')).toHaveCSS('visibility', 'visible');
  const points: [number, number][] = [[50, 40], [120, 40], [190, 40]];
  const before = await samples(page, '#mapped-surface', points);
  expect(before[2][0] - before[0][0]).toBeGreaterThan(25);
  await page.locator('#transformed-backdrop').evaluate((el) => {
    (el as HTMLElement).style.transform = 'translate(25px, 12px) rotate(31deg) scale(.78)';
    el.scrollIntoView();
  });
  await waitForGlass(page, { count: 6 });
  await aligned(page, '#mapped-surface');
  const after = await samples(page, '#mapped-surface', points);
  for (let i = 0; i < before.length; i++)
    for (let channel = 0; channel < 4; channel++) expect(Math.abs(after[i][channel] - before[i][channel])).toBeLessThan(8);
});

test('retargeting a surface to SVG clears the previous backdrop mapping', async ({ page }) => {
  await openFixture(page, fixture);
  await page.evaluate(() => {
    const wall = document.createElement('section');
    wall.style.cssText = 'position:relative;margin:50px;width:400px;height:160px;background:linear-gradient(90deg,#1010ff,#10ffff)';
    const slab = document.createElement('div');
    slab.id = 'retarget-surface';
    slab.style.cssText = 'position:absolute;left:220px;top:40px;width:140px;height:60px;border-radius:20px;background:red;transform:rotate(17deg)';
    wall.append(slab);
    for (const id of ['retarget-icon', 'reference-icon']) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = id;
      svg.setAttribute('viewBox', '0 0 80 80');
      svg.style.cssText = 'position:absolute;left:35px;top:40px;width:80px;height:80px';
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '40');
      circle.setAttribute('cy', '40');
      circle.setAttribute('r', '32');
      svg.append(circle);
      wall.append(svg);
    }
    document.body.append(wall);
    window.handle = window.glassity.glassify(slab, {
      surface: true, duration: 0, pointerLight: false, accessibility: false,
      curvature: 0, depth: 0, refraction: 0, frost: 0, tint: 'white', tintOpacity: 0,
      shine: 0, rim: 0, reflection: 0, shadow: 0, saturation: 1, brightness: 1, contrast: 1, dim: 0,
    });
    wall.scrollIntoView();
  });
  // Broad fixture selection also mounts the two SVGs; stop it before setting up the comparison.
  await page.evaluate(() => {
    window.surfaceDemo.controller.destroy();
    window.controller = window.glassity.auto({ selector: '[data-glass]', duration: 0, pointerLight: false });
  });
  await waitForGlass(page, { count: 6 });
  await page.evaluate(() => {
    window.handle.retarget(document.getElementById('retarget-icon') as unknown as SVGSVGElement);
    window.glassHandles = {
      reference: window.glassity.glassify(document.getElementById('reference-icon')!, {
        duration: 0, pointerLight: false, accessibility: false,
        curvature: 0, depth: 0, refraction: 0, frost: 0, tint: 'white', tintOpacity: 0,
        shine: 0, rim: 0, reflection: 0, shadow: 0, saturation: 1, brightness: 1, contrast: 1, dim: 0,
      }),
    };
  });
  await waitForGlass(page, { count: 7 });
  const centers = await page.evaluate(() => ['retarget-icon', 'reference-icon'].map((id) => {
    const canvas = document.getElementById(id)!.nextElementSibling as HTMLCanvasElement;
    return Array.from(canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data);
  }));
  expect(centers[0][3]).toBeGreaterThan(245);
  for (let channel = 0; channel < 4; channel++) expect(Math.abs(centers[0][channel] - centers[1][channel])).toBeLessThan(5);
});


test('disabling a surface lets broad SVG selection discover its ordinary icons', async ({ page }) => {
  await openFixture(page, fixture);
  await waitForGlass(page, { count: 5 });
  await expect(page.locator('#plain-icon')).not.toHaveAttribute('data-glassity-hidden');
  await page.locator('#tabbar').evaluate((el) => el.setAttribute('data-glass', 'off'));
  await waitForGlass(page, { count: 6 });
  await expect(canvasOf(page, '#tabbar')).toHaveCount(0);
  await expect(page.locator('#tabbar')).not.toHaveAttribute('data-glassity-surface');
  await expect(page.locator('#plain-icon')).toHaveAttribute('data-glassity-hidden', '');
  await expect(page.locator('#plain-icon + canvas[data-glassity-canvas]')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('#tabbar svg[data-glassity-hidden]')).toHaveCount(3);
  await page.locator('#tabbar').evaluate((el) => el.setAttribute('data-glass', 'surface'));
  await waitForGlass(page, { count: 5 });
  await expect(page.locator('#plain-icon')).not.toHaveAttribute('data-glassity-hidden');
  await expect(canvasOf(page, '#tabbar')).toHaveCSS('visibility', 'visible');
});

test('without WebGL2 surfaces keep their original paint and working controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto(fixture);
  await page.waitForFunction(() => !!window.surfaceDemo && !!window.glassity);
  expect(await page.evaluate(() => window.glassity.isSupported())).toBe(false);
  await page.evaluate(() => window.surfaceDemo.controller.refresh());
  await expect(page.locator('canvas[data-glassity-canvas]')).toHaveCount(0);
  for (const selector of ['#pill', '#tabbar', '#photo-toolbar', '#flat-toolbar']) {
    await expect(page.locator(selector)).not.toHaveAttribute('data-glassity-surface-active');
    await expect(page.locator(selector)).toHaveCSS('opacity', '1');
  }
  await expect(page.locator('#pill')).toHaveCSS('background-color', 'rgb(220, 232, 216)');
  await expect(page.locator('#flat-toolbar')).toHaveCSS('background-color', 'rgb(232, 238, 234)');
  await page.locator('#pill-label').click();
  await page.locator('#copy-button').click();
  expect(await page.evaluate(() => window.surfaceDemo.clicks)).toBe(1);
  expect(await page.evaluate(() => window.surfaceDemo.copyClicks)).toBe(1);
  await expect(page.locator('#selectable-label')).toHaveText('Select this label');
  expect(errors).toEqual([]);
});
