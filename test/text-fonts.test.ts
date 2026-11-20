import { afterEach, describe, expect, it, vi } from 'vitest';
import { textFontCss, waitForTextFonts, watchTextFonts } from '../src/text-fonts';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fontDocument(ready: Promise<unknown>) {
  const fonts = Object.assign(new EventTarget(), { ready });
  return { doc: { fonts } as unknown as Pick<Document, 'fonts'>, fonts };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('text font readiness', () => {
  it('waits until the browser finishes loading fonts', async () => {
    const pending = deferred();
    const { doc } = fontDocument(pending.promise);
    const done = vi.fn();
    const waiting = waitForTextFonts(doc).then(done);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    pending.resolve();
    await waiting;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('reads a fresh ready promise after another font starts loading', async () => {
    const { doc, fonts } = fontDocument(Promise.resolve());
    await waitForTextFonts(doc);
    const pending = deferred();
    fonts.ready = pending.promise;
    const done = vi.fn();
    const waiting = waitForTextFonts(doc).then(done);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    pending.resolve();
    await waiting;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('allows browsers without the FontFaceSet API', async () => {
    const doc = {} as Pick<Document, 'fonts'>;
    await expect(waitForTextFonts(doc)).resolves.toBeUndefined();
    const changed = vi.fn();
    expect(watchTextFonts(doc, changed)).toBeTypeOf('function');
    expect(changed).not.toHaveBeenCalled();
  });

  it('invalidates after initial readiness and later success or failure events', async () => {
    const pending = deferred();
    const { doc, fonts } = fontDocument(pending.promise);
    const changed = vi.fn();
    const stop = watchTextFonts(doc, changed);
    pending.resolve();
    await pending.promise;
    expect(changed).toHaveBeenCalledTimes(1);
    fonts.dispatchEvent(new Event('loadingdone'));
    fonts.dispatchEvent(new Event('loadingerror'));
    expect(changed).toHaveBeenCalledTimes(3);
    stop();
    fonts.dispatchEvent(new Event('loadingdone'));
    fonts.dispatchEvent(new Event('loadingerror'));
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('does not invalidate a source destroyed before ready resolves', async () => {
    const pending = deferred();
    const { doc, fonts } = fontDocument(pending.promise);
    const changed = vi.fn();
    const remove = vi.spyOn(fonts, 'removeEventListener');
    const stop = watchTextFonts(doc, changed);
    stop();
    pending.resolve();
    await pending.promise;
    expect(changed).not.toHaveBeenCalled();
    expect(remove.mock.calls.map(([name]) => name)).toEqual(['loadingdone', 'loadingerror']);
  });

  it('handles a failed ready promise without an unhandled watcher rejection', async () => {
    const pending = deferred();
    const { doc } = fontDocument(pending.promise);
    const changed = vi.fn();
    const stop = watchTextFonts(doc, changed);
    const waiting = waitForTextFonts(doc);
    pending.reject(new Error('font failed'));
    await expect(waiting).rejects.toThrow('font failed');
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });
});

function face(family: string, source: string): CSSRule {
  const declarations: Record<string, string> = { 'font-family': family, src: source, 'font-weight': '100 900' };
  const style = Object.assign(Object.keys(declarations), { getPropertyValue: (name: string) => declarations[name] ?? '' });
  return { type: 5, style } as unknown as CSSFontFaceRule;
}

function sheet(rules: CSSRule[], href: string | null = null): CSSStyleSheet {
  return { cssRules: rules, href, disabled: false, media: { mediaText: '' } } as unknown as CSSStyleSheet;
}

function element(sheets: CSSStyleSheet[], families: string[] = []): HTMLElement {
  const ownerDocument = {
    styleSheets: sheets,
    adoptedStyleSheets: [],
    baseURI: 'https://example.test/page/',
    fonts: families.map((family) => ({ family })),
    defaultView: null,
  };
  return { ownerDocument, getRootNode: () => ownerDocument } as unknown as HTMLElement;
}

function mockFontFetch() {
  const fetcher = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['font']) }));
  vi.stubGlobal('fetch', fetcher);
  class Reader {
    result = 'data:font/woff2;base64,Zm9udA==';
    onload?: () => void;
    readAsDataURL() { this.onload?.(); }
  }
  vi.stubGlobal('FileReader', Reader);
  return fetcher;
}

describe('text font embedding', () => {
  it('embeds only requested families and resolves URLs against the stylesheet', async () => {
    const fetcher = mockFontFetch();
    const target = element([sheet([
      face('"Text Icons"', 'url("../fonts/text-icons.woff2") format("woff2")'),
      face('Unused', 'url("missing.woff2")'),
    ], 'https://example.test/css/main.css')], ['Text Icons']);
    const css = await textFontCss(target, new Set(["'text icons'", 'sans-serif']));
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://example.test/fonts/text-icons.woff2');
    expect(css).toContain('font-family:"Text Icons";');
    expect(css).toContain('src:url("data:font/woff2;base64,Zm9udA==") format("woff2");');
    expect(css).toContain('font-weight:100 900;');
    expect(css).not.toContain('Unused');
  });

  it('keeps data and system-local font sources without fetching', async () => {
    const fetcher = mockFontFetch();
    const target = element([sheet([face('Local', 'local("Arial"), url("data:font/woff2;base64,YQ==")')])]);
    const css = await textFontCss(target, new Set(['Local']));
    expect(css).toContain('local("Arial"), url("data:font/woff2;base64,YQ==")');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps a working first font URL when an optional fallback URL fails', async () => {
    const fetcher = mockFontFetch();
    fetcher.mockImplementation(async (url?: string) => {
      if (url?.endsWith('.woff')) throw new Error('optional format missing');
      return { ok: true, blob: async () => new Blob(['font']) };
    });
    const target = element([sheet([face('Fallback', 'url("modern-fallback.woff2") format("woff2") tech(variations), url("legacy-fallback.woff") format("woff")')])]);
    const css = await textFontCss(target, new Set(['Fallback']));
    expect(css).toContain('src:url("data:font/woff2;base64,Zm9udA==") format("woff2") tech(variations);');
    expect(css).not.toContain('legacy-fallback');
    expect(css).not.toContain('format("woff")');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves local and data alternatives in order when URL alternatives fail', async () => {
    const fetcher = mockFontFetch();
    fetcher.mockRejectedValue(new Error('offline'));
    const target = element([sheet([face('Local Fallback', 'local("Font, Name"), url("missing-local-fallback.woff2"), url("data:font/woff2;base64,YQ==") format("woff2")')])]);
    const css = await textFontCss(target, new Set(['Local Fallback']));
    expect(css).toContain('src:local("Font, Name"), url("data:font/woff2;base64,YQ==") format("woff2");');
    expect(css).not.toContain('missing-local-fallback');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps successful URL alternatives in authored order', async () => {
    mockFontFetch();
    const target = element([sheet([face('Ordered', 'url("ordered-a.woff2") format("woff2"), local("Arial"), url("ordered-b.woff") format("woff")')])]);
    const css = await textFontCss(target, new Set(['Ordered']));
    expect(css).toContain('src:url("data:font/woff2;base64,Zm9udA==") format("woff2"), local("Arial"), url("data:font/woff2;base64,Zm9udA==") format("woff");');
  });

  it('traverses imported and grouped rules and adopted sheets', async () => {
    const target = element([sheet([{ type: 3, styleSheet: sheet([
      { type: 0, cssRules: [face('Nested', 'local("Arial")')] } as unknown as CSSRule,
    ]) } as CSSImportRule])]);
    (target.ownerDocument as unknown as { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [sheet([face('Adopted', 'local("Arial")')])];
    const css = await textFontCss(target, new Set(['Nested', 'Adopted']));
    expect(css).toContain('font-family:Nested;');
    expect(css).toContain('font-family:Adopted;');
  });

  it('rejects a registered custom font with no readable source instead of substituting letters', async () => {
    const blocked = { get cssRules() { throw new Error('SecurityError'); } } as unknown as CSSStyleSheet;
    await expect(textFontCss(element([blocked], ['Private Icons']), new Set(['Private Icons'])))
      .rejects.toThrow('needs a readable @font-face rule');
    await expect(textFontCss(element([], ['Programmatic']), new Set(['Programmatic'])))
      .rejects.toThrow('needs a readable @font-face rule');
  });

  it('does not mistake a system font for an unreadable web font', async () => {
    await expect(textFontCss(element([]), new Set(['Arial', 'sans-serif']))).resolves.toBe('');
  });

  it('retries a failed font download instead of retaining a rejected cache entry', async () => {
    const fetcher = mockFontFetch();
    fetcher.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('also offline'));
    const target = element([sheet([face('Retry', 'url("retry-font.woff2"), url("retry-font.woff")')])], ['Retry']);
    await expect(textFontCss(target, new Set(['Retry']))).rejects.toThrow('offline');
    await expect(textFontCss(target, new Set(['Retry']))).resolves.toContain('data:font/woff2');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('shares a successful font fetch between text sources', async () => {
    const fetcher = mockFontFetch();
    const target = element([sheet([face('Shared', 'url("shared-font.woff2")')])], ['Shared']);
    const css = await textFontCss(target, new Set(['Shared']));
    await expect(textFontCss(target, new Set(['Shared']))).resolves.toBe(css);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
