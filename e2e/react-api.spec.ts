import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

let fixture: string;

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve('e2e/fixtures/react-lifecycle.tsx')],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    target: 'es2020',
    define: { 'process.env.NODE_ENV': '"development"' },
    alias: { 'glassity/react': resolve('dist/react.js'), glassity: resolve('dist/index.js') },
  });
  fixture = result.outputFiles[0].text;
});

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('**/react-lifecycle.js', (route) => route.fulfill({ contentType: 'text/javascript', body: fixture }));
  await page.route('**/react-lifecycle.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body style="margin:30px;background:linear-gradient(135deg,#ec9568,#292e80);color:white">' +
      '<div id="root"></div><div id="portal"></div>' +
      '<svg id="outside" data-glass width="64" height="64" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="white"/></svg>' +
      '<script type="module" src="/react-lifecycle.js"></script></body></html>',
  }));
  await page.goto('/react-lifecycle.html');
  const supported = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  if (process.env.REQUIRE_WEBGL2) expect(supported).toBe(true);
  test.skip(!supported, 'This browser build has no WebGL2.');
  return errors;
}

async function drawn(page: Page, id: string): Promise<void> {
  await expect(page.locator('#' + id + ' + canvas[data-glassity-canvas]')).toHaveCSS('visibility', 'visible');
}

test('React document providers cover portals without wrappers and share their lifetime', async ({ page }) => {
  const errors = await open(page);
  for (const id of ['inside', 'outside', 'portal-icon']) await drawn(page, id);
  await expect(page.locator('#owners > #inside')).toHaveCount(1);
  await expect(page.locator('.neutral-provider')).toHaveCSS('display', 'contents');
  const canvas = await page.locator('#outside + canvas').elementHandle();

  await page.getByRole('button', { name: 'Remove first provider' }).click();
  await expect(page.locator('#inside')).toHaveCount(0);
  await expect(page.locator('#portal-icon')).toHaveCount(0);
  await drawn(page, 'outside');
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);

  await page.getByRole('button', { name: 'Remove second provider' }).click();
  await expect(page.locator('#outside + canvas')).toHaveCount(0);
  await expect(page.locator('#outside')).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});

test('React useGlass follows a replaced ref target and remounts after it disappears', async ({ page }) => {
  const errors = await open(page);
  await drawn(page, 'hook-icon');
  await page.getByRole('button', { name: 'Replace hook target' }).click();
  await expect(page.locator('#hook-icon')).toHaveAttribute('data-version', '1');
  await drawn(page, 'hook-icon');
  await expect(page.locator('#hook canvas[data-glassity-canvas]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Toggle hook target' }).click();
  await expect(page.locator('#hook canvas[data-glassity-canvas]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle hook target' }).click();
  await drawn(page, 'hook-icon');
  expect(errors).toEqual([]);
});
