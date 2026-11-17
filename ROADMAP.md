# Roadmap

Where glassity stands and what comes next. Checked items are done and verified; the note after an item says how it was verified or what is still open.

Last updated: 2026-11-17.

## Progress at a glance

| Area | State |
|---|---|
| Core rendering (WebGL2) | Working |
| Adapters: React, Vue, Svelte, Solid, Preact, Angular, Remix 3; plain JS, script tag | Working, checked from the packed package |
| Server rendering: Next.js, Nuxt, SvelteKit, Astro, React Router, Remix 3 | Checked end to end, no hydration warnings |
| ESM + CommonJS, types for every resolver | Working |
| Automatic backdrop | Working, with documented limits |
| Accessibility behaviour | Working |
| Browser coverage | Chromium, Firefox and WebKit pass the browser tests. Real Safari on macOS and iOS not checked yet |
| Published on npm | No |
| Live demo, visuals in the README | No |

## Done in 0.1

### Rendering
- [x] Distance field and local thickness from any SVG's alpha (unit tests)
- [x] Edge profiles: `squircle`, `circle`, `lip`
- [x] Refraction by Snell's law with depth, multi-band dispersion
- [x] Frost, saturation, contrast, brightness, tint, dim
- [x] Specular highlight, rim light on both sides, Fresnel reflection, drop shadow
- [x] Glass tile under the icon, with a contact shadow
- [x] Variants `regular`, `clear`, `identity`
- [x] Automatic light or dark glass from the backdrop under the icon
- [x] Materialise in and out by bending light (`visible`)
- [x] Shape morph when the icon's outline changes
- [x] Press: swell, bounce and glow (`interactive`); highlight follows the pointer
- [x] One shared WebGL context; about 1.7 ms to redraw 33 icons on integrated graphics at DPR 1

### Backdrop
- [x] CSS background image or gradient of the surface the icon sits on
- [x] Snapshot of HTML content when the surface is a flat colour; retaken when content changes
- [x] Explicit sources: image URL, `<img>`, `<video>`, `<canvas>`, any element
- [x] With every effect off the glass matches the page pixel for pixel (browser test, three engines)

### API
- [x] `glassify()`, `auto()`, `isSupported()`
- [x] `data-glass`, `data-glass="off"`, `data-glass-*` attributes
- [x] React: `GlassProvider` (nesting, inheritance), `Glass` (morphs on child swap), `useGlass`
- [x] Vue: `v-glass`, `useGlass`, `GlassProvider`; Svelte: `use:glass`, `use:glassProvider`; Solid: `use:glass`, `use:glassProvider`
- [x] Script-tag build with auto mode
- [x] 35 options, all with defaults

### Living in other people's DOM
- [x] Hiding by attribute and stylesheet: survives frameworks rewriting `style` and animation libraries (browser test)
- [x] Opacity set on the icon applies to the glass; print shows the original icons
- [x] Deferred canvas removal: no crash when Vue unmounts an icon with the directive
- [x] Sprite `<use>` and outside `url(#…)` references are copied in; an icon that draws nothing stays visible
- [x] `auto()` waits for load and idle: no hydration errors on server-rendered pages (checked with React)
- [x] Cloned pages (Turbo, swup, Barba) are cleaned up; open shadow roots are supported
- [x] Trusted Types-safe fallback; one engine per package version
- [x] Compatibility suite: packed package in Vue, Svelte, Solid and Preact apps, in CI

### Accessibility and fallback
- [x] Original SVG stays in the DOM: name, role, focus and clicks unchanged
- [x] Reduced motion, reduced transparency, more contrast, forced colours
- [x] Plain SVG with a highlight when WebGL2 is missing (browser test)

### Project
- [x] Public repository, MIT licence
- [x] CI: typecheck, unit tests, build, demo build
- [x] Browser tests with Playwright on Chromium, Firefox and WebKit, in CI
- [x] Vanilla and React demo pages

## Next

Ordered by what unlocks the most.

- [ ] **Icons that merge.** Neighbouring glass shapes blend into one body when they come close, and split apart again, like Apple's `GlassEffectContainer`. Needs one canvas per group and a smooth union of the distance fields.
- [ ] **Multi-layer icons.** Treat an SVG's groups as separate glass layers (background plate, foreground shapes), following the layer model of Apple's Icon Composer. Keep original colours as an option.
- [ ] **Real Safari check** on macOS and iOS, and on high-DPR screens. The WebKit build used in tests is not the shipping browser.
- [ ] **Performance budget**: measure with 100+ icons, at DPR 2 and 3, and on a phone. Set limits and cull accordingly.
- [ ] **Snapshot quality**: embed web fonts, capture pseudo-elements, and avoid re-reading the whole subtree after small changes.

## Compatibility follow-ups
- [x] Angular: `glassity/angular` (`provideGlassity`, `injectGlass`, `injectGlassProvider`), checked with zone.js
- [x] glassity leaves zone.js zones by itself: no change detection from its frames, also for direct `glassify` calls
- [x] Next.js, Nuxt, SvelteKit in the compatibility suite: production build, server HTML, hydration, interactions
- [x] `auto()` skips icons React has not hydrated yet (a race that showed up on Safari, which has no requestIdleCallback)
- [x] Angular 22 with zoneless change detection in the compatibility suite (its CLI runs on a Node 24.15+ fetched from npm)
- [x] Astro 7 (islands, including ones that hydrate on scroll) and React Router 8, the successor of Remix 2
- [x] Remix 3: `glassity/remix` mixins; client entries, static HTML and frame reloads checked
- [x] A provider that starts after the page-wide auto mode takes over its icons (a race seen on WebKit with Astro)
- [x] Lazily hydrated Vue components (`hydrateOnVisible` and the other strategies, Nuxt's `hydrate-on-*`) are left alone until they hydrate
- [ ] Icon fonts: draw the glyph from the font instead of an SVG
- [ ] Follow rotation and skew of the icon

## Later

- [ ] Device-motion highlights on phones (with permission, and off under reduced motion)
- [ ] Caustics and an environment image for reflections
- [ ] Glass for non-icon surfaces (bars, cards) sharing the same material
- [ ] Vue and Svelte adapters
- [ ] Canvas placement under rotated or skewed ancestors
- [ ] Offscreen rendering in a worker

## Repository and release housekeeping

Kept here so nothing is forgotten; none of it blocks development.

- [ ] Hero image or GIF at the top of the README
- [ ] Live demo on GitHub Pages
- [ ] Check that the name `glassity` is free on npm, then publish 0.1.0
- [ ] CHANGELOG and tagged GitHub releases
- [ ] CONTRIBUTING guide, issue and pull-request templates, code of conduct
- [ ] Social preview image for the repository
- [ ] API reference generated from the source comments

## Known limits

- An HTML snapshot is a picture: web fonts, cross-origin images without CORS, pseudo-elements and iframes can be missing. At most 1500 nodes are copied.
- Firefox logs one harmless "Layout was forced" warning the first time a snapshot is taken.
- The pointer light and press effects need `requestAnimationFrame`; in a background tab they pause.
- Multicolour SVGs are used for their outline only.
