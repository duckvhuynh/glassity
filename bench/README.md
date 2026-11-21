# Performance budget

This is a local measurement harness, not an optimization or a CI gate. It runs the
built package in Chromium using Playwright and CDP. No library code is changed or
special benchmark options passed to `auto()`.

## Run

```sh
npm ci
npx playwright install chromium
npm run bench
```

The command builds the current checkout, runs **three independent browser contexts
per fixture**, then writes `bench/results/YYYY-MM-DD.json` and
`bench/results/YYYY-MM-DD.md` (UTC date). Re-running on the same date replaces that
day's report. Results are checkpointed after each run. A build, browser, WebGL or
measurement failure is recorded as **INCOMPLETE**, never a passing budget. There
is no CI workflow change. Budget failures remain report results; infrastructure
failures exit nonzero.

Use an otherwise idle desktop, AC power, and the same display refresh rate. The
default is a headed browser with Chromium's normal GPU selection. Keep its window
visible and unobscured. Do not interact with it. The full matrix performs 7,200
whole-population mount/destroy cycles and can take a long time. GPU and scheduling
noise make a single run unsuitable for acceptance.

```sh
# A quick instrumentation check; produces a separate YYYY-MM-DD-smoke report.
npm run bench -- --fixture 77-repeated-image-dpr1 --repeats 1 --cycles 2

# A full baseline with importable DevTools CPU profiles alongside the reports.
npm run bench -- --profiles

# Explicit alternatives; their environment is recorded in the report.
npm run bench -- --headless
npm run bench -- --headless --software
```

`--skip-build` is available for debugging a previously built checkout. Its artifact
SHA-256 is still recorded; omit it for acceptance. `--software` explicitly selects
SwiftShader: these results cannot establish hardware desktop performance. No
hardware or software fallback is silently enabled. Browser version, CPU, OS,
viewport, renderer information, DPR, and sampling settings accompany every report.

## Fixtures

`fixture.html?count=77&shapes=repeated&backdrop=image` is the shared deterministic
page. The runner covers the complete Cartesian product:

| Axis | Values |
| --- | --- |
| Icon count | 50, 77, 100 |
| Shape population | repeated geometry, unique geometry |
| Surface | one local CSS background image, plain colour with HTML content |
| Device pixel ratio | 1, 2 |
| Sizes, in every page | 16, 20, 24, 28 px icons and 64/80 px tiles |

The 24 fixtures use a 1440 × 1200 CSS px viewport. Every icon is visible, including
the 77-icon budget case, throughout the bounded scrolling scenario. Elements use
`data-glass`; backdrop discovery uses the library's default behavior. The surface
is on `<html>` so the theme change is exactly one class change on `<html>`, with
no explicit backdrop refresh. The image lives in this repository; external asset
and CDN performance cannot influence a run. DPR is set on the browser context,
not simulated by CSS. Open the same fixture via `npm run demo` for visual inspection.

## Scenarios and targets

| Budget | Target |
| --- | --- |
| Desktop CPU, 77 visible icons | p95 ≤ 4 ms per frame in idle, scrolling, pointer movement and theme change |
| Scrolling | ≤ 1% of frame intervals over 33 ms |
| Settled idle | Exactly zero draws, texture uploads and backdrop captures |
| Main-thread long tasks | No task over 50 ms attributable to glassity |
| Initial mount | 90% of visible glass drawn within 500 ms on desktop |
| 100 mount/destroy cycles | No growth in post-GC JS heap, live canvases or live textures |

Each run includes initial mount through all glass, settling, 2 seconds idle,
3 seconds scripted scrolling, 3 seconds pointer movement over icons, and a
3-second theme-change observation. After a warm destroy and forced GC, the runner
mounts the **entire fixture population** and waits until all glass has drawn before
destroying it, 100 times. It waits for outstanding cleanup, forces GC again, and
compares the unmounted states. Both states retain the same original SVG DOM and
the intentional shared engine/cache baseline. Instance and geometry cache counts
are also reported. Startup is cold for each browser context; later cycles reuse
that context and its loaded module.

Every scalar result is the median of three per-run measurements (including
per-run p95 and paired before/after resource deltas), not a percentile across
pooled frames. Each fixture has a separate verdict; a cheaper fixture never hides
a failing one. Startup and long-task budgets include mount work; the steady-state
CPU budget does not include startup. Fifty and 100 icons are additional scaling
diagnostics for CPU, with the other targets still applied. Raw per-run evidence
is retained in JSON, so a single bad run remains visible even when the median
passes. Missing measurements are `null`/INCOMPLETE, not zero.

## What is measured

- **First / 90% / all glass:** elapsed from immediately before the first dynamic
  import and `auto()` initialization until successful draws copied to the visible
  canvases, with nonzero lens strength and a completed real backdrop capture.
  The initial flat swatch does not count. This measures submitted visible glass,
  not completion of the default materialization animation or GPU presentation.
- **CPU:** CDP V8 profiling at a requested 1,000 µs sampling interval. Samples with
  a `/dist/` frame anywhere in their ancestry (including native descendants) are
  attributed to glassity and intersected with consecutive rAF frame intervals.
  The CDP and page clocks are calibrated with five brackets; the smallest bracket's
  uncertainty is recorded. This is a sampled main-thread estimate, not exact
  tracing or a GPU timer. Browser layout/paint outside JS stacks and worker work
  are not captured by this attribution; end-to-end frame intervals include their
  effects. The profiler and probe add overhead, so compare like-for-like runs.
- **Long tasks:** `PerformanceObserver('longtask')` plus overlapping attributed
  CPU samples. Any overlap conservatively attributes the full task duration.
  The JSON keeps all observed tasks, attributed tasks, sampled intervals and raw
  frame timestamps. `--profiles` retains the full original CPU profiles. Sampling
  can miss work and cannot prove that every long task was caused by the library.
- **Frame intervals:** consecutive rAF timestamps during scrolling, with nearest
  rank p50/p95 and the percentage strictly over 33 ms. These are scheduling
  intervals, not a claim about the monitor's actual presented frames.
- **Draws / uploads / captures:** benchmark-only wrappers around successful
  renderer draws, WebGL `texImage2D`/`texSubImage2D`, and actual snapshot capture
  starts. The probe attaches through the existing versioned engine symbol and
  rejects incompatible internals. The default engine's occasional layout checks
  may still run during idle; zero pixel work is the target.
- **Resources:** CDP `Runtime.getHeapUsage` after forced GC; `queryObjects` for all
  reachable main-realm HTML canvas objects, including detached canvases; DOM
  canvases separately; WebGL texture creations minus explicit deletions. The
  probe uses weak references and drains logs into Node before both GC snapshots
  to avoid measuring its own retained observations. The measurement calls are
  prewarmed; long-task observation pauses only during the artificial forced-GC
  snapshots and resumes for every mount/destroy cycle. Context loss invalidates the
  measurement. GPU memory bytes and canvas objects in other realms are not counted.

Any positive median heap delta fails the strict no-growth budget. Heap noise,
runtime caches or JIT warmup can produce such a delta without a library leak;
review the paired raw values and repeat on the same machine. Texture or canvas
growth is not excused by a heap decrease.

## Startup and local capture changes

Startup previously waited for the window `load` event before its 400 ms idle timeout; unrelated resources could therefore delay glass indefinitely. Deferred-hydration retries also grew to two seconds. Geometry already deduplicated identical serialized shapes, but distance/thickness construction ran synchronously after decode. Renderer creation synchronously queried shader compile and link status, and each DOM snapshot copied its tree in one uninterrupted task. These are code-level causes of stalls, not a measured attribution of the earlier 17.6 s result.

`auto()` now starts at DOM readiness with a 100 ms idle deadline and at most 250 ms between hydration retries, retaining per-icon hydration guards. Visible icons mount first in 4 ms batches. Field construction yields in 4 ms slices, draw batches yield after 6 ms, and GPUs exposing `KHR_parallel_shader_compile` are polled without blocking status queries. Identical geometry still shares its pending build. DOM captures share an engine queue with 6 ms cooperative slices, cancellation and last-good pixels. Nearby icons share document-space regions (normally 768 CSS px with a guard band), so a long page does not reduce local texture density.

The 3 s first-real-glass regression is in `e2e/capture.spec.ts`, using the same 77-icon image fixture and probe, excluding the temporary colour swatch. The long-page regression checks source-pixel contrast/density, rendered detail and scroll alignment. `e2e/html-canvas.spec.ts` checks native paint updates when supported, and forces snapshots in its fallback case. Screenshot baselines are unchanged.

The smoke benchmark could not run in this worktree environment: its build subprocess failed with `spawnSync cmd.exe EPERM`. Direct build, Vitest and Playwright startup also hit subprocess `EPERM`. No before/after timing or long-task-budget pass is claimed. Run the command above on the target desktop to validate the 3 s regression and the stricter benchmark budgets. Cooperative budgets cannot preempt an individual browser layout, image decode/upload or driver call; the no-extension shader path is still synchronous.

## Verification

```sh
npm run typecheck
npm test
npm run build
npx playwright test --project=chromium e2e/bench.spec.ts
```

The browser smoke spec checks fixture coverage, real-backdrop readiness and
cleanup/instrumentation; it deliberately has no wall-clock performance assertions.
Unit tests cover attribution, percentile/median calculations and budget verdicts.
`npm run bench` remains opt-in and is not part of `npm test` or default CI.
