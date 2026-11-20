import { parentOf } from './dom';
import { cachedLoad, LruCache } from './core/lru';
/**
 * Turn a piece of the page into pixels so the glass has something to refract.
 * The browser has no "read what is behind me" API, so the element (or only its
 * CSS background) is re-rendered through an SVG <foreignObject>.
 */

const XHTML = 'http://www.w3.org/1999/xhtml';
const SKIP = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'iframe', 'object', 'embed', 'head', 'title']);
const BACKGROUND = [
  'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'background-origin', 'background-clip', 'background-blend-mode',
];

/** Thrown when an element has more nodes than a snapshot is allowed to copy. */
export class SnapshotBudgetError extends Error {}

const dataUrls = new LruCache<string, Promise<string | null>>(64);

function toDataUrl(url: string): Promise<string | null> {
  return cachedLoad(dataUrls, url, () => fetch(url)
    .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
    .then(
      (blob) =>
        new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.onabort = () => resolve(null);
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => {
      console.warn(`glassity: could not read "${url}" for the backdrop (blocked by CORS?). It is left out.`);
      return null;
    }));
}

/** Replace every url(...) in a CSS value with an inlined data URL; unreadable ones become `none`. */
async function inlineUrls(css: string): Promise<string> {
  const pattern = /url\((['"]?)(.*?)\1\)/g;
  const urls = new Set<string>();
  for (const match of css.matchAll(pattern)) if (!match[2].startsWith('data:') && !match[2].startsWith('#')) urls.add(match[2]);
  if (!urls.size) return css;
  const resolved = new Map<string, string | null>();
  await Promise.all([...urls].map(async (url) => resolved.set(url, await toDataUrl(url))));
  return css.replace(pattern, (whole, _quote, url: string) => {
    if (!resolved.has(url)) return whole;
    const data = resolved.get(url);
    return data ? `url("${data}")` : 'none';
  });
}

let sandbox: HTMLIFrameElement | null = null;
let sandboxReady: Promise<boolean> | null = null;
let sandboxUsable = false;
const defaults = new LruCache<string, Map<string, string>>(128);

/**
 * A hidden, empty document used to learn each tag's default styles.
 * It must have finished loading before it is read: Firefox reports styles
 * without the browser's own stylesheet (a <p> with no margin) on the transient
 * document an iframe starts with. A standards-mode `srcdoc` loads the same way
 * in every browser and matches the mode of ordinary pages.
 */
function prepareSandbox(): Promise<boolean> {
  if (sandbox?.isConnected && sandboxReady) return sandboxReady;
  defaults.clear();
  sandboxUsable = false;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('data-glassity-canvas', '');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;border:0;visibility:hidden;pointer-events:none';
  sandbox = frame;
  sandboxReady = new Promise<boolean>((resolve) => {
    // Settles once: whichever comes first, the frame loading or the watchdog. Before,
    // the watchdog also fired after a successful load and turned the sandbox off.
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      sandboxUsable = ok && !!frame.contentDocument?.body;
      resolve(sandboxUsable);
    };
    frame.addEventListener('load', () => done(true), { once: true });
    const watchdog = setTimeout(() => done(false), 1500); // blocked by a content policy: write full styles instead
    frame.srcdoc = '<!doctype html><html><body></body></html>';
    document.documentElement.appendChild(frame);
  });
  return sandboxReady;
}

/** Computed style of an untouched element of this tag, used to write only what differs. */
function defaultStyle(el: Element): Map<string, string> {
  const key = el.namespaceURI + '|' + el.localName;
  let known = defaults.get(key);
  if (known) return known;
  known = new Map();
  const doc = sandboxUsable ? sandbox?.contentDocument : null;
  if (doc?.body && sandbox?.contentWindow) {
    const probe = doc.createElementNS(el.namespaceURI, el.localName);
    doc.body.appendChild(probe);
    const cs = sandbox.contentWindow.getComputedStyle(probe);
    for (let i = 0; i < cs.length; i++) known.set(cs[i], cs.getPropertyValue(cs[i]));
    probe.remove();
  }
  defaults.set(key, known);
  return known;
}

function styleText(el: Element): string {
  const cs = getComputedStyle(el);
  const base = defaultStyle(el);
  let text = '';
  for (let i = 0; i < cs.length; i++) {
    const name = cs[i];
    const value = cs.getPropertyValue(name);
    if (value !== base.get(name)) text += name + ':' + value + ';';
  }
  return text + 'animation:none;transition:none;';
}

function frameOf(media: HTMLVideoElement | HTMLCanvasElement): string | null {
  try {
    if (media instanceof HTMLCanvasElement) return media.toDataURL();
    const canvas = document.createElement('canvas');
    canvas.width = media.videoWidth;
    canvas.height = media.videoHeight;
    canvas.getContext('2d')!.drawImage(media, 0, 0);
    return canvas.toDataURL();
  } catch {
    return null; // cross-origin media taints the canvas
  }
}

interface CloneJob {
  count: number;
  limit: number;
  pending: Promise<void>[];
  hide: ((el: Element) => boolean) | undefined;
}

function cloneTree(node: Node, job: CloneJob, isRoot: boolean): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  if (SKIP.has(el.localName) || el.hasAttribute('data-glassity-canvas')) return null;
  if (++job.count > job.limit) throw new SnapshotBudgetError();

  // Icons that are being turned into glass keep their place but must not be
  // painted into the backdrop, or the glass would refract its own original.
  if (job.hide?.(el)) {
    const blank = el.cloneNode(false) as Element;
    blank.setAttribute('style', styleText(el) + 'visibility:hidden;');
    blank.removeAttribute('class');
    blank.removeAttribute('id');
    return blank;
  }

  let copy: Element;
  if (el instanceof HTMLCanvasElement || el instanceof HTMLVideoElement) {
    copy = document.createElement('img');
    const frame = frameOf(el);
    if (frame) copy.setAttribute('src', frame);
  } else {
    copy = el.cloneNode(false) as Element;
    if (el instanceof HTMLImageElement) {
      copy.removeAttribute('srcset');
      copy.removeAttribute('loading');
      copy.removeAttribute('src');
      const src = el.currentSrc || el.src;
      if (src) job.pending.push(toDataUrl(src).then((data) => void (data && copy.setAttribute('src', data))));
    }
  }

  let style = styleText(el);
  if (isRoot) style += 'margin:0;position:relative;inset:auto;transform:none;box-sizing:border-box;' + `width:${(el as HTMLElement).offsetWidth}px;height:${(el as HTMLElement).offsetHeight}px;`;
  if (style.includes('url(')) job.pending.push(inlineUrls(style).then((inlined) => copy.setAttribute('style', inlined)));
  copy.setAttribute('style', style);
  copy.removeAttribute('class');
  copy.removeAttribute('id');

  if (!(el instanceof HTMLCanvasElement || el instanceof HTMLVideoElement))
    for (const child of Array.from(el.childNodes)) {
      const childCopy = cloneTree(child, job, false);
      if (childCopy) copy.appendChild(childCopy);
    }
  return copy;
}

/** First non-transparent background colour at or above `el`; the system canvas colour if none. */
export function pageColor(el: Element | null): string {
  for (let node: Element | null = el; node; node = parentOf(node)) {
    const color = getComputedStyle(node).backgroundColor;
    if (color && color !== 'transparent' && !/,\s*0\)$/.test(color) && !/\/\s*0\)$/.test(color)) return color;
  }
  return '#ffffff';
}

export interface SnapshotResult {
  canvas: HTMLCanvasElement;
  /** Canvas pixels per CSS pixel. */
  scale: number;
}

export interface SnapshotRequest {
  /** `background`: only the element's CSS background. `dom`: the element and everything in it. */
  mode: 'background' | 'dom';
  /** Area to render, CSS px. */
  width: number;
  height: number;
  /** Longest side of the result, in pixels. */
  maxSize: number;
  /** Most nodes a `dom` snapshot may copy before giving up. */
  nodeLimit?: number;
  /** Elements to keep in layout but not paint. */
  hide?: (el: Element) => boolean;
}

/** Render `el` (or only its background) into a canvas. */
export async function snapshot(el: Element, request: SnapshotRequest): Promise<SnapshotResult> {
  const width = Math.max(1, Math.round(request.width));
  const height = Math.max(1, Math.round(request.height));
  let markup: string;

  if (request.mode === 'background') {
    const cs = getComputedStyle(el);
    let style = `width:${width}px;height:${height}px;`;
    for (const name of BACKGROUND) style += name + ':' + cs.getPropertyValue(name) + ';';
    const box = document.createElement('div');
    box.setAttribute('style', await inlineUrls(style));
    markup = new XMLSerializer().serializeToString(box);
  } else {
    await prepareSandbox();
    const job: CloneJob = { count: 0, limit: request.nodeLimit ?? 1500, pending: [], hide: request.hide };
    const copy = cloneTree(el, job, el !== document.body && el !== document.documentElement);
    if (!copy) throw new Error('glassity: nothing to snapshot');
    await Promise.all(job.pending);
    const wrap = document.createElement('div');
    wrap.setAttribute('style', `width:${width}px;height:${height}px;overflow:hidden;position:relative;`);
    wrap.appendChild(copy);
    markup = new XMLSerializer().serializeToString(wrap);
  }
  if (!markup.includes(XHTML)) markup = markup.replace(/^<div/, `<div xmlns="${XHTML}"`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">${markup}</foreignObject></svg>`;
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await image.decode();

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(dpr, request.maxSize / Math.max(width, height), Math.sqrt(4_194_304 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = pageColor(el);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, scale };
}
