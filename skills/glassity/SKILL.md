---
name: glassity
description: Use when adding, styling, animating or debugging liquid-glass SVG icons, text and icon fonts with the glassity library (data-glass attributes, GlassProvider, Glass, glassify, auto, glassity/react, glassity/vue, glassity/svelte, glassity/solid, glassity/angular, glassity/remix, glassity/auto). Covers setup in every framework, all options with defaults and ranges, recipes for common looks, server rendering, accessibility and troubleshooting.
---

# glassity

glassity turns inline SVG icons and short text into liquid glass with WebGL2. It reads the outline of an `<svg>`, builds a distance field from it, and draws the icon as a lens that refracts what is behind it, with dispersion at the rim, frost, a specular highlight that follows the pointer and a soft shadow. The original `<svg>` stays in the DOM (hidden with an attribute), so its accessible name, focus and clicks are unchanged. Without WebGL2 the plain icon shows.

- Package: `glassity` on npm. ESM and CommonJS, types for every `moduleResolution`. No runtime dependencies.
- Playground with every option: https://duckvhuynh.github.io/glassity/
- Setup guide for agents: https://cdn.jsdelivr.net/npm/glassity@0.3/get-started.md

## How it works, in one paragraph

Each glass icon gets a `<canvas data-glassity-canvas>` inserted right after its `<svg>`, positioned over it and sized larger than it (room for the bevel and shadow). One WebGL2 context, shared by the whole page, draws every icon. The SVG is rasterised once (and again when its paths change), turned into a distance field plus local thickness, and the shader turns that into a curved glass surface. Thin strokes become round tubes; wide shapes get a flat top and a bevelled rim. What the glass refracts is the backdrop: the CSS background image of the nearest ancestor that paints one, or a snapshot of the HTML around the icon, or a source you pass.

## Entry points

| Import | What it gives |
|---|---|
| `glassity` | `glassify(element, options)`, `auto(options)`, `configure(options)`, `looks`, `isSupported()`, types including `GlassLook` |
| `glassity/auto` | Side effect: every `[data-glass]` on the page becomes glass, now and later |
| `glassity/react` | `GlassProvider`, `Glass`, `useGlass` (also Preact through `preact/compat`) |
| `glassity/vue` | `GlassProvider`, `vGlass` (directive `v-glass`), `useGlass` |
| `glassity/svelte` | `glass`, `glassProvider` actions |
| `glassity/solid` | `glass`, `glassProvider` directives |
| `glassity/angular` | `provideGlassity`, `injectGlass`, `injectGlassProvider` |
| `glassity/remix` | `glass`, `glassProvider` mixins (Remix 3) |
| `https://unpkg.com/glassity@0.3` | Script-tag build: `window.glassity` and page-wide auto mode |

### Core API

```ts
import { glassify, auto, configure, looks, isSupported, type GlassLook } from 'glassity';

configure({ look: 'frosted', duration: 300 }); // page defaults, existing and future icons

const one = glassify(svgOrElementContainingSvg, { tile: true });
one.update({ depth: 0.3 }); // change some options
one.set({ look: 'clear' }); // replace own options
one.retarget(otherSvg);     // move the glass to another SVG; the shape morphs
one.refresh();              // re-read the icon and the backdrop
one.destroy();              // remove the glass, show the SVG again

const group = auto({ root: element, selector: 'svg.lucide', tile: true }); // default root: document, selector: [data-glass]
group.update({ depth: 0.3 });
group.set({});
group.refresh();
group.destroy();

configure({}); // reset page defaults; scopes and own options remain
const selected: GlassLook = 'crystal';
console.log(looks[selected]); // readonly recipe
isSupported(); // false without WebGL2
```

`auto()` watches the DOM: icons added later become glass, removed ones are cleaned up, `data-glass="off"` opts out. Providers and `auto({ root })` scopes inherit from the nearest enclosing scope by DOM ancestry. Changing an outer scope updates its descendants.

`configure(options)` replaces page defaults beneath every scope and updates existing and future icons. It accepts every glass option, including `look`; `configure({})` resets this layer. It does not start discovery. Importing glassity remains safe during server rendering.

### Text and icon fonts

The existing provider, `auto()` or `glassity/auto` discovers `data-glass="text"` without another wrapper or backdrop setting:

```html
<h1 data-glass="text">Made of light</h1>
<span class="material-symbols-outlined" data-glass="text">home</span>
```

For a single element, use `glassify(element, { text: true, look: 'clear' })`. `GlassHandle.element` and `retarget(element)` use the exported `GlassElement = HTMLElement | SVGSVGElement`; narrow the type before accessing SVG-only properties. React also supports `useGlass(ref, { text: true })` and `<Glass text>`; prefer marking text inside the existing provider when individual handles are unnecessary. All glass appearance options apply. `strokeWidth` only applies to SVG strokes.

Text is rasterised through the browser with computed typography and embedded web fonts. It preserves ligatures, letter-spacing, horizontal RTL and wrapped line layout. Raster resolution and the small-glyph legibility policy follow font size rather than the heading's overall width. It waits for `document.fonts.ready` and updates after font loading, content changes and layout changes. The original text stays selectable and accessible under the pointer-transparent canvas, hidden only by the same opacity marker used for SVGs. Destroy, printing, forced colours and unavailable WebGL2 show the original.

Limits per text source: **512 UTF-16 code units, eight rendered lines, 64 descendant elements**. Exceeding a cap leaves the entire source plain; do not truncate it. Use real text nodes and inline formatting in short headings, wordmarks or glyphs, not long paragraphs. Translation and positive axis-aligned scale work; vertical writing, rotation, skew, perspective and reflection deliberately leave the original visible. Use installed system fonts or CSS `@font-face` with readable rules and same-origin/CORS-enabled font files. Usable font `src` alternatives survive failures in other alternatives. If no source can be embedded or resolved locally, the original remains visible. FontFace API-only fonts and glyphs only in `::before`/`::after` are not supported by this source.

### React

```tsx
import { GlassProvider, Glass, useGlass } from 'glassity/react';

<GlassProvider depth={0.3} tile>          {/* every [data-glass] inside */}
  <Bell data-glass />
</GlassProvider>

<GlassProvider selector="svg.lucide">…</GlassProvider>  {/* a whole icon set */}

<Glass tile interactive>                   {/* one icon; swapping the child morphs */}
  <Calendar size={64} />
</Glass>

const ref = useRef<SVGSVGElement>(null);
useGlass(ref, { variant: 'clear' });
```

Options are props. `GlassProvider` also takes `selector`, `scope`, `as`, `className`, `style`. Its default wrapper uses `display: contents`, including with `className` alone; `style` can give it a layout. `<GlassProvider scope="document" look="frosted">` renders no wrapper, only context and children, and discovers icons across the document, including portals. Document providers share one controller until the last unmounts. Their selectors are combined; when options conflict, the last-mounted document provider wins. Removing it restores the remaining providers’ values. `useGlass` follows the ref if a render changes its target element. The files carry `'use client'`.

Next.js: `lucide-react` drops `data-*` props inside Server Components. Mark icons in client components, use a provider `selector`, or import `glassity/auto` from a `'use client'` file rendered in the root layout.

### Vue

```vue
<script setup>
import { GlassProvider, vGlass } from 'glassity/vue';
</script>

<template>
  <GlassProvider tile :depth="0.3">   <!-- attributes in kebab-case, or :options="{...}" -->
    <House data-glass />
  </GlassProvider>
  <Calendar v-glass="{ depth: 0.3 }" />
</template>
```

`useGlass(templateRef, options)` for a ref. Nuxt: register in `plugins/glass.client.ts` (`import 'glassity/auto'`, `nuxtApp.vueApp.directive('glass', vGlass)`) and an empty `glass` directive in `plugins/glass.server.ts`.

### Svelte

```svelte
<script>
  import { glass, glassProvider } from 'glassity/svelte';
</script>

<nav use:glassProvider={{ tile: true }}>…</nav>
<span use:glass={{ depth: 0.3 }}><Calendar /></span>
```

Actions work on elements: put `use:glass` on the `<svg>` or on a wrapper of an icon component. SvelteKit: `if (browser) import('glassity/auto')` in `+layout.svelte`.

### Solid

```tsx
import { glass, glassProvider } from 'glassity/solid';
void glass, glassProvider; // directives are referenced by name only

<nav use:glassProvider={{ tile: true }}>…</nav>
<span use:glass={{ depth: 0.3 }}><Calendar /></span>
```

### Angular

```ts
import { provideGlassity, injectGlass, type GlassOptions } from 'glassity/angular';

bootstrapApplication(App, { providers: [provideGlassity({ tile: true })] }); // every [data-glass]

@Directive({ selector: '[glass]' })
export class GlassDirective {
  readonly glass = input<GlassOptions | ''>('');
  constructor() { injectGlass(() => this.glass() || {}); } // options read as a signal
}
```

Plain functions, no decorators shipped. Works with zone.js and zoneless; glassity runs outside zones and never triggers change detection. `injectGlassProvider()` scopes a container.

### Remix 3

```tsx
import { glass, glassProvider } from 'glassity/remix';
<svg mix={glass({ tile: true })} viewBox="0 0 24 24">…</svg>
<nav mix={glassProvider({ selector: 'svg' })}>…</nav>
```

Browser-only mixins. Add `glassity` to the asset server's `allowPackages`. For static server HTML use `glassity/auto` in the browser entry.

### Astro, React Router, plain HTML

- Astro: `<script>import 'glassity/auto';</script>` in a layout. Late islands become glass after they hydrate.
- React Router framework mode: `import 'glassity/auto'` in `app/root` or a route module.
- No build: `<script src="https://unpkg.com/glassity@0.3"></script>` (pin the current version) and `data-glass` on icons. `window.glassity.controller.update({...})` changes the page-wide options.

## Attributes

| Attribute | Effect |
|---|---|
| `data-glass` | Glass with the shared options |
| `data-glass="clear"` | Pick a variant: `regular`, `clear`, `identity` |
| `data-glass="text"` | Use the element's text or icon-font glyph as the shape |
| `data-glass="off"` | Leave this icon alone |
| `data-glass-look="crystal"` | Pick a named look |
| `data-glass-depth="0.3"`, `data-glass-tile`, `data-glass-light-angle="-30"` | Any option, kebab-case; a bare attribute is `true` |

## Options

All optional. Lengths are fractions of the icon's box, so a look holds at any size. Explicit option precedence: `configure()` page defaults, outer scope, inner scope, attributes on the icon, then options passed to `glassify`/`Glass`. Later layers win; `undefined` does not override. The selected look's recipe sits below all explicit options. For example, `configure({ depth: 0.2 })` keeps depth at 0.2 even under an inner `look: 'crystal'`.

| Option | Default | Range | Effect |
|---|---|---|---|
| `look` | `'default'` | `default`, `clear`, `frosted`, `crystal`, `tinted`, `bold` | Named recipe below explicit options; changing looks drops the previous recipe |
| `text` | `false` | boolean | Use an HTML text element instead of looking for an SVG; also enabled by `data-glass="text"` |
| `variant` | `'regular'` | `regular`, `clear`, `identity` | `clear` presets: frost 0, saturation 1.1, contrast 1, tintOpacity 0.04, dim `auto`, dispersion 0.5. `identity` leaves the SVG as is |
| `profile` | `'squircle'` | `squircle`, `circle`, `lip`, `dome` | Edge cross-section. `dome`: a glass ball traced through both surfaces; magnifies, and from depth about 0.3 shows the page upside down. Best on a round tile |
| `tile` | `false` | boolean | Rounded glass plate filling the SVG's box; the icon becomes a glass mark on it |
| `tileRadius` | `0.26` | 0 to 0.5 | Plate corner radius; `0.5` is a circle on a square box |
| `glyphOpacity` | `0.9` | 0 to 1 | How solid the mark is on a plate |
| `padding` | `0` (`0.22` with tile) | 0 to 0.45 | Inset of the icon in its box |
| `strokeWidth` | from the SVG | > 0 | Override stroke width in viewBox units; stroked icons only |
| `weight` | `0` | -0.03 to 0.08 | Bolder (or thinner) shape, stroked or filled, by growing the outline |
| `bevel` | `0.09` | 0.005 to 0.5 | Width of the curved edge; strokes thinner than it become round tubes |
| `curvature` | `1` | 0 to 4 | Steepness of the edge; 0 is flat glass |
| `depth` | `0.16` | 0 to 2 | Optical depth: how far light travels after bending |
| `ior` | `1.5` | 1 to 2.5 | Index of refraction |
| `refraction` | `1` | 0 to 8 | Overall strength of the bending |
| `dispersion` | `0.35` | 0 to 2 | Colour separation at the rim |
| `bands` | `6` | 1 to 8 | Wavelength samples for dispersion (cost) |
| `frost` | `0.3` | 0 to 1 | Blur of what is seen through |
| `saturation` | `1.35` | 0 to 3 | Of what is seen through |
| `brightness` | `1` | 0 to 3 | Of what is seen through |
| `contrast` | `0.9` | 0 to 2 | Of what is seen through |
| `tint` | `'auto'` | CSS colour, `currentColor` or `auto` | Glass body colour. `currentColor` follows the icon's computed `color`, including alpha. Small automatic icons turn near-black on light neutral surfaces and blend toward their CSS colour on dark or saturated surfaces |
| `tintOpacity` | `0.14` | 0 to 1 | How much tint is mixed in |
| `legibility` | `'auto'` | `auto`, `off` | Help small automatic glyphs read on dark or saturated backdrops. `off` disables this contrast correction; explicit tints are unchanged |
| `dim` | `0` | 0 to 1 or `'auto'` | Darkening under the glass. `auto` (clear default): up to 35% over bright, busy backdrops only |
| `opacity` | `1` | 0 to 1 | Overall opacity. An inline `opacity` on the `<svg>` also applies |
| `shine` | `1` | 0 to 4 | Specular highlight |
| `rim` | `1` | 0 to 4 | Thin light along the edge |
| `reflection` | `0.6` | 0 to 4 | Fresnel reflection of the surroundings |
| `lightAngle` | `-45` | degrees | Light direction, clockwise from the top |
| `shadow` | `0.3` | 0 to 1 | Drop shadow; also the dark outline that draws glass on white pages |
| `interactive` | `false` | boolean | Swell, bounce and glow when pressed |
| `pointerLight` | `true` | boolean | Highlight follows the pointer |
| `visible` | `true` | boolean | Hide or show; the glass materialises by bending light in and out |
| `duration` | `520` | 0 to 10000 ms | Materialise and morph time |
| `scheme` | `'auto'` | `auto`, `light`, `dark` | `auto` reads the backdrop under each icon; force for a known page colour |
| `accessibility` | `true` | boolean | Follow reduced motion, reduced transparency, more contrast, forced colours. `false` ignores them except forced colours, which always win |
| `backdrop` | `'auto'` | see below | What the glass refracts |
| `maxDpr` | `2` | 0.5 to 4 | Cap on device pixel ratio (cost) |

### Small icons and CSS colour

With the defaults (`tint: 'auto'`, `legibility: 'auto'`), small icons on dark and saturated surfaces now look different: glass blends toward the icon's computed CSS `color` to preserve contrast, and a semi-transparent colour stays dimmer. Light neutral surfaces keep the existing near-black ink. The policy reads the sampled backdrop, uses smooth size and contrast ramps with hysteresis, and follows class, state and theme changes without per-frame style reads.

Size is the effective glyph after padding, not the tile: a 48 px tile at the default `padding: 0.22` has a glyph of about 27 px. This sizing correction still applies with `legibility: 'off'`, so padded tiles can differ from earlier releases.

```ts
glassify(svg, { tint: 'currentColor', tintOpacity: 0.55 });
glassify(svg, { legibility: 'off' });
```

`currentColor` explicitly follows the SVG's computed `color` at any size. All explicit tints bypass automatic legibility and retain the chosen `tintOpacity`. Providers accept the same options; attributes are `data-glass-tint="currentColor"` and `data-glass-legibility="off"`.

### Backdrop

| Value | Refracts |
|---|---|
| `'auto'` | The nearest ancestor with a CSS background image or gradient. If it only has a colour, a snapshot of its HTML (retaken when it changes; up to 1500 nodes). If none, the provider root or `<body>` |
| `'none'` | Only the page colour |
| `'/path.webp'` (URL) | That image, covering the container |
| `<img>`, `<video>`, `<canvas>` element | That element, live (video and canvas every frame) |
| Any other element | A snapshot of it |

## Recipes

Use a named `look` instead of copying its recipe. `looks` is a readonly record exported from `glassity`; `GlassLook` is its name type. `look: 'default'` has no recipe overrides. A handle or controller can switch with `.update({ look: 'clear' })` without retaining values from the previous recipe. Explicitly set options remain; use `.set({ look: 'clear' })` to replace them too.

| Look | Options |
|---|---|
| Clear Apple-like glass | `{ look: 'clear' }` → variant `clear` |
| Frosted | `{ look: 'frosted' }` → frost 0.8, tintOpacity 0.32, dispersion 0.1, shine 0.8 |
| Crystal | `{ look: 'crystal' }` → variant `clear`, depth 0.34, curvature 1.7, dispersion 1.3, shine 1.6 |
| Bold, thin icon sets | `{ look: 'bold' }` → weight 0.05, depth 0.22 |
| App icon tiles (dock) | `{ tile: true, interactive: true }` |
| Round glass buttons | `{ tile: true, tileRadius: 0.5, profile: 'circle', bevel: 0.5, depth: 0.3, weight: 0.02 }` |
| Glass ball lens | `{ tile: true, tileRadius: 0.5, profile: 'dome', variant: 'clear', depth: 0.6, weight: 0.02 }` |
| Over a video | `backdrop: videoElement` (React: the element from a ref) |
| Morph between icons | Swap the paths inside the same `<svg>`, swap the child of `<Glass>`, or `handle.retarget(newSvg)` |
| Show and hide | `visible: false` / `true` (or `data-glass-visible="false"`) |
| Tinted glass | `{ look: 'tinted' }` → tint `#2f6bef`, tintOpacity 0.55 |
| Follow the icon's CSS colour at any size | `{ tint: 'currentColor', tintOpacity: 0.55 }` |
| Disable the dark/saturated backdrop correction | `{ legibility: 'off' }` |

Playground links carry settings after `#`: keys that are option names are options (`depth=0.3&tile=true&variant=clear`). `bg`, `layout`, `set`, `lib`, `icon`, `size`, `compare` only describe the playground.

## Behaviour to know

- **Server rendering.** Importing glassity on the server is safe; nothing runs there. `auto()` waits for load and idle and skips icons that React, Astro islands or lazily hydrated Vue components have not hydrated yet, so there are no hydration warnings.
- **Hiding.** The SVG or text element gets `data-glassity-hidden` and a constructed stylesheet sets its opacity to 0. Frameworks rewriting `style` cannot make it reappear. Printing shows the original icons.
- **Accessibility.** Keep the icon's own `aria-label`/`role` (or `aria-hidden` when decorative). The canvas is `aria-hidden` and ignores the pointer. Reduced motion stops the pointer light and bounce; reduced transparency makes the glass frostier; more contrast makes it solid; forced colours show the plain SVG.
- **Colour.** The SVG supplies the outline; individual fills are not reproduced. Small automatic icons on dark or saturated surfaces also use the icon's computed CSS `color`. For a chosen colour at any size, use `tint` (including `currentColor`) with `tintOpacity`.
- **Light pages.** Glass stays light on white (as Apple's); it is drawn by its own refracted shadow and a thin contour. Small glyphs (under about 28 px after padding) flip to dark ink.
- **Performance.** One WebGL context; icons redraw only when something changes (pointer, animation, backdrop). Off-screen icons are skipped. `bands` and `maxDpr` are the cost knobs.
- **Supported icon sources.** Inline SVG from any library (Lucide, Phosphor, Heroicons, Tabler, react-icons, Iconify, Material Symbols SVG, Font Awesome SVG), sprites through `<use href>` (same origin or CORS), gradients, masks, clip paths defined elsewhere, web components with an open shadow root (put `data-glass` on the element).
- **CSP.** `img-src` needs `blob:` and `data:`. Trusted Types are fine. `style-src` needs no `unsafe-inline`.

## Limits

- Text sources are limited to 512 UTF-16 code units, eight rendered lines and 64 descendant elements. Over-limit text stays plain. Horizontal text supports translation and positive axis-aligned scale. Vertical writing, rotation, skew, perspective and reflection leave the original visible; glyphs supplied only by pseudo-elements are outside this source.
- Text web fonts need readable CSS `@font-face` rules and embeddable font files (same-origin or CORS). FontFace API-only fonts and unreadable remote rules cannot be reproduced; keep the original visible.
- Rotation and skew of the icon, or of the canvas's ancestors, are not followed; translation and scale are.
- Multicolour SVGs are used for their outline only.
- HTML snapshots are pictures: web fonts, cross-origin images without CORS, pseudo-elements and iframes may be missing.
- Real Safari on macOS and iOS has not been checked; WebKit builds pass the test suite.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No `canvas[data-glassity-canvas]` | Setup did not run in the browser, or no `data-glass`. Check the import is client-side |
| `data-glass` not on the `<svg>` | The component drops props (lucide-react in a Server Component). Client component or provider `selector` |
| Flat, invisible glass | Check the icon's CSS `color` contrasts with its surface and `legibility` is `auto`. Larger glass needs detail behind it: use a gradient or image background, `tile: true`, or a bigger icon |
| Small icons on a white bar turned pale grey | Expected for icons from about 28 to 40 px on plain light backgrounds: below 28 px glassity turns them dark so they stay readable, but larger ones stay light glass with little to show. Leave them plain (`data-glass="off"`), make them bigger, or use `tile: true` |
| Very frosted and tinted | The OS asks for reduced transparency. Intended; `accessibility: false` only for testing |
| Plain icon | No WebGL2: `isSupported()` is false; the fallback is the plain SVG |
| Text stays plain | Check the text/line/element caps and console warnings. The font must be installed or available through readable `@font-face` CSS with same-origin/CORS font files |
| Part of the icon missing | External `<use>` sprite without CORS, or a reference that does not resolve |
| Glass in the wrong place after an animation | Rotation or skew is not followed; animate opacity, translate or scale instead |
| Images blocked | Add `blob:` and `data:` to `img-src` |

## Removing it

`data-glass="off"` on one icon, `handle.destroy()` / `controller.destroy()` in code, or remove the setup import. The original SVGs are untouched.
