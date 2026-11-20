# Set up glassity

You are an AI coding agent, and someone asked you to add **glassity** to their project. glassity turns the inline SVG icons a site already has into liquid glass, rendered with WebGL2: the page behind each icon bends at its edges, splits into colour at the rim and catches a highlight that follows the pointer. The original `<svg>` stays in the page, so labels, focus and clicks keep working. Browsers without WebGL2 show the plain icon.

Follow the steps below in order. Keep the change small: add glassity, mark a few icons, show the person the result. Do not restyle their app or swap their icon library.

- Repository: https://github.com/duckvhuynh/glassity
- Playground (every option, live): https://duckvhuynh.github.io/glassity/
- Full reference for agents: https://cdn.jsdelivr.net/npm/glassity@0.3/skills/glassity/SKILL.md

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

Use `pnpm add glassity`, `yarn add glassity` or `bun add glassity` to match the lockfile. No other package is needed; the adapters use the framework the app already has. Leave the person's other packages alone: no `npm audit fix`, no upgrades. The package manager may reformat `package.json`; that is fine.

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

`GlassProvider` renders a `<div style="display: contents">`, including when only `className` is supplied, so it does not change the layout. For no wrapper at all and discovery across the whole document, including portals, use `<GlassProvider scope="document">`. Multiple document providers share discovery until the last one unmounts. Their selectors are combined; when options conflict, the last-mounted document provider wins. Removing it restores the remaining providers’ values.

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

In `src/main.js` (or `main.ts`):

```js
import 'glassity/auto';
```

That is the default. Use `GlassProvider` from `glassity/vue` instead only when one part of the page needs its own options: wrap that part of a component's template in `<GlassProvider>`.

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

`@0.3` was the current minor version when this guide was written. Use the current one (`npm view glassity version`, keep major and minor): before 1.0 a new minor version may change options.

## 4. Mark the icons

Add `data-glass` to the icons that should be glass. Icon components pass it through to their `<svg>`:

```tsx
<Bell data-glass />            {/* React, Preact, Solid: lucide, react-icons, heroicons, phosphor, tabler, iconify */}
<svg data-glass viewBox="0 0 24 24">…</svg>
```

```vue
<Search data-glass :size="48" />                     <!-- Vue: @lucide/vue, lucide-vue-next and most icon components -->
<component :is="item.icon" data-glass />             <!-- dynamic components pass it on too -->
```

```svelte
<Search data-glass size={48} />                      <!-- Svelte: @lucide/svelte and most icon components -->
```

To make a whole icon set glass without touching every icon, give the provider a selector. Lucide adds the class `lucide` to its icons:

```tsx
<GlassProvider selector="svg.lucide">…</GlassProvider>
```

If the person did not say which icons, choose icons that will look like glass, using these two rules:

- **Size: 40 px or more for a pronounced glass effect.** Smaller icons have less room for the bevel and the bending. Under about 28 px, automatic legibility keeps them near-black on light neutral surfaces and blends toward their CSS colour on dark or saturated surfaces.
- **Choose the surface for the look.** Photos and gradients show refraction; solid buttons and plain dashboards get studio highlights automatically with `environment: 'auto'`. No backdrop declaration or extra wrapper is needed.

Good first choices: feature or category icons in a hero, a dock or toolbar over a colourful background, icons on cards with an image. Five to ten icons is a good start.

Small toolbar and tab icons can use the defaults without wrappers or backdrop declarations. Small icons on dark and saturated surfaces now look different: glassity uses their CSS `color` to keep contrast and respects its alpha, so dimmed icons stay dimmer. The size is measured after padding; a 48 px tile with default padding has a glyph of about 27 px. Check readability in both active and inactive states.

### Buttons, pills, toolbars and tab bars

For a glass background behind ordinary content, put `data-glass="surface"` on an existing HTML container such as a `button`, `nav` or `div`. Keep its CSS size and `border-radius`; individual and elliptical corner radii are read automatically. The setup from step 3 also discovers these surfaces, including through React and Vue providers. If you use a custom selector, include `[data-glass]`.

```html
<button data-glass="surface" style="border-radius: 999px">Save</button>
<nav data-glass="surface" data-glass-look="frosted" style="border-radius: 24px">
  <!-- Existing links, labels and icons stay here. -->
</nav>
```

Replaced elements and native controls (`input`, `img`, `video`, `canvas`, `select`, `textarea`) cannot host the rendering canvas and remain unchanged. No wrapper or explicit backdrop is needed for supported containers. Labels stay selectable, buttons stay clickable, and focus rings stay visible. Inner SVGs stay plain unless they carry `data-glass` explicitly, even with a provider selector that matches all SVGs. For a single element in code, use `glassify(element, { surface: true, look: 'clear' })`. Material options apply to the slab; CSS continues to style the children. Large surfaces cap DPR at 1.5, or a lower `maxDpr`.

## 5. Pick a look

Keep the Default look unless the person asked for a style. Make one adjustment on your own: thin outline icon sets (Lucide, Feather, Tabler, Heroicons outline, Iconoir) look better a little bolder, so add `weight: 0.03`.

Where options go, by setup:

| How you turned it on in step 3 | Example with `weight: 0.03` |
|---|---|
| `import 'glassity/auto'` (Vue, Svelte, Next.js, Nuxt, SvelteKit, Astro, React Router, plain JS) | Keep the import and add `import { configure } from 'glassity'; configure({ weight: 0.03 });` in the same file, or put `data-glass-weight="0.03"` on the icons |
| `GlassProvider` from `glassity/react` (React, Preact) | `<GlassProvider weight={0.03}>` (options are props) |
| `GlassProvider` from `glassity/vue` | `<GlassProvider weight="0.03">` or `:options="{ weight: 0.03 }"` |
| `use:glassProvider` (Svelte, Solid) | `use:glassProvider={{ weight: 0.03 }}` |
| `provideGlassity` (Angular) | `provideGlassity({ weight: 0.03 })` |
| `glassProvider` mixin (Remix 3) | `glassProvider({ weight: 0.03 })` |
| Script tag | `glassity.controller.update({ weight: 0.03 })` after the script, or `data-glass-*` attributes |
| One icon | `data-glass-weight="0.03"` (any option, kebab-case) |

Keep `tint: 'auto'` and `legibility: 'auto'` (the defaults) for automatic small-icon contrast. `legibility: 'off'` disables the new dark/saturated backdrop correction; the corrected glyph sizing after padding still applies, including on tiles. To follow the icon's computed CSS colour explicitly at any size, use `{ tint: 'currentColor', tintOpacity: 0.55 }`. Colour changes from classes, state or themes are picked up automatically. Explicit tints, including `currentColor`, bypass automatic legibility. These also work as `data-glass-legibility="off"` and `data-glass-tint="currentColor"`.


Named looks use the library's recipes, also used by the playground. Set `look` as a provider option or `data-glass-look="frosted"` on one icon:

| Look | Options |
|---|---|
| Default | `{ look: 'default' }` |
| Clear | `{ look: 'clear' }` |
| Frosted | `{ look: 'frosted' }` |
| Crystal | `{ look: 'crystal' }` |
| Tinted | `{ look: 'tinted' }` |
| Bold | `{ look: 'bold' }` |
| Flat dashboards and solid buttons | Default `{ environment: 'auto' }` |
| Studio lights over any backdrop | `{ environment: 'studio' }` |
| Soft studio highlights | `{ environment: 'studio', frost: 0.6 }` |
| Original ambient reflection only | `{ environment: 'none' }` |
| App-icon tiles | `{ tile: true, interactive: true }` |
| Round buttons | `{ tile: true, tileRadius: 0.5, profile: 'circle', bevel: 0.5, depth: 0.3, weight: 0.02 }` |
| Glass ball lens | `{ tile: true, tileRadius: 0.5, profile: 'dome', variant: 'clear', depth: 0.6, weight: 0.02 }` |

Studio lighting adds a broad window reflection, a softer opposite fill and a dark horizon tinted by the backdrop. `environment: 'auto'` (the default) strengthens flat surfaces and fades the lights over detailed backdrops, keeping photos essentially unchanged. `studio` keeps the lights on; `none` preserves the original ambient reflection. `reflection` controls the strength and `frost` broadens the highlights, with Fresnel keeping them restrained. Use the same option on a provider, `glassify(svg, { environment: 'studio' })`, or `data-glass-environment="studio"` on one icon.

`configure({ look: 'frosted' })` sets page defaults for existing and future icons; `configure({})` resets them. Each call replaces the page defaults and does not start discovery. Nested providers and `auto({ root })` scopes inherit by DOM ancestry. Explicit options apply in order: page defaults, outer scope, inner scope, icon attributes, then an icon's own options. The selected look's recipe sits below all explicit options; changing looks drops the previous recipe but keeps explicit overrides. `looks` and `type GlassLook` are exported from `glassity` if you need to inspect recipes or type a look picker.

If the person sends a playground link, its settings are in the part after `#`: every key that is an option name (`depth=0.3`, `tile=true`, `variant=clear`, …) is an option to apply. Ignore `bg`, `layout`, `set`, `lib`, `icon`, `size` and `compare`: they only describe the playground.

### Optional: authored app-icon layers

Only add layers when the person wants an app icon built from separate glass bodies. Keep the existing provider or import. Add `data-glass-layers` to the SVG and mark its groups explicitly:

```html
<svg data-glass data-glass-layers data-glass-colors="source"
     data-glass-appearance="dark" viewBox="0 0 100 100" width="96" height="96">
  <g data-glass-layer="base" fill="#2479ef">
    <rect x="4" y="4" width="92" height="92" rx="24" />
  </g>
  <g data-glass-layer="mark" data-glass-depth="0.08" fill="#ffffff">
    <circle cx="50" cy="50" r="23" />
  </g>
</svg>
```

Each later group refracts the layers below it. Groups can override depth, frost, tint and opacity with `data-glass-*` attributes. `appearance` is `default`, `dark` (dark base, light marks), `clear`, or `tinted` (one colour from `tint`). The same options work in code: `{ layers: true, colors: 'source', appearance: 'dark' }`.

There is a four-layer cap, in SVG document order. Ordinary exporter groups stay a single body unless explicitly marked. Put all visible artwork inside marked groups; artwork outside them and layers beyond four are omitted. Source colours mean one solid fill (or stroke) tint per layer, not multicolour or gradient textures. Layer additions and removals update automatically. See the full reference for nested groups and appearance override rules.

### Motion, when requested

For interactive buttons, add `interactive: true` to the provider or `data-glass-interactive` to the SVG. The default `interaction: 'subtle'` adds a gentle hover/focus-visible highlight and press swell; choose `'bouncy'` for a stronger spring or `'none'` to disable feedback. Attributes use `data-glass-interaction="bouncy"`. Enter/Space on the existing host button triggers the same press feedback. A press briefly lights nearby glass within about 120 px; no wrappers or backdrop settings are needed.

For a sequence controlled by a slider or scroll library:

```ts
import { glassify } from 'glassity';

const handle = glassify(svg);
const sequence = handle.sequence([heartSvg, starSvg, checkSvg], { autoplay: false });
await sequence.ready; // every shape preloaded; catch errors here
sequence.seek(0.5);   // 0–1 from the slider/scroll callback
// sequence.play(), sequence.pause(), sequence.cancel()
// await sequence.finished -> 'completed' or 'cancelled'
```

Pass at least two shapes, as SVG elements or complete SVG markup strings. The mounted icon must have a laid-out size. `duration` is total milliseconds (default `1000`), `loop` defaults to `false` and `autoplay` to `true`. Cancelling or replacing an active sequence preserves the current blend. Reduced motion jumps playback to the end and disables spreading light and swell; manual seeking still works. Only add a sequence when the person asks for one; ordinary path changes already morph automatically.

## 6. Check that it works

Start the dev server (in the background; stop it when you are done, and kill the process if the port stays taken) and open the page. glassity starts after DOM readiness and a bounded idle wait, then mounts icons in small batches while respecting deferred hydration. Wait for the first glass canvas instead of checking at once:

```js
// Playwright
await page.waitForFunction(() => document.querySelector('canvas[data-glassity-canvas]'), null, { timeout: 10_000 });
await page.evaluate(() => document.querySelectorAll('canvas[data-glassity-canvas]').length); // > 0: glass is on
```

Each glass icon gets a `<canvas data-glassity-canvas>` right after its `<svg>`, and the `<svg>` gets `data-glassity-hidden` (it stays in the page, invisible). A surface instead keeps its content visible above its canvas. Check that a surface follows a resize and its CSS corner radii, and that its buttons, text selection and keyboard focus still work.

- With a headless browser (Playwright, Puppeteer), launch Chromium with `--enable-unsafe-swiftshader --ignore-gpu-blocklist`. Without a GPU it otherwise has no WebGL2, finds no glass, and the check fails although the setup is right. Console warnings like "GPU stall due to ReadPixels" come from that software renderer and are harmless.
- Look at the result too, in a screenshot if you can. Check small icons on white, dark and saturated surfaces, including an active tab or button. Small automatic icons use near-black ink on light neutral surfaces and their CSS `color` on other surfaces; larger icons remain more transparent. To follow CSS colour at any size, use `{ tint: 'currentColor', tintOpacity: 0.55 }`, or choose an explicit tint such as `{ tint: '#ffffff', tintOpacity: 0.4 }`.
- If you cannot open a browser at all, make sure the build passes and ask the person to look at the page.

| Symptom | Cause and fix |
|---|---|
| No canvas at all | The setup code did not run in the browser, or no element has `data-glass`. Check that the import is in client code. In Next.js it must be in a `'use client'` file. |
| `data-glass` missing on the `<svg>` | The icon component dropped the prop (lucide-react in a Server Component). Use a client component or a provider `selector`. |
| Icon looks flat or invisible | For small icons, check that their CSS `color` contrasts with the surface and `legibility` is `auto`. On flat surfaces leave `environment: 'auto'`, or use `studio` to keep highlights on; check that `reflection` is above 0. |
| Glass is very frosty and tinted | The system asks for reduced transparency (on Windows: Transparency effects off). That is on purpose. `accessibility: false` turns it off, for testing only. |
| Plain icon, no glass | The browser has no WebGL2 (`isSupported()` from `glassity` returns false). The plain icon is the fallback. |
| Icon content missing | A `<use href>` sprite from another origin without CORS. Same-origin sprites work. |
| Blocked images under a strict CSP | `img-src` must allow `blob:` and `data:`. |
| Hydration warning | Should not happen: glassity waits for hydration. If it does, make sure glassity is imported once, from client code, not passed to a server component. |

## 7. Teach yourself for later

The skill file is a complete reference: every option, recipe and edge case, written for agents. Ask the person once, for example: "Should I save the glassity reference in the project, so I know how to use it next time?" If yes, copy it **word for word**, not a summary: from `node_modules/glassity/skills/glassity/SKILL.md` (glassity 0.3.2 and later), or download it with `curl -fsSL https://cdn.jsdelivr.net/npm/glassity@0.3/skills/glassity/SKILL.md -o <path>`. Save it to:

- Claude Code: `.claude/skills/glassity/SKILL.md`
- Cursor: `.cursor/rules/glassity.mdc` (keep the text; Cursor reads the front matter as rule metadata)
- Other agents (Codex, Copilot, Windsurf, Gemini, Aider): append a short note to `AGENTS.md`, for example "glassity reference: node_modules/glassity/skills/glassity/SKILL.md".

Whether to commit these files is the person's call.

## 8. Report back

Tell the person, in a few lines:

- which files you changed (including a saved skill file) and which icons are now glass, and which ones you left alone and why;
- how to tune the look: open https://duckvhuynh.github.io/glassity/, adjust, and press "Copy link" or copy the code shown there;
- how small icons adapt to the surface and CSS colour (step 6), and how to use `tint: 'currentColor'` or opt out with `legibility: 'off'`;
- how to turn it off for one icon: `data-glass="off"`; and everywhere: remove the setup code from step 3 (leftover `data-glass` attributes do no harm);
- what is not committed. Do not commit unless the person asked you to.
