import { createController } from 'remix/router';

import { assets } from './assets.ts';
import { routes } from './routes.ts';
import { HomePage, Panel } from './pages.tsx';

export default createController(routes, {
  actions: {
    async assets(context) {
      return (await assets.fetch(context.request)) ?? new Response('Not Found', { status: 404 });
    },
    home(context) {
      return context.render(<HomePage />);
    },
    // Frame content: an HTML fragment that the page reconciles into the live DOM on reload.
    panel(context) {
      const visit = Number(new URL(context.request.url).searchParams.get('visit') ?? '1');
      return context.render(<Panel visit={visit} />);
    },
  },
});
