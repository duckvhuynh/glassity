import { cachedLoad, LruCache } from './core/lru';

type FontDocument = Pick<Document, 'fonts'>;

/** Read the current ready promise: a later font load starts a new cycle. */
export async function waitForTextFonts(doc: FontDocument): Promise<void> {
  await doc.fonts?.ready;
}

/** Font loads can change glyph outlines without changing an element's dimensions. */
export function watchTextFonts(doc: FontDocument, changed: () => void): () => void {
  const fonts = doc.fonts;
  if (!fonts) return () => {};
  let active = true;
  const notify = () => { if (active) changed(); };
  fonts.addEventListener('loadingdone', notify);
  fonts.addEventListener('loadingerror', notify);
  void Promise.resolve(fonts.ready).then(notify, notify);
  return () => {
    active = false;
    fonts.removeEventListener('loadingdone', notify);
    fonts.removeEventListener('loadingerror', notify);
  };
}

const fontData = new LruCache<string, Promise<string | null>>(32);
const familyName = (name: string) => name.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase();

async function fontDataUrl(url: string): Promise<string> {
  const data = await cachedLoad(fontData, url, async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`glassity: could not embed text font "${url}" (${response.status}).`);
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`glassity: could not read text font "${url}".`));
      reader.onabort = reader.onerror;
      reader.readAsDataURL(blob);
    });
  });
  if (!data) throw new Error(`glassity: could not embed text font "${url}".`);
  return data;
}

function fontSources(source: string): string[] {
  const sources: string[] = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      sources.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  sources.push(source.slice(start).trim());
  return sources.filter(Boolean);
}

async function inlineFontUrls(source: string, base: string): Promise<string> {
  const results = await Promise.allSettled(fontSources(source).map(async (alternative) => {
    if (/^local\(/i.test(alternative)) return alternative;
    const pattern = /url\(\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^)]*?))\s*\)/gi;
    const matches = [...alternative.matchAll(pattern)];
    if (!matches.length) throw new Error('glassity: a text font has no readable source.');
    const urls = await Promise.all(matches.map(async (match) => {
      const value = (match[1] ?? match[2] ?? match[3]).trim();
      if (/^data:/i.test(value)) return match[0];
      const url = new URL(value.replace(/\\([()'"\\ ])/g, '$1'), base).href;
      return `url("${await fontDataUrl(url)}")`;
    }));
    let index = 0;
    return alternative.replace(pattern, () => urls[index++]);
  }));
  // An optional legacy format must not invalidate a working modern font source.
  const usable = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (!usable.length) {
    const failed = results.find((result) => result.status === 'rejected');
    throw failed?.reason ?? new Error('glassity: a text font has no readable source.');
  }
  return usable.join(', ');
}

interface FontRule {
  style: CSSStyleDeclaration;
  base: string;
}

/** SVG images cannot see the page's font faces, so copy the faces they actually use. */
export async function textFontCss(element: HTMLElement, families: ReadonlySet<string>): Promise<string> {
  const doc = element.ownerDocument;
  const wanted = new Set([...families].map(familyName));
  const found = new Set<string>();
  const rules: FontRule[] = [];
  const seen = new Set<CSSStyleSheet>();
  const mediaMatches = (media: MediaList | undefined) => !media?.mediaText || !doc.defaultView?.matchMedia || doc.defaultView.matchMedia(media.mediaText).matches;
  const visitRules = (list: CSSRuleList, base: string): void => {
    for (const rule of Array.from(list)) {
      if (rule.type === 5) {
        const style = (rule as CSSFontFaceRule).style;
        const family = familyName(style.getPropertyValue('font-family'));
        if (!wanted.has(family)) continue;
        found.add(family);
        rules.push({ style, base });
      } else if (rule.type === 3) {
        const imported = rule as CSSImportRule;
        if (imported.styleSheet && mediaMatches(imported.media)) visitSheet(imported.styleSheet);
      } else if ('cssRules' in rule) {
        if (rule.type === 4 && !mediaMatches((rule as CSSMediaRule).media)) continue;
        if (rule.type === 12 && typeof CSS !== 'undefined' && !CSS.supports((rule as CSSSupportsRule).conditionText)) continue;
        visitRules((rule as CSSGroupingRule).cssRules, base);
      }
    }
  };
  const visitSheet = (sheet: CSSStyleSheet): void => {
    if (seen.has(sheet) || sheet.disabled || !mediaMatches(sheet.media)) return;
    seen.add(sheet);
    let list: CSSRuleList;
    try { list = sheet.cssRules; }
    catch { return; } // Cross-origin CSS is checked against the registered faces below.
    visitRules(list, sheet.href ?? doc.baseURI);
  };
  for (const sheet of [...Array.from(doc.styleSheets), ...doc.adoptedStyleSheets]) visitSheet(sheet);
  const tree = element.getRootNode();
  if (typeof ShadowRoot !== 'undefined' && tree instanceof ShadowRoot)
    for (const sheet of [...Array.from(tree.styleSheets), ...tree.adoptedStyleSheets]) visitSheet(sheet);

  // Programmatically registered fonts have no readable source. A substitute font
  // would turn a ligature icon into letters, so preserve the original instead.
  for (const face of doc.fonts ?? []) {
    const family = familyName(face.family);
    if (wanted.has(family) && !found.has(family))
      throw new Error(`glassity: text font "${face.family}" needs a readable @font-face rule.`);
  }

  return (await Promise.all(rules.map(async ({ style, base }) => {
    const source = style.getPropertyValue('src');
    if (!source) throw new Error('glassity: a text font has no readable source.');
    const inlined = await inlineFontUrls(source, base);
    const declarations = Array.from(style).map((name) => `${name}:${name === 'src' ? inlined : style.getPropertyValue(name)};`).join('');
    return `@font-face{${declarations}}`;
  }))).join('\n');
}
