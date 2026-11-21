---
name: glassity
description: Use when adding, styling, animating or debugging liquid-glass SVG icons, text and icon fonts with the glassity library (data-glass attributes, GlassProvider, Glass, glassify, auto, glassity/react, glassity/vue, glassity/svelte, glassity/solid, glassity/angular, glassity/remix, glassity/auto). Covers setup in every framework, all options with defaults and ranges, recipes for common looks, server rendering, accessibility and troubleshooting.
---

# glassity

glassity turns inline SVG icons and short text into liquid glass with WebGL2. It reads the outline of an `<svg>`, builds a distance field from it, and draws the icon as a lens that refracts what is behind it, with dispersion at the rim, frost, a specular highlight that follows the pointer and a soft shadow. The original `<svg>` stays in the DOM (hidden with an attribute), so its accessible name, focus and clicks are unchanged. Without WebGL2 the plain icon shows.

- Package: `glassity` on npm. ESM and CommonJS, types for every `moduleResolution`. No runtime dependencies.
- Playground with every option: https://duckvhuynh.github.io/glassity/
- Setup guide for agents: https://cdn.jsdelivr.net/npm/glassity@0.4/get-started.md

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
| `https://unpkg.com/glassity@0.4` | Script-tag build: `window.glassity` and page-wide auto mode |

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

### Sequences and interaction

```ts
import { glassify, type SequenceController, type SequenceOptions, type SequenceShape } from 'glassity';

const handle = glassify(svg);
const shapes: SequenceShape[] = [heartSvg, starSvg, checkSvg]; // SVG elements or complete SVG markup strings
const options: SequenceOptions = { duration: 1800, autoplay: false, loop: false };
const sequence: SequenceController = handle.sequence(shapes, options);
await sequence.ready;
sequence.seek(0.25); // drive directly from a slider or scroll library
sequence.play();
sequence.pause();
console.log(sequence.progress); // 0–1
sequence.cancel(); // retain the currently drawn shape
console.log(await sequence.finished); // 'completed' or 'cancelled'
```

- All shapes preload into the mounted icon's raster frame; differing viewBoxes fit that same box. The source SVG is untouched.
- `duration` is the total sequence time in milliseconds (default `1000`), divided equally between adjacent pairs. `autoplay` defaults to `true`; `loop` defaults to `false`. A loop returns to the first shape: repeat that shape at the end for a continuous loop.
- `seek(0–1)` draws a precise position and preserves the playing/paused state. Use `autoplay: false` when a scroll library owns the position. `play()` after completion restarts at 0; `finished` settles once for the first completion or cancellation.
- Resizing preloads a new shared raster frame while retaining the same controller and playback position.
- Replacing an active sequence or morph captures its visible blend as the new first keyframe. `cancel()` freezes that blend and makes the controller inactive; create another sequence to resume with new shapes.
- Pass at least two complete SVG shapes. Await `ready` to handle invalid or empty shapes and icons without a laid-out size. Cancellation settles `ready`; `finished` reports `'cancelled'`. Without WebGL2, during SSR, with `variant: 'identity'`, or in forced colours, the controller is cancelled and the source SVG remains. Reduced motion makes `play()` jump to the final shape, including loops, while explicit seeking still works.

Enable interaction with `interactive: true`. `interaction: 'subtle'` is the default; `'bouncy'` increases the spring and swell, and `'none'` disables feedback. Providers, adapters and attributes use the same option (`data-glass-interaction="bouncy"`). The existing nearest button/link host receives hover, focus-visible and press behavior; Enter/Space activates press feedback without changing the button's normal action. Disabled controls stay inactive.

Press deformation changes shape coordinates in the shader, leaving backdrop lookups in screen space. Each press sends a short-lived touch light to nearby glass within about 120 px, fading with distance and time. Reduced motion disables the swell and spreading light while keeping static feedback. Keep the existing DOM: no interaction wrapper or backdrop declaration is needed.

The local `e2e/fixtures/motion.html` fixture has a heart → star → check scrubber, playback controls and near/far tiles for review.

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
- No build: `<script src="https://unpkg.com/glassity@0.4"></script>` (pin the current version) and `data-glass` on icons. `window.glassity.controller.update({...})` changes the page-wide options.

## Attributes

| Attribute | Effect |
|---|---|
| `data-glass` | Glass with the shared options |
| `data-glass="clear"` | Pick a variant: `regular`, `clear`, `identity` |
| `data-glass="text"` | Use the element's text or icon-font glyph as the shape |
| `data-glass="off"` | Leave this icon alone |
| `data-glass-look="crystal"` | Pick a named look |
| `data-glass-environment="studio"` | Keep studio reflections on over any backdrop |
| `data-glass-depth="0.3"`, `data-glass-tile`, `data-glass-light-angle="-30"` | Any option, kebab-case; a bare attribute is `true` |

### Layered app icons

Opt in with `data-glass-layers` and mark each glass body with `<g data-glass-layer="name">`. The first group is the bottom layer; later groups refract the already-rendered glass beneath them. No wrapper or backdrop declaration is needed.

```html
<svg data-glass data-glass-layers data-glass-colors="source"
     viewBox="0 0 100 100" width="96" height="96" role="img" aria-label="App">
  <g data-glass-layer="base" fill="#2479ef">
    <rect x="4" y="4" width="92" height="92" rx="24" />
  </g>
  <g data-glass-layer="mark" data-glass-depth="0.08"
     data-glass-frost="0.1" data-glass-opacity="0.9" fill="#ffffff">
    <circle cx="50" cy="50" r="23" />
  </g>
</svg>
```

Use `appearance` on the SVG or through any adapter:

```ts
const handle = glassify(svg, { layers: true, colors: 'source', appearance: 'dark' });
handle.update({ appearance: 'tinted', tint: '#a38cff' });
```

| Appearance | Layered icon treatment |
|---|---|
| `default` | Inherited glass options and each group's overrides |
| `dark` | A dark body with light marks |
| `clear` | The clear variant with no frost and a faint tint |
| `tinted` | Every layer uses the icon's `tint`, with monochrome content; `auto` uses its CSS colour |

Groups can override material options with attributes such as `data-glass-depth`, `data-glass-frost`, `data-glass-tint`, `data-glass-tint-opacity` and `data-glass-opacity`. Group overrides win over appearance defaults, except `tinted` keeps one tint and zero saturation throughout. Visibility, interaction, accessibility and backdrop belong to the whole icon. A layered icon uses its authored base shape instead of the automatic `tile` plate.

`colors: 'source'` uses each layer's first visible solid fill as its tint (or a solid stroke for stroke-only artwork), mixed at `0.55` by default. A group's explicit tint or tint opacity overrides it. It is one colour per layer: gradients and patterns are not reproduced as colour textures. Dark and tinted appearances replace the source palette; clear keeps only a faint tint.

To bound memory and draw cost, glassity renders at most **four marked groups**, in SVG document order; additional marked groups are omitted. Ordinary exporter groups never become layers automatically. Unmarked artwork outside marked groups is omitted in layered mode; keep it inside a layer. Nested marked groups render separately and are excluded from their parent's shape. Definitions, masks and clip paths remain available but are not themselves layers. An SVG with no marked groups keeps the usual single-body rendering, and `appearance` has no effect on it. Adding, removing or reordering a layer updates the stack; layer geometry changes replace the stack together without a per-layer shape morph.

## Options

All optional. Lengths are fractions of the icon's box, so a look holds at any size. Explicit option precedence: `configure()` page defaults, outer scope, inner scope, attributes on the icon, then options passed to `glassify`/`Glass`. Later layers win; `undefined` does not override. The selected look's recipe sits below all explicit options. For example, `configure({ depth: 0.2 })` keeps depth at 0.2 even under an inner `look: 'crystal'`.

| Option | Default | Range | Effect |
|---|---|---|---|
| `look` | `'default'` | `default`, `clear`, `frosted`, `crystal`, `tinted`, `bold` | Named recipe below explicit options; changing looks drops the previous recipe |
| `layers` | `false` | boolean | Explicit `g[data-glass-layer]` groups become separate glass bodies; first four in document order |
| `colors` | `'default'` | `default`, `source` | Use each layer's first solid SVG fill or stroke as its tint |
| `appearance` | `'default'` | `default`, `dark`, `clear`, `tinted` | Layered app-icon treatment; plain icons are unchanged |
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
| `environment` | `'auto'` | `auto`, `studio`, `none` | Procedural studio reflections: `auto` strengthens flat surfaces and fades over detail, `studio` always enables them, `none` keeps the original ambient reflection |
| `lightAngle` | `-45` | degrees | Light direction, clockwise from the top |
| `shadow` | `0.3` | 0 to 1 | Drop shadow; also the dark outline that draws glass on white pages |
| `interactive` | `false` | boolean | Enable hover, focus-visible and pointer/keyboard press feedback |
| `interaction` | `'subtle'` | `none`, `subtle`, `bouncy` | Feedback preset used when `interactive` is true |
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

### Lighting on flat surfaces

`environment: 'auto'` needs no setup: a broad window, softer opposite fill and dark horizon reflect from the glass on plain surfaces. Their colour follows the low-frequency backdrop colour, and their strength fades with backdrop detail so photos keep essentially the same look. Fresnel bounds the reflections; `reflection` scales them and `frost` broadens their highlights. `environment: 'studio'` keeps the lights on even over photos. `environment: 'none'` disables only these added lights, preserving the original reflection; `reflection: 0` disables reflected surroundings altogether.

Use the option on any provider, `glassify(svg, { environment: 'studio' })`, or `data-glass-environment="studio"`. No extra wrapper or backdrop declaration is needed. The `GlassEnvironment` type is exported from `glassity`.

### Backdrop

| Value | Refracts |
|---|---|
| `'auto'` | The nearest ancestor with a CSS background image or gradient. If it only has a colour, a local snapshot around nearby icons (queued, retaken on content/scroll changes; up to 1500 copied nodes per region). If none, the provider root or `<body>` |
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
| Flat dashboards and solid buttons | Default `{ environment: 'auto' }`; no backdrop setup needed |
| Studio lights over any backdrop | `{ environment: 'studio' }` |
| Soft studio highlights | `{ environment: 'studio', frost: 0.6 }` |
| Original ambient reflection only | `{ environment: 'none' }` |
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

- **Server rendering.** Importing glassity on the server is safe; nothing runs there. `auto()` waits for DOM readiness and a bounded idle period and skips icons that React, Astro islands or lazily hydrated Vue components have not hydrated yet, so there are no hydration warnings.
- **Hiding.** The SVG or text element gets `data-glassity-hidden` and a constructed stylesheet sets its opacity to 0. Frameworks rewriting `style` cannot make it reappear. Printing shows the original icons.
- **Accessibility.** Keep the icon's own `aria-label`/`role` (or `aria-hidden` when decorative). The canvas is `aria-hidden` and ignores the pointer. Reduced motion stops the pointer light and bounce; reduced transparency makes the glass frostier; more contrast makes it solid; forced colours show the plain SVG.
- **Colour.** The SVG supplies the outline by default; layered icons with `colors: 'source'` use one solid fill or stroke tint per layer. Small automatic icons on dark or saturated surfaces also use the icon's computed CSS `color`. For a chosen colour at any size, use `tint` (including `currentColor`) with `tintOpacity`.
- **Light pages.** Glass stays light on white (as Apple's); it is drawn by its own refracted shadow and a thin contour. Small glyphs (under about 28 px after padding) flip to dark ink.
- **Performance.** One WebGL context; icons redraw only when something changes (pointer, animation, backdrop). Off-screen icons are skipped. `bands` and `maxDpr` are the cost knobs.
- **Supported icon sources.** Inline SVG from any library (Lucide, Phosphor, Heroicons, Tabler, react-icons, Iconify, Material Symbols SVG, Font Awesome SVG), sprites through `<use href>` (same origin or CORS), gradients, masks, clip paths defined elsewhere, web components with an open shadow root (put `data-glass` on the element).
- **CSP.** `img-src` needs `blob:` and `data:`. Trusted Types are fine. `style-src` needs no `unsafe-inline`.

## Limits

- Text sources are limited to 512 UTF-16 code units, eight rendered lines and 64 descendant elements. Over-limit text stays plain. Horizontal text supports translation and positive axis-aligned scale. Vertical writing, rotation, skew, perspective and reflection leave the original visible; glyphs supplied only by pseudo-elements are outside this source.
- Text web fonts need readable CSS `@font-face` rules and embeddable font files (same-origin or CORS). FontFace API-only fonts and unreadable remote rules cannot be reproduced; keep the original visible.
- Rotation and skew of SVG icons, or of their canvas ancestors, are not followed; translation and scale are.
- Multicolour SVGs use their outline unless layered mode and `colors: 'source'` are enabled. Layers have one solid tint each; gradients and patterns are not colour textures.
- Layered icons use at most four marked groups. Extra marked groups and unmarked artwork outside layers are omitted; layer changes do not morph between outlines.
- HTML snapshots are pictures: web fonts, cross-origin images without CORS, pseudo-elements and iframes may be missing. Local regions retain their last good pixels while queued replacements are prepared. Native HTML-in-Canvas paint events are used only for an already-rendered drawable subtree in an application-owned canvas, detected at runtime. The browser cannot capture arbitrary page HTML this way; ordinary HTML remains on snapshots. Never move app DOM or require a wrapper to enable native capture.
- Real Safari on macOS and iOS has not been checked; WebKit builds pass the test suite.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No `canvas[data-glassity-canvas]` | Setup did not run in the browser, or no `data-glass`. Check the import is client-side |
| `data-glass` not on the `<svg>` | The component drops props (lucide-react in a Server Component). Client component or provider `selector` |
| Flat, invisible glass | Check the icon's CSS `color` contrasts with its surface and `legibility` is `auto`. Leave `environment: 'auto'` for flat surfaces, or choose `studio` to keep its highlights on; `reflection: 0` removes them |
| Small icons on a white bar turned pale grey | Expected for icons from about 28 to 40 px on plain light backgrounds: below 28 px glassity turns them dark so they stay readable, but larger ones stay light glass with little to show. Leave them plain (`data-glass="off"`), make them bigger, or use `tile: true` |
| Very frosted and tinted | The OS asks for reduced transparency. Intended; `accessibility: false` only for testing |
| Plain icon | No WebGL2: `isSupported()` is false; the fallback is the plain SVG |
| Text stays plain | Check the text/line/element caps and console warnings. The font must be installed or available through readable `@font-face` CSS with same-origin/CORS font files |
| Part of the icon missing | External `<use>` sprite without CORS, or a reference that does not resolve |
| Glass in the wrong place after an animation | Rotation or skew is not followed; animate opacity, translate or scale instead |
| Images blocked | Add `blob:` and `data:` to `img-src` |

## Removing it

`data-glass="off"` on one icon, `handle.destroy()` / `controller.destroy()` in code, or remove the setup import. The original SVGs are untouched.
