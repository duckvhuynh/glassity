# Changelog

All notable changes to glassity. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version may change the API.

## [Unreleased]

### Added
- `weight`: makes any icon bolder (or thinner), stroked or filled, by growing its outline evenly.
- Playground presets "Round" (a round glass button: `tile`, `tileRadius: 0.5`) and "Bold".

### Changed
- On a light page the glass stays light, as Apple's does, instead of turning grey. It is outlined by its own shadow seen through the edge and a thin contour, and its shadow is lighter. Only icons under about 28 px turn dark there.
- `dim: 'auto'` (the clear variant) darkens only over bright, busy backdrops such as photos, not a plain light page.
- Glyphs on tiles stay white on a light page, with a stronger contact shadow.
- Highlights take a little colour from what is behind them.

## [0.1.2] - 2026-11-17

No change to the library code.

### Documentation
- README opens with the default glass on large icons, and shows a quick tour of the playground and logos as glass.
- The playground has a Logos set and larger icons by default.

## [0.1.1] - 2026-11-17

No change to the library code.

### Documentation
- README with images and animations of the glass, rendered from the playground.
- The npm page links to the playground: https://duckvhuynh.github.io/glassity/

## [0.1.0] - 2026-11-17

First release.

### Rendering
- Liquid-glass material for any inline SVG, drawn with WebGL2 in one context shared by the whole page.
- Geometry from the icon's own outline: a distance field and local thickness, so thin strokes become round tubes and filled shapes get a flat top with a bevel.
- Refraction by Snell's law with optical depth, multi-band dispersion, frost, tint, dim, saturation, contrast and brightness.
- Specular highlight, rim light, Fresnel reflection and a drop shadow; an optional glass tile under the icon.
- Variants `regular`, `clear` and `identity`; edge profiles `squircle`, `circle` and `lip`.
- Glass that turns light or dark from the backdrop under each icon.
- Materialises by bending light in and out (`visible`), morphs when the icon's outline changes, swells and glows when pressed (`interactive`), and follows the pointer with its highlight.
- 35 options, all with defaults, also settable as `data-glass-*` attributes.

### Backdrop
- Refracts the CSS background of the surface an icon sits on, or a snapshot of its HTML content when the surface is a flat colour.
- Explicit backdrops: an image URL, `<img>`, `<video>`, `<canvas>` or any element.

### API and adapters
- Core: `glassify()`, `auto()`, `isSupported()`, the `glassity/auto` side-effect import and a script-tag build.
- `glassity/react`: `GlassProvider`, `Glass`, `useGlass` (also on Preact through `preact/compat`).
- `glassity/vue`: `v-glass`, `useGlass`, `GlassProvider`.
- `glassity/svelte`: `use:glass`, `use:glassProvider`.
- `glassity/solid`: `use:glass`, `use:glassProvider`.
- `glassity/angular`: `provideGlassity`, `injectGlass`, `injectGlassProvider`; works with zone.js and zoneless.
- `glassity/remix`: `glass` and `glassProvider` mixins for Remix 3.
- ESM and CommonJS builds with types for every TypeScript `moduleResolution` mode.

### Working inside framework-owned DOM
- The original SVG stays in the DOM for accessibility; it is hidden with an attribute and a stylesheet, so frameworks that rewrite `style` and animation libraries cannot make it reappear.
- No hydration errors on server-rendered pages: waits for load and idle, and leaves alone what React, Astro islands and lazily hydrated Vue components have not hydrated yet.
- Never triggers Angular change detection.
- Sprite `<use>` and outside `url(#…)` references, open shadow roots, cloned pages (Turbo, swup, Barba), Trusted Types and printing are handled.

### Accessibility
- Follows reduced motion, reduced transparency, increased contrast and forced colours.
- Without WebGL2, icons stay plain SVG with a soft highlight.

[Unreleased]: https://github.com/duckvhuynh/glassity/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/duckvhuynh/glassity/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/duckvhuynh/glassity/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/duckvhuynh/glassity/releases/tag/v0.1.0
