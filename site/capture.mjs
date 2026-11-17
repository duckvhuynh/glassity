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
  // Default glass, big icons: they appear by bending light in, the highlight follows the pointer, then they go.
  async hero() {
    const scene = 'bg=meadow&layout=dock&size=176';
    const shot = await film('hero', `${scene}&visible=false`, {
      seconds: 4.6,
      size: { width: 1280, height: 600, scale: 1 },
      before: (page) => page.mouse.move(40, 560),
      script: async (page, t) => {
        if (t === 0) await set(page, scene);
        if (t >= 0.6 && t <= 3.2) {
          const k = (t - 0.6) / 2.6;
          await page.mouse.move(150 + 980 * k, 250 + 90 * Math.sin(k * Math.PI));
        }
        if (Math.abs(t - 3.4) < 1e-6) await page.mouse.move(1270, 590);
        if (Math.abs(t - 3.9) < 1e-6) await set(page, `${scene}&visible=false`);
      },
    });
    encode('hero', shot, 1280);
  },

  // The playground itself, in quick cuts: presets, backdrops, icon sets, morph, compare, press, logos.
  async tour() {
    const fps = 16;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    await page.goto(`${base}#accessibility=false`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      () => {
        const engine = Object.getOwnPropertySymbols(globalThis).map((s) => globalThis[s]).find((v) => v && v.instances);
        return engine && engine.instances.size > 0 && [...engine.instances.values()].every((i) => i.canvas.style.visibility === 'visible');
      },
      null,
      { timeout: 30_000, polling: 200 },
    );
    await page.evaluate(() => {
      document.querySelector('#bg').scrollIntoView({ block: 'start' });
      window.scrollBy(0, -16);
      const cursor = document.createElement('div');
      cursor.id = 'tour-cursor';
      cursor.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 8.5-6.6 1.6L9.6 19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      cursor.style.cssText = 'position:fixed;left:0;top:0;z-index:99;pointer-events:none;filter:drop-shadow(0 1px 2px #0006)';
      document.body.append(cursor);
    });
    await page.waitForTimeout(600);
    const clip = await page.evaluate(() => {
      const play = document.querySelector('#play').getBoundingClientRect();
      const top = document.querySelector('#bg').getBoundingClientRect().top - 12;
      const bottom = document.querySelector('#status').getBoundingClientRect().top - 2;
      return { x: Math.max(0, play.left - 12), y: top, width: play.width + 24, height: bottom - top };
    });
    // A button by its text inside a group, as a selector.
    const sel = async (host, text) => {
      const n = await page.evaluate(([h, t]) => [...document.querySelectorAll(`${h} > button`)].findIndex((b) => b.textContent.trim() === t) + 1, [host, text]);
      return `${host} > button:nth-of-type(${n})`;
    };
    const center = (selector) =>
      page.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      }, selector);
    const point = (xy) => page.evaluate(([x, y]) => (document.getElementById('tour-cursor').style.transform = `translate(${x - 4}px, ${y - 2}px)`), xy);

    // [time, target, action]: the cursor glides to the target, then the action runs.
    const steps = [
      [0.9, await sel('#presets', 'Crystal'), 'click'],
      [1.9, '#bg button[data-bg="aurora"]', 'click'],
      [2.9, await sel('#set', 'Phosphor fill'), 'click'],
      [3.9, '#bg button[data-bg="silk"]', 'click'],
      [4.9, await sel('#layout', 'One'), 'click'],
      [5.8, '#picker button[aria-label="star"]', 'click'],
      [6.6, '#picker button[aria-label="bell"]', 'click'],
      [7.5, '#compare', 'click'],
      [8.1, '.divider button', 'drag'],
      [9.6, '#compare', 'click'],
      [10.4, await sel('#presets', 'Tiles'), 'click'],
      [11.2, await sel('#layout', 'Dock'), 'click'],
      [12.0, '#bg button[data-bg="leaves"]', 'click'],
      [12.8, '.layer.glass .icons > svg:nth-of-type(3)', 'press'],
      [13.8, await sel('#set', 'Logos'), 'click'],
      [14.6, '#bg button[data-bg="aurora"]', 'click'],
      [15.4, await sel('#presets', 'Default'), 'click'],
    ];
    const seconds = 16.6;
    await page.clock.install();
    await page.clock.runFor(50);
    const dir = join(tmp, 'tour');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    let n = 0;
    const shoot = () => page.screenshot({ path: join(dir, `${String(n++).padStart(4, '0')}.png`), clip });
    let at = [clip.x + clip.width * 0.5, clip.y + clip.height * 0.6];
    let from = at;
    let leg = -1;
    const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
    const done = new Set();
    for (let f = 0; f < Math.round(seconds * fps); f++) {
      const t = f / fps;
      const index = steps.findIndex(([time]) => t < time + 1e-6);
      if (index !== -1) {
        const [time, target] = steps[index];
        const start = time - 0.5;
        if (t >= start) {
          if (leg !== index) {
            leg = index;
            from = at;
          }
          const goal = await center(target);
          const k = Math.min(1, (t - start) / 0.42);
          at = [from[0] + (goal[0] - from[0]) * ease(k), from[1] + (goal[1] - from[1]) * ease(k)];
        }
      }
      await page.mouse.move(at[0], at[1]);
      await point(at);
      for (let s = 0; s < steps.length; s++) {
        const [time, target, action] = steps[s];
        if (done.has(s) || t < time - 1e-6) continue;
        done.add(s);
        if (action === 'click') await page.evaluate((x) => document.querySelector(x).click(), target);
        if (action === 'press') {
          await page.mouse.down();
          for (let p = 0; p < 3; p++) {
            await page.clock.runFor(1000 / fps);
            await shoot();
          }
          await page.mouse.up();
        }
        if (action === 'drag') {
          for (const split of [44, 36, 30, 30, 36, 46, 56, 66, 72, 72, 66, 58, 52, 50]) {
            const rect = await page.evaluate(() => document.querySelector('.stage').getBoundingClientRect().toJSON());
            at = [rect.left + (rect.width * split) / 100, rect.top + rect.height / 2];
            await page.mouse.move(at[0], at[1]);
            await point(at);
            await page.evaluate((v) => {
              window.glassity.state.split = v;
              window.glassity.update();
            }, split);
            await page.clock.runFor(1000 / fps);
            await shoot();
          }
        }
      }
      await page.clock.runFor(1000 / fps);
      await shoot();
    }
    await page.close();
    encode('tour', { dir, fps }, 1100);
  },

  // Your own SVG: logos of tools glassity works with, as glass.
  async logos() {
    const file = await still('logos', 'bg=aurora&layout=grid&set=logos&size=96', { width: 1200, height: 560, scale: 2 });
    toWebp(file, 'logos', 1600);
  },

  // One icon, swapped in place: the glass flows from shape to shape.
  async morph() {
    const order = ['heart', 'star', 'bell', 'sparkles', 'heart'];
    const shot = await film('morph', 'bg=iridescent&layout=single&icon=heart&size=260&depth=0.24', {
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
    const file = await still('compare', 'bg=fern&layout=dock&size=130&compare=50');
    toWebp(file, 'compare', 1600);
  },

  async looks() {
    const panel = { width: 600, height: 340, scale: 2 };
    const common = 'bg=meadow&layout=single&icon=camera&size=210';
    const files = [];
    for (const [caption, opts] of [
      ['Default', ''],
      ['Clear', 'variant=clear'],
      ['Frosted', 'frost=0.8&tintOpacity=0.32&dispersion=0.1&shine=0.8'],
      ['Crystal', 'variant=clear&depth=0.34&curvature=1.7&dispersion=1.3&shine=1.6'],
      ['Round', 'tile=true&tileRadius=0.5&profile=circle&bevel=0.5&depth=0.3&weight=0.02'],
      ['Tiles', 'tile=true'],
    ])
      files.push(await still(`look-${caption}`, `${common}&caption=${caption}${opts ? '&' + opts : ''}`, panel));
    grid('looks', files, 3, 1800);
  },

  async backdrops() {
    const panel = { width: 600, height: 340, scale: 2 };
    const files = [];
    for (const [caption, hash] of [
      ['Leaves: light glass on white', 'bg=leaves&layout=dock&size=70'],
      ['Silk', 'bg=silk&layout=dock&set=phosphor&size=70'],
      ['Ocean', 'bg=ocean&layout=dock&size=70&tile=true'],
      ['Aurora', 'bg=aurora&layout=dock&set=phosphor&size=70'],
      ['Light streaks', 'bg=gradient&layout=dock&size=70&variant=clear'],
      ['Plain HTML, refracted', 'bg=article&layout=dock&set=phosphor&size=70&variant=clear'],
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
