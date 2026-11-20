// Every icon in the examples is glass: one page-wide scan picks up each Lucide icon (and any
// inline <svg data-glass>), including those in menus and sheets React renders in portals.
// Icons inside a <GlassProvider> keep that provider's own look (round buttons, tiles), unless
// the playground picks a look or profile for the whole page (see glass-styles.ts).
import { auto } from 'glassity';
import { LOOKS, PROFILES, isLook, isProfile, type Look, type Profile } from './glass-styles';

const SELECTOR = 'svg.lucide, svg[data-glass]';

// The look and profile picked in the playground: from the frame's URL (?look=…&profile=…),
// then from messages the playground sends when the picker changes.
const params = new URLSearchParams(location.search);
let look: Look = isLook(params.get('look')) ? (params.get('look') as Look) : 'default';
let profile: Profile = isProfile(params.get('profile')) ? (params.get('profile') as Profile) : 'default';

const kebab = (key: string) => 'data-glass-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/** The attributes this script wants on one icon. */
function wanted(): Map<string, string> {
  const out = new Map<string, string>();
  const chosen: Record<string, string | number> = { ...LOOKS[look].options, ...PROFILES[profile].options };
  for (const [key, value] of Object.entries(chosen)) out.set(kebab(key), String(value));
  return out;
}

// Which attributes on each icon this script set, so it never touches ones written by hand.
const ours = new WeakMap<SVGSVGElement, Set<string>>();

function style(root: ParentNode) {
  for (const svg of root.querySelectorAll<SVGSVGElement>(SELECTOR)) {
    const mine = ours.get(svg) ?? new Set<string>();
    const next = wanted();
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
  // Created before auto(), so new icons are styled before glassity looks at them.
  const own = (node: Node) => node instanceof Element && node.hasAttribute('data-glassity-canvas');
  new MutationObserver((records) => {
    // glassity's own canvases coming and going are not a reason to look again.
    if (records.every((r) => own(r.target) || (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(own)))) return;
    schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
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
