// Evasion, an outdoor gear e-commerce landing page by kerroudj, from the v0 community templates:
// https://v0.app/templates/evasion-ecommerce-template-annqMtFCROP
// Ported from Next.js to this Vite app with glassity added; the original layout and styles are kept.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './globals.css';
import Home from './page';
import { glassEverywhere } from '../../src/glass-everywhere';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);

glassEverywhere();
