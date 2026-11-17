// Compatibility suite: install the packed package into small apps (one per framework),
// build each app, serve it and check it in a real browser.
//
//   npm run build && npm run test:compat
//   COMPAT_APPS=vue,nextjs COMPAT_BROWSERS=chromium,webkit npm run test:compat
//   COMPAT_TARBALL=path/to/other.tgz npm run test:compat   # check another build
//
// Every app follows the same contract, so one checker covers them all:
// - every <svg data-expect-glass> must be glass: hidden original, a visible canvas right after it, centred on it
// - no other canvas may exist, and no console error, hydration warning or page error may appear
// - buttons #color, #swap and #toggle exercise a string style binding, an icon swap and unmount/remount
// - the app sets window.__glassity (to isSupported()) once it has mounted or hydrated
//
// An app may describe itself in compat.json:
//   { "build": "npx next build", "start": "npx next start -p {port}", "ssr": true }
//   { "build": "npx ng build", "static": "dist/app/browser" }
//   { "build": false, "start": "node server.ts" }          (no build step)
// Buttons with data-compat-step="label" are clicked after the standard steps.
// Defaults: build with Vite, serve dist/ as static files. With "ssr", the HTML the server
// sends must contain the icons and nothing from glassity.
import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..');
const all = readdirSync(here, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(here, entry.name, 'package.json')))
  .map((entry) => entry.name);
const apps = process.env.COMPAT_APPS ? process.env.COMPAT_APPS.split(',').map((s) => s.trim()).filter(Boolean) : all;
const browsers = (process.env.COMPAT_BROWSERS || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const engines = { chromium, firefox, webkit };
const sh = (command, cwd, env = {}) =>
  execSync(command, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: true, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });

// 1. Pack the package exactly as npm would publish it.
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(root) {
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
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, stop: () => server.close() }));
  });
}

const freePort = () =>
  new Promise((resolve) => {
    const probe = createNetServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/** Start an app's own server and wait until it answers. */
async function serveCommand(command, cwd) {
  const port = await freePort();
  const child = spawn(command.replaceAll('{port}', String(port)), {
    cwd,
    shell: true,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  const stop = () => {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  };
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited: ${log.slice(-400)}`);
    try {
      const response = await fetch(url);
      if (response.ok) return { url, stop };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  stop();
  throw new Error(`server did not answer on ${url}: ${log.slice(-400)}`);
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

const firstLine = (error) =>
  (String(error.stderr || error.stdout || error.message)
    .split('\n')
    .find((line) => /error|not exported|cannot|failed/i.test(line)) ?? String(error.message)).trim().slice(0, 300);

const results = [];
for (const app of apps) {
  const dir = join(here, app);
  const config = existsSync(join(dir, 'compat.json')) ? JSON.parse(readFileSync(join(dir, 'compat.json'), 'utf8')) : {};
  console.log(`\n── ${app}`);
  let server;
  try {
    sh('npm install --no-audit --no-fund --loglevel=error', dir);
    sh(`npm install --no-save --no-audit --no-fund --loglevel=error "${tarball}"`, dir);
    if (config.build !== false) sh(config.build ?? 'npx vite build --logLevel error', dir, { NODE_ENV: 'production' });
    server = config.start ? await serveCommand(config.start, dir) : await serveStatic(join(dir, config.static ?? 'dist'));
  } catch (error) {
    results.push({ app, browser: 'install/build/start', problems: [firstLine(error)] });
    console.log('  install/build/start: FAIL\n    - ' + firstLine(error));
    continue;
  }

  // Server rendering: the icons are in the HTML, glassity is not.
  if (config.ssr) {
    const html = await (await fetch(server.url)).text();
    const problems = [];
    if (!html.includes('data-expect-glass')) problems.push('server HTML has no icons: is the page really server-rendered?');
    // <Glass> renders a data-glassity-host wrapper on purpose (the same on server and client);
    // a canvas or a hidden marker would mean glassity ran on the server.
    if (/data-glassity-(canvas|hidden)/.test(html)) problems.push('server HTML already contains glass');
    results.push({ app, browser: 'server html', problems });
    console.log(`  server html: ${problems.length ? 'FAIL' : 'ok'}`);
    for (const problem of problems) console.log('    - ' + problem);
  }

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
      if (text.includes('GPU stall') || text.includes('Download the React DevTools')) return;
      const framework = /\[Vue warn\]|svelte|solid|angular|NG0\d/i.test(text);
      // React, Vue and Svelte all report a server/client mismatch, at different levels.
      const hydration = /hydrat|mismatch|did not match|#418|#423|#425/i.test(text);
      if (message.type() === 'error' || hydration || (message.type() === 'warning' && framework)) errors.push(message.type() + ': ' + text.slice(0, 200));
    });
    const problems = [];
    try {
      await page.goto(server.url);
      await page.waitForFunction(() => window.__glassity !== undefined, null, { timeout: 30_000 });
      const supported = await page.evaluate(() => window.__glassity);
      if (!supported) problems.push('WebGL2 not available');
      else {
        problems.push(...(await invariant(page, 'initial')));
        const steps = [
          ['#color', 'string style changed'],
          ['#swap', 'icon swapped'],
          ['#toggle', 'icon removed'],
          ['#toggle', 'icon added back'],
        ];
        // Optional extra steps an app offers, clicked in page order: content that hydrates
        // late (an Astro client:visible island), a Remix frame reload, …
        for (const label of await page.locator('[data-compat-step]').evaluateAll((all) => all.map((b) => b.getAttribute('data-compat-step'))))
          steps.push([`[data-compat-step="${label}"]`, label]);
        for (const [button, label] of steps) {
          await page.click(button);
          problems.push(...(await invariant(page, label)));
        }
        // Apps that count change-detection turns (Angular with zone.js): an idle page with
        // glass on it must cause none, or glassity is running inside the zone.
        if (await page.evaluate(() => typeof window.__ticks === 'number')) {
          await page.waitForTimeout(500);
          const before = await page.evaluate(() => window.__ticks);
          await page.waitForTimeout(1500);
          const turns = (await page.evaluate(() => window.__ticks)) - before;
          if (turns > 1) problems.push(`idle page caused ${turns} change-detection turns in 1.5 s`);
        }
      }
    } catch (error) {
      problems.push('run: ' + String(error.message).split('\n')[0].slice(0, 200));
    }
    problems.push(...errors);
    results.push({ app, browser: name, problems });
    console.log(`  ${name}: ${problems.length ? 'FAIL' : 'ok'}`);
    for (const problem of problems) console.log('    - ' + problem);
    await browser.close();
  }
  server.stop();
}

const failed = results.filter((r) => r.problems.length);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
