import { expect, test, type Page } from '@playwright/test';
import type { GlassHandle, SequenceController } from '../src/index';
import { frames, glassSignature, openFixture, signatureDifference } from './helpers';

declare global {
  interface Window {
    motion: {
      handle: GlassHandle;
      shapes: string[];
      sequence: SequenceController;
      ready: Promise<void>;
    };
    motionRecording: Promise<{ difference: number; coverage: number }[]>;
  }
}

async function open(page: Page): Promise<string[]> {
  const errors = await openFixture(page, '/e2e/fixtures/motion.html');
  await page.evaluate(() => window.motion.ready);
  await page.waitForFunction(() => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-glassity-canvas]')];
    return canvases.length === 4 && canvases.every((canvas) => canvas.style.visibility === 'visible');
  });
  await frames(page, 3);
  return errors;
}

async function seek(page: Page, progress: number): Promise<number[]> {
  await page.evaluate((value) => window.motion.sequence.seek(value), progress);
  await frames(page, 3);
  return glassSignature(page, '#morph');
}

/** Record actual canvas pixels throughout a brief interaction, including quick key presses. */
async function record(page: Page, ids: string[], duration = 1000): Promise<void> {
  await page.evaluate(({ ids, duration }) => {
    const canvases = ids.map((id) => document.querySelector(id)!.nextElementSibling as HTMLCanvasElement);
    const pixels = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const before = canvases.map(pixels);
    const alpha = (data: Uint8ClampedArray) => {
      let sum = 0;
      for (let i = 3; i < data.length; i += 4) sum += data[i];
      return sum;
    };
    const coverage = before.map(alpha);
    const result = ids.map(() => ({ difference: 0, coverage: 1 }));
    const until = performance.now() + duration;
    window.motionRecording = new Promise((resolve) => {
      const sample = () => {
        canvases.forEach((canvas, index) => {
          const after = pixels(canvas);
          let sum = 0;
          for (let i = 0; i < after.length; i += 4) {
            for (let c = 0; c < 3; c++) sum += Math.abs(after[i + c] * after[i + 3] / 255 - before[index][i + c] * before[index][i + 3] / 255);
          }
          result[index].difference = Math.max(result[index].difference, sum / (after.length / 4 * 3));
          result[index].coverage = Math.max(result[index].coverage, alpha(after) / coverage[index]);
        });
        if (performance.now() < until) requestAnimationFrame(sample);
        else resolve(result);
      };
      requestAnimationFrame(sample);
    });
  }, { ids, duration });
}

test('seek scrubs preloaded shapes without changing the source SVG', async ({ page }) => {
  const errors = await open(page);
  const source = await page.locator('#morph').innerHTML();
  const heart = await seek(page, 0);
  const halfway = await seek(page, 0.25);
  const star = await seek(page, 0.5);
  const check = await seek(page, 1);
  expect(signatureDifference(heart, halfway)).toBeGreaterThan(1);
  expect(signatureDifference(heart, star)).toBeGreaterThan(3);
  expect(signatureDifference(star, check)).toBeGreaterThan(3);
  expect(signatureDifference(heart, await seek(page, 0))).toBeLessThan(0.1);
  expect(await page.locator('#morph').innerHTML()).toBe(source);
  expect(errors).toEqual([]);
});

test('pause and interruption keep the currently drawn blend', async ({ page }) => {
  const errors = await open(page);
  const blend = await seek(page, 0.3);
  await page.evaluate(() => window.motion.sequence.pause());
  await page.waitForTimeout(150);
  expect(signatureDifference(blend, await glassSignature(page, '#morph'))).toBeLessThan(0.1);
  await page.evaluate(async () => {
    window.motion.sequence = window.motion.handle.sequence([...window.motion.shapes].reverse(), { autoplay: false, duration: 600 });
    await window.motion.sequence.ready;
  });
  await frames(page, 3);
  expect(signatureDifference(blend, await glassSignature(page, '#morph'))).toBeLessThan(0.2);
  const next = await seek(page, 0.4);
  expect(signatureDifference(blend, next)).toBeGreaterThan(1);
  expect(await page.evaluate(async () => {
    window.motion.sequence.cancel();
    return window.motion.sequence.finished;
  })).toBe('cancelled');
  await page.waitForTimeout(150);
  expect(signatureDifference(next, await glassSignature(page, '#morph'))).toBeLessThan(0.2);
  expect(errors).toEqual([]);
});

test('play completes and a loop can be cancelled', async ({ page }) => {
  const errors = await open(page);
  expect(await page.evaluate(async () => {
    window.motion.sequence = window.motion.handle.sequence(window.motion.shapes, { duration: 120 });
    await window.motion.sequence.ready;
    return window.motion.sequence.finished;
  })).toBe('completed');
  expect(await page.evaluate(() => window.motion.sequence.progress)).toBe(1);
  await page.evaluate(async () => {
    window.motion.sequence = window.motion.handle.sequence(window.motion.shapes, { duration: 120, loop: true });
    await window.motion.sequence.ready;
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(async () => {
    window.motion.sequence.cancel();
    return window.motion.sequence.finished;
  })).toBe('cancelled');
  expect(errors).toEqual([]);
});

for (const key of ['Enter', 'Space']) {
  test('a quick ' + key + ' press swells the shape without scaling the canvas', async ({ page }) => {
    const errors = await open(page);
    await page.locator('#touch-button').focus();
    await page.waitForTimeout(500); // Let the focus highlight settle before measuring the press.
    await record(page, ['#touch']);
    await page.keyboard.press(key);
    const [press] = await page.evaluate(() => window.motionRecording);
    expect(press.difference).toBeGreaterThan(0.2);
    expect(press.coverage).toBeGreaterThan(1.01);
    expect(await page.locator('#touch + canvas').evaluate((canvas) => (canvas as HTMLElement).style.transform)).toBe('');
    expect(errors).toEqual([]);
  });
}

test('hover and keyboard focus-visible lift the highlight', async ({ page }) => {
  const errors = await open(page);
  const idle = await glassSignature(page, '#touch');
  await page.locator('#touch-button').hover();
  await expect.poll(async () => signatureDifference(idle, await glassSignature(page, '#touch'))).toBeGreaterThan(0.1);
  await page.mouse.move(0, 0);
  await expect.poll(async () => signatureDifference(idle, await glassSignature(page, '#touch'))).toBeLessThan(0.1);
  await page.locator('#cancel').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#touch-button')).toBeFocused();
  expect(await page.locator('#touch-button').evaluate((button) => button.matches(':focus-visible'))).toBe(true);
  await expect.poll(async () => signatureDifference(idle, await glassSignature(page, '#touch'))).toBeGreaterThan(0.1);
  expect(errors).toEqual([]);
});

test('a press lights nearby glass and the light fades without reaching distant glass', async ({ page }) => {
  const errors = await open(page);
  const near = await glassSignature(page, '#near');
  const far = await glassSignature(page, '#far');
  await record(page, ['#near', '#far'], 1200);
  await page.locator('#touch-button').click();
  const [nearLight, farLight] = await page.evaluate(() => window.motionRecording);
  expect(nearLight.difference).toBeGreaterThan(0.1);
  expect(farLight.difference).toBeLessThan(0.02);
  expect(signatureDifference(near, await glassSignature(page, '#near'))).toBeLessThan(0.1);
  expect(signatureDifference(far, await glassSignature(page, '#far'))).toBeLessThan(0.1);
  expect(errors).toEqual([]);
});

test('reduced motion keeps seek and static feedback while suppressing swell and spreading light', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await open(page);
  const heart = await seek(page, 0);
  expect(signatureDifference(heart, await seek(page, 0.5))).toBeGreaterThan(3);
  expect(await page.evaluate(async () => {
    window.motion.sequence.play();
    return window.motion.sequence.finished;
  })).toBe('completed');
  expect(await page.evaluate(() => window.motion.sequence.progress)).toBe(1);
  await record(page, ['#touch', '#near'], 500);
  await page.locator('#touch-button').click();
  const [touch, near] = await page.evaluate(() => window.motionRecording);
  expect(touch.coverage).toBeLessThan(1.005);
  expect(near.difference).toBeLessThan(0.02);
  expect(errors).toEqual([]);
});

test('element keyframes stay seekable after a resize', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(async () => {
    window.motion.sequence = window.motion.handle.sequence([
      document.querySelector<SVGSVGElement>('#morph')!, ...window.motion.shapes.slice(1),
    ], { autoplay: false });
    await window.motion.sequence.ready;
    window.motion.sequence.seek(0.35);
  });
  await frames(page, 3);
  const width = await page.locator('#morph + canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).width);
  await page.locator('#morph').evaluate((svg) => {
    (svg as SVGSVGElement).style.width = '180px';
    (svg as SVGSVGElement).style.height = '180px';
  });
  await expect.poll(() => page.locator('#morph + canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(width);
  expect(await page.evaluate(() => window.motion.sequence.progress)).toBeCloseTo(0.35);
  const middle = await glassSignature(page, '#morph');
  expect(signatureDifference(middle, await seek(page, 1))).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});
