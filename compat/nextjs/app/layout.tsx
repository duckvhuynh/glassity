import type { ReactNode } from 'react';
import { AutoGlass } from './auto-glass';

export const metadata = { title: 'glassity compat: nextjs' };

const css = `
  body { margin: 0; font: 14px system-ui, sans-serif; background: #111; color: #eee; }
  .stage { display: flex; gap: 28px; align-items: center; padding: 36px; flex-wrap: wrap;
    background: repeating-linear-gradient(90deg, #ffffff40 0 2px, transparent 2px 14px), linear-gradient(135deg, #e2572e, #2a2f7a); }
  .stage svg { width: 64px; height: 64px; }
  button { margin: 8px 4px; }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <style>{css}</style>
        {/* glassity/auto loaded from the layout: the path most likely to disturb hydration */}
        <AutoGlass />
        {children}
      </body>
    </html>
  );
}
