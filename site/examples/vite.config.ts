// The real-world examples shown in the playground: shadcn/ui blocks and v0 community
// templates, with glassity. They use glassity from this repository's source, so they always
// show the current code. Built into ../dist/examples by `npm run build` (after `node site/build.mjs`).
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const repo = path.resolve(__dirname, '../..');
const src = path.resolve(__dirname, 'src');
// Each v0 template keeps its own "@/..." imports, resolved inside its own folder.
const templates = ['tasko', 'finflow', 'evasion'].map((name) => path.resolve(__dirname, 'v0', name));

function templateAlias(): Plugin {
  return {
    name: 'template-alias',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.startsWith('@/') || !importer) return null;
      const file = importer.replace(/\\/g, '/');
      const root = templates.find((t) => file.startsWith(t.replace(/\\/g, '/') + '/')) ?? src;
      return this.resolve(path.join(root, source.slice(2)), importer, { skipSelf: true });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [templateAlias(), react(), tailwindcss()],
  define: { __VERSION__: JSON.stringify('examples') },
  build: {
    outDir: '../dist/examples',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        tasko: path.resolve(__dirname, 'tasko.html'),
        finflow: path.resolve(__dirname, 'finflow.html'),
        evasion: path.resolve(__dirname, 'evasion.html'),
      },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: 'glassity/react', replacement: path.join(repo, 'src/react.tsx') },
      { find: /^glassity$/, replacement: path.join(repo, 'src/index.ts') },
      { find: 'next/image', replacement: path.join(src, 'shims/next-image.tsx') },
      { find: 'next/link', replacement: path.join(src, 'shims/next-link.tsx') },
      { find: 'next/navigation', replacement: path.join(src, 'shims/next-navigation.ts') },
    ],
  },
});
