import { readFileSync } from 'node:fs';
import { defineConfig, type Options } from 'tsup';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;
const define = { __VERSION__: JSON.stringify(version) };

// The React and auto entries must share ONE engine with the core entry (one
// WebGL context per page), so they import the built core instead of bundling it.
const shareCore: NonNullable<Options['esbuildPlugins']>[number] = {
  name: 'share-core',
  setup(build) {
    build.onResolve({ filter: /^\.\/index$/ }, () => ({ path: './index.js', external: true }));
  },
};

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    target: 'es2020',
    define,
    minify: false,
    sourcemap: true,
  },
  {
    entry: { react: 'src/react.tsx' },
    format: ['esm'],
    dts: true,
    target: 'es2020',
    define,
    external: ['react', 'react/jsx-runtime'],
    esbuildPlugins: [shareCore],
    banner: { js: "'use client';" },
    sourcemap: true,
  },
  {
    entry: { auto: 'src/auto.ts' },
    format: ['esm'],
    dts: true,
    target: 'es2020',
    define,
    esbuildPlugins: [shareCore],
    sourcemap: true,
  },
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
