// Renders the glassity icon with glassity itself: the mark (mark.svg) as glass over a
// generated background (raw/*.png, from an image model). Writes the icons the site uses.
// Needs a server on :4173 (`npm run demo`), `npm run build`, Playwright's Chromium and ffmpeg.
// Usage: node site/icon/render.mjs [background]   (default background.webp, made by an image model; OUT=dir to write elsewhere)
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.OUT ?? join(here, '..', 'icons');
const base = process.env.SITE_URL ?? 'http://localhost:4173';
const background = process.argv[2] ?? 'background.webp';

// Large sizes: thick, clear glass with a strong lens, like an Icon Composer layer.
const clear = { variant: 'clear', weight: 0.02, depth: 0.32, bevel: 0.2, dispersion: 0.8, shine: 1.4, rim: 1.4, shadow: 0.45 };
// Favicons are 16 to 32 px: the mark needs a bright, solid body to read at that size.
const solid = { weight: 0.045, depth: 0.2, bevel: 0.22, tintOpacity: 0.62, frost: 0.5, shine: 1.2, rim: 1.2, shadow: 0.6 };

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--force-color-profile=srgb'] });

/** One 1024 px render. `round` cuts the corners off (transparent); iOS rounds apple-touch icons itself. */
async function render(file, look, round) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  const hash = `${round ? 'round&' : ''}bg=${encodeURIComponent(background)}&o=${encodeURIComponent(JSON.stringify(look))}`;
  await page.goto(`${base}/site/icon/render.html#${hash}`);
  await page.waitForFunction(() => document.querySelector('canvas[data-glassity-canvas]')?.style.visibility === 'visible', null, { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.locator('#icon').screenshot({ path: file, omitBackground: true });
  await page.close();
}

const large = join(out, 'icon-1024.png');
const square = join(out, 'icon-square-1024.png');
const small = join(out, 'icon-small-1024.png');
await render(large, clear, true);
await render(square, clear, false);
await render(small, solid, true);
await browser.close();

const resize = (input, size, name) => ffmpeg('-i', input, '-vf', `scale=${size}:${size}:flags=lanczos`, join(out, name));
resize(large, 512, 'icon-512.png');
resize(large, 192, 'icon-192.png');
resize(square, 180, 'apple-touch-icon.png');
resize(small, 48, 'favicon-48.png');
resize(small, 32, 'favicon-32.png');
resize(small, 16, 'favicon-16.png');
ffmpeg('-i', join(out, 'favicon-32.png'), join(out, 'favicon.ico'));
await rm(square);
await rm(small);
console.log('icons written to', out);
