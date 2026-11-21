# Changelog

All notable changes to glassity. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version may change the API.

## [Unreleased]

### Upgrading from 0.3
- **Small icons on dark or saturated surfaces look different.** They now take on their own CSS colour so they stay readable (light neutral surfaces keep their near-black small icons). For the old look, set `legibility: 'off'`.
- **Flat backgrounds get faint studio highlights** (`environment: 'auto'`). For the old reflection, set `environment: 'none'`.
- **TypeScript:** `GlassHandle.element` and `retarget()` take `GlassElement` (`SVGSVGElement | HTMLElement`), because text can be glass now. Narrow the type before reading SVG-only fields.
- **Pressing an interactive icon no longer sets a CSS `transform` on its canvas;** the swell happens in the shader.
- Nothing else needs a change: zero-config setups keep working as before.

### Added
- **Readable small icons by default.** `legibility: 'auto' | 'off'` (default `auto`): small icons on dark or saturated backdrops blend toward their own CSS colour, with smooth size and contrast ramps. Explicit tints are left alone. `tint: 'currentColor'` uses the icon's computed colour and follows class, state and theme changes.
- **Named looks.** `look: 'default' | 'clear' | 'frosted' | 'crystal' | 'tinted' | 'bold'`, also as `data-glass-look`. The `looks` recipes and the `GlassLook` type are exported. Explicit options override a recipe, and switching looks drops the previous recipe's values.
- **Page-wide defaults.** `configure(options)` sets defaults for every existing and future icon, beneath scopes and per-icon options; `configure({})` resets them.
- **Glass text and icon fonts.** `data-glass="text"` or `glassify(element, { text: true })` turns headings, wordmarks and icon-font glyphs (Material Symbols and others) into glass. The browser renders the text, so fonts, ligatures, right-to-left text and wrapped headings stay exact. The original text stays selectable and readable by screen readers. Up to 512 characters, eight lines and 64 child elements per element; longer text stays plain.
- **Layered icons.** `data-glass-layers` with up to four marked `<g data-glass-layer>` groups renders each group as its own glass body, bottom to top, with per-group depth, frost, tint and opacity. `appearance: 'default' | 'dark' | 'clear' | 'tinted'` gives app-icon variants, and `colors: 'source'` keeps each layer's SVG colour. Ordinary SVGs render as before.
- **Motion.** `handle.sequence([heart, star, check], { duration, loop, autoplay })` preloads shapes and returns `play()`, `pause()`, `seek(0–1)` (for scroll or a slider), `cancel()`, `ready` and `finished`. `interaction: 'none' | 'subtle' | 'bouncy'` adds hover and keyboard-focus highlights, pointer and Enter/Space press feedback, and a touch light that spreads to nearby glass. Reduced motion is respected throughout.
- **Studio lighting for flat interfaces.** `environment: 'auto' | 'studio' | 'none'` (default `auto`): on plain backgrounds, glass picks up a soft window glint along its bevels. It fades out over photos; `studio` keeps it on, and frost softens it.
- **Faster, steadier backdrops.** A capture queue shares, prioritises and slices HTML snapshots, and captures local regions around visible icons instead of shrinking a long page into one texture. Canvases drawn with Chrome's HTML-in-Canvas update natively.
- **A performance benchmark** for 50, 77 and 100 icons (`npm run bench`), with startup, idle, scrolling, pointer, theme-change and mount/destroy budgets.

### Changed
- One option registry now supplies defaults, validation, attribute parsing and the option names every framework adapter uses.
- Tile glyphs are sized after padding (a default 48 px tile has a glyph of about 27 px), with or without legibility.
- The playground presets and the real-app examples use the library's named looks and legibility instead of hand-copied recipes and workarounds.

### Fixed
- First glass no longer waits for the window `load` event or long hydration retries; visible icons start first, and heavy work is spread across frames.
- GPU context loss and failed uploads show the original SVGs until glass can draw again; resources are rebuilt on restore and failed backdrops retry.
- Large image, video and canvas backdrops are downscaled to fit the GPU; caches are bounded and textures are released once.
- A newer capture always wins over an older or cancelled one, and the last good backdrop stays while a new one is taken.
- Nested `auto()` scopes inherit options from the scope around them, and update when it changes.
- React: `<GlassProvider scope="document">` renders no wrapper and covers portals; a provider with only `className` keeps a neutral layout; `useGlass` follows a ref whose element changes.
- Vue notices in-place option changes; Solid, Angular and Remix rescan when the selector changes.

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
