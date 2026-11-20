// Every icon in the examples is glass: one page-wide scan picks up each Lucide icon (and any
// inline <svg data-glass>), including those in menus and sheets React renders in portals.
// Icons inside a <GlassProvider> keep that provider's own look (round buttons, tiles), unless
// the playground picks a look or profile for the whole page (see glass-styles.ts).
import { auto, looks } from 'glassity';
import { LOOKS, PROFILES, isLook, isProfile, type Look, type Profile } from './glass-styles';

const SELECTOR = 'svg.lucide, svg[data-glass]';

// The look and profile picked in the playground: from the frame's URL (?look=…&profile=…),
// then from messages the playground sends when the picker changes.
const params = new URLSearchParams(location.search);
let look: Look = isLook(params.get('look')) ? (params.get('look') as Look) : 'default';
let profile: Profile = isProfile(params.get('profile')) ? (params.get('profile') as Profile) : 'default';

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

const kebab = (key: string) => 'data-glass-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/** The attributes this script wants on one icon. */
function wanted(svg: SVGSVGElement): Map<string, string> {
  const out = new Map<string, string>();
  const chosen: Record<string, string | number> = { ...LOOKS[look].options, ...PROFILES[profile].options };
  // Small icons are mostly stroke, so clear glass leaves little to see on a dark or saturated
  // surface (a dark toolbar, a lime button). There each one is tinted with its own CSS colour,
  // which keeps the contrast the design gave it. On light surfaces glassity's automatic tint
  // (near-black for small icons) already reads well, and larger icons keep it everywhere.
  // A look with its own tint wins.
  const { width, height } = svg.getBoundingClientRect();
  if (!('tint' in looks[look]) && width && Math.max(width, height) < 28 && !onLightSurface(svg)) {
    const [r, g, b, a] = rgba(getComputedStyle(svg).color);
    out.set(kebab('tint'), `rgb(${r}, ${g}, ${b})`);
    // A dimmed icon (text-white/40) stays a little dimmer.
    out.set(kebab('tintOpacity'), ((0.55 * Math.max(a, 128)) / 255).toFixed(2));
  }
  for (const [key, value] of Object.entries(chosen)) if (!out.has(kebab(key))) out.set(kebab(key), String(value));
  return out;
}

// Which attributes on each icon this script set, so it never touches ones written by hand.
const ours = new WeakMap<SVGSVGElement, Set<string>>();

function style(root: ParentNode) {
  for (const svg of root.querySelectorAll<SVGSVGElement>(SELECTOR)) {
    if (!svg.getBoundingClientRect().width) continue; // hidden: style it when it shows
    const mine = ours.get(svg) ?? new Set<string>();
    const next = wanted(svg);
    for (const name of mine) if (!next.has(name)) svg.removeAttribute(name);
    for (const name of [...next.keys()]) if (!mine.has(name) && svg.hasAttribute(name)) next.delete(name); // set by hand
    for (const [name, value] of next) if (svg.getAttribute(name) !== value) svg.setAttribute(name, value);
    ours.set(svg, new Set(next.keys()));
  }
}

export function glassEverywhere() {
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      style(document);
    });
  };
  schedule();
  // A button that turns active fades its background in: look again once it has.
  document.addEventListener('transitionend', schedule, true);
  // Created before auto(), so new icons are styled before glassity looks at them.
  const own = (node: Node) => node instanceof Element && node.hasAttribute('data-glassity-canvas');
  new MutationObserver((records) => {
    // glassity's own canvases coming and going are not a reason to look again.
    if (records.every((r) => own(r.target) || (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(own)))) return;
    schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'data-state'] });
  // The playground's picker, from the page that holds this frame.
  addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    const data = event.data as { type?: unknown; look?: unknown; profile?: unknown } | null;
    if (data?.type !== 'glassity-style' || !isLook(data.look) || !isProfile(data.profile)) return;
    look = data.look;
    profile = data.profile;
    schedule();
  });
  return auto({ selector: SELECTOR, weight: 0.03 });
}
