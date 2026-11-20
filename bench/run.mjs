import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { attributeLongTasks, attributeProfile, cpuFrames, frameStats, markdownReport } from './metrics.mjs';
import { startServer } from './server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const flags = new Set(['--headless', '--software', '--profiles', '--skip-build']);
const valued = new Set(['--fixture', '--repeats', '--cycles']);
const options = { repeats: 3, cycles: 100, fixture: null };
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (flags.has(flag)) options[flag.slice(2)] = true;
  else if (valued.has(flag) && args[i + 1] && !args[i + 1].startsWith('--')) options[flag.slice(2)] = args[++i];
  else throw new Error(`Unknown or incomplete option: ${flag}`);
}
for (const key of ['repeats', 'cycles']) {
  options[key] = Number(options[key]);
  if (!Number.isInteger(options[key]) || options[key] < 1) throw new Error(`--${key} must be a positive integer`);
}

const matrix = [50, 77, 100].flatMap((count) => ['repeated', 'unique'].flatMap((shapes) =>
  ['image', 'snapshot'].flatMap((backdrop) => [1, 2].map((dpr) => ({
    id: `${count}-${shapes}-${backdrop}-dpr${dpr}`, count, shapes, backdrop, dpr,
  })))));
const fixtures = options.fixture ? matrix.filter((fixture) => fixture.id === options.fixture) : matrix;
if (!fixtures.length) throw new Error(`Unknown fixture: ${options.fixture}. Choose from ${matrix.map((x) => x.id).join(', ')}`);

const timestamp = new Date().toISOString();
const complete = fixtures.length === matrix.length && options.repeats === 3 && options.cycles === 100;
const name = timestamp.slice(0, 10) + (complete ? '' : '-smoke');
const resultDir = new URL('./results/', import.meta.url);
const metadata = {
  timestamp, node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(),
  viewport: { width: 1440, height: 1200 }, headless: !!options.headless, software: !!options.software,
  repeats: options.repeats, cycles: options.cycles, fullMatrix: complete,
  expectedRunCount: fixtures.length * options.repeats, profileIntervalUs: 1000,
};
const report = { schemaVersion: 1, metadata, runs: [] };
await mkdir(resultDir, { recursive: true });
async function save() {
  await writeFile(new URL(`${name}.json`, resultDir), JSON.stringify(report, null, 2) + '\n');
  await writeFile(new URL(`${name}.md`, resultDir), markdownReport(report));
}

/** Match CDP's monotonic timestamps to performance.now without assuming their origins. */
async function clockOffset(page, cdp) {
  const stamp = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'Timestamp').value * 1000;
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const before = await stamp();
    const now = await page.evaluate(() => performance.now());
    const after = await stamp();
    samples.push({ offset: (before + after) / 2 - now, uncertainty: (after - before) / 2 });
  }
  return samples.sort((a, b) => a.uncertainty - b.uncertainty)[0];
}

async function resources(page, cdp, run) {
  run.allLongTasks.push(...await page.evaluate(() => {
    window.bench.clearMeasurements();
    return window.bench.pauseLongTasks();
  }));
  try {
    await cdp.send('HeapProfiler.collectGarbage');
    // queryObjects counts detached canvases too. Release CDP references before the next GC.
    const { result: prototype } = await cdp.send('Runtime.evaluate', { expression: 'HTMLCanvasElement.prototype' });
    let objects;
    let canvases;
    try {
      ({ objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: prototype.objectId }));
      const { result } = await cdp.send('Runtime.callFunctionOn', {
        objectId: objects.objectId, functionDeclaration: 'function() { return this.length; }', returnByValue: true,
      });
      canvases = result.value;
    } finally {
      if (objects) await cdp.send('Runtime.releaseObject', { objectId: objects.objectId });
      await cdp.send('Runtime.releaseObject', { objectId: prototype.objectId });
    }
    const state = await page.evaluate(() => ({ ...window.bench.resourceState(), textures: window.bench.counters().textures }));
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize: heapBytes } = await cdp.send('Runtime.getHeapUsage');
    return { heapBytes, canvases, ...state };
  } finally {
    await page.evaluate(() => window.bench.resumeLongTasks());
  }
}

async function runFixture(browser, server, fixture, repeat) {
  const context = await browser.newContext({ viewport: metadata.viewport, deviceScaleFactor: fixture.dpr, reducedMotion: 'no-preference', colorScheme: 'light' });
  const run = { fixture, repeat, cycles: options.cycles, errors: [], scenarios: {}, allLongTasks: [] };
  let cdp;
  let profiling = false;
  let clock;
  let page;
  try {
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', (error) => run.errors.push(error.message));
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type()) && /glassity|WebGL|context/i.test(message.text())) run.errors.push(message.text());
    });
    cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: metadata.profileIntervalUs });
    await page.goto(`${server.url}/bench/fixture.html?count=${fixture.count}&shapes=${fixture.shapes}&backdrop=${fixture.backdrop}`);
    await page.waitForFunction(() => window.bench?.ready);
    clock = await clockOffset(page, cdp);
    run.clockUncertaintyMs = clock.uncertainty;
    await cdp.send('Profiler.start');
    profiling = true;
    run.mount = await page.evaluate(() => window.bench.mount());
    await page.evaluate(() => window.bench.settle());
    run.diagnostics = await page.evaluate(() => window.bench.diagnostics());
    if (run.diagnostics.visibleIcons !== fixture.count) throw new Error('Fixture does not have every icon visible.');
    const expectedMode = fixture.backdrop === 'image' ? 'background' : 'dom';
    if (run.diagnostics.backdropModes.length !== 1 || run.diagnostics.backdropModes[0] !== expectedMode)
      throw new Error(`Fixture did not exercise the expected ${expectedMode} backdrop path.`);
    for (const scenario of ['idle', 'scroll', 'pointer', 'theme']) {
      await page.evaluate(() => window.bench.settle());
      run.scenarios[scenario] = await page.evaluate((mode) => window.bench.frames(mode === 'idle' ? 2000 : 3000, mode), scenario);
      if (scenario === 'theme') {
        run.scenarios.theme.firstUpdatedMs = run.scenarios.theme.theme.firstMs;
        run.scenarios.theme.allUpdatedMs = run.scenarios.theme.theme.allMs;
      }
    }
    await page.evaluate(async () => { await window.bench.settle(); window.bench.destroy(); });
    await page.evaluate(() => window.bench.settle());
    // A warm, unmounted baseline includes intentional singleton caches. Both sides have identical DOM.
    run.allLongTasks.push(...await page.evaluate(() => window.bench.drainLongTasks()));
    await resources(page, cdp, run); // Warm the measurement machinery before its retained heap is compared.
    run.resources = { cycles: 0, before: await resources(page, cdp, run) };
    for (let cycle = 0; cycle < options.cycles; cycle++) {
      await page.evaluate(async () => { await window.bench.mount(); window.bench.destroy(); });
      run.allLongTasks.push(...await page.evaluate(() => window.bench.drainLongTasks()));
      run.resources.cycles = cycle + 1;
      if ((cycle + 1) % 25 === 0) console.log(`  ${fixture.id} run ${repeat}: ${cycle + 1}/${options.cycles} cycles`);
    }
    await page.evaluate(() => window.bench.settle());
    run.allLongTasks.push(...await page.evaluate(() => window.bench.drainLongTasks()));
    run.resources.after = await resources(page, cdp, run);
    run.resources.completedCycles = options.cycles;
    run.counters = await page.evaluate(() => window.bench.counters());
    if (run.counters.contextLosses) run.errors.push('WebGL context was lost; texture accounting is invalid.');
  } catch (error) {
    run.error = error.stack || String(error);
  } finally {
    if (profiling) {
      try {
        const { profile } = await cdp.send('Profiler.stop');
        if (!profile.samples?.length) throw new Error('CDP returned no CPU samples; attribution cannot be evaluated.');
        const intervals = attributeProfile(profile, profile.startTime / 1000 - clock.offset);
        if (run.mount && !intervals.length) throw new Error('Glass drew but CDP found no /dist/ samples; CPU attribution is invalid.');
        run.sampledGlassityMs = intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0);
        run.allLongTasks.push(...await page.evaluate(() => window.bench.drainLongTasks()));
        run.longTasks = attributeLongTasks(run.allLongTasks, intervals);
        run.attribution = { samplingIntervalUs: metadata.profileIntervalUs, intervals };
        for (const scenario of Object.values(run.scenarios)) {
          scenario.frames = frameStats(scenario.frameTimes);
          scenario.cpu = cpuFrames(intervals, scenario.frameTimes);
        }
        if (options.profiles) {
          const directory = new URL(`${name}-profiles/`, resultDir);
          await mkdir(directory, { recursive: true });
          const filename = `${fixture.id}-run${repeat}.cpuprofile`;
          await writeFile(new URL(filename, directory), JSON.stringify(profile));
          run.profileFile = `${name}-profiles/${filename}`;
        }
      } catch (error) {
        run.error = [run.error, `Profiler failed: ${error.stack || error}`].filter(Boolean).join('\n');
      }
    }
    if (run.errors.length && !run.error) run.error = run.errors.join('\n');
    await context.close();
  }
  return run;
}

let browser;
let server;
try {
  metadata.packageVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  if (!options['skip-build']) {
    console.log('Building the current checkout: npm run build');
    try {
      execSync('npm run build', { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      metadata.buildError = [error.message, error.stdout, error.stderr].filter(Boolean).map(String).join('\n');
      throw new Error('Build failed; no browser measurements were taken. See buildError in JSON.');
    }
  }
  metadata.distSha256 = createHash('sha256').update(await readFile(new URL('../dist/index.js', import.meta.url))).digest('hex');
  browser = await chromium.launch({ headless: !!options.headless, args: options.software ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : [] });
  metadata.browserVersion = browser.version();
  const browserCdp = await browser.newBrowserCDPSession();
  const { gpu } = await browserCdp.send('SystemInfo.getInfo');
  metadata.gpu = { devices: gpu.devices, featureStatus: gpu.featureStatus, auxAttributes: gpu.auxAttributes };
  await browserCdp.detach();
  server = await startServer();
  // Interleave repetitions to reduce bias from heating up during the matrix.
  for (let repeat = 1; repeat <= options.repeats; repeat++) {
    for (const fixture of fixtures) {
      console.log(`${report.runs.length + 1}/${metadata.expectedRunCount}: ${fixture.id}, run ${repeat}`);
      report.runs.push(await runFixture(browser, server, fixture, repeat));
      await save();
    }
  }
} catch (error) {
  metadata.fatalError = error.stack || String(error);
  console.error(metadata.fatalError);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
  await save();
  if (report.runs.some((run) => run.error)) process.exitCode = 1;
  console.log(`Reports: bench/results/${name}.json and bench/results/${name}.md`);
}
