import { readFileSync } from 'node:fs';
import { defineConfig, type Options } from 'tsup';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;
const define = { __VERSION__: JSON.stringify(version) };

/** Frameworks are peers: the app brings its own copy. */
const peers = ['react', 'react/jsx-runtime', 'vue', 'solid-js', 'solid-js/web'];

// Adapters must share ONE engine with the core entry (one WebGL context per
// page), so they import the built core instead of bundling a second copy.
const shareCore: NonNullable<Options['esbuildPlugins']>[number] = {
  name: 'share-core',
  setup(build) {
    const core = build.initialOptions.format === 'cjs' ? './index.cjs' : './index.js';
    build.onResolve({ filter: /^\.\/index$/ }, () => ({ path: core, external: true }));
  },
};

/** Every entry ships as ESM (.js) and CommonJS (.cjs), each with its own types. */
const entry = (name: string, file: string, extra: Options = {}): Options => ({
  entry: { [name]: file },
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  dts: true,
  target: 'es2020',
  define,
  sourcemap: true,
  external: peers,
  ...(name === 'index' ? { clean: true } : { esbuildPlugins: [shareCore] }),
  ...extra,
});

export default defineConfig([
  entry('index', 'src/index.ts'),
  entry('auto', 'src/auto.ts'),
  entry('react', 'src/react.tsx', { banner: { js: "'use client';" } }),
  entry('vue', 'src/vue.ts'),
  entry('svelte', 'src/svelte.ts'),
  entry('solid', 'src/solid.ts'),
  {
    // <script src="https://unpkg.com/glassity"></script> → window.glassity, auto mode on.
    entry: { glassity: 'src/global.ts' },
    format: ['iife'],
    globalName: 'glassity',
    target: 'es2020',
    define,
    minify: true,
    outExtension: () => ({ js: '.global.js' }),
  },
]);
