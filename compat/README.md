# Compatibility suite

Small apps, one per framework, that install glassity from the packed tarball (exactly what npm would publish), are built for production and checked in a real browser. The server-rendered ones (Next.js, Nuxt, SvelteKit, Astro, React Router) also have their server HTML checked and fail on any hydration warning.

```bash
npm run build
npm run test:compat                       # every app, Chromium
COMPAT_APPS=vue,svelte npm run test:compat
COMPAT_BROWSERS=chromium,webkit npm run test:compat
COMPAT_TARBALL=old.tgz npm run test:compat   # check another build
```

An app may describe how it is built and served in `compat.json` (`build`, `start` with `{port}`, `static`, `ssr`); the default is a Vite build served as static files.

Every app follows the same contract, so one checker (`run.mjs`) covers them all:

- each `<svg data-expect-glass>` must be glass: the original hidden, a drawn canvas right after it and centred on it;
- no other canvas, no console error, no page error;
- `#color` changes a **string** style binding on a glass icon, `#swap` swaps an icon component, `#toggle` removes and re-adds an icon that uses the framework's own adapter;
- an app may add `#reveal`, clicked last, to bring in content that hydrates late;
- an app that sets `window.__ticks` (Angular) fails if an idle page with glass runs change detection.

| App | Uses |
|---|---|
| `vue` | `v-glass`, `useGlass`, `<GlassProvider>` from `glassity/vue`, `@lucide/vue` |
| `svelte` | `use:glass`, `use:glassProvider` from `glassity/svelte`, `@lucide/svelte` |
| `solid` | `use:glass`, `use:glassProvider` from `glassity/solid`, `lucide-solid` |
| `preact` | `<Glass>`, `<GlassProvider>` from `glassity/react` through `preact/compat`, `lucide-preact` |
| `angular` | Angular 21 with zone.js: `provideGlassity`, `injectGlass` (as a `[glass]` directive), `injectGlassProvider`; counts change-detection turns while idle |
| `angular-zoneless` | The same on Angular 22 without zone.js. Its CLI needs Node 24.15+, so the app brings one through the `node` package |
| `astro` | Server output with a React island, static markup, `glassity/auto`, and a `client:visible` island revealed last (`#reveal`) |
| `react-router` | React Router 8 framework mode (formerly Remix): `glassity/auto` in a route module, `<Glass>`, `<GlassProvider>` |
| `nextjs` | App Router: server component page, `glassity/auto` from the layout, `<Glass>` and `<GlassProvider>` in a client component |
| `nuxt` | `glassity/auto` and `v-glass` from a client plugin, `<GlassProvider>` |
| `sveltekit` | adapter-node, `glassity/auto` from the layout, `use:glass`, `use:glassProvider` |
