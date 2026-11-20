import { expect, test, type Page } from '@playwright/test';
import type { GlassOptions } from '../src/options';

declare global {
  interface Window {
    glassity: typeof import('../src/index');
    legibilityHandles: Record<string, import('../src/index').GlassHandle>;
  }
}

type RGB = [number, number, number];
const SURFACES: Record<string, RGB> = { white: [255, 255, 255], dark: [31, 31, 31], lime: [200, 230, 58] };
const STILL = { accessibility: false, duration: 0, pointerLight: false } as const;
const UNLIT = { refraction: 0, curvature: 0, dispersion: 0, frost: 0, saturation: 1, brightness: 1, contrast: 1, shine: 0, rim: 0, reflection: 0, shadow: 0, dim: 0 } as const;

async function settle(page: Page): Promise<void> {
  // Allow the snapshot debounce and the legibility transition to finish.
  await page.waitForTimeout(800);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function update(page: Page, id: string, options: Omit<GlassOptions, 'backdrop'> & { backdrop?: string }): Promise<void> {
  await page.evaluate(({ id, options }) => window.legibilityHandles[id].update(options), { id, options });
  await settle(page);
}

async function pixels(page: Page, id: string): Promise<number[]> {
  return page.evaluate((id) => {
    const canvas = document.getElementById(id)!.nextElementSibling as HTMLCanvasElement;
    return Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data);
  }, id);
}

function meanDifference(a: number[], b: number[]): number {
  expect(a.length).toBe(b.length);
  return a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
}

/** Sample known stroke centre lines, rather than selecting the darkest pixels. */
async function core(page: Page, id: string, surface: RGB, padding = 0): Promise<{ contrast: number; rgb: RGB; alpha: number }> {
  return page.evaluate(({ id, surface, padding }) => {
    const svg = document.getElementById(id)!;
    const canvas = svg.nextElementSibling as HTMLCanvasElement;
    const box = svg.getBoundingClientRect();
    const bounds = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d')!;
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const scale = canvas.width / bounds.width;
    const inset = Math.min(box.width, box.height) * padding;
    const values: number[][] = [];
    const alphas: number[] = [];
    for (const y of [6, 12, 18]) {
      for (const x of [7, 10, 12, 14, 17]) {
        const px = Math.round((box.left - bounds.left + inset + x / 24 * (box.width - inset * 2)) * scale - 0.5);
        const py = Math.round((box.top - bounds.top + inset + y / 24 * (box.height - inset * 2)) * scale - 0.5);
        const offset = (py * canvas.width + px) * 4;
        const alpha = rgba[offset + 3] / 255;
        alphas.push(alpha);
        values.push(surface.map((background, channel) => rgba[offset + channel] * alpha + background * (1 - alpha)));
      }
    }
    const luminance = (rgb: number[]) => rgb.map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const background = luminance(surface);
    const contrasts = values.map((rgb) => {
      const foreground = luminance(rgb);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    }).sort((a, b) => a - b);
    return {
      contrast: contrasts[Math.floor(contrasts.length / 2)],
      rgb: [0, 1, 2].map((channel) => values.reduce((sum, rgb) => sum + rgb[channel], 0) / values.length) as RGB,
      alpha: alphas.reduce((sum, alpha) => sum + alpha, 0) / alphas.length,
    };
  }, { id, surface, padding });
}

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Pixel thresholds are checked in Chromium.');
  await page.goto('/e2e/fixtures/legibility.html');
  await page.waitForFunction(() => !!window.glassity && !!document.getElementById('changing'));
  expect(await page.evaluate(() => window.glassity.isSupported()), 'This regression suite needs real WebGL2 rendering').toBe(true);
  await page.evaluate((options) => {
    window.legibilityHandles = {};
    for (const svg of document.querySelectorAll<SVGSVGElement>('svg[data-glass]')) {
      window.legibilityHandles[svg.id] = window.glassity.glassify(svg, options);
    }
  }, STILL);
  await page.waitForFunction(() => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-glassity-canvas]')];
    return canvases.length === 11 && canvases.every((canvas) => canvas.style.visibility === 'visible');
  });
  await settle(page);
});

test('default 16, 20 and 24 px stroke cores contrast against white, dark and lime surfaces', async ({ page }) => {
  for (const [name, surface] of Object.entries(SURFACES)) {
    for (const size of [16, 20, 24]) {
      const sample = await core(page, name + '-' + size, surface);
      expect(sample.alpha, name + ' ' + size + ' px stroke coverage').toBeGreaterThan(0.65);
      expect(sample.contrast, name + ' ' + size + ' px core contrast').toBeGreaterThanOrEqual(3);
    }
  }
});

test('explicit CSS tints bypass automatic legibility on every surface', async ({ page }) => {
  for (const name of Object.keys(SURFACES)) {
    const id = name + '-20';
    await update(page, id, { tint: '#e74b83', tintOpacity: 0.61, legibility: 'off' });
    const explicit = await pixels(page, id);
    await update(page, id, { legibility: 'auto' });
    expect(meanDifference(explicit, await pixels(page, id)), name + ' explicit tint').toBe(0);
  }
});

test('off restores the previous automatic glass and preserves light-page ink', async ({ page }) => {
  await update(page, 'lime-20', { legibility: 'off' });
  const oldPixels = await pixels(page, 'lime-20');
  const oldCore = await core(page, 'lime-20', SURFACES.lime);
  await update(page, 'lime-20', { legibility: 'auto' });
  const readable = await core(page, 'lime-20', SURFACES.lime);
  expect(readable.contrast).toBeGreaterThan(oldCore.contrast + 1);
  expect(meanDifference(oldPixels, await pixels(page, 'lime-20'))).toBeGreaterThan(2);
  await update(page, 'lime-20', { legibility: 'off' });
  expect(meanDifference(oldPixels, await pixels(page, 'lime-20'))).toBe(0);

  const light = await pixels(page, 'white-20');
  await update(page, 'white-20', { legibility: 'off' });
  expect(meanDifference(light, await pixels(page, 'white-20'))).toBe(0);
});

test('currentColor follows inline colour and inherited class changes without refresh', async ({ page }) => {
  await update(page, 'changing', { ...UNLIT, tint: 'currentColor', tintOpacity: 0.85 });
  await page.locator('#changing').evaluate((svg) => { (svg as SVGElement).style.color = 'rgb(230, 30, 40)'; });
  await expect.poll(async () => {
    const { rgb } = await core(page, 'changing', SURFACES.dark);
    return rgb[0] - rgb[2];
  }).toBeGreaterThan(100);
  await page.locator('#changing').evaluate((svg) => { (svg as SVGElement).style.color = 'rgb(30, 70, 230)'; });
  await expect.poll(async () => {
    const { rgb } = await core(page, 'changing', SURFACES.dark);
    return rgb[2] - rgb[0];
  }).toBeGreaterThan(100);
  await page.evaluate(() => {
    (document.getElementById('changing') as unknown as SVGElement).style.removeProperty('color');
    document.getElementById('state')!.classList.add('green');
  });
  await expect.poll(async () => {
    const { rgb } = await core(page, 'changing', SURFACES.dark);
    return rgb[1] - rgb[0];
  }).toBeGreaterThan(100);
  await settle(page);
  const explicit = await pixels(page, 'changing');
  await update(page, 'changing', { legibility: 'off' });
  expect(meanDifference(explicit, await pixels(page, 'changing'))).toBe(0);
});

test('auto follows active-state surface and colour changes without refresh', async ({ page }) => {
  const dark = await core(page, 'changing', SURFACES.dark);
  expect(dark.contrast).toBeGreaterThanOrEqual(3);
  await page.locator('#state').evaluate((host) => host.setAttribute('data-active', 'true'));
  await expect.poll(async () => (await core(page, 'changing', SURFACES.lime)).contrast).toBeGreaterThanOrEqual(3);
  await settle(page);
  const lime = await core(page, 'changing', SURFACES.lime);
  expect(lime.rgb[0]).toBeLessThan(dark.rgb[0] - 50);
  await page.locator('#state').evaluate((host) => host.removeAttribute('data-active'));
  await expect.poll(async () => (await core(page, 'changing', SURFACES.dark)).rgb[0]).toBeGreaterThan(dark.rgb[0] - 8);
});

test('a translucent CSS colour produces a dimmer automatic glyph', async ({ page }) => {
  await update(page, 'changing', UNLIT);
  const opaque = await core(page, 'changing', SURFACES.dark);
  await page.locator('#changing').evaluate((svg) => { (svg as SVGElement).style.color = 'rgba(244, 244, 244, 0.4)'; });
  await expect.poll(async () => (await core(page, 'changing', SURFACES.dark)).rgb[0]).toBeLessThan(opaque.rgb[0] - 15);
});

test('a 48 px tile treats its padded 27 px glyph as small without tinting the plate', async ({ page }) => {
  const readable = await core(page, 'tile', SURFACES.lime, 0.22);
  const plate = () => page.evaluate(() => {
    const svg = document.getElementById('tile')!.getBoundingClientRect();
    const canvas = document.getElementById('tile')!.nextElementSibling as HTMLCanvasElement;
    const bounds = canvas.getBoundingClientRect();
    const scale = canvas.width / bounds.width;
    return Array.from(canvas.getContext('2d')!.getImageData(Math.round((svg.left - bounds.left + 24) * scale), Math.round((svg.top - bounds.top + 7) * scale), 1, 1).data);
  });
  const plateBefore = await plate();
  await update(page, 'tile', { legibility: 'off' });
  const old = await core(page, 'tile', SURFACES.lime, 0.22);
  expect(readable.contrast).toBeGreaterThan(old.contrast + 0.5);
  expect(await plate()).toEqual(plateBefore);

  await update(page, 'tile', { legibility: 'auto', padding: 0 });
  const large = await pixels(page, 'tile');
  await update(page, 'tile', { legibility: 'off' });
  expect(meanDifference(large, await pixels(page, 'tile'))).toBe(0);
});

test('a button hover updates its icon when the pointer lands directly on the SVG stroke', async ({ page }) => {
  await page.locator('#state').evaluate((host) => {
    host.setAttribute('role', 'button');
    host.classList.add('hover-test');
  });
  await settle(page);
  const dark = await core(page, 'changing', SURFACES.dark);

  await page.locator('#changing path').hover();
  await expect(page.locator('#state')).toHaveCSS('background-color', 'rgb(200, 230, 58)');
  await expect.poll(async () => (await core(page, 'changing', SURFACES.lime)).rgb[0]).toBeLessThan(dark.rgb[0] - 50);
  await expect.poll(async () => (await core(page, 'changing', SURFACES.lime)).contrast).toBeGreaterThanOrEqual(3);

  await page.mouse.move(0, 0);
  await expect.poll(async () => (await core(page, 'changing', SURFACES.dark)).rgb[0]).toBeGreaterThan(dark.rgb[0] - 8);
});

test('an unrelated sibling animation does not repeatedly read icon computed styles', async ({ page }) => {
  await page.evaluate(() => {
    const sibling = document.createElement('div');
    sibling.id = 'unrelated';
    sibling.style.cssText = 'position:absolute;left:650px;top:24px;width:30px;height:30px;background:coral';
    document.body.append(sibling);
  });
  await settle(page);

  const reads = await page.evaluate(async () => {
    const original = window.getComputedStyle;
    const sibling = document.getElementById('unrelated')!;
    let calls = 0;
    window.getComputedStyle = (element, pseudoElt) => {
      if (element instanceof SVGSVGElement && element.hasAttribute('data-glass')) calls++;
      return original.call(window, element, pseudoElt);
    };
    try {
      for (let frame = 0; frame < 24; frame++) {
        sibling.style.transform = 'translateY(' + frame + 'px)';
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
      return calls;
    } finally {
      window.getComputedStyle = original;
      sibling.remove();
    }
  });
  expect(reads).toBe(0);
});

test('legibility samples the passed live canvas backdrop instead of the white host', async ({ page }) => {
  await page.evaluate(() => {
    const host = document.getElementById('white')!.getBoundingClientRect();
    const source = document.createElement('canvas');
    source.id = 'live-backdrop';
    source.width = source.height = 32;
    source.style.cssText = 'position:absolute;pointer-events:none;opacity:0;left:' + (host.left + scrollX) + 'px;top:' + (host.top + scrollY) + 'px;width:' + host.width + 'px;height:' + host.height + 'px';
    const ctx = source.getContext('2d')!;
    ctx.fillStyle = '#1f1f1f';
    ctx.fillRect(0, 0, 32, 32);
    document.body.append(source);
    (document.getElementById('white-20') as unknown as SVGElement).style.color = '#f4f4f4';
    window.legibilityHandles['white-20'].update({ backdrop: source });
  });
  try {
    await settle(page);
    await expect(page.locator('#white')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const automatic = await core(page, 'white-20', SURFACES.dark);
    expect(automatic.contrast).toBeGreaterThanOrEqual(3);
    await update(page, 'white-20', { legibility: 'off' });
    const old = await core(page, 'white-20', SURFACES.dark);
    expect(automatic.rgb[0]).toBeGreaterThan(old.rgb[0] + 15);
    await update(page, 'white-20', { legibility: 'auto' });

    await page.evaluate(() => {
      const source = document.getElementById('live-backdrop') as HTMLCanvasElement;
      const ctx = source.getContext('2d')!;
      ctx.fillStyle = '#c8e63a';
      ctx.fillRect(0, 0, source.width, source.height);
      (document.getElementById('white-20') as unknown as SVGElement).style.color = '#1f2318';
    });
    await expect.poll(async () => (await core(page, 'white-20', SURFACES.lime)).rgb[0]).toBeLessThan(automatic.rgb[0] - 50);
    await expect.poll(async () => (await core(page, 'white-20', SURFACES.lime)).contrast).toBeGreaterThanOrEqual(3);
  } finally {
    await page.evaluate(() => {
      window.legibilityHandles['white-20'].update({ backdrop: 'auto' });
      (document.getElementById('white-20') as unknown as SVGElement).style.removeProperty('color');
      document.getElementById('live-backdrop')?.remove();
    });
  }
});
