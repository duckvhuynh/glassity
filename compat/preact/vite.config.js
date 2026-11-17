import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The preset aliases react and react-dom to preact/compat, so glassity/react runs on Preact.
export default defineConfig({ plugins: [preact()] });
