import { installProbe } from './probe.mjs';

const query = new URLSearchParams(location.search);
const fixture = {
  count: Number(query.get('count') || 77),
  shapes: query.get('shapes') || 'repeated',
  backdrop: query.get('backdrop') || 'image',
  dpr: devicePixelRatio,
};
if (![50, 77, 100].includes(fixture.count) || !['repeated', 'unique'].includes(fixture.shapes) || !['image', 'snapshot'].includes(fixture.backdrop))
  throw new Error('Invalid benchmark fixture parameters.');

document.documentElement.classList.toggle('image', fixture.backdrop === 'image');
document.querySelector('#description').textContent = `${fixture.count} icons · ${fixture.shapes} shapes · ${fixture.backdrop} backdrop · DPR ${fixture.dpr}`;
const ns = 'http://www.w3.org/2000/svg';
const grid = document.querySelector('main');
for (let i = 0; i < fixture.count; i++) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', `Icon ${i + 1}`);
  const svg = document.createElementNS(ns, 'svg');
  const tile = i % 11 === 0;
  const size = tile ? (i % 2 ? 80 : 64) : [16, 20, 24, 28][i % 4];
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('data-glass', '');
  svg.setAttribute('data-bench-icon', String(i));
  if (tile) svg.setAttribute('data-glass-tile', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  const shape = fixture.shapes === 'unique' ? i : i % 4;
  const vertices = 5 + shape % 5;
  const points = Array.from({ length: vertices * 2 }, (_, j) => {
    const angle = j * Math.PI / vertices - Math.PI / 2 + shape * 0.013;
    const radius = j % 2 ? 4 + (shape % 17) / 12 : 9;
    return `${(12 + Math.cos(angle) * radius).toFixed(3)},${(12 + Math.sin(angle) * radius).toFixed(3)}`;
  });
  path.setAttribute('d', 'M' + points.join('L') + 'Z');
  svg.append(path);
  button.append(svg);
  grid.append(button);
}

const { version } = await fetch('/package.json').then((response) => response.json());
const probe = installProbe(version);
let library = null;
let controller = null;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function assertHealthy() {
  if (probe.engine && !probe.engine.renderer) throw new Error('WebGL2 unavailable; plain SVG is not a performance result.');
  if (probe.counters().contextLosses) throw new Error('WebGL context lost during measurement.');
}

async function mount() {
  if (controller) throw new Error('Destroy the previous controller before mounting again.');
  probe.startMount();
  library ??= await import('/dist/index.js');
  controller = library.auto({ selector: '[data-bench-icon]' });
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    assertHealthy();
    const result = probe.mountTiming(fixture.count);
    if (result.allMs !== null) {
      probe.finishMount();
      return result;
    }
    await nextFrame();
  }
  throw new Error(`Not every icon drew a real backdrop within 30 s: ${JSON.stringify(probe.mountTiming(fixture.count))}`);
}

async function settle() {
  const deadline = performance.now() + 15_000;
  let last = '';
  let quietSince = performance.now();
  while (performance.now() < deadline) {
    assertHealthy();
    const { draws, uploads, captures, pendingCaptures } = probe.counters();
    const stamp = `${draws}/${uploads}/${captures}`;
    const instances = probe.engine ? [...probe.engine.instances.values()] : [];
    const pending = instances.some((instance) => instance.backdrop?.busy || instance.dirty || instance.lens !== instance.lensTo);
    if (stamp !== last || pending || pendingCaptures || (instances.length && probe.engine?.hot > 0)) quietSince = performance.now();
    last = stamp;
    if (performance.now() - quietSince >= 500) return;
    await nextFrame();
  }
  throw new Error('The page did not settle within 15 s.');
}

function destroy() {
  controller?.destroy();
  controller = null;
  probe.finishMount();
}

async function frames(durationMs, mode = 'idle') {
  if (!['idle', 'scroll', 'pointer', 'theme'].includes(mode)) throw new Error('Unknown benchmark scenario: ' + mode);
  const before = probe.counters();
  const frameTimes = [];
  const centers = mode === 'pointer' ? [...document.querySelectorAll('[data-bench-icon]')].map((svg) => {
    const box = svg.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }) : [];
  const start = await nextFrame();
  if (mode === 'theme') {
    probe.startTheme();
    document.documentElement.classList.toggle('dark');
  }
  let now = start;
  while (now - start <= durationMs) {
    assertHealthy();
    frameTimes.push(now);
    const phase = (now - start) / durationMs;
    if (mode === 'scroll') window.scrollTo(0, Math.round(50 - Math.cos(phase * Math.PI * 4) * 50));
    if (mode === 'pointer') {
      // Visit actual icon centres; the one-time layout read stays outside measured frames.
      const { x, y } = centers[Math.min(centers.length - 1, Math.floor(phase * centers.length))];
      document.elementFromPoint(x, y)?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerType: 'mouse' }));
    }
    now = await nextFrame();
  }
  frameTimes.push(now);
  const after = probe.counters();
  return {
    frameTimes,
    draws: after.draws - before.draws,
    uploads: after.uploads - before.uploads,
    captures: after.captures - before.captures,
    theme: mode === 'theme' ? probe.finishTheme(fixture.count) : null,
  };
}

window.bench = {
  ready: true,
  fixture,
  mount,
  settle,
  destroy,
  frames,
  counters: probe.counters,
  drainLongTasks: probe.drainLongTasks,
  pauseLongTasks: probe.pauseLongTasks,
  resumeLongTasks: probe.resumeLongTasks,
  clearMeasurements: probe.clearMeasurements,
  resourceState: () => ({
    domCanvases: document.querySelectorAll('canvas').length,
    instances: probe.engine?.instances.size ?? 0,
    geometries: probe.engine?.geometries.size ?? 0,
  }),
  diagnostics: () => ({
    renderer: !!probe.engine?.renderer,
    backdropModes: [...new Set([...probe.engine.instances.values()].map((instance) => instance.backdrop?.mode))],
    visibleIcons: [...document.querySelectorAll('[data-bench-icon]')].filter((svg) => {
      const box = svg.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
    }).length,
  }),
};
