# Compatibility suite

Small Vite apps, one per framework, that install glassity from the packed tarball (exactly what npm would publish) and are checked in a real browser.

```bash
npm run build
npm run test:compat                       # every app, Chromium
COMPAT_APPS=vue,svelte npm run test:compat
COMPAT_BROWSERS=chromium,webkit npm run test:compat
```

Every app follows the same contract, so one checker (`run.mjs`) covers them all:

- each `<svg data-expect-glass>` must be glass: the original hidden, a drawn canvas right after it and centred on it;
- no other canvas, no console error, no page error;
- `#color` changes a **string** style binding on a glass icon, `#swap` swaps an icon component, `#toggle` removes and re-adds an icon that uses the framework's own adapter.

| App | Uses |
|---|---|
| `vue` | `v-glass`, `useGlass`, `<GlassProvider>` from `glassity/vue`, `@lucide/vue` |
| `svelte` | `use:glass`, `use:glassProvider` from `glassity/svelte`, `@lucide/svelte` |
| `solid` | `use:glass`, `use:glassProvider` from `glassity/solid`, `lucide-solid` |
| `preact` | `<Glass>`, `<GlassProvider>` from `glassity/react` through `preact/compat`, `lucide-preact` |
