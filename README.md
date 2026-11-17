# glassity

[![CI](https://github.com/duckvhuynh/glassity/actions/workflows/ci.yml/badge.svg)](https://github.com/duckvhuynh/glassity/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Liquid-glass material for the SVG icons you already use. No redrawn icon set: glassity reads the outline of any `<svg>` and renders it as refracting glass with WebGL2.

- One provider (or one import) turns icons into glass. No canvas, no coordinates, no background set-up.
- Real refraction of what is behind the icon, with dispersion, frost, highlights and a drop shadow.
- Icons in a group join into one piece of glass when they come close, or share one glass bar.
- Works with Lucide, Feather, Tabler, Heroicons, or your own SVG. Outline and filled.
- The original `<svg>` stays in the DOM, so labels, focus and clicks keep working.
- React adapter and plain JavaScript. No runtime dependencies.

> Status: 0.1, early. Not on npm yet: until it is, clone the repo and run `npm install && npm run build` (see [Develop](#develop)). See also [Limits](#limits).

## Install

```bash
npm install glassity
```

## Use

### React

Wrap your app (or any part of it) once. Every `<svg data-glass>` inside becomes glass.

```tsx
import { GlassProvider } from 'glassity/react';
import { Calendar } from 'lucide-react';

<GlassProvider>
  <Calendar data-glass />
</GlassProvider>
```

Turn a whole icon set into glass without touching each icon:

```tsx
<GlassProvider selector="svg.lucide" tile interactive>
  <Toolbar />
</GlassProvider>
```

Providers nest. The inner one inherits the outer options and overrides them.

Give one icon its own options with `<Glass>`. Swap its child and the glass morphs from one shape to the other.

```tsx
import { Glass } from 'glassity/react';

<Glass tile interactive depth={0.3}>
  <Calendar size={64} />
</Glass>
```

Put icons in a group and they behave like one piece of glass: neighbours that come close reach for each other and join, a pressed icon swells into the next, a hidden one is absorbed. With `bar` the whole group is a single glass bar.

```tsx
import { GlassGroup } from 'glassity/react';

<GlassGroup tile spacing={0.4}>
  <House /> <Mail /> <Camera />
</GlassGroup>

<GlassGroup bar>
  <House /> <Search /> <Settings />
</GlassGroup>
```

Already have a ref to an `<svg>`? Use the hook.

```tsx
const ref = useRef<SVGSVGElement>(null);
useGlass(ref, { variant: 'clear' });
```

### Plain JavaScript

```js
import 'glassity/auto'; // every [data-glass] on the page, now and later
```

```js
import { auto, glassify, group } from 'glassity';

const page = auto({ selector: 'svg.lucide', tile: true }); // a group
page.update({ depth: 0.3 });

const one = glassify(document.querySelector('#logo'), { variant: 'clear' }); // a single SVG
one.destroy();

const toolbar = group(document.querySelector('.toolbar'), { bar: true });  // icons that join
```

Or without code: `data-glass-group` on a container makes one group of every `<svg>` inside it (with auto mode on). Its options are its own attributes.

```html
<div class="toolbar" data-glass-group data-glass-tile data-glass-spacing="0.4">
  <svg>…</svg> <svg>…</svg> <svg>…</svg>
</div>
```

### Script tag

```html
<script src="https://unpkg.com/glassity"></script>
<svg data-glass ...>...</svg>
```

### Per-icon attributes

| Attribute | Effect |
|---|---|
| `data-glass` | Make this icon glass with the shared options |
| `data-glass="clear"` | Pick a variant (`regular`, `clear`, `identity`) |
| `data-glass="off"` | Leave this icon alone |
| `data-glass-depth="0.3"`, `data-glass-tile`, … | Any option below, in kebab-case |

## Options

Every option is optional. Sizes are fractions of the icon's box, so icons of any size keep the same look.

| Option | Default | What it does |
|---|---|---|
| `variant` | `'regular'` | `regular` keeps content legible; `clear` is see-through; `identity` leaves the SVG untouched |
| `profile` | `'squircle'` | Cross-section of the edge: `squircle`, `circle`, `lip` |
| `tile` | `false` | Put the icon on a rounded glass plate that fills the SVG's box |
| `tileRadius` | `0.26` | Plate corner radius, 0–0.5 |
| `glyphOpacity` | `0.9` | How solid the icon is on a plate |
| `padding` | `0` (`0.22` with `tile`) | Inset of the icon inside its box, per side |
| `strokeWidth` | from the SVG | Override the stroke width, in viewBox units |
| `spacing` | `0.35` | In a group: the gap, in icon sizes, under which shapes join. `0` keeps them separate |
| `bar` | `false` | In a group: one glass bar around all icons instead of a plate per icon |
| `barPadding` | `0.28` | In a group with `bar`: space between the icons and the edge of the bar |
| `bevel` | `0.09` | Width of the curved edge. Thin strokes use their own half-width |
| `curvature` | `1` | How steep the edge is. `0` is flat glass |
| `depth` | `0.16` | Optical depth: how far light travels after bending |
| `ior` | `1.5` | Index of refraction |
| `refraction` | `1` | Overall strength of the bending |
| `dispersion` | `0.35` (`0.5` clear) | Colour separation at the edges |
| `bands` | `6` | Wavelength bands sampled for dispersion, 1–8 |
| `frost` | `0.3` (`0` clear) | Blur of what is seen through the glass |
| `saturation` | `1.35` | Saturation of what is seen through the glass |
| `brightness` | `1` | Brightness of what is seen through the glass |
| `contrast` | `0.9` | Contrast of what is seen through the glass |
| `tint` | `'auto'` | Glass colour. `auto` picks white or near-black from the backdrop |
| `tintOpacity` | `0.14` (`0.04` clear) | How much tint is mixed in |
| `dim` | `0` (`'auto'` clear) | Darkening under the glass. `auto`: up to 35%, only over bright backdrops |
| `opacity` | `1` | Overall opacity |
| `shine` | `1` | Specular highlight |
| `rim` | `1` | Thin light along the edge |
| `reflection` | `0.6` | Reflected surroundings |
| `lightAngle` | `-45` | Light direction in degrees, clockwise from the top |
| `shadow` | `0.3` | Drop shadow |
| `interactive` | `false` | Swell, bounce and glow when pressed |
| `pointerLight` | `true` | The highlight follows the pointer |
| `visible` | `true` | Show or hide. The glass materialises by bending light in and out |
| `duration` | `520` | Materialise and morph time, ms |
| `scheme` | `'auto'` | `auto` reads the backdrop under the icon; `dark` / `light` force it |
| `accessibility` | `true` | Follow the system's accessibility settings (see below) |
| `backdrop` | `'auto'` | What the glass refracts (see below) |
| `maxDpr` | `2` | Upper limit for the device pixel ratio |

## Groups

- All icons of a group share the group's material. On a single icon only `data-glass="off"`, `data-glass-interactive` and `data-glass-visible` apply.
- A group is one canvas. Use it for a cluster such as a toolbar or a tab bar. A group too large to draw at a useful resolution falls back to separate icons and says so in the console.
- Joining is live: it follows layout changes and CSS transitions of the icons, with no call from you.
- Merging needs float render targets, which nearly every WebGL2 device has. `canMerge()` tells you; without it a group's icons are drawn one by one.

## What the glass refracts

WebGL cannot see the page behind a canvas, so glassity builds a picture of it. With `backdrop: 'auto'` it looks for the surface the icon sits on, the nearest ancestor that paints a background:

1. The surface has a background **image or gradient**: that background is refracted. Exact and cheap. This is the usual "icons on a wallpaper" case.
2. The surface has only a **background colour**: its HTML content is rendered to a picture and refracted. The picture is taken again when the content changes.
3. No surface found: the provider's container, or `<body>`, is used the same way.

Or say what to refract:

```tsx
<GlassProvider backdrop="/wallpaper.webp" />   // an image, stretched to cover the container
<GlassProvider backdrop={videoRef} />          // <video> and <canvas> update every frame
<GlassProvider backdrop={someElementRef} />    // a snapshot of that element
<GlassProvider backdrop="none" />              // only the page colour
```

## Accessibility

The original SVG is kept (invisible) under the glass, so its accessible name, role, focus and pointer events are unchanged. The canvas is `aria-hidden` and ignores the pointer.

With `accessibility: true` (default) glassity follows the system:

| System setting | Effect |
|---|---|
| Reduce motion | No pointer light, no bounce, transitions are instant |
| Reduce transparency | Frostier, more tinted glass. On Windows this is on when "Transparency effects" is off |
| More contrast | Solid black or white icons |
| Forced colours | Glass is off; the plain SVG shows |

Without WebGL2 the icon stays a plain SVG with a soft highlight.

## Limits

- **Snapshots are pictures, not live content.** In the HTML-snapshot case, web fonts, cross-origin images without CORS, pseudo-elements and iframes may be missing or differ. A snapshot copies at most 1500 nodes; beyond that only the CSS background is used. Use `backdrop` to choose something smaller.
- **A canvas positioned by CSS transforms with rotation or skew** is not handled.
- **Multi-layer icons** are treated as one shape.
- **Multicolour SVGs** are used for their outline only.
- Browser tests pass on Chromium, Firefox and WebKit (Playwright builds). Real Safari on macOS and iOS has not been checked yet.
- "Liquid glass" here is a simulation of the look. It is not Apple's shader.

## Develop

```bash
npm install
npm run build      # dist/
npm test           # geometry and options unit tests
npx playwright install chromium firefox webkit   # once
npm run test:e2e   # browser tests on Chromium, Firefox and WebKit (after a build)
npm run demo:build # bundles the React demo
npm run demo       # http://localhost:4173/  and  /demo/react.html
```

What is done and what comes next is in [ROADMAP.md](ROADMAP.md). The design decisions behind 0.1 are in [docs/design.md](docs/design.md) (Vietnamese).

## Contributing

Issues and pull requests are welcome. Before opening a pull request, run `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e`, and check the change in both demo pages.

## License

[MIT](LICENSE) © Duc Huynh

The demo icons are from [Lucide](https://lucide.dev) (ISC licence, see `demo/icons/LICENSE-LUCIDE`).
