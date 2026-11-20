import { expect, test, type Page } from '@playwright/test';
import type { Engine } from '../src/engine';
import type { Backdrop } from '../src/backdrop';
import type { BackTexture } from '../src/gl/renderer';

declare global {
  interface Window {
    glassity: typeof import('../src/index');
    controller: import('../src/index').GlassController;
    handle: import('../src/index').GlassHandle;
    gpu: {
      engine: Engine;
      gl: WebGL2RenderingContext;
      lose: WEBGL_lose_context | null;
      source: HTMLCanvasElement | null;
      attempts: number;
      failUploads: boolean;
      previous: BackTexture | null;
    };
  }
}

const ICONS = ['#a', '#t', '#c'];

async function drawn(page: Page, count: number): Promise<void> {
  await page.waitForFunction((count) => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-glassity-canvas]')];
    return canvases.length === count && canvases.every((canvas) => {
      if (canvas.style.visibility !== 'visible' || canvas.width < 2) return false;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 128) return true;
      return false;
    });
  }, count);
}

async function originals(page: Page): Promise<void> {
  for (const selector of ICONS) {
    await expect(page.locator(selector)).toHaveCSS('opacity', '1');
    await expect(page.locator(selector + ' + canvas')).toHaveCSS('visibility', 'hidden');
  }
}

async function mountAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.controller = window.glassity.auto({ accessibility: false, duration: 0, pointerLight: false, backdrop: 'none' });
  });
  await drawn(page, 3);
}

/** A real direct canvas backdrop, with upload failures injected at the WebGL boundary. */
async function mountMedia(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { gpu } = window;
    const source = document.createElement('canvas');
    source.width = source.height = 32;
    source.getContext('2d')!.fillStyle = '#e04020';
    source.getContext('2d')!.fillRect(0, 0, 32, 32);
    gpu.source = source;
    const original = gpu.gl.texImage2D;
    gpu.gl.texImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      if (args.length === 6 && args[5] === gpu.source) {
        gpu.attempts++;
        if (gpu.failUploads) throw new DOMException('Injected upload failure', 'SecurityError');
      }
      (original as (...args: unknown[]) => void).apply(this, args);
    } as typeof original;
    window.handle = window.glassity.glassify(document.querySelector('#a')!, {
      accessibility: false, duration: 0, pointerLight: false, backdrop: source,
    });
  });
  await drawn(page, 1);
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto('/e2e/fixtures/basic.html');
  await page.waitForFunction(() => !!window.glassity);
  const supported = await page.evaluate(() => window.glassity.isSupported());
  testInfo.annotations.push({ type: 'webgl2', description: String(supported) });
  if (process.env.REQUIRE_WEBGL2) expect(supported, 'WebGL2 must be available in this browser').toBe(true);
  test.skip(!supported, 'This browser build has no WebGL2.');
  await page.evaluate(() => {
    const key = Object.getOwnPropertySymbols(globalThis).find((key) => key.description?.startsWith('glassity.engine@'))!;
    const engine = (globalThis as unknown as Record<symbol, Engine>)[key];
    const gl = engine.renderer!.canvas.getContext('webgl2')!;
    window.gpu = { engine, gl, lose: gl.getExtension('WEBGL_lose_context'), source: null, attempts: 0, failUploads: false, previous: null };
  });
});

test('context loss shows every original and repeated restores redraw retained geometry', async ({ page }) => {
  test.skip(!await page.evaluate(() => !!window.gpu.lose), 'WEBGL_lose_context is unavailable.');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await mountAll(page);
  const bytes = await page.evaluate(() => window.gpu.engine.renderer!.textureBytes);
  expect(bytes).toBeGreaterThan(0);

  for (let cycle = 0; cycle < 2; cycle++) {
    await page.evaluate(() => window.gpu.lose!.loseContext());
    await expect.poll(() => page.evaluate(() => window.gpu.engine.renderer!.state)).toBe('lost');
    await originals(page);
    expect(await page.evaluate(() => window.gpu.engine.renderer!.textureBytes)).toBe(0);
    // Clearing the copies proves restoration performs real draws, not just unhiding old pixels.
    await page.evaluate(() => {
      for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-glassity-canvas]'))
        canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
      window.controller.refresh();
    });
    await originals(page);
    await page.evaluate(() => window.gpu.lose!.restoreContext());
    await expect.poll(() => page.evaluate(() => window.gpu.engine.renderer!.state)).toBe('ready');
    await drawn(page, 3);
    for (const selector of ICONS) await expect(page.locator(selector)).toHaveCSS('opacity', '0');
    expect(await page.evaluate(() => window.gpu.engine.renderer!.textureBytes)).toBe(bytes);
  }

  await page.evaluate(() => window.controller.destroy());
  await expect(page.locator('canvas[data-glassity-canvas]')).toHaveCount(0);
  expect(await page.evaluate(() => window.gpu.engine.renderer!.textureBytes)).toBe(0);
  expect(errors).toEqual([]);
});

for (const failure of ['program', 'geometry'] as const) {
  test('a ' + failure + ' failure during restoration leaves every original visible', async ({ page }) => {
    test.skip(!await page.evaluate(() => !!window.gpu.lose), 'WEBGL_lose_context is unavailable.');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await mountAll(page);
    await page.evaluate(() => window.gpu.lose!.loseContext());
    await expect.poll(() => page.evaluate(() => window.gpu.engine.renderer!.state)).toBe('lost');
    await originals(page);
    await page.evaluate((failure) => {
      const { gl, lose } = window.gpu;
      if (failure === 'program') gl.createShader = () => null;
      else {
        const original = gl.texImage2D;
        gl.texImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
          if (args[2] === gl.RG16F) throw new Error('Injected field upload failure');
          (original as (...args: unknown[]) => void).apply(this, args);
        } as typeof original;
      }
      lose!.restoreContext();
    }, failure);
    await expect.poll(() => page.evaluate(() => window.gpu.engine.renderer!.state)).toBe('failed');
    await originals(page);
    expect(await page.evaluate(() => window.gpu.engine.renderer!.textureBytes)).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('a draw error shows every original instead of copying an empty frame', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await mountAll(page);
  await page.evaluate(() => {
    const { gl, engine } = window.gpu;
    const original = gl.drawArrays;
    gl.drawArrays = function (this: WebGL2RenderingContext) {
      // A real WebGL validation error sets the error flag without throwing.
      original.call(this, gl.TRIANGLES, 0, -1);
    };
    engine.invalidate();
  });
  await expect.poll(() => page.evaluate(() => window.gpu.engine.renderer!.state)).toBe('failed');
  await originals(page);
  expect(await page.evaluate(() => window.gpu.engine.renderer!.textureBytes)).toBe(0);
  expect(errors).toEqual([]);
});

test('a failed replacement keeps the previous texture and refresh retries it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await mountMedia(page);
  const failure = await page.evaluate(() => {
    const { gpu, handle } = window;
    const backdrop = (handle as unknown as { backdrop: Backdrop }).backdrop;
    gpu.previous = gpu.engine.backTexture(backdrop).texture;
    const before = gpu.engine.renderer!.textureBytes;
    gpu.failUploads = true;
    gpu.source!.getContext('2d')!.fillStyle = '#20c040';
    gpu.source!.getContext('2d')!.fillRect(0, 0, 32, 32);
    backdrop.tick();
    const result = gpu.engine.backTexture(backdrop);
    return {
      retained: result.texture.texture === gpu.previous.texture,
      usable: gpu.gl.isTexture(gpu.previous.texture),
      neutral: result.neutral,
      before,
      after: gpu.engine.renderer!.textureBytes,
    };
  });
  expect(failure.retained).toBe(true);
  expect(failure.usable).toBe(true);
  expect(failure.neutral).toBe(false);
  expect(failure.after).toBe(failure.before);
  await drawn(page, 1);

  await page.evaluate(() => {
    window.gpu.failUploads = false;
    window.handle.refresh();
  });
  await expect.poll(() => page.evaluate(() => window.gpu.gl.isTexture(window.gpu.previous!.texture))).toBe(false);
  await drawn(page, 1);
  expect(await page.evaluate(() => window.gpu.engine.renderer!.textureBytes)).toBe(failure.before);
  await page.evaluate(() => window.handle.destroy());
  expect(await page.evaluate(() => window.gpu.engine.renderer!.textureBytes)).toBe(0);
  expect(errors).toEqual([]);
});

test('failed live backdrops back off and recover without another user action', async ({ page }) => {
  await mountMedia(page);
  const attempts = await page.evaluate(() => {
    const { gpu, handle } = window;
    const backdrop = (handle as unknown as { backdrop: Backdrop }).backdrop;
    gpu.failUploads = true;
    backdrop.tick();
    gpu.engine.backTexture(backdrop);
    const first = gpu.attempts;
    for (let i = 0; i < 20; i++) {
      backdrop.tick();
      gpu.engine.backTexture(backdrop);
    }
    gpu.previous = gpu.engine.backTexture(backdrop).texture;
    return { first, after: gpu.attempts };
  });
  expect(attempts.after).toBe(attempts.first);
  await page.evaluate(() => { window.gpu.failUploads = false; });
  await expect.poll(() => page.evaluate(() => window.gpu.attempts), { timeout: 10_000 }).toBeGreaterThan(attempts.after);
  await expect.poll(() => page.evaluate(() => window.gpu.gl.isTexture(window.gpu.previous!.texture))).toBe(false);
  await drawn(page, 1);
});

test('changing the backdrop source retries after an upload failure', async ({ page }) => {
  await mountMedia(page);
  const result = await page.evaluate(() => {
    const { gpu, handle } = window;
    const oldBackdrop = (handle as unknown as { backdrop: Backdrop }).backdrop;
    gpu.failUploads = true;
    oldBackdrop.tick();
    gpu.engine.backTexture(oldBackdrop);
    const source = document.createElement('canvas');
    source.width = source.height = 32;
    source.getContext('2d')!.fillStyle = '#2040e0';
    source.getContext('2d')!.fillRect(0, 0, 32, 32);
    gpu.source = source;
    gpu.failUploads = false;
    handle.update({ backdrop: source });
    const backdrop = (handle as unknown as { backdrop: Backdrop }).backdrop;
    const before = gpu.attempts;
    const next = gpu.engine.backTexture(backdrop);
    return { attempted: gpu.attempts > before, neutral: next.neutral };
  });
  expect(result).toEqual({ attempted: true, neutral: false });
  await drawn(page, 1);
});

test('large direct media is downscaled and repeated disposal releases every texture', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { gpu } = window;
    const source = document.createElement('canvas');
    source.width = 4096;
    source.height = 64;
    source.getContext('2d')!.fillStyle = '#4080c0';
    source.getContext('2d')!.fillRect(0, 0, source.width, source.height);
    window.handle = window.glassity.glassify(document.querySelector('#a')!, {
      accessibility: false, duration: 0, pointerLight: false, backdrop: source,
    });
    const backdrop = (window.handle as unknown as { backdrop: Backdrop }).backdrop;
    const texture = gpu.engine.backTexture(backdrop).texture;
    return { w: texture.w, h: texture.h, max: gpu.gl.getParameter(gpu.gl.MAX_TEXTURE_SIZE) as number };
  });
  expect(result.w).toBeLessThanOrEqual(Math.min(2560, result.max));
  expect(result.w).toBeLessThan(4096);
  expect(result.h).toBeGreaterThan(0);
  expect(Math.abs(result.w / result.h - 64)).toBeLessThan(2);
  await drawn(page, 1);
  await page.evaluate(() => {
    window.handle.destroy();
    window.handle.destroy();
  });
  expect(await page.evaluate(() => window.gpu.engine.renderer!.textureBytes)).toBe(0);
});
