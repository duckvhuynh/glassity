import { StrictMode, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { GlassProvider, useGlass } from 'glassity/react';

function Icon({ id }: { id: string }) {
  return <svg id={id} data-glass width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="12" cy="12" r="8" /></svg>;
}

function HookIcon() {
  const ref = useRef<SVGSVGElement>(null);
  const [version, setVersion] = useState(0);
  const [visible, setVisible] = useState(true);
  useGlass(ref, { duration: 0, accessibility: false, pointerLight: false });
  return <section id="hook">
    <button onClick={() => setVersion((value) => value + 1)}>Replace hook target</button>
    <button onClick={() => setVisible((value) => !value)}>Toggle hook target</button>
    {visible && <svg key={version} ref={ref} id="hook-icon" data-version={version} width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="12" cy="12" r="8" /></svg>}
  </section>;
}

function App() {
  const [first, setFirst] = useState(true);
  const [second, setSecond] = useState(true);
  return <>
    <button onClick={() => setFirst(false)}>Remove first provider</button>
    <button onClick={() => setSecond(false)}>Remove second provider</button>
    <section id="owners">
      {first && <GlassProvider scope="document" duration={0} accessibility={false} pointerLight={false}>
        <Icon id="inside" />
        {createPortal(<Icon id="portal-icon" />, document.getElementById('portal')!)}
      </GlassProvider>}
      {second && <GlassProvider scope="document" duration={0} accessibility={false} pointerLight={false} />}
    </section>
    <GlassProvider className="neutral-provider"><span>Neutral provider</span></GlassProvider>
    <HookIcon />
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
