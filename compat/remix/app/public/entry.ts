import { run } from 'remix/component';
// Every [data-glass] on the page becomes glass, including what frames bring in later.
import 'glassity/auto';

const app = run({
  async loadModule(moduleUrl, exportName) {
    const mod = await import(moduleUrl);
    return mod[exportName];
  },
});

app.addEventListener('error', (event) => console.error((event as ErrorEvent).error));
