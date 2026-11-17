// Renders the README images and animations from the playground, frame by frame.
// Needs: `npm run site:build`, a server on :4173 (`npm run demo`), Playwright's Chromium, ffmpeg.
// Usage: node site/capture.mjs [scene ...]     Output: docs/media/
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const media = join(root, 'docs/media');
const tmp = join(root, 'test-results/media');
const base = process.env.SITE_URL ?? 'http://localhost:4173/site/dist/index.html';
const only = process.argv.slice(2);

// accessibility=false: show the glass as most visitors see it, whatever this machine's settings are.
const url = (hash) => `${base}#capture&accessibility=false&${hash}`;
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--hide-scrollbars'],
});

async function open(hash, { width, height, scale }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: 'no-preference' });
  await page.goto(url(hash));
  await page.evaluate(() => document.fonts.ready);
  // Ready when every icon has drawn its glass and nothing is animating.
  await page.waitForFunction(
    () => {
      const engine = Object.getOwnPropertySymbols(globalThis).map((s) => globalThis[s]).find((v) => v && v.instances);
      if (!engine || !engine.instances.size) return false;
      return [...engine.instances.values()].every((i) => i.canvas.style.visibility === 'visible' || !i.r.visible);
    },
    null,
    { timeout: 30_000, polling: 200 },
  );
  await page.waitForTimeout(800);
  return page;
}

const set = (page, hash) => page.evaluate((h) => (location.hash = `capture&accessibility=false&${h}`), hash);

async function still(name, hash, size = { width: 1200, height: 600, scale: 2 }) {
  const page = await open(hash, size);
  const file = join(tmp, `${name}.png`);
  await page.screenshot({ path: file });
  await page.close();
  return file;
}

/** Record `seconds` of an animation at `fps`, calling `script(page, t)` before each frame. */
async function film(name, hash, { seconds, fps = 30, size, before, script }) {
  const page = await open(hash, size);
  if (before) await before(page);
  await page.clock.install();
  await page.clock.runFor(50);
  const dir = join(tmp, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const frames = Math.round(seconds * fps);
  for (let f = 0; f < frames; f++) {
    await script?.(page, f / fps);
    await page.clock.runFor(1000 / fps);
    await page.screenshot({ path: join(dir, `${String(f).padStart(4, '0')}.png`) });
  }
  await page.close();
  return { dir, fps };
}

function encode(name, { dir, fps }, width) {
  const input = ['-framerate', String(fps), '-i', join(dir, '%04d.png')];
  const scale = `scale=${width}:-2:flags=lanczos`;
  ffmpeg(...input, '-vf', scale, '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '78', '-compression_level', '6', '-loop', '0', join(media, `${name}.webp`));
}

function toWebp(input, name, width) {
  ffmpeg('-i', input, '-vf', `scale=${width}:-2:flags=lanczos`, '-c:v', 'libwebp', '-q:v', '88', join(media, `${name}.webp`));
}

/** Panels in a grid with a gap, as one image. */
function grid(name, files, columns, width) {
  const gap = 16;
  const inputs = files.flatMap((f) => ['-i', f]);
  const layout = files
    .map((_, i) => {
      const c = i % columns;
      const r = Math.floor(i / columns);
      const x = c === 0 ? '0' : Array.from({ length: c }, (_, k) => `w${k}`).join('+') + `+${gap * c}`;
      const y = r === 0 ? '0' : Array.from({ length: r }, (_, k) => `h${k * columns}`).join('+') + `+${gap * r}`;
      return `${x}_${y}`;
    })
    .join('|');
  const alpha = files.map((_, i) => `[${i}:v]format=rgba[v${i}]`).join(';');
  const stack = `${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=0x00000000`;
  ffmpeg(...inputs, '-filter_complex', `${alpha};${stack},scale=${width}:-2:flags=lanczos`, '-c:v', 'libwebp', '-q:v', '88', join(media, `${name}.webp`));
}

const scenes = {
  // Icons appear by bending light in, the highlight follows the pointer, one is pressed, then they go.
  async hero() {
    const size = { width: 1280, height: 600, scale: 1 };
    const shot = await film('hero', 'bg=meadow&layout=dock&size=112&tile=true&interactive=true&visible=false', {
      seconds: 5,
      size,
      before: (page) => page.mouse.move(40, 560),
      script: async (page, t) => {
        if (t === 0) await set(page, 'bg=meadow&layout=dock&size=112&tile=true&interactive=true');
        if (t >= 0.7 && t <= 3.3) {
          const k = (t - 0.7) / 2.6;
          await page.mouse.move(250 + 780 * k, 230 + 60 * Math.sin(k * Math.PI));
        }
        if (Math.abs(t - 2.0) < 1e-6) await page.mouse.down();
        if (Math.abs(t - 2.3) < 1e-6) await page.mouse.up();
        if (Math.abs(t - 3.5) < 1e-6) await page.mouse.move(1270, 590);
        if (Math.abs(t - 4.3) < 1e-6) await set(page, 'bg=meadow&layout=dock&size=112&tile=true&interactive=true&visible=false');
      },
    });
    encode('hero', shot, 1280);
  },

  // One icon, swapped in place: the glass flows from shape to shape.
  async morph() {
    const order = ['heart', 'star', 'bell', 'sparkles', 'heart'];
    const shot = await film('morph', 'bg=iridescent&layout=single&icon=heart&size=230&depth=0.24', {
      seconds: 4.5,
      size: { width: 720, height: 420, scale: 1 },
      script: async (page, t) => {
        const step = Math.round(t * 30);
        if (step > 0 && step % 27 === 0 && step / 27 < order.length) {
          const icon = order[step / 27];
          await page.evaluate((i) => {
            window.glassity.state.icon = i;
            window.glassity.update();
          }, icon);
        }
      },
    });
    encode('morph', shot, 720);
  },

  // A canvas behind the glass, refracted live.
  async live() {
    const shot = await film('live', 'bg=live&layout=dock&set=phosphor&size=88', {
      seconds: 3.5,
      fps: 20,
      size: { width: 800, height: 360, scale: 1 },
    });
    encode('live', shot, 800);
  },

  async compare() {
    const file = await still('compare', 'bg=fern&layout=dock&size=104&compare=50');
    toWebp(file, 'compare', 1600);
  },

  async looks() {
    const panel = { width: 600, height: 340, scale: 2 };
    const common = 'bg=meadow&layout=single&icon=camera&size=170';
    const files = [];
    for (const [caption, opts] of [
      ['Default', ''],
      ['Clear', 'variant=clear'],
      ['Frosted', 'frost=0.8&tintOpacity=0.32&dispersion=0.1&shine=0.8'],
      ['Crystal', 'variant=clear&depth=0.34&curvature=1.7&dispersion=1.3&shine=1.6'],
      ['Chunky', 'bevel=0.2&depth=0.42&curvature=2.2&strokeWidth=3.2'],
      ['Tiles', 'tile=true'],
    ])
      files.push(await still(`look-${caption}`, `${common}&caption=${caption}${opts ? '&' + opts : ''}`, panel));
    grid('looks', files, 3, 1800);
  },

  async backdrops() {
    const panel = { width: 600, height: 340, scale: 2 };
    const files = [];
    for (const [caption, hash] of [
      ['Leaves: dark glass by itself', 'bg=leaves&layout=dock&size=62'],
      ['Silk', 'bg=silk&layout=dock&set=phosphor&size=62'],
      ['Ocean', 'bg=ocean&layout=dock&size=62&tile=true'],
      ['Aurora', 'bg=aurora&layout=dock&set=phosphor&size=62'],
      ['Light streaks', 'bg=gradient&layout=dock&size=62&variant=clear'],
      ['Plain HTML, refracted', 'bg=article&layout=dock&set=phosphor&size=62&variant=clear'],
    ])
      files.push(await still(`bd-${caption.split(':')[0]}`, `${hash}&caption=${encodeURIComponent(caption)}`, panel));
    grid('backdrops', files, 3, 1800);
  },
};

await mkdir(media, { recursive: true });
await mkdir(tmp, { recursive: true });
for (const [name, run] of Object.entries(scenes)) {
  if (only.length && !only.includes(name)) continue;
  const started = Date.now();
  await run();
  console.log(`${name}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
await browser.close();
