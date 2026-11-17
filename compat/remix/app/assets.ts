import { createAssetServer } from 'remix/assets';

export const assets = createAssetServer({
  basePath: '/assets',
  rootDir: process.cwd(),
  allowFiles: ['app/**/public/**'],
  // Browser code may only import the packages listed here.
  allowPackages: ['remix', 'glassity'],
  minify: true,
  fingerprint: true,
  watch: false,
});

export const scriptEntry = await assets.getScriptEntry('app/public/entry.ts');
