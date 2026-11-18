// Every icon in the examples is glass: one page-wide scan picks up each Lucide icon (and any
// inline <svg data-glass>), including those in menus and sheets React renders in portals.
// Icons inside a <GlassProvider> keep that provider's own look (round buttons, tiles).
import { auto } from 'glassity';

const SELECTOR = 'svg.lucide, svg[data-glass]';

// Small icons are mostly stroke, so clear glass leaves little to see on a dark or saturated
// surface (a dark toolbar, a lime button). There each one is tinted with its own CSS colour,
// which keeps the contrast the design gave it. On light surfaces glassity's automatic tint
// (near-black for small icons) already reads well, and larger icons keep it everywhere.
const ours = new WeakSet<SVGSVGElement>();

// Any CSS colour (Tailwind v4 uses oklch) as [r, g, b, a] in 0–255, via a 1×1 canvas.
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
function rgba(css: string): number[] {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a]; // getImageData is not premultiplied
}

/** True when the nearest painted surface behind `el` is a light, plain colour. */
function onLightSurface(el: Element): boolean {
  for (let node: Element | null = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.backgroundImage !== 'none') return false; // a photo or gradient
    const [r, g, b, a] = rgba(style.backgroundColor);
    if (a < 128) continue;
    // Light and close to grey: white, cream, pale cards. A saturated lime is not.
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    return luminance > 0.72 * 255 && chroma < 60;
  }
  return true; // the page itself
}

function tintSmall(root: ParentNode) {
  for (const svg of root.querySelectorAll<SVGSVGElement>(SELECTOR)) {
    if (svg.hasAttribute('data-glass-tint') && !ours.has(svg)) continue; // set by hand
    const { width, height } = svg.getBoundingClientRect();
    if (!width) continue;
    let tint: string | null = null;
    let strength = 0.55;
    if (Math.max(width, height) < 28 && !onLightSurface(svg)) {
      // Re-read on every change, so an icon that turns active (another colour) follows.
      const [r, g, b, a] = rgba(getComputedStyle(svg).color);
      tint = `rgb(${r}, ${g}, ${b})`;
      strength = (0.55 * Math.max(a, 128)) / 255; // a dimmed icon (text-white/40) stays a little dimmer
    }
    if (svg.getAttribute('data-glass-tint') === tint && svg.getAttribute('data-glass-tint-opacity') === strength.toFixed(2)) continue;
    if (tint) {
      ours.add(svg);
      svg.setAttribute('data-glass-tint', tint);
      svg.setAttribute('data-glass-tint-opacity', strength.toFixed(2));
    } else if (ours.has(svg)) {
      svg.removeAttribute('data-glass-tint');
      svg.removeAttribute('data-glass-tint-opacity');
    }
  }
}

export function glassEverywhere() {
  tintSmall(document);
  // Created before auto(), so new icons are tinted before glassity looks at them.
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      tintSmall(document);
    });
  };
  // A button that turns active fades its background in: look again once it has.
  document.addEventListener('transitionend', schedule, true);
  const own = (node: Node) => node instanceof Element && node.hasAttribute('data-glassity-canvas');
  new MutationObserver((records) => {
    // glassity's own canvases coming and going are not a reason to look again.
    if (records.every((r) => own(r.target) || (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(own)))) return;
    schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'data-state'] });
  return auto({ selector: SELECTOR, weight: 0.03 });
}
