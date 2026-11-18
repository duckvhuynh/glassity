import { auto, isSupported, type GlassController, type GlassOptions } from '../src/index';
import { resolveOptions, type ResolvedOptions } from '../src/options';
import icons from 'virtual:icons';
import { ensure, libIcon, mountLibrary, setInfo, showcase } from './library';

// ── state ──────────────────────────────────────────────────────────────────

type Key = keyof ResolvedOptions;
type Layout = 'single' | 'dock' | 'grid';
type IconSet = 'lucide' | 'phosphor' | 'logos' | 'lib' | 'custom';
type Tab = 'react' | 'vue' | 'svelte' | 'html' | 'js';

interface BackdropInfo {
  id: string;
  name: string;
  kind: 'photo' | 'css' | 'article' | 'live' | 'upload';
  /** Colour of the plain icons in compare mode. */
  ink?: 'dark';
  label?: string;
}

const BACKDROPS: BackdropInfo[] = [
  { id: 'meadow', name: 'Meadow', kind: 'photo' },
  { id: 'leaves', name: 'Leaves', kind: 'photo', ink: 'dark' },
  { id: 'silk', name: 'Silk', kind: 'photo', ink: 'dark' },
  { id: 'gradient', name: 'Light streaks', kind: 'photo', ink: 'dark' },
  { id: 'fern', name: 'Fern', kind: 'photo' },
  { id: 'ocean', name: 'Ocean', kind: 'photo' },
  { id: 'iridescent', name: 'Iridescent', kind: 'photo', ink: 'dark' },
  { id: 'aurora', name: 'Aurora', kind: 'photo' },
  { id: 'sunset', name: 'CSS gradient', kind: 'css' },
  { id: 'grid', name: 'Grid', kind: 'css' },
  { id: 'stripes', name: 'Stripes', kind: 'css' },
  { id: 'night', name: 'Night', kind: 'css' },
  { id: 'paper', name: 'Paper', kind: 'css', ink: 'dark' },
  { id: 'article', name: 'Plain HTML', kind: 'article', ink: 'dark', label: 'HTML' },
  { id: 'live', name: 'Live canvas', kind: 'live', label: 'Live' },
  { id: 'upload', name: 'Your photo', kind: 'upload', label: '+ Yours' },
];
type Backdrop = string;
const backdropInfo = (id: string) => BACKDROPS.find((b) => b.id === id) ?? BACKDROPS[0];
let uploadUrl = '';

const LAYOUTS: [Layout, string][] = [['single', 'One'], ['dock', 'Dock'], ['grid', 'Grid']];
const SETS: [IconSet, string][] = [['lucide', 'Lucide'], ['phosphor', 'Phosphor fill'], ['logos', 'Logos'], ['lib', 'More sets'], ['custom', 'Your SVG']];
const TABS: [Tab, string][] = [['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['html', 'HTML'], ['js', 'JavaScript']];
const SIZES: Record<Layout, number> = matchMedia('(max-width: 640px)').matches ? { single: 170, dock: 46, grid: 44 } : { single: 260, dock: 116, grid: 76 };
const DOCK = ['house', 'search', 'bell', 'heart', 'camera', 'music'];
const LOGO_DOCK = ['react', 'vue', 'svelte', 'angular', 'astro', 'solid'];
const GRID = ['house', 'search', 'bell', 'heart', 'settings', 'camera', 'mail', 'map-pin', 'calendar', 'sun', 'sparkles', 'music', 'cloud', 'star', 'message', 'zap', 'leaf', 'coffee'];

interface State {
  options: GlassOptions;
  bg: Backdrop;
  layout: Layout;
  set: IconSet;
  icon: string;
  size: Record<Layout, number>;
  compare: boolean;
  split: number;
  tab: Tab;
  custom: string;
  /** The icon set of the library in use, and the icons it shows in a dock or grid. */
  lib: string;
  libNames: string[];
}

const state: State = {
  options: {},
  bg: 'meadow',
  layout: 'dock',
  set: 'lucide',
  icon: 'heart',
  size: { ...SIZES },
  compare: false,
  split: 50,
  tab: 'react',
  custom: '',
  lib: 'tabler',
  libNames: [],
};

// ── controls ───────────────────────────────────────────────────────────────

type Control =
  | { key: Key; kind: 'select'; choices: string[]; help?: string }
  | { key: Key; kind: 'range'; min: number; max: number; step: number; auto?: boolean; zero?: string; help?: string }
  | { key: Key; kind: 'toggle'; help?: string }
  | { key: Key; kind: 'color'; help?: string };

const GROUPS: { title: string; open?: boolean; controls: Control[] }[] = [
  {
    title: 'Material',
    open: true,
    controls: [
      { key: 'variant', kind: 'select', choices: ['regular', 'clear', 'identity'] },
      { key: 'profile', kind: 'select', choices: ['squircle', 'circle', 'lip', 'dome'] },
      { key: 'scheme', kind: 'select', choices: ['auto', 'light', 'dark'] },
      { key: 'tile', kind: 'toggle', help: 'A rounded glass plate behind the icon' },
      { key: 'interactive', kind: 'toggle', help: 'Swell and glow when pressed' },
    ],
  },
  {
    title: 'Refraction',
    open: true,
    controls: [
      { key: 'depth', kind: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'bevel', kind: 'range', min: 0.005, max: 0.3, step: 0.005 },
      { key: 'curvature', kind: 'range', min: 0, max: 4, step: 0.05 },
      { key: 'refraction', kind: 'range', min: 0, max: 4, step: 0.05 },
      { key: 'ior', kind: 'range', min: 1, max: 2.5, step: 0.01 },
      { key: 'dispersion', kind: 'range', min: 0, max: 2, step: 0.05 },
      { key: 'bands', kind: 'range', min: 1, max: 8, step: 1 },
    ],
  },
  {
    title: 'Surface',
    controls: [
      { key: 'frost', kind: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'tint', kind: 'color' },
      { key: 'tintOpacity', kind: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'dim', kind: 'range', min: 0, max: 1, step: 0.01, auto: true },
      { key: 'saturation', kind: 'range', min: 0, max: 3, step: 0.05 },
      { key: 'brightness', kind: 'range', min: 0, max: 2, step: 0.05 },
      { key: 'contrast', kind: 'range', min: 0, max: 2, step: 0.05 },
      { key: 'opacity', kind: 'range', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Light',
    controls: [
      { key: 'shine', kind: 'range', min: 0, max: 4, step: 0.05 },
      { key: 'rim', kind: 'range', min: 0, max: 4, step: 0.05 },
      { key: 'reflection', kind: 'range', min: 0, max: 4, step: 0.05 },
      { key: 'lightAngle', kind: 'range', min: -180, max: 180, step: 1 },
      { key: 'shadow', kind: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'pointerLight', kind: 'toggle', help: 'The highlight follows the pointer' },
    ],
  },
  {
    title: 'Tile and shape',
    controls: [
      { key: 'tileRadius', kind: 'range', min: 0, max: 0.5, step: 0.01 },
      { key: 'glyphOpacity', kind: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'padding', kind: 'range', min: 0, max: 0.45, step: 0.01 },
      { key: 'weight', kind: 'range', min: -0.03, max: 0.08, step: 0.005, help: 'Bolder shapes, stroked or filled' },
      { key: 'strokeWidth', kind: 'range', min: 0, max: 4, step: 0.1, zero: 'from SVG' },
    ],
  },
  {
    title: 'Motion and system',
    controls: [
      { key: 'visible', kind: 'toggle', help: 'Hide it and the glass bends away' },
      { key: 'duration', kind: 'range', min: 0, max: 2000, step: 10 },
      { key: 'accessibility', kind: 'toggle', help: 'Follow reduced motion, transparency and contrast' },
      { key: 'maxDpr', kind: 'range', min: 0.5, max: 4, step: 0.5 },
    ],
  },
];

const PRESETS: [string, GlassOptions][] = [
  ['Default', {}],
  ['Clear', { variant: 'clear' }],
  ['Frosted', { frost: 0.8, tintOpacity: 0.32, dispersion: 0.1, shine: 0.8 }],
  ['Crystal', { variant: 'clear', depth: 0.34, curvature: 1.7, dispersion: 1.3, shine: 1.6 }],
  ['Chunky', { bevel: 0.2, depth: 0.42, curvature: 2.2, strokeWidth: 3.2 }],
  ['Bubble', { profile: 'circle', variant: 'clear', depth: 0.5, dispersion: 0.9, reflection: 1.4, rim: 1.6 }],
  ['Round', { tile: true, tileRadius: 0.5, profile: 'circle', bevel: 0.5, depth: 0.3, weight: 0.02 }],
  ['Lens', { tile: true, tileRadius: 0.5, profile: 'dome', variant: 'clear', depth: 0.6, weight: 0.02 }],
  ['Bold', { weight: 0.04, depth: 0.22 }],
  ['Tiles', { tile: true, interactive: true }],
];

// ── elements ───────────────────────────────────────────────────────────────

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const stage = $('#stage');
const glassIcons = $('.layer.glass .icons');
const plainIcons = $('.layer.plain .icons');
const liveCanvas = $<HTMLCanvasElement>('.live');
const status = $('#status');
const codeEl = $('#code code');
const NS = 'http://www.w3.org/2000/svg';

// ── icons ──────────────────────────────────────────────────────────────────

interface IconData {
  viewBox: string;
  attrs: Record<string, string>;
  body: string;
}

let customIcon: IconData | null = null;

function parseCustom(text: string): IconData | null {
  if (!text.trim()) return null;
  const doc = new DOMParser().parseFromString(text.trim(), 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) return null;
  for (const bad of svg.querySelectorAll('script, foreignObject')) bad.remove();
  for (const el of [svg, ...svg.querySelectorAll('*')])
    for (const name of el.getAttributeNames()) if (/^on/i.test(name)) el.removeAttribute(name);
  let viewBox = svg.getAttribute('viewBox');
  if (!viewBox) {
    const w = parseFloat(svg.getAttribute('width') || '24');
    const h = parseFloat(svg.getAttribute('height') || '24');
    viewBox = `0 0 ${w} ${h}`;
  }
  const attrs: Record<string, string> = {};
  for (const name of svg.getAttributeNames())
    if (!['width', 'height', 'viewBox', 'class', 'style', 'xmlns', 'id'].includes(name) && !name.startsWith('xmlns:') && !name.startsWith('data-glass')) attrs[name] = svg.getAttribute(name)!;
  return { viewBox, attrs, body: svg.innerHTML };
}

function iconLabel(name: string): string {
  if (state.set === 'custom') return 'Your SVG';
  if (state.set === 'logos') return icons.logos[name]?.title ?? name;
  if (state.set === 'lib') return name.replace(/-/g, ' ');
  return name;
}

function iconFor(name: string): IconData {
  if (state.set === 'custom') return customIcon ?? icons.lucide.sparkles;
  if (state.set === 'lib') return libIcon(state.lib, name) ?? icons.lucide.sparkles;
  const set = icons[state.set];
  return set[name] ?? Object.values(set)[0];
}

function paint(svg: SVGSVGElement, data: IconData): void {
  for (const name of svg.getAttributeNames())
    if (!name.startsWith('data-') && !name.startsWith('aria-') && name !== 'role') svg.removeAttribute(name);
  svg.setAttribute('viewBox', data.viewBox);
  for (const [k, v] of Object.entries(data.attrs)) svg.setAttribute(k, v);
  svg.innerHTML = data.body;
}

function makeIcon(name: string, glass: boolean): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  if (glass) {
    svg.setAttribute('data-glass', '');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', iconLabel(name));
  } else {
    svg.setAttribute('data-glass', 'off');
  }
  paint(svg, iconFor(name));
  return svg;
}

function names(): string[] {
  if (state.layout === 'single' || state.set === 'custom') return [state.icon];
  if (state.set === 'logos') return state.layout === 'dock' ? LOGO_DOCK : Object.keys(icons.logos);
  if (state.set === 'lib') return state.layout === 'dock' ? state.libNames.slice(0, 6) : state.libNames;
  return state.layout === 'dock' ? DOCK : GRID;
}

let shown = '';
function renderIcons(): void {
  stage.dataset.layout = state.set === 'custom' ? 'single' : state.layout;
  stage.style.setProperty('--icon', `${state.size[state.layout]}px`);
  const list = names();
  const key = `${state.set}${state.set === 'lib' ? ':' + state.lib : ''}|${state.layout}|${list.join(',')}`;
  if (key === shown) return;
  const single = list.length === 1 && glassIcons.querySelectorAll(':scope > svg').length === 1 && shown.split('|')[1] === state.layout;
  shown = key;
  if (single) {
    // Same element, new outline: the glass morphs from one shape to the other.
    const data = iconFor(list[0]);
    for (const svg of [glassIcons.firstElementChild, plainIcons.firstElementChild] as SVGSVGElement[]) {
      paint(svg, data);
      if (svg.hasAttribute('role')) svg.setAttribute('aria-label', iconLabel(list[0]));
    }
    return;
  }
  glassIcons.replaceChildren(...list.map((n) => makeIcon(n, true)));
  plainIcons.replaceChildren(...list.map((n) => makeIcon(n, false)));
}

function renderPicker(): void {
  const picker = $('#picker');
  $('#custom').classList.toggle('open', state.set === 'custom');
  // Library icons are picked in the library panel below.
  picker.hidden = state.set === 'custom' || state.set === 'lib';
  if (picker.hidden) return;
  picker.replaceChildren(
    ...Object.keys(icons[state.set as 'lucide' | 'phosphor' | 'logos']).map((name) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = iconLabel(name);
      button.setAttribute('aria-label', iconLabel(name));
      button.setAttribute('aria-pressed', String(state.layout === 'single' && state.icon === name));
      const svg = document.createElementNS(NS, 'svg');
      paint(svg, icons[state.set as 'lucide' | 'phosphor' | 'logos'][name]);
      svg.setAttribute('aria-hidden', 'true');
      button.append(svg);
      button.addEventListener('click', () => {
        state.icon = name;
        state.layout = 'single';
        update();
      });
      return button;
    }),
  );
}

// ── live canvas backdrop ───────────────────────────────────────────────────

let liveFrame = 0;
function drawLive(now: number): void {
  liveFrame = 0;
  if (state.bg !== 'live') return;
  const rect = stage.getBoundingClientRect();
  const w = Math.max(2, Math.round(rect.width));
  const h = Math.max(2, Math.round(rect.height));
  if (liveCanvas.width !== w || liveCanvas.height !== h) {
    liveCanvas.width = w;
    liveCanvas.height = h;
  }
  const g = liveCanvas.getContext('2d')!;
  const t = now / 1000;
  g.fillStyle = '#0b1020';
  g.fillRect(0, 0, w, h);
  const blobs: [string, number, number, number][] = [
    ['#ff7a59', 0.21, 0.37, 0.0],
    ['#ffd36e', 0.17, 0.29, 1.7],
    ['#3fd0ff', 0.13, 0.41, 3.1],
    ['#8a62ff', 0.19, 0.23, 4.4],
    ['#ff5fa2', 0.11, 0.33, 5.6],
  ];
  g.globalCompositeOperation = 'lighter';
  for (const [color, sx, sy, phase] of blobs) {
    const x = w * (0.5 + 0.38 * Math.sin(t * sx * 2 + phase));
    const y = h * (0.5 + 0.34 * Math.cos(t * sy * 2 + phase * 1.3));
    const r = Math.min(w, h) * 0.42;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color + 'cc');
    grad.addColorStop(1, color + '00');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  g.globalCompositeOperation = 'source-over';
  // Thin moving lines make the bending easy to see.
  g.strokeStyle = '#ffffff30';
  g.lineWidth = 1;
  const offset = (t * 18) % 28;
  g.beginPath();
  for (let x = -28 + offset; x < w; x += 28) {
    g.moveTo(x, 0);
    g.lineTo(x + h * 0.25, h);
  }
  g.stroke();
  liveFrame = requestAnimationFrame(drawLive);
}

// ── glass ──────────────────────────────────────────────────────────────────

let controller: GlassController | null = null;

function applyGlass(): void {
  const options: GlassOptions = { ...state.options };
  if (state.bg === 'live') options.backdrop = liveCanvas;
  if (!controller) controller = auto({ root: $('.layer.glass'), ...options });
  else controller.set(options);
}

// ── panel ──────────────────────────────────────────────────────────────────

const defaults = (): ResolvedOptions => resolveOptions({ variant: state.options.variant, tile: state.options.tile });
const isSet = (key: Key) => key in state.options && (state.options as Record<string, unknown>)[key] !== undefined;

function current(key: Key): unknown {
  return isSet(key) ? (state.options as Record<string, unknown>)[key] : defaults()[key];
}

function setOption(key: Key, value: unknown): void {
  const options = state.options as Record<string, unknown>;
  if (value === undefined) delete options[key];
  else options[key] = value;
  // A value equal to the default for the current variant is not an override.
  if (key !== 'variant' && key !== 'tile' && value !== undefined && defaults()[key] === value) delete options[key];
  if ((key === 'variant' && value === 'regular') || (key === 'tile' && value === false)) delete options[key];
  update();
}

const fmt = (n: number, step: number) => {
  const digits = step >= 1 ? 0 : String(step).split('.')[1]?.length ?? 2;
  return Number(n.toFixed(digits)).toString();
};

const label = (key: string) => key.replace(/[A-Z]/g, (c) => ' ' + c.toLowerCase()).replace(/^./, (c) => c.toUpperCase());

const syncers: (() => void)[] = [];

function buildPanel(): void {
  const groups = $('#groups');
  for (const group of GROUPS) {
    const details = document.createElement('details');
    details.open = !!group.open;
    const summary = document.createElement('summary');
    summary.textContent = group.title;
    details.append(summary);
    for (const ctl of group.controls) details.append(control(ctl));
    groups.append(details);
  }
  const presets = $('#presets');
  for (const [name, options] of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.addEventListener('click', () => {
      state.options = { ...options };
      update();
    });
    presets.append(button);
    syncers.push(() => button.setAttribute('aria-pressed', String(sameOptions(state.options, options))));
  }
}

function sameOptions(a: GlassOptions, b: GlassOptions): boolean {
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b);
  return ka.length === kb.length && kb.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

function control(ctl: Control): HTMLElement {
  const box = document.createElement('div');
  box.className = 'ctl';
  const id = 'opt-' + ctl.key;
  const head = document.createElement('div');
  head.className = 'head';
  const name = document.createElement('label');
  name.htmlFor = id;
  name.textContent = label(ctl.key);
  name.title = ctl.help ?? '';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'reset';
  reset.textContent = '×';
  reset.title = 'Back to default';
  reset.setAttribute('aria-label', `Reset ${label(ctl.key)}`);
  reset.addEventListener('click', () => setOption(ctl.key, undefined));
  const right = document.createElement('span');
  right.className = 'pair';
  head.append(name, right);
  box.append(head);

  if (ctl.kind === 'select') {
    const select = document.createElement('select');
    select.id = id;
    for (const choice of ctl.choices) select.append(new Option(choice, choice));
    select.addEventListener('change', () => setOption(ctl.key, select.value));
    right.append(select, reset);
    syncers.push(() => {
      select.value = String(current(ctl.key));
      box.classList.toggle('set', isSet(ctl.key));
    });
  } else if (ctl.kind === 'toggle') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.addEventListener('change', () => setOption(ctl.key, input.checked));
    right.append(reset, input);
    if (ctl.help) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = ctl.help;
      box.append(hint);
    }
    syncers.push(() => {
      input.checked = current(ctl.key) === true;
      box.classList.toggle('set', isSet(ctl.key));
    });
  } else if (ctl.kind === 'color') {
    const autoBox = document.createElement('input');
    autoBox.type = 'checkbox';
    autoBox.title = 'auto: white; small icons turn dark on a light page';
    autoBox.setAttribute('aria-label', 'Automatic tint');
    const color = document.createElement('input');
    color.type = 'color';
    color.id = id;
    color.value = '#ffffff';
    const val = document.createElement('span');
    val.className = 'val';
    color.addEventListener('input', () => setOption('tint', color.value));
    autoBox.addEventListener('change', () => setOption('tint', autoBox.checked ? undefined : color.value));
    right.append(reset, val, color, autoBox);
    syncers.push(() => {
      const v = String(current('tint'));
      autoBox.checked = v === 'auto';
      if (v !== 'auto') color.value = v;
      val.textContent = v === 'auto' ? 'auto' : '';
      box.classList.toggle('set', isSet('tint'));
    });
  } else {
    const range = document.createElement('input');
    range.type = 'range';
    range.id = id;
    range.min = String(ctl.min);
    range.max = String(ctl.max);
    range.step = String(ctl.step);
    const val = document.createElement('span');
    val.className = 'val';
    right.append(reset, val);
    let autoBox: HTMLInputElement | null = null;
    if (ctl.auto) {
      autoBox = document.createElement('input');
      autoBox.type = 'checkbox';
      autoBox.title = 'auto';
      autoBox.setAttribute('aria-label', `Automatic ${label(ctl.key).toLowerCase()}`);
      autoBox.addEventListener('change', () => setOption(ctl.key, autoBox!.checked ? 'auto' : Number(range.value)));
      right.append(autoBox);
    }
    range.addEventListener('input', () => {
      const n = Number(range.value);
      setOption(ctl.key, ctl.zero && n === 0 ? undefined : n);
    });
    box.append(range);
    syncers.push(() => {
      const v = current(ctl.key);
      const isAuto = v === 'auto';
      if (autoBox) autoBox.checked = isAuto;
      range.disabled = isAuto;
      const n = typeof v === 'number' ? v : v == null ? 0 : ctl.min;
      if (document.activeElement !== range) range.value = String(n);
      val.textContent = isAuto ? 'auto' : v == null && ctl.zero ? ctl.zero : fmt(n, ctl.step);
      box.classList.toggle('set', isSet(ctl.key));
    });
  }
  return box;
}

// ── code ───────────────────────────────────────────────────────────────────

function overrides(): [string, unknown][] {
  return Object.entries(state.options).filter(([, v]) => v !== undefined);
}

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const num = (v: unknown) => (typeof v === 'number' ? Number(v.toFixed(3)).toString() : String(v));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function component(name: string): { name: string; from: string; extra: string } {
  const c = icons.components[name] ?? icons.components.heart;
  return state.set === 'phosphor'
    ? { name: c.phosphor, from: '@phosphor-icons/react', extra: ' weight="fill"' }
    : { name: c.lucide, from: 'lucide-react', extra: '' };
}

function code(): string {
  const o = overrides();
  const own = state.set === 'custom' || state.set === 'logos' || state.set === 'lib';
  const list = own ? ['custom'] : names().slice(0, state.layout === 'single' ? 1 : 3);
  const more = !own && names().length > list.length;
  const libSvg = () => `<svg data-glass viewBox="${iconFor(state.icon).viewBox}">…</svg>  {/* ${state.lib}:${state.layout === 'single' ? state.icon : '…'} */}`;
  const customSvg =
    state.set === 'logos' ? '<svg data-glass viewBox="0 0 24 24"><path d="…" /></svg>  {/* your logo */}' : state.set === 'lib' ? libSvg() : '<svg data-glass viewBox="…">…</svg>';
  switch (state.tab) {
    case 'react': {
      const props = o.map(([k, v]) => (v === true ? ` ${k}` : typeof v === 'string' ? ` ${k}="${v}"` : ` ${k}={${num(v)}}`)).join('');
      const comps = list.map(component);
      const imports = own ? '' : `import { ${[...new Set(comps.map((c) => c.name))].join(', ')} } from '${comps[0].from}';\n`;
      const body = own ? `      ${customSvg}` : comps.map((c) => `      <${c.name}${c.extra} data-glass />`).join('\n') + (more ? '\n      {/* … */}' : '');
      return `import { GlassProvider } from 'glassity/react';\n${imports}\nexport function Icons() {\n  return (\n    <GlassProvider${props}>\n${body}\n    </GlassProvider>\n  );\n}`;
    }
    case 'vue': {
      const props = o.map(([k, v]) => (v === true ? ` ${kebab(k)}` : typeof v === 'string' ? ` ${kebab(k)}="${v}"` : ` :${kebab(k)}="${num(v)}"`)).join('');
      const comps = list.map((n) => {
        const c = component(n);
        return state.set === 'phosphor' ? { ...c, name: 'Ph' + c.name, from: '@phosphor-icons/vue' } : { ...c, from: '@lucide/vue' };
      });
      const imports = own ? '' : `import { ${[...new Set(comps.map((c) => c.name))].join(', ')} } from '${comps[0].from}';\n`;
      const body = own ? `    ${customSvg.replace('{/* your logo */}', '<!-- your logo -->')}` : comps.map((c) => `    <${c.name}${c.extra} data-glass />`).join('\n') + (more ? '\n    <!-- … -->' : '');
      return `<script setup>\nimport { GlassProvider } from 'glassity/vue';\n${imports}</script>\n\n<template>\n  <GlassProvider${props}>\n${body}\n  </GlassProvider>\n</template>`;
    }
    case 'svelte': {
      const obj = o.length ? `{{ ${o.map(([k, v]) => `${k}: ${typeof v === 'string' ? `'${v}'` : num(v)}`).join(', ')} }}` : '';
      const comps = list.map((n) => {
        const c = component(n);
        return state.set === 'phosphor' ? { ...c, from: 'phosphor-svelte' } : { ...c, from: '@lucide/svelte' };
      });
      const imports = own ? '' : `  import { ${[...new Set(comps.map((c) => c.name))].join(', ')} } from '${comps[0].from}';\n`;
      const body = own ? `  ${customSvg.replace('{/* your logo */}', '<!-- your logo -->')}` : comps.map((c) => `  <${c.name}${c.extra} data-glass />`).join('\n') + (more ? '\n  <!-- … -->' : '');
      return `<script>\n  import { glassProvider } from 'glassity/svelte';\n${imports}</script>\n\n<nav use:glassProvider${obj ? '=' + obj : ''}>\n${body}\n</nav>`;
    }
    case 'html': {
      const attrs = o
        .filter(([k]) => k !== 'variant')
        .map(([k, v]) => (v === true ? ` data-glass-${kebab(k)}` : ` data-glass-${kebab(k)}="${num(v)}"`))
        .join('');
      const variant = state.options.variant ? `="${state.options.variant}"` : '';
      const n = own ? 1 : list.length;
      const svgs = Array.from({ length: n }, () => `<svg data-glass${variant}${attrs} viewBox="…">…</svg>`).join('\n');
      return `<script src="https://unpkg.com/glassity"></script>\n\n${svgs}${more ? '\n<!-- … -->' : ''}`;
    }
    case 'js': {
      const obj = o.length ? `{ ${o.map(([k, v]) => `${k}: ${typeof v === 'string' ? `'${v}'` : num(v)}`).join(', ')} }` : '';
      return `import { auto } from 'glassity';\n\n// every <svg data-glass> on the page, now and later\nconst glass = auto(${obj});\n\n// change options any time\nglass.update({ depth: 0.3 });`;
    }
  }
}

function highlight(src: string): string {
  // Small and good enough: comments, strings, keywords, tags.
  return esc(src)
    .replace(/(\/\/[^\n]*|\{\/\*.*?\*\/\}|&lt;!--.*?--&gt;)/g, '\u0000c$1\u0001')
    .replace(/('[^'\n]*'|"[^"\n]*")/g, '\u0000s$1\u0001')
    .replace(/\b(import|from|export|function|return|const)\b/g, '\u0000k$1\u0001')
    .replace(/(&lt;\/?)([A-Za-z][\w-]*)/g, '$1\u0000t$2\u0001')
    .replace(/\u0000(\w)/g, '<span class="tok-$1">')
    .replace(/\u0001/g, '</span>');
}

// ── url state ──────────────────────────────────────────────────────────────

function toHash(): string {
  const p = new URLSearchParams();
  if (state.bg !== 'meadow' && state.bg !== 'upload') p.set('bg', state.bg);
  if (state.layout !== 'dock') p.set('layout', state.layout);
  if (state.set !== 'lucide' && state.set !== 'custom') p.set('set', state.set);
  if (state.set === 'lib') p.set('lib', state.lib);
  if (state.layout === 'single') p.set('icon', state.icon);
  if (state.size[state.layout] !== SIZES[state.layout]) p.set('size', String(state.size[state.layout]));
  if (state.compare) p.set('compare', String(state.split));
  for (const [k, v] of overrides()) p.set(k, String(v));
  return p.toString();
}

function fromHash(): void {
  const p = new URLSearchParams(location.hash.slice(1));
  const known = new Set(GROUPS.flatMap((g) => g.controls.map((c) => c.key as string)));
  const bg = p.get('bg');
  if (bg && BACKDROPS.some((b) => b.id === bg) && bg !== 'upload') state.bg = bg;
  const layout = p.get('layout');
  if (layout && LAYOUTS.some(([l]) => l === layout)) state.layout = layout as Layout;
  const set = p.get('set');
  if (set === 'lucide' || set === 'phosphor' || set === 'logos' || set === 'lib') state.set = set;
  const lib = p.get('lib');
  if (lib && /^[a-z0-9-]+$/.test(lib)) state.lib = lib;
  const icon = p.get('icon');
  // Library names are checked when the set loads.
  if (icon && (state.set === 'lib' ? /^[a-z0-9-]+$/.test(icon) : icons.lucide[icon] || icons.logos[icon])) state.icon = icon;
  const size = Number(p.get('size'));
  if (size >= 24 && size <= 400) state.size[state.layout] = size;
  if (p.has('compare')) {
    state.compare = true;
    state.split = Math.min(95, Math.max(5, Number(p.get('compare')) || 50));
  }
  const options: Record<string, unknown> = {};
  for (const [k, raw] of p) {
    if (!known.has(k)) continue;
    options[k] = raw === 'true' ? true : raw === 'false' ? false : /^-?[\d.]+$/.test(raw) ? Number(raw) : raw;
  }
  state.options = options as GlassOptions;
  // Capture mode for README media: only the stage, with an optional caption.
  if (p.has('capture')) document.documentElement.dataset.capture = '';
  if (p.has('caption')) $('.caption').textContent = p.get('caption');
}

// ── wiring ─────────────────────────────────────────────────────────────────

function segmented<T extends string>(host: HTMLElement, items: [T, string][], get: () => T, set: (v: T) => void): void {
  for (const [value, text] of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', () => set(value));
    host.append(button);
    syncers.push(() => button.setAttribute('aria-pressed', String(get() === value)));
  }
}

let hashTimer = 0;
function update(): void {
  const info = backdropInfo(state.bg);
  stage.dataset.bg = state.bg;
  const image = info.kind === 'photo' ? `url("backdrops/${info.id}.webp")` : info.kind === 'upload' ? `url("${uploadUrl}")` : '';
  if (image) stage.dataset.photo = '';
  else delete stage.dataset.photo;
  if (stage.style.backgroundImage !== image) stage.style.backgroundImage = image;
  if (info.ink) stage.dataset.ink = info.ink;
  else delete stage.dataset.ink;
  $('#bgName').textContent = info.name;
  if (state.compare) stage.dataset.compare = '';
  else delete stage.dataset.compare;
  stage.style.setProperty('--split', `${state.split}%`);
  renderIcons();
  renderPicker();
  applyGlass();
  if (state.bg === 'live' && !liveFrame) liveFrame = requestAnimationFrame(drawLive);
  for (const sync of syncers) sync();
  ($('#size') as HTMLInputElement).value = String(state.size[state.layout]);
  ($('#compare') as HTMLInputElement).checked = state.compare;
  const n = overrides().length;
  $('#changed').textContent = n ? `${n} changed` : 'defaults';
  codeEl.innerHTML = highlight(code());
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    const hash = toHash();
    if (!document.documentElement.hasAttribute('data-capture')) history.replaceState(null, '', hash ? '#' + hash : location.pathname);
  }, 200);
}

function toast(text: string): void {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1400);
}

async function copy(text: string, done = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('Copy failed: select the text instead');
  }
}

function describeStatus(): void {
  const notes: string[] = [];
  if (!isSupported()) notes.push('<b>WebGL2 is not available here</b>, so the icons stay plain SVG. That is the fallback your users would see too.');
  if (matchMedia('(prefers-reduced-transparency: reduce)').matches)
    notes.push('Your system asks for <b>reduced transparency</b>, so the glass is frostier. Turn off “Accessibility” under Motion and system to see it clear.');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) notes.push('Your system asks for <b>reduced motion</b>: no moving highlight or bounce.');
  status.innerHTML = notes.join(' ') || 'Move the pointer over the stage. Click an icon below to look at it alone; click another to watch it morph.';
}

function wire(): void {
  const bgHost = $('#bg');
  for (const info of BACKDROPS) {
    if (info.kind === 'css' && info.id === 'sunset') bgHost.append(Object.assign(document.createElement('span'), { className: 'gap' }));
    const button = document.createElement('button');
    button.type = 'button';
    button.title = info.name;
    button.setAttribute('aria-label', info.name);
    button.dataset.bg = info.id;
    if (info.kind === 'photo') {
      button.dataset.photo = '';
      button.style.backgroundImage = `url("backdrops/${info.id}-thumb.webp")`;
    }
    if (info.label) button.textContent = info.label;
    button.addEventListener('click', () => {
      if (info.kind === 'upload') {
        ($('#photo') as HTMLInputElement).click();
        return;
      }
      state.bg = info.id;
      update();
      controller?.refresh();
    });
    bgHost.append(button);
    syncers.push(() => button.setAttribute('aria-pressed', String(state.bg === info.id)));
  }
  $('#photo').addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (uploadUrl) URL.revokeObjectURL(uploadUrl);
    uploadUrl = URL.createObjectURL(file);
    state.bg = 'upload';
    update();
    controller?.refresh();
  });
  segmented($('#layout'), LAYOUTS, () => (state.set === 'custom' ? 'single' : state.layout), (v) => {
    state.layout = v;
    if (state.set === 'custom' && v !== 'single') state.set = 'lucide';
    update();
  });
  segmented($('#set'), SETS, () => state.set, (v) => {
    if (v === 'lib') {
      void useLibrary(state.lib);
      library.open(state.lib);
      return;
    }
    state.set = v;
    if (v === 'custom') {
      state.layout = 'single';
      if (!state.custom) {
        state.custom = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons.lucide.sparkles.body}</svg>`;
        ($('#customSvg') as HTMLTextAreaElement).value = state.custom;
      }
      customIcon = parseCustom(state.custom);
    }
    update();
  });
  segmented($('#tabs'), TABS, () => state.tab, (v) => {
    state.tab = v;
    update();
  });
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('role', 'tab');

  $('#customSvg').addEventListener('input', (event) => {
    state.custom = (event.target as HTMLTextAreaElement).value;
    const parsed = parseCustom(state.custom);
    if (!parsed) {
      status.textContent = 'That is not a valid <svg> yet.';
      return;
    }
    customIcon = parsed;
    shown = '';
    describeStatus();
    update();
  });

  $('#size').addEventListener('input', (event) => {
    state.size[state.layout] = Number((event.target as HTMLInputElement).value);
    update();
  });
  $('#compare').addEventListener('change', (event) => {
    state.compare = (event.target as HTMLInputElement).checked;
    update();
  });

  const handle = $('.divider button');
  const drag = (event: PointerEvent) => {
    const rect = stage.getBoundingClientRect();
    state.split = Math.min(95, Math.max(5, ((event.clientX - rect.left) / rect.width) * 100));
    update();
  };
  handle.addEventListener('pointerdown', (event) => {
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener('pointermove', drag);
  });
  const stop = () => handle.removeEventListener('pointermove', drag);
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowLeft' ? -2 : event.key === 'ArrowRight' ? 2 : 0;
    if (!step) return;
    event.preventDefault();
    state.split = Math.min(95, Math.max(5, state.split + step));
    update();
  });

  $('#reset').addEventListener('click', () => {
    state.options = {};
    update();
  });
  $('#share').addEventListener('click', () => copy(location.href.split('#')[0] + (toHash() ? '#' + toHash() : ''), 'Link copied'));
  $('#copyCode').addEventListener('click', () => copy(code()));
  for (const b of document.querySelectorAll<HTMLElement>('[data-copy]')) b.addEventListener('click', () => copy(b.dataset.copy!, b.dataset.done));

  // In a real app: the examples page (site/examples) in a frame, one scene at a time.
  const examples: [string, string, string][] = [
    ['dashboard', 'Dashboard', 'shadcn/ui block dashboard-01 with glass quick actions over a photo.'],
    ['mobile', 'Mobile app', 'A feed with a glass tab bar and round glass buttons: the photos bend as they scroll under them.'],
    ['landing', 'Landing page', 'Feature icons as glass over a hero photo, with shadcn/ui buttons and cards.'],
  ];
  let example = 'dashboard';
  const showExample = (id: string) => {
    example = id;
    const url = `examples/index.html#${id}`;
    ($('#exampleFrame') as HTMLIFrameElement).src = url;
    ($('#exampleOpen') as HTMLAnchorElement).href = url;
    $('#exampleNote').textContent = examples.find(([k]) => k === id)![2];
    for (const sync of syncers) sync();
  };
  segmented($('#exampleTabs'), examples.map(([k, label]) => [k, label] as [string, string]), () => example, showExample);
  $('#exampleNote').textContent = examples[0][2];

  // Get started: the install command for each package manager.
  const managers: [string, string][] = [['npm', 'npm i glassity'], ['pnpm', 'pnpm add glassity'], ['yarn', 'yarn add glassity'], ['bun', 'bun add glassity']];
  let manager = 'npm';
  segmented($('#pm'), managers.map(([m]) => [m, m] as [string, string]), () => manager, (m) => {
    manager = m;
    $('#pmCmd').textContent = managers.find(([k]) => k === m)![1];
    for (const sync of syncers) sync();
  });
  $('#pmCopy').addEventListener('click', () => copy($('#pmCmd').textContent!));
  window.addEventListener('hashchange', () => {
    fromHash();
    if (state.set === 'lib') {
      const wanted = state.layout === 'single' ? state.icon : undefined;
      state.libNames = [];
      void useLibrary(state.lib, wanted);
    } else update();
  });
}

// ── icon library ───────────────────────────────────────────────────────────

/** Switch the stage to a set of the library; with a name, show that icon alone. */
async function useLibrary(prefix: string, name?: string): Promise<void> {
  if (!(await setInfo(prefix))) prefix = 'tabler';
  const showcaseNames = await showcase(prefix, 18);
  if (name) await ensure(prefix, [name]);
  state.set = 'lib';
  state.lib = prefix;
  state.libNames = showcaseNames;
  if (name && libIcon(prefix, name)) {
    state.icon = name;
    state.layout = 'single';
  } else if (!libIcon(prefix, state.icon)) state.icon = showcaseNames[0];
  update();
  library.mark();
}

const library = mountLibrary($('#library'), {
  pick: (prefix, name) => void useLibrary(prefix, name),
  current: () => ({ prefix: state.set === 'lib' ? state.lib : null, icon: state.icon }),
});

fromHash();
buildPanel();
wire();
describeStatus();
if (state.set === 'lib') {
  // Draw the stage once the set's icons are in.
  const wanted = state.layout === 'single' ? state.icon : undefined;
  state.set = 'lucide';
  update();
  void useLibrary(state.lib, wanted);
} else update();

// For the media capture script and for poking around in the console.
Object.assign(window, { glassity: { state, update, get controller() { return controller; } } });
