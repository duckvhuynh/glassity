// The real-world examples shown in the playground: shadcn/ui blocks with glassity.
// They use glassity from this repository's source, so they always show the current code.
// Built into ../dist/examples by `npm run build` (run `node site/build.mjs` first).
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const repo = path.resolve(__dirname, '../..');

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  define: { __VERSION__: JSON.stringify('examples') },
  build: { outDir: '../dist/examples', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: 'glassity/react', replacement: path.join(repo, 'src/react.tsx') },
      { find: /^glassity$/, replacement: path.join(repo, 'src/index.ts') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
});
