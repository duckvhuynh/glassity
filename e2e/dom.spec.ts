import { expect, test, type Page } from '@playwright/test';

/**
 * How glassity behaves as a guest in a DOM that a framework or another library
 * also writes to. Each page is served inline so every case stays self-contained.
 */

declare global {
  interface Window {
    glassity: typeof import('../src/index');
    controller: import('../src/index').GlassController;
    handle: import('../src/index').GlassHandle;
    mutationsBeforeIdle: number;
  }
}

const ICON = '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>';
const WALL =
  'padding:30px;display:flex;gap:30px;background:repeating-linear-gradient(90deg,#fff 0 2px,transparent 2px 14px),linear-gradient(135deg,#e2572e,#2a2f7a)';
const icon = (attrs = '', body = ICON) =>
  `<svg data-glass ${attrs} width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">${body}</svg>`;
const START = `<script type="module">import * as g from '/dist/index.js'; window.glassity = g; window.controller = g.auto({ accessibility: false, duration: 0, pointerLight: false });</script>`;
const LOAD_ONLY = `<script type="module">import * as g from '/dist/index.js'; window.glassity = g;</script>`;

async function serve(page: Page, body: string, head = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/inline.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8">${head}</head><body style="margin:0">${body}</body></html>` }),
  );
  await page.goto('/inline.html');
  await page.waitForFunction(() => !!window.glassity);
  return errors;
}

/** Wait until every glass icon is drawn. */
async function drawn(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (count) => {
      const all = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-glassity-canvas]')].filter((c) => c.style.visibility === 'visible');
      return all.length === count;
    },
    count,
    { timeout: 10_000 },
  );
}

const settle = (page: Page, ms = 400) => page.waitForTimeout(ms);
const opacity = (page: Page, selector: string) => page.locator(selector).evaluate((el) => getComputedStyle(el).opacity);

/** Share of a glass canvas the icon covers (0 when there is no canvas). */
const coverage = (page: Page, selector: string) =>
  page.locator(selector).evaluate((svg) => {
    const canvas = svg.nextElementSibling as HTMLCanvasElement | null;
    if (!canvas?.matches('canvas[data-glassity-canvas]') || canvas.width < 2) return 0;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let covered = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 128) covered++;
    return covered / (data.length / 4);
  });

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto('/e2e/fixtures/basic.html');
  await page.waitForFunction(() => !!(window as Window).glassity);
  const supported = await page.evaluate(() => window.glassity.isSupported());
  const needsWebgl = !testInfo.title.includes('without WebGL2');
  if (process.env.REQUIRE_WEBGL2 && needsWebgl) expect(supported, 'WebGL2 must be available in this browser').toBe(true);
  test.skip(!supported && needsWebgl, 'This browser build has no WebGL2.');
});

test.describe('framework style writes', () => {
  test('rewriting the whole style attribute keeps the original icon hidden', async ({ page }) => {
    const errors = await serve(page, `<div style="${WALL}">${icon('id="a"')}${icon('id="b"')}${icon('id="c"')}</div>${START}`);
    await drawn(page, 3);
    await page.evaluate(() => {
      document.getElementById('a')!.setAttribute('style', 'color: red'); // Svelte style="…", Vue string :style on first render
      (document.getElementById('b') as unknown as SVGElement).style.cssText = 'color: red'; // Vue string :style on update
      (document.getElementById('c') as unknown as SVGElement).style.color = 'red'; // React, Vue object style, Solid
    });
    await settle(page);
    for (const id of ['#a', '#b', '#c']) expect(await opacity(page, id)).toBe('0');
    expect(errors).toEqual([]);
  });

  test('the glass follows an opacity that an animation library sets on the icon', async ({ page }) => {
    await serve(page, `<div style="${WALL}">${icon('id="a"')}</div>${START}`);
    await drawn(page, 1);
    // GSAP, Motion and the Web Animations API write the icon's own opacity.
    await page.evaluate(() => {
      (document.getElementById('a') as unknown as SVGElement).style.opacity = '0.25';
    });
    await settle(page);
    expect(await opacity(page, '#a')).toBe('0');
    await expect.poll(() => page.locator('#a + canvas').evaluate((c) => getComputedStyle(c).opacity)).toBe('0.25');

    await page.evaluate(() => (document.getElementById('a') as unknown as SVGElement).style.removeProperty('opacity'));
    await expect.poll(() => page.locator('#a + canvas').evaluate((c) => getComputedStyle(c).opacity)).toBe('1');
  });

  test('printing shows the original icon, not the glass', async ({ page }) => {
    await serve(page, `<div style="${WALL}">${icon('id="a" style="opacity:.8"')}</div>${START}`);
    await drawn(page, 1);
    await page.emulateMedia({ media: 'print' });
    expect(await opacity(page, '#a')).toBe('0.8');
    await expect(page.locator('#a + canvas')).toHaveCSS('display', 'none');
  });
});

test.describe('removal and cloned pages', () => {
  test('destroy does not pull the canvas out from under a framework that is mid-update', async ({ page }) => {
    await serve(page, `<div id="wall" style="${WALL}">${icon('id="a"')}</div>${LOAD_ONLY}`);
    const result = await page.evaluate(async () => {
      const svg = document.getElementById('a')!;
      window.handle = window.glassity.glassify(svg, { accessibility: false, duration: 0 });
      await new Promise((resolve) => setTimeout(resolve, 600));
      // What Vue does on v-if: it takes the svg's next sibling as the anchor, the
      // component's unmount hook runs (destroy), then Vue inserts before the anchor.
      const anchor = svg.nextSibling!;
      window.handle.destroy();
      const placeholder = document.createComment('v-if');
      try {
        svg.parentNode!.insertBefore(placeholder, anchor);
        svg.remove();
      } catch (error) {
        return 'threw: ' + String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      return document.querySelectorAll('canvas[data-glassity-canvas]').length;
    });
    expect(result).toBe(0);
  });

  test('a page restored from a clone (Turbo, swup, Barba) is cleaned up', async ({ page }) => {
    await serve(page, `<div id="wall" style="${WALL}">${icon('id="a"')}${icon('id="b"')}</div>${START}`);
    await drawn(page, 2);
    await page.evaluate(() => {
      const wall = document.getElementById('wall')!;
      wall.replaceWith(wall.cloneNode(true));
    });
    await drawn(page, 2);
    await settle(page);
    expect(await page.locator('canvas[data-glassity-canvas]').count()).toBe(2);

    // Without glass the restored icons must be visible again, not stuck at opacity 0.
    await page.evaluate(() => window.controller.destroy());
    await settle(page);
    expect(await page.locator('canvas[data-glassity-canvas]').count()).toBe(0);
    expect(await opacity(page, '#a')).toBe('1');
    expect(await opacity(page, '#b')).toBe('1');
  });
});

test.describe('icons that reference other parts of the page', () => {
  test('sprite icons (<use href="#…">) and shared gradients become glass', async ({ page }) => {
    const sprite =
      '<svg style="display:none"><defs><linearGradient id="shared"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>' +
      `<symbol id="plus" viewBox="0 0 24 24">${ICON}</symbol></svg>`;
    const defs = '<svg data-glass id="defs" width="64" height="64" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" fill="url(#shared)"/></svg>';
    const errors = await serve(page, `${sprite}<div style="${WALL}">${icon('id="plain"')}${icon('id="use"', '<use href="#plus"/>')}${defs}</div>${START}`);
    await drawn(page, 3);
    await settle(page);
    const plain = await coverage(page, '#plain');
    expect(plain).toBeGreaterThan(0.05);
    expect(await coverage(page, '#use')).toBeGreaterThan(plain * 0.8);
    expect(await coverage(page, '#defs')).toBeGreaterThan(0.2);
    expect(errors).toEqual([]);
  });

  test('an icon that draws nothing is left visible instead of vanishing', async ({ page }) => {
    // A reference that cannot be resolved: the raster comes out empty.
    await serve(page, `<div style="${WALL}">${icon('id="ok"')}${icon('id="empty"', '<use href="#missing"/>')}</div>${START}`);
    await drawn(page, 1);
    await settle(page, 600);
    expect(await opacity(page, '#ok')).toBe('0');
    expect(await opacity(page, '#empty')).toBe('1');
  });
});

test.describe('server-rendered pages', () => {
  test('auto mode leaves the DOM alone until the page has loaded and gone idle', async ({ page }) => {
    // Hydration (React, Vue, Svelte) expects the server's DOM untouched until it has run.
    const watch = `<script>
      window.mutationsBeforeIdle = 0;
      // Only count changes glassity makes; the parser adding the rest of the page is fine.
      const ours = (node) => node.nodeType === 1 && [...node.attributes].some((a) => a.name.startsWith('data-glassity'));
      const seen = new MutationObserver((records) => {
        for (const r of records)
          if ((r.attributeName || '').startsWith('data-glassity') || [...r.addedNodes].some(ours)) window.mutationsBeforeIdle++;
      });
      seen.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
      addEventListener('load', () => setTimeout(() => seen.disconnect(), 0));
    </script>`;
    await serve(page, `${watch}<div style="${WALL}">${icon('id="a"')}</div>${START}`);
    await drawn(page, 1);
    expect(await page.evaluate(() => window.mutationsBeforeIdle)).toBe(0);
  });
});

test.describe('server-rendered pages, continued', () => {
  test('icons React has not hydrated yet are left alone until it has', async ({ page }) => {
    // React marks its root with __reactContainer$… and every node it has hydrated with
    // __reactFiber$…. Simulate a root whose hydration is still under way.
    const markRoot = `<script>document.__reactContainer$test = {};</script>`;
    await serve(page, `${markRoot}<div style="${WALL}">${icon('id="a"')}</div>${START}`);
    await settle(page, 1200);
    expect(await page.locator('canvas[data-glassity-canvas]').count()).toBe(0);
    expect(await opacity(page, '#a')).toBe('1');

    // React reaches the icon.
    await page.evaluate(() => {
      const svg = document.getElementById('a') as unknown as Record<string, unknown>;
      svg['__reactFiber$test'] = {};
    });
    await drawn(page, 1);
    expect(await opacity(page, '#a')).toBe('0');
  });
});

test.describe('server-rendered pages, islands', () => {
  test('icons inside an Astro island that has not hydrated are left alone until it has', async ({ page }) => {
    await serve(page, `<astro-island ssr><div style="${WALL}">${icon('id="a"')}</div></astro-island>${START}`);
    await settle(page, 1200);
    expect(await page.locator('canvas[data-glassity-canvas]').count()).toBe(0);

    // Astro removes the attribute once the island has hydrated.
    await page.evaluate(() => document.querySelector('astro-island')!.removeAttribute('ssr'));
    await drawn(page, 1);
  });
});

test.describe('nested scopes', () => {
  test('a provider that starts after the page-wide auto mode takes over its icons and keeps them', async ({ page }) => {
    // Page-wide auto mode first (glassity/auto), then a provider inside the page, as when a
    // framework component mounts after the page has loaded.
    await serve(page, `<div style="${WALL}"><div id="inner">${icon('id="a"')}</div></div>${START}`);
    await drawn(page, 1);
    await page.evaluate(() => {
      window.handle = window.glassity.auto({ root: document.getElementById('inner')!, accessibility: false, duration: 0, tile: true }) as never;
    });
    await settle(page);
    // Something changes on the page: the page-wide scan runs again.
    await page.evaluate(() => document.body.append(document.createElement('p')));
    await settle(page, 700);
    await drawn(page, 1);
    // The provider's options apply: a tile covers most of the icon's box.
    expect(await coverage(page, '#a')).toBeGreaterThan(0.4);
  });
});

test.describe('web components', () => {
  test('an icon inside an open shadow root becomes glass, also when it arrives late', async ({ page }) => {
    const define = `<script>
      customElements.define('late-icon', class extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: 'open' });
          setTimeout(() => { root.innerHTML = '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">${ICON}</svg>'; }, 300);
        }
      });
    </script>`;
    const errors = await serve(page, `${define}<div style="${WALL}"><late-icon data-glass id="host"></late-icon></div>${START}`);
    await page.waitForFunction(() => {
      const canvas = document.getElementById('host')!.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[data-glassity-canvas]');
      return canvas?.style.visibility === 'visible';
    });
    const hidden = await page.evaluate(() => getComputedStyle(document.getElementById('host')!.shadowRoot!.querySelector('svg')!).opacity);
    expect(hidden).toBe('0');
    expect(errors).toEqual([]);
  });
});

test('without WebGL2, a page that enforces Trusted Types still gets the fallback', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  const errors = await serve(page, `<div style="${WALL}">${icon('id="a"')}</div>${START}`, `<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'">`);
  await settle(page, 600);
  await expect(page.locator('#a')).toHaveAttribute('filter', /url\(#glassity-bevel-/);
  expect(errors).toEqual([]);
});
