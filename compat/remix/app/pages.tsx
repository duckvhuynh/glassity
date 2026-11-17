import { Frame, type Handle } from 'remix/component';
import { ImportMap } from 'remix/component/server';

import { scriptEntry } from './assets.ts';
import { Controls } from './public/controls.tsx';

const css = `
  body { margin: 0; font: 14px system-ui, sans-serif; background: #111; color: #eee; }
  .stage { display: flex; gap: 28px; align-items: center; padding: 36px; flex-wrap: wrap;
    background: repeating-linear-gradient(90deg, #ffffff40 0 2px, transparent 2px 14px), linear-gradient(135deg, #e2572e, #2a2f7a); }
  .stage svg { width: 64px; height: 64px; }
  button { margin: 8px 4px; }
`;

const HEART =
  'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z';

export function HomePage() {
  return () => {
    const { href, importMap, preloads } = scriptEntry;
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <title>glassity compat: remix</title>
          <style>{css}</style>
          <ImportMap value={importMap} />
          {preloads.map((preload) => (
            <link key={preload} rel="modulepreload" href={preload} />
          ))}
          <script type="module" src={href}></script>
        </head>
        <body>
          {/* A client entry: hydrates on its own in the browser. */}
          <Controls />

          {/* Static server HTML: glassity/auto from the browser entry handles it. */}
          <div class="stage">
            <svg data-glass data-expect-glass="static" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
              <path d={HEART} />
            </svg>
          </div>

          {/* A frame: its HTML is reconciled into the live DOM again on every reload. */}
          <Frame name="panel" src="/panel" />
        </body>
      </html>
    );
  };
}

export function Panel(handle: Handle<{ visit: number }>) {
  return () => (
    <div class="stage">
      <span>visit {handle.props.visit}</span>
      <svg data-glass data-expect-glass="frame" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M3 10h18M8 2v4M16 2v4" />
      </svg>
    </div>
  );
}
