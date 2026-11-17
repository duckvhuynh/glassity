// Builds the playground site into site/dist. It bundles glassity from src/, so the site
// always shows the code in this checkout. Usage: node site/build.mjs [--watch]
import { build, context } from 'esbuild';
import { copyFile, cp, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
const out = join(here, 'dist');
const require = createRequire(import.meta.url);
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

// One name per icon, mapped to the Lucide (outline) and Phosphor (fill) versions.
const ICONS = [
  ['house', 'House', 'house'],
  ['search', 'Search', 'magnifying-glass'],
  ['bell', 'Bell', 'bell'],
  ['heart', 'Heart', 'heart'],
  ['settings', 'Settings', 'gear-six'],
  ['camera', 'Camera', 'camera'],
  ['mail', 'Mail', 'envelope-simple'],
  ['map-pin', 'MapPin', 'map-pin'],
  ['calendar', 'Calendar', 'calendar-blank'],
  ['sun', 'Sun', 'sun'],
  ['moon', 'Moon', 'moon'],
  ['sparkles', 'Sparkles', 'sparkle'],
  ['music', 'Music', 'music-notes'],
  ['play', 'Play', 'play'],
  ['cloud', 'Cloud', 'cloud'],
  ['star', 'Star', 'star'],
  ['message', 'MessageCircle', 'chat-circle'],
  ['user', 'User', 'user'],
  ['lock', 'Lock', 'lock'],
  ['bookmark', 'Bookmark', 'bookmark-simple'],
  ['zap', 'Zap', 'lightning'],
  ['leaf', 'Leaf', 'leaf'],
  ['wifi', 'Wifi', 'wifi-high'],
  ['battery', 'BatteryFull', 'battery-high'],
  ['phone', 'Phone', 'phone'],
  ['image', 'Image', 'image'],
  ['folder', 'Folder', 'folder'],
  ['gift', 'Gift', 'gift'],
  ['coffee', 'Coffee', 'coffee'],
  ['compass', 'Compass', 'compass'],
  ['flame', 'Flame', 'flame'],
  ['droplet', 'Droplet', 'drop'],
];

async function iconData() {
  const lucide = require('lucide');
  const phosphorDir = join(root, 'node_modules/@phosphor-icons/core/assets/fill');
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const node = ([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`;
  const pascal = (s) => s.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());
  const data = { lucide: {}, phosphor: {}, components: {} };
  for (const [name, l, p] of ICONS) {
    data.components[name] = { lucide: l, phosphor: pascal(p) };
    data.lucide[name] = {
      viewBox: '0 0 24 24',
      attrs: { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
      body: lucide[l].map(node).join(''),
    };
    const svg = await readFile(join(phosphorDir, `${p}-fill.svg`), 'utf8');
    data.phosphor[name] = {
      viewBox: svg.match(/viewBox="([^"]+)"/)[1],
      attrs: { fill: 'currentColor' },
      body: svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''),
    };
  }
  return data;
}

const icons = {
  name: 'icons',
  setup(b) {
    b.onResolve({ filter: /^virtual:icons$/ }, () => ({ path: 'icons', namespace: 'icons' }));
    b.onLoad({ filter: /.*/, namespace: 'icons' }, async () => ({ contents: JSON.stringify(await iconData()), loader: 'json' }));
  },
};

const options = {
  entryPoints: [join(here, 'main.ts')],
  outfile: join(out, 'main.js'),
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  sourcemap: true,
  define: { __VERSION__: JSON.stringify(version) },
  plugins: [icons],
  logLevel: 'info',
};

const copyStatic = async () => {
  await mkdir(out, { recursive: true });
  const html = (await readFile(join(here, 'index.html'), 'utf8')).replaceAll('%VERSION%', version);
  await (await import('node:fs/promises')).writeFile(join(out, 'index.html'), html);
  await copyFile(join(here, 'favicon.svg'), join(out, 'favicon.svg'));
  // Backdrop photos: site/backdrops/*.webp (made from raw/ by site/backdrops.mjs).
  await cp(join(here, 'backdrops'), join(out, 'backdrops'), { recursive: true, filter: (src) => !/[\/]raw([\/]|$)/.test(src) });
};

await copyStatic();
if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching site/ (index.html is copied once; restart to pick up changes to it)');
} else {
  await build(options);
}
