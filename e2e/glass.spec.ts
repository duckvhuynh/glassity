import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    glassity: typeof import('../src/index');
    controller: import('../src/index').GlassController;
    handle: import('../src/index').GlassHandle;
  }
}

/** Options that switch every visible effect off: the glass should then show the page exactly as it is. */
const FLAT = {
  accessibility: false,
  refraction: 0,
  curvature: 0,
  dispersion: 0,
  frost: 0,
  tint: '#ffffff',
  tintOpacity: 0,
  dim: 0,
  saturation: 1,
  contrast: 1,
  brightness: 1,
  shine: 0,
  rim: 0,
  reflection: 0,
  shadow: 0,
  scheme: 'dark',
  pointerLight: false,
  duration: 0,
} as const;

const CANVAS = 'canvas[data-glassity-canvas]';

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/e2e/fixtures/basic.html');
  await page.waitForFunction(() => !!window.glassity);
  return errors;
}

/** Wait until `count` glass canvases exist and all of them have been drawn. */
async function drawn(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    ({ selector, count }) => {
      const all = [...document.querySelectorAll<HTMLCanvasElement>(selector)];
      return all.length === count && all.every((canvas) => canvas.style.visibility === 'visible');
    },
    { selector: CANVAS, count },
  );
}

/** Let the backdrop snapshot land and two frames pass. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(450);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function shot(page: Page, selector: string): Promise<string> {
  const box = (await page.locator(selector).boundingBox())!;
  const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) };
  return (await page.screenshot({ clip })).toString('base64');
}

/** Compare two screenshots: mean channel difference (0–255) and the share of clearly different pixels. */
async function difference(page: Page, a: string, b: string): Promise<{ mean: number; changed: number }> {
  return page.evaluate(
    async ([first, second]) => {
      const read = async (data: string) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + data;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [x, y] = await Promise.all([read(first), read(second)]);
      let sum = 0;
      let changed = 0;
      const pixels = Math.min(x.length, y.length) / 4;
      for (let i = 0; i < pixels; i++) {
        const d = Math.max(Math.abs(x[i * 4] - y[i * 4]), Math.abs(x[i * 4 + 1] - y[i * 4 + 1]), Math.abs(x[i * 4 + 2] - y[i * 4 + 2]));
        sum += d;
        if (d > 32) changed++;
      }
      return { mean: sum / pixels, changed: changed / pixels };
    },
    [a, b],
  );
}

/** Share of a glass canvas that is covered by the icon. */
async function coverage(page: Page, svg: string): Promise<number> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector)!.nextElementSibling as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let covered = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 128) covered++;
    return covered / (data.length / 4);
  }, svg);
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto('/e2e/fixtures/basic.html');
  await page.waitForFunction(() => !!window.glassity);
  const supported = await page.evaluate(() => window.glassity.isSupported());
  testInfo.annotations.push({ type: 'webgl2', description: String(supported) });
  const needsWebgl = !testInfo.title.includes('without WebGL2');
  // CI sets REQUIRE_WEBGL2 so a browser without WebGL2 fails loudly instead of skipping every real test.
  if (process.env.REQUIRE_WEBGL2 && needsWebgl) expect(supported, 'WebGL2 must be available in this browser').toBe(true);
  test.skip(!supported && needsWebgl, 'This browser build has no WebGL2; only the fallback applies.');
});

test('turns marked icons into glass and keeps them accessible', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    window.controller = window.glassity.auto({ accessibility: false, duration: 0 });
  });
  await drawn(page, 3);

  // The original SVG is still there for assistive technology and clicks, just not painted.
  await expect(page.locator('#a')).toHaveCSS('opacity', '0');
  await expect(page.getByRole('img', { name: 'Calendar' })).toHaveCount(1);
  const canvas = page.locator('#a + canvas');
  await expect(canvas).toHaveAttribute('aria-hidden', 'true');
  await expect(canvas).toHaveCSS('pointer-events', 'none');

  // The stroke icon covers some of its canvas, not none and not all of it.
  const share = await coverage(page, '#a');
  expect(share).toBeGreaterThan(0.03);
  expect(share).toBeLessThan(0.5);
  // A tile fills most of the icon box.
  expect(await coverage(page, '#t')).toBeGreaterThan(0.4);

  // data-glass="off" opts out.
  await expect(page.locator('#b')).toHaveCSS('opacity', '1');
  await expect(page.locator('#b + canvas')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('with every effect off, glass over a CSS background shows the page unchanged', async ({ page }) => {
  await open(page);
  await page.evaluate((flat) => {
    window.controller = window.glassity.auto(flat);
  }, FLAT);
  await drawn(page, 3);
  await settle(page);
  const through = await shot(page, '#a');

  await page.evaluate(() => {
    window.controller.destroy();
    document.querySelector<SVGElement>('#a')!.style.opacity = '0';
  });
  const bare = await shot(page, '#a');

  const { mean, changed } = await difference(page, through, bare);
  expect(mean).toBeLessThan(2.5);
  expect(changed).toBeLessThan(0.02);
});

test('refraction bends the backdrop inside the icon', async ({ page }) => {
  await open(page);
  await page.evaluate((flat) => {
    window.controller = window.glassity.auto(flat);
  }, FLAT);
  await drawn(page, 3);
  await settle(page);
  const flat = await shot(page, '#a');

  await page.evaluate(() => window.controller.update({ refraction: 1, curvature: 1, depth: 0.3 }));
  await settle(page);
  const bent = await shot(page, '#a');

  const { changed } = await difference(page, flat, bent);
  expect(changed).toBeGreaterThan(0.02);
});

test('with every effect off, glass over HTML content shows that content unchanged', async ({ page }) => {
  await open(page);
  await page.evaluate((flat) => {
    window.controller = window.glassity.auto(flat);
  }, FLAT);
  await drawn(page, 3);
  await settle(page);
  const through = await shot(page, '#c');

  await page.evaluate(() => {
    window.controller.destroy();
    document.querySelector<SVGElement>('#c')!.style.opacity = '0';
  });
  const bare = await shot(page, '#c');

  // Text is rasterized twice (page and snapshot), so allow a little more than for a plain background.
  const { mean, changed } = await difference(page, through, bare);
  expect(mean).toBeLessThan(4);
  expect(changed).toBeLessThan(0.04);
});

test('follows the page as icons are added, removed and opted out', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    window.controller = window.glassity.auto({ accessibility: false, duration: 0 });
  });
  await drawn(page, 3);

  await page.evaluate(() => {
    const extra = document.querySelector('#a')!.cloneNode(true) as SVGElement;
    extra.id = 'extra';
    document.querySelector('#wall')!.append(extra);
  });
  await drawn(page, 4);

  await page.evaluate(() => document.querySelector('#extra')!.remove());
  await drawn(page, 3);

  await page.evaluate(() => document.querySelector('#a')!.setAttribute('data-glass', 'off'));
  await drawn(page, 2);
  await expect(page.locator('#a')).toHaveCSS('opacity', '1');

  await page.evaluate(() => window.controller.destroy());
  await expect(page.locator(CANVAS)).toHaveCount(0);
  await expect(page.locator('#c')).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});

test('glassify handles one icon: update, hide, morph, destroy', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    window.handle = window.glassity.glassify(document.querySelector('#a')!, { accessibility: false, duration: 120 });
  });
  await drawn(page, 1);
  await settle(page);
  const calendar = await shot(page, '#a');

  // Replacing the outline in place morphs to the new shape.
  await page.evaluate(() => {
    document.querySelector('#a')!.innerHTML = '<circle cx="12" cy="12" r="9"></circle>';
  });
  await page.waitForTimeout(500);
  await settle(page);
  const circle = await shot(page, '#a');
  expect((await difference(page, calendar, circle)).changed).toBeGreaterThan(0.03);

  await page.evaluate(() => window.handle.update({ visible: false, duration: 0 }));
  await expect(page.locator('#a + canvas')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#a')).toHaveCSS('opacity', '0');

  await page.evaluate(() => window.handle.destroy());
  await expect(page.locator(CANVAS)).toHaveCount(0);
  await expect(page.locator('#a')).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});

test('weight makes a stroked icon bolder, and a filled one too', async ({ page }) => {
  const errors = await open(page);
  const covered = async (weight: number) => {
    await page.evaluate((w) => {
      window.handle?.destroy();
      window.handle = window.glassity.glassify(document.querySelector('#a')!, { accessibility: false, duration: 0, shadow: 0, weight: w });
    }, weight);
    await drawn(page, 1);
    await settle(page);
    return coverage(page, '#a');
  };
  const thin = await covered(0);
  const bold = await covered(0.05);
  expect(bold).toBeGreaterThan(thin * 1.3);

  await page.evaluate(() => {
    document.querySelector('#a')!.innerHTML = '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"></circle>';
  });
  const dot = await covered(0);
  const bigDot = await covered(0.05);
  expect(bigDot).toBeGreaterThan(dot * 1.2);
  expect(errors).toEqual([]);
});

test('a dome lens draws a different picture than a plain round tile', async ({ page }) => {
  const errors = await open(page);
  const look = async (profile: string) => {
    await page.evaluate((p) => {
      window.handle?.destroy();
      window.handle = window.glassity.glassify(document.querySelector('#a')!, {
        accessibility: false,
        duration: 0,
        tile: true,
        tileRadius: 0.5,
        profile: p as 'dome',
        depth: 0.8,
      });
    }, profile);
    await drawn(page, 1);
    await settle(page);
    return shot(page, '#a');
  };
  const round = await look('circle');
  const dome = await look('dome');
  expect((await difference(page, round, dome)).changed).toBeGreaterThan(0.02);
  expect(errors).toEqual([]);
});

test('pressing an interactive icon makes it swell and settle back', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.controller = window.glassity.auto({ accessibility: false, duration: 0 });
  });
  await drawn(page, 3);
  const canvas = page.locator('#t + canvas');
  const box = (await page.locator('#press').boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(async () => canvas.evaluate((el) => (el as HTMLElement).style.transform)).toContain('scale(1.0');
  await page.mouse.up();
  await expect.poll(async () => canvas.evaluate((el) => (el as HTMLElement).style.transform), { timeout: 5000 }).toBe('');
});

test.describe('system settings', () => {
  test.use({ forcedColors: 'active' });

  test('forced colours leave the plain SVG in place', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      window.controller = window.glassity.auto();
    });
    await page.waitForTimeout(400);
    await expect(page.locator('#a')).toHaveCSS('opacity', '1');
    const visible = await page.locator(CANVAS).evaluateAll((all) => all.filter((canvas) => (canvas as HTMLElement).style.visibility === 'visible').length);
    expect(visible).toBe(0);
  });

  test('forced colours win even with accessibility: false', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      window.controller = window.glassity.auto({ accessibility: false });
    });
    await page.waitForTimeout(400);
    await expect(page.locator('#a')).toHaveCSS('opacity', '1');
    const visible = await page.locator(CANVAS).evaluateAll((all) => all.filter((canvas) => (canvas as HTMLElement).style.visibility === 'visible').length);
    expect(visible).toBe(0);
  });
});

test('without WebGL2 the icon stays a plain SVG with a highlight', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  const errors = await open(page);
  const supported = await page.evaluate(() => {
    window.controller = window.glassity.auto();
    return window.glassity.isSupported();
  });
  expect(supported).toBe(false);
  await expect(page.locator('#a')).toHaveCSS('opacity', '1');
  await expect(page.locator('#a')).toHaveAttribute('filter', /url\(#glassity-bevel-/);
  await expect(page.locator(CANVAS)).toHaveCount(0);

  // The controller owns its plain stand-ins too: destroying it removes the highlight,
  // and the icons can be picked up again afterwards.
  await page.evaluate(() => window.controller.destroy());
  await expect(page.locator('#a')).not.toHaveAttribute('filter', /glassity-bevel/);
  await page.evaluate(() => {
    window.controller = window.glassity.auto();
  });
  await expect(page.locator('#a')).toHaveAttribute('filter', /url\(#glassity-bevel-/);

  // A single handle: destroy, then glassify the same icon again.
  await page.evaluate(() => {
    window.controller.destroy();
    const svg = document.querySelector<SVGSVGElement>('#a')!;
    window.glassity.glassify(svg).destroy();
    window.handle = window.glassity.glassify(svg);
  });
  await expect(page.locator('#a')).toHaveAttribute('filter', /url\(#glassity-bevel-/);
  expect(errors).toEqual([]);
});

test('glass follows an icon that layout moves without any event', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.controller = window.glassity.auto({ accessibility: false, duration: 0, pointerLight: false });
  });
  await drawn(page, 3);
  await settle(page);

  /** Distance between the centre of the icon and the centre of its glass. */
  const drift = () =>
    page.evaluate(() => {
      const svg = document.querySelector('#a')!.getBoundingClientRect();
      const canvas = document.querySelector('#a + canvas')!.getBoundingClientRect();
      return Math.hypot(svg.left + svg.width / 2 - (canvas.left + canvas.width / 2), svg.top + svg.height / 2 - (canvas.top + canvas.height / 2));
    });
  expect(await drift()).toBeLessThan(1);

  // A sibling appears and pushes the icon aside: no scroll, no resize, nothing glassity listens to.
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.cssText = 'flex:none;width:57px;height:10px';
    document.querySelector('#wall')!.prepend(spacer);
  });
  await page.waitForTimeout(700);
  expect(await drift()).toBeLessThan(1);
});
