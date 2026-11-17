# Set up glassity

You are an AI coding agent, and someone asked you to add **glassity** to their project. glassity turns the inline SVG icons a site already has into liquid glass, rendered with WebGL2: the page behind each icon bends at its edges, splits into colour at the rim and catches a highlight that follows the pointer. The original `<svg>` stays in the page, so labels, focus and clicks keep working. Browsers without WebGL2 show the plain icon.

Follow the steps below in order. Keep the change small: add glassity, mark a few icons, show the person the result. Do not restyle their app or swap their icon library.

- Repository: https://github.com/duckvhuynh/glassity
- Playground (every option, live): https://duckvhuynh.github.io/glassity/
- Full reference for agents: https://raw.githubusercontent.com/duckvhuynh/glassity/main/skills/glassity/SKILL.md

This guide is enough to set glassity up. Open the full reference only when you need an option or a behaviour this guide does not cover.

## 1. Look at the project

Read `package.json` and the files next to it, then note three things.

**Package manager**, from the lockfile: `package-lock.json` npm, `pnpm-lock.yaml` pnpm, `yarn.lock` yarn, `bun.lock` or `bun.lockb` bun. No `package.json` at all: a plain HTML site (see the script tag in step 3).

**Framework**, from the dependencies:

| Dependency | Use |
|---|---|
| `next` | Next.js |
| `nuxt` | Nuxt |
| `@sveltejs/kit` | SvelteKit |
| `astro` | Astro |
| `react-router` with `@react-router/dev` | React Router (framework mode) |
| `remix` version 3 | Remix 3 |
| `@angular/core` | Angular |
| `vue` | Vue |
| `svelte` | Svelte |
| `solid-js` | Solid |
| `preact` | Preact |
| `react` | React (Vite, CRA or similar) |
| none of these | Plain JavaScript or TypeScript (Vite or another bundler) |

When several match, take the first row that matches: a Next.js app also lists `react`.

**Icons.** Find how icons are drawn: `lucide-react`, `@lucide/vue`, `lucide-vue-next`, `@lucide/svelte`, `lucide-solid`, `@phosphor-icons/*`, `@heroicons/*`, `react-icons`, `@tabler/icons-*`, `@iconify/*`, or `<svg>` written inline. All of these render an inline `<svg>` and work.

Icon **fonts** do not work: Material Symbols or Material Icons loaded as a font, the Font Awesome webfont, `<i class="fa ...">`. There is no SVG to read. Tell the person and suggest the SVG version of the same set (for example `@material-symbols/svg-400`, `@fortawesome/react-fontawesome`, or the set in https://duckvhuynh.github.io/glassity/ under "More sets").

## 2. Install

```bash
npm install glassity
```

Use `pnpm add glassity`, `yarn add glassity` or `bun add glassity` to match the lockfile. No other package is needed; the adapters use the framework the app already has. Leave the person's other packages alone: no `npm audit fix`, no upgrades.

## 3. Turn it on

Pick the one block that matches the framework. Each one makes every `<svg data-glass>` on the page glass. Add it once, at the root of the app.

### React (Vite and similar), Preact

In the root component (usually `src/App.jsx` or `src/App.tsx`), wrap what it returns:

```tsx
import { GlassProvider } from 'glassity/react';

export default function App() {
  return <GlassProvider>{/* what App returned before */}</GlassProvider>;
}
```

`GlassProvider` renders a `<div style="display: contents">`, so it does not change the layout; replacing a fragment `<>…</>` with it is fine.

Preact uses the same `glassity/react` through `preact/compat` (the Preact Vite preset aliases it).

### Next.js (App Router)

Make a small client component and render it once in the root layout:

```tsx
// app/glass.tsx
'use client';
import 'glassity/auto';

export function Glass() {
  return null;
}
```

```tsx
// app/layout.tsx: inside <body>
import { Glass } from './glass';
// ...
<body>
  <Glass />
  {children}
</body>
```

`lucide-react` drops `data-*` props when it renders inside a Server Component, so `<Bell data-glass />` in a server component never reaches the `<svg>`. Mark icons in client components (`'use client'`), or wrap a group in `<GlassProvider selector="svg.lucide">` inside a client component.

### Vue

```js
// main.js
import 'glassity/auto';
```

Or scope it: `import { GlassProvider } from 'glassity/vue'` and wrap part of the template in `<GlassProvider>`.

### Nuxt

```ts
// plugins/glass.client.ts
import 'glassity/auto';
import { vGlass } from 'glassity/vue';

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('glass', vGlass);
});
```

If templates use `v-glass`, also add an empty server version so they compile on the server:

```ts
// plugins/glass.server.ts
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('glass', {});
});
```

### Svelte

```svelte
<script>
  import 'glassity/auto';
</script>
```

Or per element: `import { glass, glassProvider } from 'glassity/svelte'`, then `<nav use:glassProvider>` or `<span use:glass={{ depth: 0.3 }}>`.

### SvelteKit

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { browser } from '$app/environment';
  let { children } = $props();
  if (browser) import('glassity/auto');
</script>

{@render children()}
```

### Astro

In the layout or page, as a client script:

```astro
<script>
  import 'glassity/auto';
</script>
```

Icons inside islands that hydrate later (`client:visible`, `client:idle`) become glass once they have hydrated.

### Solid

```tsx
import { glassProvider } from 'glassity/solid';
void glassProvider; // directives are referenced by name only

<nav use:glassProvider>{/* icons with data-glass */}</nav>
```

### Angular

```ts
// main.ts
import { provideGlassity } from 'glassity/angular';

bootstrapApplication(App, { providers: [provideGlassity()] });
```

Works with zone.js and zoneless. glassity never triggers change detection.

### React Router (framework mode)

```js
// app/root.jsx (or any route module)
import 'glassity/auto';
```

Importing glassity on the server is safe; it starts in the browser after hydration.

### Remix 3

```tsx
import { glass, glassProvider } from 'glassity/remix';

<nav mix={glassProvider()}>…</nav>
```

Add `'glassity'` to `allowPackages` of the asset server so the browser may load it. For static server HTML, import `glassity/auto` in the browser entry instead.

### Plain JavaScript or TypeScript

In the main entry module (for example `src/main.ts`):

```js
import 'glassity/auto';
```

### Plain HTML, no build step

```html
<script src="https://unpkg.com/glassity@0.3"></script>
```

Pin the current version (`npm view glassity version`); before 1.0 a new minor version may change options.

## 4. Mark the icons

Add `data-glass` to the icons that should be glass. Icon components pass it through to their `<svg>`:

```tsx
<Bell data-glass />            {/* lucide-react, react-icons, heroicons, phosphor, tabler, iconify */}
<svg data-glass viewBox="0 0 24 24">…</svg>
```

To make a whole icon set glass without touching every icon, give the provider a selector. Lucide adds the class `lucide` to its icons:

```tsx
<GlassProvider selector="svg.lucide">…</GlassProvider>
```

If the person did not say which icons, choose the most visible ones: the main navigation, a toolbar, a dock, feature cards. Five to ten icons is a good start.

Glass needs two things to look like glass:

- **Size.** It reads best from about 40 px. Under about 28 px it turns into a small solid glyph on light pages, by design.
- **Something behind it.** It refracts what is behind the icon: a photo, a gradient or a CSS background image looks best. Over a plain colour it refracts the HTML around the icon.

## 5. Pick a look

Keep the Default look unless the person asked for a style. Make one adjustment on your own: thin outline icon sets (Lucide, Feather, Tabler, Heroicons outline, Iconoir) look better a little bolder, so add `weight: 0.03`.

Where options go, by setup:

| Setup | Example with `weight: 0.03` |
|---|---|
| React, Preact | `<GlassProvider weight={0.03}>` (options are props) |
| Vue | `<GlassProvider weight="0.03">` or `:options="{ weight: 0.03 }"` |
| Svelte, Solid | `use:glassProvider={{ weight: 0.03 }}` |
| Angular | `provideGlassity({ weight: 0.03 })` |
| Remix 3 | `glassProvider({ weight: 0.03 })` |
| `glassity/auto` (Next.js, Nuxt, SvelteKit, Astro, React Router, plain JS) | `glassity/auto` takes no options. Replace `import 'glassity/auto'` with `import { auto } from 'glassity'; auto({ weight: 0.03 });` in the same file, or put `data-glass-weight="0.03"` on the icons |
| Script tag | `glassity.controller.update({ weight: 0.03 })` after the script, or `data-glass-*` attributes |
| One icon | `data-glass-weight="0.03"` (any option, kebab-case) |

These presets are the same as in the playground:

| Look | Options |
|---|---|
| Default | `{}` |
| Clear | `{ variant: 'clear' }` |
| Frosted | `{ frost: 0.8, tintOpacity: 0.32, dispersion: 0.1, shine: 0.8 }` |
| Crystal | `{ variant: 'clear', depth: 0.34, curvature: 1.7, dispersion: 1.3, shine: 1.6 }` |
| Bold | `{ weight: 0.04, depth: 0.22 }` |
| App-icon tiles | `{ tile: true, interactive: true }` |
| Round buttons | `{ tile: true, tileRadius: 0.5, profile: 'circle', bevel: 0.5, depth: 0.3, weight: 0.02 }` |
| Glass ball lens | `{ tile: true, tileRadius: 0.5, profile: 'dome', variant: 'clear', depth: 0.6, weight: 0.02 }` |

If the person sends a playground link, its settings are in the part after `#`: every key that is an option name (`depth=0.3`, `tile=true`, `variant=clear`, …) is an option to apply. Ignore `bg`, `layout`, `set`, `lib`, `icon`, `size` and `compare`: they only describe the playground.

## 6. Check that it works

Start the dev server (in the background; stop it when you are done) and open the page. glassity starts after the page has loaded and gone idle, so wait about two seconds, then run in the page:

```js
document.querySelectorAll('canvas[data-glassity-canvas]').length // > 0: glass is on
```

Each glass icon gets a `<canvas data-glassity-canvas>` right after its `<svg>`, and the `<svg>` gets `data-glassity-hidden` (it stays in the page, invisible).

- With a headless browser (Playwright, Puppeteer), launch Chromium with `--enable-unsafe-swiftshader --ignore-gpu-blocklist`. Without a GPU it otherwise has no WebGL2, finds no glass, and the check fails although the setup is right.
- Look at the result too, in a screenshot if you can. The icons now show the page through them, so **their CSS `color` no longer shows**: white icons become clear glass. That is expected; tell the person. For whiter or coloured glass use `tint` with `tintOpacity` (for example `{ tint: '#ffffff', tintOpacity: 0.4 }`), or `tile: true` for a solid white mark on a glass plate.
- If you cannot open a browser at all, make sure the build passes and ask the person to look at the page.

| Symptom | Cause and fix |
|---|---|
| No canvas at all | The setup code did not run in the browser, or no element has `data-glass`. Check that the import is in client code. In Next.js it must be in a `'use client'` file. |
| `data-glass` missing on the `<svg>` | The icon component dropped the prop (lucide-react in a Server Component). Use a client component or a provider `selector`. |
| Icon looks flat or invisible | Nothing interesting behind it. Put it over a gradient or photo, or use `tile: true`. |
| Glass is very frosty and tinted | The system asks for reduced transparency (on Windows: Transparency effects off). That is on purpose. `accessibility: false` turns it off, for testing only. |
| Plain icon, no glass | The browser has no WebGL2 (`isSupported()` from `glassity` returns false). The plain icon is the fallback. |
| Icon content missing | A `<use href>` sprite from another origin without CORS. Same-origin sprites work. |
| Blocked images under a strict CSP | `img-src` must allow `blob:` and `data:`. |
| Hydration warning | Should not happen: glassity waits for hydration. If it does, make sure glassity is imported once, from client code, not passed to a server component. |

## 7. Teach yourself for later

The skill file is a complete reference: every option, recipe and edge case, written for agents. Ask the person once whether to save it in the project. If yes, copy it **word for word**, not a summary: from `node_modules/glassity/skills/glassity/SKILL.md` (glassity 0.3.2 and later), or download it with `curl -fsSL https://raw.githubusercontent.com/duckvhuynh/glassity/main/skills/glassity/SKILL.md -o <path>`. Save it to:

- Claude Code: `.claude/skills/glassity/SKILL.md`
- Cursor: `.cursor/rules/glassity.mdc` (keep the text; Cursor reads the front matter as rule metadata)
- Other agents (Codex, Copilot, Windsurf, Gemini, Aider): append a short note to `AGENTS.md`, for example "glassity reference: node_modules/glassity/skills/glassity/SKILL.md".

Whether to commit these files is the person's call.

## 8. Report back

Tell the person, in a few lines:

- which files you changed and which icons are now glass;
- how to tune the look: open https://duckvhuynh.github.io/glassity/, adjust, and press "Copy link" or copy the code shown there;
- that the icons' CSS colour no longer shows (step 6), and how to change it;
- how to turn it off for one icon: `data-glass="off"`; and everywhere: remove the setup code from step 3 (leftover `data-glass` attributes do no harm);
- what is not committed. Do not commit unless the person asked you to.
