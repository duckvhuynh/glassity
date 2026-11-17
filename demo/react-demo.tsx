import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bell, Calendar, Camera, Heart, House, Mail, Search, Settings, Sparkles } from 'lucide-react';
import { Glass, GlassGroup, GlassProvider, useGlass } from 'glassity/react';

const cycle = [Calendar, Heart, Sparkles, Bell];

function HookIcon() {
  const ref = useRef<SVGSVGElement>(null);
  useGlass(ref, { tile: true, tint: '#34c759', tintOpacity: 0.55 });
  return (
    <svg ref={ref} width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="Add">
      <path d="M5 12h14M12 5v14" />
    </svg>
  );
}

function App() {
  const [index, setIndex] = useState(0);
  const [interactive, setInteractive] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [gap, setGap] = useState(8);
  const [extra, setExtra] = useState(false);
  const Current = cycle[index % cycle.length];

  return (
    <main>
      <h1>glassity — React</h1>
      <p>
        One <code>&lt;GlassProvider selector="svg.lucide" tile&gt;</code> turns every Lucide icon in the first panel into glass. The second
        panel uses <code>&lt;Glass&gt;</code> and <code>useGlass</code> directly.
      </p>

      <section className="stage dusk">
        <h2>GlassProvider — no wrapper per icon</h2>
        <GlassProvider selector="svg.lucide" tile interactive={interactive} accessibility={false}>
          <div className="row">
            {[House, Mail, Camera, Search, Settings].map((Icon, i) => (
              <button key={i} className="icon" aria-label={Icon.displayName}>
                <Icon size={76} aria-hidden />
              </button>
            ))}
            {/* A nested provider inherits and overrides. */}
            <GlassProvider selector="svg.lucide" tile={false} variant="clear">
              <Bell size={76} aria-label="Bell" />
              <Heart size={76} data-glass="off" aria-label="Heart, left as plain SVG" />
            </GlassProvider>
          </div>
        </GlassProvider>
      </section>

      <section className="stage dusk">
        <h2>GlassGroup — icons that join</h2>
        <div className="row">
          <GlassGroup tile interactive spacing={0.4} accessibility={false}>
            <div className="row" style={{ gap }}>
              {[House, Mail, Camera].map((Icon, i) => (
                <button key={i} className="icon" aria-label={Icon.displayName}>
                  <Icon size={64} aria-hidden />
                </button>
              ))}
            </div>
          </GlassGroup>
          <GlassGroup bar interactive accessibility={false}>
            <div className="row" style={{ gap: 26 }}>
              <House size={30} aria-label="Home" />
              <Search size={30} aria-label="Search" />
              {extra && <Bell size={30} aria-label="Alerts" />}
              <Settings size={30} aria-label="Settings" />
            </div>
          </GlassGroup>
          <div className="buttons">
            <label>
              Gap <input type="range" min={-6} max={60} value={gap} onChange={(event) => setGap(Number(event.target.value))} />
            </label>
            <button onClick={() => setExtra((v) => !v)}>{extra ? 'Remove' : 'Add'} an icon in the bar</button>
          </div>
        </div>
      </section>

      <section className="stage ocean">
        <h2>Glass and useGlass</h2>
        <div className="row">
          {mounted && (
            <Glass depth={0.24} dispersion={0.8} accessibility={false}>
              <Current size={104} aria-label="Morphing icon" />
            </Glass>
          )}
          <HookIcon />
          <div className="buttons">
            <button onClick={() => setIndex((i) => i + 1)}>Next icon (morph)</button>
            <button onClick={() => setInteractive((v) => !v)}>Interactive: {interactive ? 'on' : 'off'}</button>
            <button onClick={() => setMounted((v) => !v)}>{mounted ? 'Unmount' : 'Mount'}</button>
          </div>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
