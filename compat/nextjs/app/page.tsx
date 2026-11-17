// A server component: rendered to HTML on the server, hydrated in the browser.
import { Controls } from './controls';

export default function Page() {
  return (
    <main>
      <Controls />
      <div className="stage">
        {/* Handled by glassity/auto from the layout. A plain <svg>: lucide-react drops
            data-* attributes when it renders inside a server component. */}
        <svg data-glass data-expect-glass="auto" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
        </svg>
      </div>
    </main>
  );
}
