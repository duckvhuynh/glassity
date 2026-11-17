import { useEffect, useState } from 'react';
import { Bell, Calendar, Camera, Star } from 'lucide-react';
import { Glass, GlassProvider } from 'glassity/react';
import { isSupported } from 'glassity';
// Imported on the server too (where it does nothing) and in the browser, where it starts
// before React has hydrated: glassity has to wait on its own.
import 'glassity/auto';

export default function Home() {
  const [color, setColor] = useState('#ffffff');
  const [swapped, setSwapped] = useState(false);
  const [shown, setShown] = useState(true);

  // Runs after hydration: the checker waits for it before clicking.
  useEffect(() => {
    window.__glassity = isSupported();
  }, []);

  return (
    <main>
      <button id="color" onClick={() => setColor('#ffd400')}>color</button>
      <button id="swap" onClick={() => setSwapped(!swapped)}>swap</button>
      <button id="toggle" onClick={() => setShown(!shown)}>toggle</button>

      <div className="stage">
        {shown && (
          <Glass accessibility={false}>
            <Star data-expect-glass="glass" />
          </Glass>
        )}
        {/* handled by glassity/auto */}
        <svg data-glass data-expect-glass="auto" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
        </svg>
      </div>

      <GlassProvider className="stage" accessibility={false} tile>
        <Calendar data-glass data-expect-glass="provider" />
        {swapped ? <Camera data-glass data-expect-glass="swap-b" /> : <Bell data-glass data-expect-glass="swap-a" />}
        {/* A string style replaces the whole style attribute on every change. */}
        <svg data-glass data-expect-glass="string-style" style={{ color }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      </GlassProvider>
    </main>
  );
}
