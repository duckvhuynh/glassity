import { useState } from 'preact/hooks';
import { Bell, Calendar, Camera, Star } from 'lucide-preact';
import { Glass, GlassProvider } from 'glassity/react';

export function App() {
  const [color, setColor] = useState('#ffffff');
  const [swapped, setSwapped] = useState(false);
  const [shown, setShown] = useState(true);
  return (
    <>
      <button id="color" onClick={() => setColor('#ffd400')}>color</button>
      <button id="swap" onClick={() => setSwapped(!swapped)}>swap</button>
      <button id="toggle" onClick={() => setShown(!shown)}>toggle</button>

      <div class="stage">
        {shown && (
          <Glass accessibility={false}>
            <Star data-expect-glass="glass" />
          </Glass>
        )}
      </div>

      <GlassProvider className="stage" accessibility={false} tile>
        <Calendar data-glass data-expect-glass="provider" />
        {swapped ? <Camera data-glass data-expect-glass="swap-b" /> : <Bell data-glass data-expect-glass="swap-a" />}
        {/* A string style replaces the whole style attribute on every change. */}
        <svg data-glass data-expect-glass="string-style" style={'color:' + color} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      </GlassProvider>
    </>
  );
}
