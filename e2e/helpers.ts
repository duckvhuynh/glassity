import { expect, test, type Page } from '@playwright/test';

/**
 * Shared helpers for the browser tests. The engine keeps its state in private fields;
 * the tests read them from the page instead of adding test code to src/. The types
 * below mirror src/engine.ts and src/backdrop.ts: when a field is renamed there,
 * rename it here too (typecheck will not notice, the tests will time out).
 */

export interface MediaState {
  reducedMotion: boolean;
  reducedTransparency: boolean;
  moreContrast: boolean;
  forcedColors: boolean;
}

export interface BackdropInternals {
  source: unknown;
  version: number;
  live: boolean;
  width: number;
  height: number;
  /** SnapshotBackdrop only: a capture is running. Set as soon as the backdrop is made. */
  busy?: boolean;
}

export interface InstanceInternals {
  element: SVGSVGElement;
  canvas: HTMLCanvasElement;
  destroyed: boolean;
  dirty: boolean;
  revealed: boolean;
  blank: boolean;
  onscreen: boolean;
  readonly inert: boolean;
  readonly system: MediaState;
  geometry: { key: string } | null;
  geometryKey: string;
  previous: { key: string } | null;
  morph: number;
  lens: number;
  lensTo: number;
  interaction: { scale: number; highlight: number; glow: number };
  interactionMoving: boolean;
  touchLightStrength: number;
  sequenceVisual: boolean;
  motionSequence: { frame: unknown; controller: { running: boolean } } | null;
  light: [number, number];
  lightTarget: [number, number];
  drawnVersion: number;
  backdrop: BackdropInternals | null;
}

export interface EngineInternals {
  instances: Map<SVGSVGElement, InstanceInternals>;
  media: MediaState;
  renderer: { canvas: HTMLCanvasElement; lost: boolean; generation: number } | null;
}

/** What `installGlassHooks` puts on `window.glassityTest`. */
export interface GlassityTest {
  engine(): EngineInternals | null;
  instances(): InstanceInternals[];
  instance(target: string | Element): InstanceInternals | null;
  /** True when this icon has nothing left to draw: no pending shape, backdrop, animation or frame. */
  settled(instance: InstanceInternals): boolean;
  /** Forget how long the page has been still. */
  reset(): void;
  /** True once `count` icons (or at least one) are drawn and every glass has been still for `quiet` ms. */
  ready(count?: number, quiet?: number): boolean;
}

declare global {
  interface Window {
    glassity: typeof import('../src/index');
    controller: import('../src/index').GlassController;
    handle: import('../src/index').GlassHandle;
    glassityTest?: GlassityTest;
    glassHandles: Record<string, import('../src/index').GlassHandle>;
  }
}

/**
 * Runs in the page: defines `window.glassityTest`. Self-contained on purpose, because
 * Playwright sends the function's source to the page.
 */
export function installGlassHooks(): void {
  if (window.glassityTest) return;
  // The engine lives on a global symbol named after the package version (src/engine.ts).
  const engine = (): EngineInternals | null => {
    const store = globalThis as unknown as Record<symbol, EngineInternals | undefined>;
    for (const key of Object.getOwnPropertySymbols(store)) if (key.description?.startsWith('glassity.engine')) return store[key] ?? null;
    return null;
  };
  const instances = (): InstanceInternals[] => [...(engine()?.instances.values() ?? [])];
  const settled = (i: InstanceInternals): boolean => {
    // Nothing is drawn for these, so there is nothing to wait for.
    if (i.destroyed || i.inert || i.blank || !i.onscreen) return true;
    if (i.dirty || i.previous || i.lens !== i.lensTo) return false;
    if (i.lensTo === 0) return true; // hidden on purpose (`visible: false`)
    if (!i.revealed || i.canvas.style.visibility !== 'visible') return false;
    // A new shape is being rasterized: the key is set before the field is ready.
    if (!i.motionSequence?.frame && (!i.geometry || (!i.sequenceVisual && i.geometry.key !== i.geometryKey))) return false;
    if (Math.abs(i.light[0] - i.lightTarget[0]) + Math.abs(i.light[1] - i.lightTarget[1]) > 0.003) return false;
    if (i.interactionMoving || i.touchLightStrength > 0 || i.motionSequence?.controller.running) return false;
    const b = i.backdrop;
    if (!b || !b.source || b.busy) return false;
    // A live backdrop (video, canvas) changes every frame; it is drawn within the same frame.
    return b.live || b.version === i.drawnVersion;
  };
  let since = -1;
  window.glassityTest = {
    engine,
    instances,
    instance(target) {
      const el = typeof target === 'string' ? document.querySelector(target) : target;
      return instances().find((i) => i.element === el) ?? null;
    },
    settled,
    reset() {
      since = -1;
    },
    ready(count, quiet = 120) {
      const e = engine();
      const live = instances().filter((i) => !i.destroyed && !i.inert);
      const shown = live.filter((i) => !i.blank).length;
      const ok = !!e && !e.renderer?.lost && (count === undefined ? shown > 0 : shown === count) && live.every(settled);
      const now = performance.now();
      if (!ok) {
        since = -1;
        return false;
      }
      if (since < 0) since = now;
      // Still for a moment: covers the short async read of the SVG that runs before
      // the engine marks anything as pending.
      return now - since >= quiet;
    },
  };
}

/**
 * Wait until every glass is drawn and still: shapes rasterized, backdrop snapshots
 * taken, transitions finished. Use this instead of fixed sleeps.
 */
export async function waitForGlass(page: Page, { count, quiet = 120, timeout = 10_000 }: { count?: number; quiet?: number; timeout?: number } = {}): Promise<void> {
  await page.evaluate(installGlassHooks);
  await page.evaluate(() => window.glassityTest!.reset());
  await page.waitForFunction(({ count, quiet }) => window.glassityTest!.ready(count, quiet), { count, quiet }, { polling: 'raf', timeout });
}

/** Wait until the engine has seen a system setting change (it redraws in the same task). */
export async function waitForMedia(page: Page, key: keyof MediaState, value = true): Promise<void> {
  await page.evaluate(installGlassHooks);
  await page.waitForFunction(({ key, value }) => window.glassityTest!.engine()?.media[key] === value, { key, value });
}

/** Let `count` animation frames pass. */
export async function frames(page: Page, count = 2): Promise<void> {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, count);
}

/**
 * Open a fixture page that sets `window.glassity`, and skip the test when the browser
 * has no WebGL2 (CI sets REQUIRE_WEBGL2 so that fails instead). Returns the page errors.
 */
export async function openFixture(page: Page, path: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(path);
  await page.waitForFunction(() => !!window.glassity);
  const supported = await page.evaluate(() => window.glassity.isSupported());
  if (process.env.REQUIRE_WEBGL2) expect(supported, 'WebGL2 must be available in this browser').toBe(true);
  test.skip(!supported, 'This browser build has no WebGL2.');
  return errors;
}

/**
 * A coarse picture of an icon's glass: the mean colour (weighted by alpha) of each
 * cell of a grid laid over its canvas. Small enough to bring back from the page.
 */
export async function glassSignature(page: Page, svg: string, grid = 12): Promise<number[]> {
  return page.locator(svg).evaluate((el, grid) => {
    // The glass canvas is always the element right after the SVG.
    const canvas = el.nextElementSibling;
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.hasAttribute('data-glassity-canvas')) throw new Error('No glass canvas after #' + el.id);
    const { width, height } = canvas;
    const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    const sums = new Array<number>(grid * grid * 3).fill(0);
    const counts = new Array<number>(grid * grid).fill(0);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const cell = Math.floor((y * grid) / height) * grid + Math.floor((x * grid) / width);
        const a = data[i + 3] / 255;
        for (let c = 0; c < 3; c++) sums[cell * 3 + c] += data[i + c] * a;
        counts[cell]++;
      }
    return sums.map((sum, k) => sum / Math.max(1, counts[Math.floor(k / 3)]));
  }, grid);
}

/** Mean channel difference (0–255) between two signatures. */
export function signatureDifference(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export interface GlassStats {
  /** Fully opaque pixels: inside the glass, away from its antialiased edge. */
  opaque: number;
  /** Mean HSV saturation of those pixels, 0–1. */
  saturation: number;
  /** Mean brightness step between horizontal neighbours, 0–255: how much detail shows. */
  detail: number;
  /** Share of opaque pixels that are white (every channel 245 or more). */
  white: number;
  /** Share of opaque pixels that are near black (every channel 40 or less). */
  ink: number;
  /** Share of the canvas covered by the glass (alpha over 128). */
  coverage: number;
}

/** Measure what an icon's glass canvas shows. */
export async function glassStats(page: Page, svg: string): Promise<GlassStats> {
  return page.locator(svg).evaluate((el) => {
    const canvas = el.nextElementSibling;
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.hasAttribute('data-glassity-canvas')) throw new Error('No glass canvas after #' + el.id);
    const { width, height } = canvas;
    const d = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    let opaque = 0;
    let saturation = 0;
    let detail = 0;
    let white = 0;
    let ink = 0;
    let covered = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (d[i + 3] > 128) covered++;
        if (d[i + 3] < 255) continue;
        const max = Math.max(d[i], d[i + 1], d[i + 2]);
        const min = Math.min(d[i], d[i + 1], d[i + 2]);
        opaque++;
        saturation += max ? (max - min) / max : 0;
        if (min >= 245) white++;
        if (max <= 40) ink++;
        if (x + 1 < width && d[i + 7] === 255) detail += Math.abs(d[i] + d[i + 1] + d[i + 2] - d[i + 4] - d[i + 5] - d[i + 6]) / 3;
      }
    const n = Math.max(1, opaque);
    return { opaque, saturation: saturation / n, detail: detail / n, white: white / n, ink: ink / n, coverage: covered / Math.max(1, width * height) };
  });
}
