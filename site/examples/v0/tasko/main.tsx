// Tasko, a task management dashboard by jessin, from the v0 community templates:
// https://v0.app/templates/tasko-modern-task-management-dashboard-SGGKgsJdrxG
// Ported from Next.js to this Vite app with glassity added; the original layout and styles are kept.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import DashboardPage from './page';
import { glassEverywhere } from '../../src/glass-everywhere';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DashboardPage />
  </StrictMode>,
);

glassEverywhere();
