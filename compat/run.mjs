// Compatibility suite: install the packed package into small Vite apps (one per
// framework), build each app, serve the build and check it in a real browser.
//
//   npm run build && npm run test:compat
//   COMPAT_APPS=vue,svelte COMPAT_BROWSERS=chromium,webkit npm run test:compat
//
// Every app follows the same contract, so one checker covers them all:
// - every <svg data-expect-glass> must be glass: hidden original, a visible canvas right after it, centred on it
// - no other canvas may exist, and no console error or page error may appear
// - buttons #color, #swap and #toggle exercise a string style binding, an icon swap and unmount/remount
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..');
const apps = (process.env.COMPAT_APPS || 'vue,svelte,solid,preact').split(',').map((s) => s.trim()).filter(Boolean);
const browsers = (process.env.COMPAT_BROWSERS || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const engines = { chromium, firefox, webkit };
const sh = (command, cwd) => execSync(command, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: true });

// 1. Pack the package exactly as npm would publish it.
// COMPAT_TARBALL tests another build instead (an older release, say).
let tarball = process.env.COMPAT_TARBALL;
if (!tarball) {
  const pack = join(here, '.pack');
  rmSync(pack, { recursive: true, force: true });
  mkdirSync(pack);
  if (!existsSync(join(repo, 'dist/index.js'))) throw new Error('Run `npm run build` first.');
  sh(`npm pack --pack-destination "${pack}"`, repo);
  tarball = join(pack, readdirSync(pack).find((f) => f.endsWith('.tgz')));
}
console.log('packed', tarball);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve(root) {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      let path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      try {
        const body = readFileSync(join(root, path));
        response.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(body);
      } catch {
        response.writeHead(404).end();
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Wait until the page satisfies the contract, or return what is wrong. */
async function invariant(page, label) {
  const deadline = Date.now() + 8000;
  let problems = [];
  while (Date.now() < deadline) {
    problems = await page.evaluate(() => {
      const out = [];
      const expected = [...document.querySelectorAll('svg[data-expect-glass]')];
      const canvases = [...document.querySelectorAll('canvas[data-glassity-canvas]')];
      if (canvases.length !== expected.length) out.push(`${canvases.length} canvases for ${expected.length} glass icons`);
      for (const svg of expected) {
        const name = svg.getAttribute('data-expect-glass') || svg.outerHTML.slice(0, 60);
        const canvas = svg.nextElementSibling;
        if (getComputedStyle(svg).opacity !== '0') out.push(`${name}: original icon visible`);
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.hasAttribute('data-glassity-canvas')) {
          out.push(`${name}: no canvas next to it`);
          continue;
        }
        if (canvas.style.visibility !== 'visible') out.push(`${name}: canvas not drawn`);
        const a = svg.getBoundingClientRect();
        const b = canvas.getBoundingClientRect();
        const off = Math.hypot(a.left + a.width / 2 - b.left - b.width / 2, a.top + a.height / 2 - b.top - b.height / 2);
        if (off > 2) out.push(`${name}: canvas ${off.toFixed(1)}px off`);
      }
      return out;
    });
    if (!problems.length) return [];
    await page.waitForTimeout(150);
  }
  return problems.map((p) => `${label}: ${p}`);
}

const results = [];
for (const app of apps) {
  const dir = join(here, app);
  console.log(`\n── ${app}`);
  try {
    sh('npm install --no-audit --no-fund --loglevel=error', dir);
    sh(`npm install --no-save --no-audit --no-fund --loglevel=error "${tarball}"`, dir);
    sh('npx vite build --logLevel error', dir);
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).split('\n').find((line) => /error|not exported|cannot/i.test(line)) ?? String(error.message);
    results.push({ app, browser: 'install/build', problems: [detail.trim().slice(0, 300)] });
    console.log('  install/build: FAIL\n    - ' + detail.trim().slice(0, 300));
    continue;
  }
  const server = await serve(join(dir, 'dist'));
  const url = `http://127.0.0.1:${server.address().port}/`;

  for (const name of browsers) {
    const launch =
      name === 'chromium'
        ? { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
        : name === 'firefox'
          ? { firefoxUserPrefs: { 'webgl.force-enabled': true } }
          : {};
    const browser = await engines[name].launch(launch);
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push('pageerror: ' + String(error).slice(0, 200)));
    page.on('console', (message) => {
      const text = message.text();
      if ((message.type() === 'error' || (message.type() === 'warning' && /\[Vue warn\]|svelte|solid/i.test(text))) && !text.includes('GPU stall'))
        errors.push(message.type() + ': ' + text.slice(0, 200));
    });
    await page.goto(url);
    const supported = await page.waitForFunction(() => window.__glassity !== undefined).then(() => page.evaluate(() => window.__glassity));
    const problems = [];
    if (!supported) problems.push('WebGL2 not available');
    else {
      problems.push(...(await invariant(page, 'initial')));
      for (const [button, label] of [
        ['#color', 'string style changed'],
        ['#swap', 'icon swapped'],
        ['#toggle', 'icon removed'],
        ['#toggle', 'icon added back'],
      ]) {
        await page.click(button);
        problems.push(...(await invariant(page, label)));
      }
    }
    problems.push(...errors);
    results.push({ app, browser: name, problems });
    console.log(`  ${name}: ${problems.length ? 'FAIL' : 'ok'}`);
    for (const problem of problems) console.log('    - ' + problem);
    await browser.close();
  }
  server.close();
}

const failed = results.filter((r) => r.problems.length);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
