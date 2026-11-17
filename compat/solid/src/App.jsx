import { createSignal, Show } from 'solid-js';
import { Bell, Calendar, Camera, Star } from 'lucide-solid';
import { glass, glassProvider } from 'glassity/solid';

// Solid directives are referenced by name only; keep the imports alive.
void glass;
void glassProvider;

export function App() {
  const [color, setColor] = createSignal('#ffffff');
  const [swapped, setSwapped] = createSignal(false);
  const [shown, setShown] = createSignal(true);
  return (
    <>
      <button id="color" onClick={() => setColor('#ffd400')}>color</button>
      <button id="swap" onClick={() => setSwapped(!swapped())}>swap</button>
      <button id="toggle" onClick={() => setShown(!shown())}>toggle</button>

      <div class="stage">
        <Show when={shown()}>
          {/* A component: the directive goes on a wrapper. */}
          <span use:glass={{ accessibility: false }}>
            <Star data-expect-glass="directive" />
          </span>
        </Show>
      </div>

      <div class="stage" use:glassProvider={{ accessibility: false, tile: true }}>
        <Calendar data-glass data-expect-glass="provider" />
        <Show when={!swapped()} fallback={<Camera data-glass data-expect-glass="swap-b" />}>
          <Bell data-glass data-expect-glass="swap-a" />
        </Show>
        {/* A string style replaces the whole style attribute on every change. */}
        <svg data-glass data-expect-glass="string-style" style={'color:' + color()} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      </div>
    </>
  );
}
