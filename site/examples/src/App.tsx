import { useEffect, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Dashboard } from './pages/dashboard';
import { Landing } from './pages/landing';
import { Mobile } from './pages/mobile';

const pages = { dashboard: Dashboard, mobile: Mobile, landing: Landing } as const;
type Page = keyof typeof pages;

const read = (): Page => {
  const id = location.hash.slice(1);
  return id in pages ? (id as Page) : 'dashboard';
};

export default function App() {
  const [page, setPage] = useState<Page>(read);
  useEffect(() => {
    const on = () => setPage(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const Current = pages[page];
  return (
    <TooltipProvider>
      <Current />
    </TooltipProvider>
  );
}
