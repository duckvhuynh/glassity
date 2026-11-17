import { clientEntry, on, ref, type Handle } from 'remix/component';
import { isSupported } from 'glassity';
import { glass, glassProvider } from 'glassity/remix';

declare global {
  interface Window {
    __glassity?: boolean;
  }
}

const STAR = 'M12 2l3 7h7l-5.5 4 2 7-6.5-4.5L5.5 20l2-7L2 9h7z';

export const Controls = clientEntry(import.meta.url, function Controls(handle: Handle) {
  let color = '#ffffff';
  let swapped = false;
  let shown = true;
  let visit = 1;

  return () => (
    <div>
      {/* Runs only in the browser, after hydration: the checker waits for it. */}
      <span hidden mix={ref(() => (window.__glassity = isSupported()))} />
      <button id="color" mix={on('click', () => ((color = '#ffd400'), handle.update()))}>color</button>
      <button id="swap" mix={on('click', () => ((swapped = !swapped), handle.update()))}>swap</button>
      <button id="toggle" mix={on('click', () => ((shown = !shown), handle.update()))}>toggle</button>
      <button
        data-compat-step="frame reloaded"
        mix={on('click', async () => {
          visit++;
          await handle.frames.get('panel')?.reload({ src: `/panel?visit=${visit}` });
        })}
      >
        reload frame
      </button>

      <div class="stage">
        {shown && (
          <svg key="star" mix={glass({ accessibility: false })} data-expect-glass="mixin" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
            <path d={STAR} />
          </svg>
        )}
      </div>

      <div class="stage" mix={glassProvider({ accessibility: false, tile: true })}>
        {swapped ? (
          <svg key="b" data-glass data-expect-glass="swap-b" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
            <rect x="4" y="4" width="16" height="16" rx="3" />
          </svg>
        ) : (
          <svg key="a" data-glass data-expect-glass="swap-a" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
            <circle cx="12" cy="12" r="8" />
          </svg>
        )}
        {/* A string style replaces the whole style attribute on every change. */}
        <svg data-glass data-expect-glass="string-style" style={`color: ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      </div>
    </div>
  );
});
