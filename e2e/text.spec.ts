import { expect, test, type Page } from '@playwright/test';
import { glassSignature, glassStats, signatureDifference, waitForGlass } from './helpers';

declare global {
  interface Window {
    textGlassController?: import('../src/index').GlassController;
    textGlassHandles: Record<string, import('../src/index').GlassHandle>;
  }
}

const STILL = { accessibility: false, duration: 0, pointerLight: false, shadow: 0 } as const;

async function mount(page: Page, id: string): Promise<void> {
  await page.evaluate(({ id, options }) => {
    window.textGlassHandles[id] = window.glassity.glassify(document.getElementById(id)!, { ...options, text: true });
  }, { id, options: STILL });
  await drawn(page, id);
}

async function drawn(page: Page, id: string): Promise<void> {
  await expect(page.locator('#' + id)).toHaveAttribute('data-glassity-hidden', '');
  await expect(page.locator('#' + id + ' + canvas')).toHaveCSS('visibility', 'visible');
  await waitForGlass(page);
}

async function lines(page: Page, id: string): Promise<number> {
  return page.locator('#' + id).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top))).size;
  });
}

async function alpha(page: Page, id: string): Promise<number[]> {
  return page.locator('#' + id + ' + canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i * 4 + 3]);
  });
}

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Text shaping and mask pixels are checked in Chromium.');
  await page.goto('/e2e/fixtures/text.html?manual');
  await page.waitForFunction(() => !!window.glassity);
  expect(await page.evaluate(() => window.glassity.isSupported()), 'This suite needs real WebGL2 rendering').toBe(true);
});

test('auto renders text, wrapped headings and icon fonts without wrappers or backdrop options', async ({ page }) => {
  await page.evaluate((options) => {
    window.textGlassController = window.glassity.auto(options);
  }, STILL);
  for (const id of ['wordmark', 'wrapped', 'ligature', 'direct-glyph', 'tile-glyph', 'small']) {
    await drawn(page, id);
    const stats = await glassStats(page, '#' + id);
    expect(stats.coverage, id + ' has a nonempty glyph mask').toBeGreaterThan(0.01);
    expect(stats.coverage, id + ' does not become a solid rectangle').toBeLessThan(0.8);
  }
  expect(await lines(page, 'wrapped')).toBe(2);
  await expect(page.locator('#wordmark')).toHaveCSS('opacity', '0');
  await expect(page.locator('#wordmark + canvas')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#wordmark + canvas')).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.hero > #wordmark')).toHaveCount(1);
  await expect(page.locator('#manual + canvas')).toHaveCount(0);
});

test('glass text remains available to getByText, the accessibility tree and selection', async ({ page }) => {
  await mount(page, 'wordmark');
  await expect(page.getByText('glassity', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'glassity', level: 1 })).toHaveCount(1);
  await expect(page.locator('#wordmark')).not.toHaveAttribute('aria-hidden');

  const selected = await page.locator('#wordmark').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selected).toBe('glassity');
  await page.evaluate(() => getSelection()?.removeAllRanges());

  // A real drag also reaches the original text through the pointer-transparent canvas.
  const box = (await page.locator('#wordmark').boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection()?.toString())).toContain('glassity');
});

test('textContent and characterData mutations replace the rendered mask', async ({ page }) => {
  await mount(page, 'manual');
  await expect(page.locator('#manual')).not.toHaveAttribute('data-glass');
  const original = await alpha(page, 'manual');

  await page.locator('#manual').evaluate((element) => { element.textContent = 'WWWW'; });
  await expect.poll(() => alpha(page, 'manual')).not.toEqual(original);
  await drawn(page, 'manual');
  const replaced = await alpha(page, 'manual');

  await page.locator('#manual').evaluate((element) => { (element.firstChild as Text).data = 'iiii'; });
  await expect.poll(() => alpha(page, 'manual')).not.toEqual(replaced);
  await drawn(page, 'manual');
  await expect(page.getByText('iiii', { exact: true })).toHaveCount(1);
});

test('changing wrap width, font size and letter spacing updates the glass', async ({ page }) => {
  await mount(page, 'wrapped');
  expect(await lines(page, 'wrapped')).toBe(2);
  const original = await alpha(page, 'wrapped');
  await page.locator('#wrapped').evaluate((element) => { (element as HTMLElement).style.width = '240px'; });
  await expect.poll(() => lines(page, 'wrapped')).toBeGreaterThan(2);
  await expect.poll(() => alpha(page, 'wrapped')).not.toEqual(original);
  await drawn(page, 'wrapped');
  const wrapped = await alpha(page, 'wrapped');
  await page.locator('#wrapped').evaluate((element) => {
    (element as HTMLElement).style.fontSize = '36px';
    (element as HTMLElement).style.letterSpacing = '3px';
  });
  await expect.poll(() => alpha(page, 'wrapped')).not.toEqual(wrapped);
  await drawn(page, 'wrapped');
});

test('a local icon-font ligature has exactly the direct glyph mask', async ({ page }) => {
  await mount(page, 'ligature');
  await mount(page, 'direct-glyph');
  expect(await page.evaluate(() => document.fonts.check('64px "Glassity Test Icons"', 'home'))).toBe(true);
  const ligature = await alpha(page, 'ligature');
  const direct = await alpha(page, 'direct-glyph');
  expect(ligature.length).toBe(direct.length);
  const difference = ligature.reduce((sum, value, i) => sum + Math.abs(value - direct[i]), 0) / ligature.length;
  expect(difference, 'home must shape into the same house as U+E000, not fallback letters').toBeLessThan(0.1);
  expect(ligature.filter((value) => value > 128).length).toBeGreaterThan(500);

  // Disabling liga leaves four narrow stems in this purpose-built font.
  await page.locator('#ligature').evaluate((element) => {
    (element as HTMLElement).style.fontFeatureSettings = '"liga" 0';
    (element as HTMLElement).style.fontVariantLigatures = 'none';
  });
  await expect.poll(() => alpha(page, 'ligature')).not.toEqual(ligature);
});

test('initial font loading leaves the original visible and later font loading rerasterizes', async ({ page }) => {
  let release: () => void = () => {};
  let requested: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const request = new Promise<void>((resolve) => { requested = resolve; });
  await page.route('**/text-icons.ttf?delayed=1', async (route) => {
    requested();
    await gate;
    await route.continue();
  });

  await mount(page, 'manual');
  const before = await alpha(page, 'manual');
  try {
    await page.evaluate((options) => {
      const sheet = document.createElement('style');
      sheet.textContent = '@font-face{font-family:"Delayed Text Icons";src:url("/e2e/fixtures/text-icons.ttf?delayed=1") format("truetype");font-display:swap}';
      document.head.append(sheet);
      const existing = document.getElementById('manual')!;
      existing.textContent = 'home';
      existing.style.font = '64px/80px "Delayed Text Icons"';
      const fresh = document.createElement('span');
      fresh.id = 'delayed';
      fresh.textContent = 'home';
      fresh.style.cssText = 'display:block;width:80px;height:80px;font:64px/80px "Delayed Text Icons"';
      document.querySelector('.toolbar')!.prepend(fresh);
      window.textGlassHandles.delayed = window.glassity.glassify(fresh, { ...options, text: true });
    }, STILL);
    await request;
    await expect(page.locator('#delayed')).not.toHaveAttribute('data-glassity-hidden');
    await expect(page.locator('#delayed')).toHaveCSS('opacity', '1');
    release();
    await drawn(page, 'delayed');
    await drawn(page, 'manual');
    await expect.poll(() => alpha(page, 'manual')).not.toEqual(before);
    expect(await page.evaluate(() => document.fonts.check('64px "Delayed Text Icons"', 'home'))).toBe(true);
    expect((await glassStats(page, '#delayed')).coverage).toBeGreaterThan(0.1);
  } finally {
    release();
  }
});

test('small text uses the existing automatic legibility policy', async ({ page }) => {
  await mount(page, 'small');
  const readable = await glassSignature(page, '#small');
  await page.evaluate(() => window.textGlassHandles.small.update({ legibility: 'off' }));
  await waitForGlass(page);
  const uncorrected = await glassSignature(page, '#small');
  expect(signatureDifference(readable, uncorrected)).toBeGreaterThan(0.1);
});

test('RTL and inline styled text keep their content and redraw when direction changes', async ({ page }) => {
  await page.locator('#manual').evaluate((element) => {
    element.textContent = '';
    element.setAttribute('dir', 'rtl');
    const strong = document.createElement('strong');
    strong.textContent = 'مرحبا';
    element.append(strong, document.createTextNode(' 123'));
    (element as HTMLElement).style.width = '350px';
  });
  await mount(page, 'manual');
  await expect(page.getByText('مرحبا', { exact: true })).toHaveCount(1);
  const rtl = await alpha(page, 'manual');
  await page.locator('#manual').evaluate((element) => { element.setAttribute('dir', 'ltr'); });
  await expect.poll(() => alpha(page, 'manual')).not.toEqual(rtl);
  expect((await glassStats(page, '#manual')).coverage).toBeGreaterThan(0.01);
});

test('over-limit content restores the whole original and recovers when shortened', async ({ page }) => {
  await mount(page, 'manual');
  await page.locator('#manual').evaluate((element) => { element.textContent = 'a'.repeat(513); });
  await expect(page.locator('#manual')).not.toHaveAttribute('data-glassity-hidden');
  await expect(page.locator('#manual')).toHaveCSS('opacity', '1');
  await expect(page.locator('#manual + canvas')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#manual')).toHaveText('a'.repeat(513));

  await page.locator('#manual').evaluate((element) => { element.textContent = 'Short again'; });
  await drawn(page, 'manual');

  await page.locator('#manual').evaluate((element) => {
    (element as HTMLElement).style.whiteSpace = 'pre';
    element.textContent = Array.from({ length: 9 }, (_, i) => 'Line ' + i).join('\n');
  });
  await expect(page.locator('#manual')).not.toHaveAttribute('data-glassity-hidden');
  await expect(page.locator('#manual + canvas')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#manual')).toContainText('Line 8');
});

test('destroy restores source styling and removes its canvas', async ({ page }) => {
  const style = await page.locator('#manual').getAttribute('style');
  await mount(page, 'manual');
  await page.evaluate(() => window.textGlassHandles.manual.destroy());
  await expect(page.locator('#manual + canvas')).toHaveCount(0);
  await expect(page.locator('#manual')).toHaveCSS('opacity', '1');
  await expect(page.locator('#manual')).not.toHaveAttribute('data-glassity-hidden');
  expect(await page.locator('#manual').getAttribute('style')).toBe(style);
  await expect(page.getByText('Plain until glassify()', { exact: true })).toHaveCount(1);
});

test('controller and page text defaults rescan existing matches', async ({ page }) => {
  await page.evaluate((options) => {
    window.textGlassController = window.glassity.auto({ ...options, selector: '#manual' });
  }, STILL);
  await expect(page.locator('#manual + canvas')).toHaveCount(0);
  await page.evaluate(() => window.textGlassController!.update({ text: true }));
  await drawn(page, 'manual');
  await page.evaluate(() => window.textGlassController!.set({ text: false }));
  await expect(page.locator('#manual + canvas')).toHaveCount(0);
  await page.evaluate((options) => {
    window.textGlassController!.set(options);
    window.glassity.configure({ text: true });
  }, STILL);
  await drawn(page, 'manual');
});

test('retargeting text preserves the new DOM and discards the previous mask', async ({ page }) => {
  await mount(page, 'manual');
  await page.evaluate(() => window.textGlassHandles.manual.retarget(document.getElementById('wordmark')!));
  await drawn(page, 'wordmark');
  await expect(page.locator('#manual')).not.toHaveAttribute('data-glassity-hidden');
  await expect(page.locator('#manual + canvas')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'glassity', level: 1 })).toHaveCount(1);
});

test('scaled text keeps its glyph density and canvas aligned', async ({ page }) => {
  await page.locator('#manual').evaluate((element) => {
    element.textContent = 'Scaled';
    element.parentElement!.style.transform = 'scale(0.8)';
    element.parentElement!.style.transformOrigin = 'top left';
    (element as HTMLElement).style.transform = 'scale(1.25)';
    (element as HTMLElement).style.transformOrigin = 'top left';
  });
  await mount(page, 'manual');
  const boxes = await page.locator('#manual').evaluate((element) => {
    const text = element.getBoundingClientRect();
    const canvas = element.nextElementSibling!.getBoundingClientRect();
    return {
      dx: text.left + text.width / 2 - canvas.left - canvas.width / 2,
      dy: text.top + text.height / 2 - canvas.top - canvas.height / 2,
      excessWidth: canvas.width - text.width,
      excessHeight: canvas.height - text.height,
    };
  });
  expect(Math.abs(boxes.dx)).toBeLessThan(1);
  expect(Math.abs(boxes.dy)).toBeLessThan(1);
  expect(Math.abs(boxes.excessWidth - boxes.excessHeight)).toBeLessThan(1);
  expect((await glassStats(page, '#manual')).coverage).toBeGreaterThan(0.01);
});

test('inherited language controls text transformation in the mask', async ({ page }) => {
  await page.locator('#manual').evaluate((element) => {
    element.parentElement!.setAttribute('lang', 'tr');
    element.textContent = 'i';
    (element as HTMLElement).style.textTransform = 'uppercase';
  });
  await mount(page, 'manual');
  const localized = await alpha(page, 'manual');
  await page.locator('#manual').evaluate((element) => { element.textContent = 'İ'; });
  await drawn(page, 'manual');
  await expect.poll(() => alpha(page, 'manual')).toEqual(localized);
});


test('empty and display-none text clears the old glass and can return', async ({ page }) => {
  await mount(page, 'manual');
  await page.locator('#manual').evaluate((element) => { element.textContent = ''; });
  await expect(page.locator('#manual + canvas')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#manual')).not.toHaveAttribute('data-glassity-hidden');
  await page.locator('#manual').evaluate((element) => { element.textContent = 'Back again'; });
  await drawn(page, 'manual');
  await page.locator('#manual').evaluate((element) => { (element as HTMLElement).style.display = 'none'; });
  await expect(page.locator('#manual + canvas')).toHaveCSS('visibility', 'hidden');
  await page.locator('#manual').evaluate((element) => { (element as HTMLElement).style.removeProperty('display'); });
  await drawn(page, 'manual');
});
