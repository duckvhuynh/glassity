// Bundles the React demo against the built package in ../dist. Run `npm run build` first.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));

await build({
  entryPoints: [join(here, 'react-demo.tsx')],
  outfile: join(here, 'out/react-demo.js'),
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"development"' },
  alias: {
    'glassity/react': join(here, '../dist/react.js'),
    glassity: join(here, '../dist/index.js'),
  },
  logLevel: 'info',
});
