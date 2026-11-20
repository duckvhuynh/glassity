# Changelog

All notable changes to glassity. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version may change the API.

## [Unreleased]

### Added
- Named looks: `look: 'default' | 'clear' | 'frosted' | 'crystal' | 'tinted' | 'bold'`, also available as `data-glass-look`. The readonly `looks` recipes and `GlassLook` type are exported from `glassity`. Explicit options override a recipe; switching looks does not retain the previous recipe's values.
- `configure(options)` replaces page defaults for existing and future icons, beneath scopes and per-icon options. `configure({})` resets them.
- `legibility: 'auto' | 'off'` (default `auto`): small icons on dark or saturated backdrops blend toward their own CSS colour, with smooth size and contrast ramps and hysteresis. Explicit tints are unchanged; `off` disables the new contrast correction.
- `tint: 'currentColor'`: use the icon's computed CSS colour, including alpha, and follow class, state and theme changes.
- A local Chromium performance benchmark for 50, 77 and 100 icons, with startup, idle, scrolling, pointer, theme and mount/destroy measurements, reproducible fixtures and JSON/Markdown budget reports (`npm run bench`).

### Changed
- One option registry supplies defaults, validation, attribute parsing and adapter option names.
- Playground presets and real-app example look pickers use the library's named looks.
- Small icons on dark and saturated surfaces look different by default and keep more contrast. Light neutral surfaces keep their near-black small icons. Tile glyphs use their size after padding: a default 48 px tile has a glyph of about 27 px. This sizing correction also applies with `legibility: 'off'`.
- The real-app examples use the library's legibility policy instead of adding a tint workaround to each small icon. Their look and profile pickers still work through `data-glass-*` attributes.

### Fixed
- Nested `auto()` scopes inherit options by DOM ancestry and update when an outer scope changes. Surviving controllers resume discovery when another controller on the same root is destroyed.
- React document providers render no wrapper and share one discovery controller, including icons in portals. A provider with only `className` keeps its neutral layout, and `useGlass` follows a ref whose target changes.
- Vue notices in-place option mutations. Solid, Angular and Remix restart discovery when the selector changes.
- GPU failures and context loss show the original SVGs until glass can draw again. Restoring the context rebuilds resources from retained pixels and geometry; failed uploads keep the previous texture and backdrops retry with backoff.
- Direct image, video and canvas backdrops are downscaled to fit the texture budget. Texture storage is released once, and snapshot and external sprite caches now have bounded sizes.

## [0.3.5] - 2026-11-20

### Fixed
- React: `weight` on `<GlassProvider>` and `<Glass>` was ignored. Every adapter now takes its option names from the defaults, so no option can be left out again.
- An icon that changed twice quickly could end up showing the older shape: a slow first read of the SVG no longer overwrites a newer one.
- HTML backdrops: the snapshot helper switched itself off 1.5 s after starting, which sent every later snapshot down a slower path.
- Without WebGL2, the plain stand-ins are now owned by their controller: destroying it removes their highlight, and the icons can be picked up again.
- An option value that is not a number (`data-glass-depth="deep"`, `NaN`) now falls back to its default instead of making the glass draw nothing.
- `accessibility: false` no longer overrides forced colours (High Contrast mode): the plain icon always shows there.

### Changed
- Releases publish to npm only after the full CI (unit, browser and framework tests) passes on the tagged commit. CI also builds the playground on pull requests.

### Documentation
- The agent prompt, the setup guide and the script tag point at the published 0.3 files (jsDelivr and unpkg) instead of `main`.
- Corrected the version note, the compatibility claims (twelve framework apps, Chromium and WebKit; React 19 checked) and the small-icon size advice (28 px turns dark, 40 px recommended).
- The playground's real-app examples have Glass and Profile pickers: switch every icon in a demo between looks (clear, frosted, crystal, tinted, bold) and edge profiles, live.

## [0.3.4] - 2026-11-18

### Fixed
- An icon painted in a see-through colour (Tailwind's `text-white/40`, an `rgba()` stroke) no longer erodes to a few dots: its shape is read at full strength.

### Documentation
- The playground has an "In a real app" section: a shadcn/ui dashboard, a mobile app screen and a landing page using glassity, with React and Tailwind (`site/examples`). Three v0 community templates (Tasko, FinFlow, Evasion) join them, credited to their authors, and every icon in the examples is glass.
- The README lists where glassity fits: landing pages, dashboards, mobile web and hybrid apps.

## [0.3.3] - 2026-11-18

No change to the library code.

### Documentation
- The README opens with a short black-and-white film of what glassity does, cut from the promo video.
- A new glassity icon: the glass g, larger in its square, over glossy black slabs. The favicons, app icons and the playground header use it.
- The agent setup guide (`get-started.md`) is clearer about Vue, which icons to pick, and how to check the result.

## [0.3.2] - 2026-11-18

### Added
- `get-started.md`: a setup guide for AI coding agents. Paste "Set up glassity for me. Fetch https://raw.githubusercontent.com/duckvhuynh/glassity/main/get-started.md and follow it." into any coding agent.
- `skills/glassity/SKILL.md`: the full reference for agents (every option, recipe and fix), to keep in a project.
- Both files ship in the npm package.

## [0.3.1] - 2026-11-17

### Fixed
- Glass icons no longer look chiselled: the creases along the middle of strokes and the corners of filled shapes are rounded over, so the surface flows like liquid glass. Marks on a tile get a wider, softer bevel.

### Documentation
- The README opens with the glassity icon, rendered with glassity itself.

## [0.3.0] - 2026-11-17

### Added
- `profile: 'dome'`: a ball of glass, traced through both of its surfaces. It magnifies, and with `depth` from about 0.3 shows the page upside down. Best on a round tile.
- Marks on a tile are glass too: they lens the plate behind them under a white, frosted body.
- Playground preset "Lens".

## [0.2.0] - 2026-11-17

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

[Unreleased]: https://github.com/duckvhuynh/glassity/compare/v0.3.5...HEAD
[0.3.5]: https://github.com/duckvhuynh/glassity/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/duckvhuynh/glassity/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/duckvhuynh/glassity/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/duckvhuynh/glassity/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/duckvhuynh/glassity/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/duckvhuynh/glassity/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/duckvhuynh/glassity/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/duckvhuynh/glassity/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/duckvhuynh/glassity/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/duckvhuynh/glassity/releases/tag/v0.1.0
