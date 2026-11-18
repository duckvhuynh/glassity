// FinFlow, a finance mobile and web app UI by jessin, from the v0 community templates:
// https://v0.app/templates/finflow-modern-finance-mobile-web-app-ui-TdbdgFKSnpg
// Ported from Next.js to this Vite app with glassity added; the original layout and styles are kept.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import './globals.css';
import { FinanceApp } from '@/components/finance/finance-app';
import { glassEverywhere } from '../../src/glass-everywhere';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FinanceApp />
  </StrictMode>,
);

glassEverywhere();
