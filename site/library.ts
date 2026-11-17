// The icon library: 21 open icon sets, every icon, loaded in small pieces as they are shown.
// Data is written by site/library.mjs at build time.

export interface SetInfo {
  prefix: string;
  name: string;
  total: number;
  width: number;
  height: number;
  license: string;
  licenseUrl: string;
  author: string;
  authorUrl: string;
  samples: string[];
}

export interface LibIcon {
  viewBox: string;
  attrs: Record<string, string>;
  body: string;
}

const CHUNK = 300; // must match site/library.mjs
const PAGE = 240; // icons added to the grid at a time

let setsPromise: Promise<SetInfo[]> | null = null;
const namesCache = new Map<string, Promise<string[]>>();
const chunkCache = new Map<string, Promise<void>>();
const loaded = new Map<string, Map<string, LibIcon>>();

const json = <T>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json() as Promise<T>;
  });

export const loadSets = (): Promise<SetInfo[]> => (setsPromise ??= json<SetInfo[]>('sets/index.json'));

export async function setInfo(prefix: string): Promise<SetInfo | null> {
  return (await loadSets()).find((s) => s.prefix === prefix) ?? null;
}

function loadNames(prefix: string): Promise<string[]> {
  let names = namesCache.get(prefix);
  if (!names) namesCache.set(prefix, (names = json<string[]>(`sets/${prefix}/names.json`)));
  return names;
}

function loadChunk(set: SetInfo, index: number): Promise<void> {
  const key = `${set.prefix}/${index}`;
  let chunk = chunkCache.get(key);
  if (!chunk) {
    chunk = json<[string, string, number?, number?, number?, number?][]>(`sets/${key}.json`).then((rows) => {
      let icons = loaded.get(set.prefix);
      if (!icons) loaded.set(set.prefix, (icons = new Map()));
      for (const [name, body, w = set.width, h = set.height, left = 0, top = 0] of rows)
        icons.set(name, { viewBox: `${left} ${top} ${w} ${h}`, attrs: {}, body });
    });
    chunkCache.set(key, chunk);
  }
  return chunk;
}

/** An icon that has been loaded, or null. */
export const libIcon = (prefix: string, name: string): LibIcon | null => loaded.get(prefix)?.get(name) ?? null;

/** Load whatever is needed to draw these icons of a set. */
export async function ensure(prefix: string, names: string[]): Promise<void> {
  const set = await setInfo(prefix);
  if (!set) return;
  const all = await loadNames(prefix);
  const index = new Map(all.map((n, i) => [n, i]));
  const chunks = new Set<number>();
  for (const name of names) {
    const i = index.get(name);
    if (i !== undefined) chunks.add(Math.floor(i / CHUNK));
  }
  await Promise.all([...chunks].map((c) => loadChunk(set, c)));
}

/** A row of icons that shows a set well: its own samples, then the first icons. */
export async function showcase(prefix: string, count: number): Promise<string[]> {
  const set = await setInfo(prefix);
  if (!set) return [];
  const all = await loadNames(prefix);
  const out = [...new Set([...set.samples, ...all])].slice(0, count);
  await ensure(prefix, out);
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const number = (n: number) => n.toLocaleString('en-US');

/**
 * The browser panel: sets on the left, a searchable grid of every icon on the right.
 * `pick` is called with a set and an icon name; `current` says which one is on stage.
 */
export function mountLibrary(
  host: HTMLElement,
  hooks: { pick: (prefix: string, name: string) => void; current: () => { prefix: string | null; icon: string } },
): { open: (prefix?: string) => void; mark: () => void } {
  const toggle = host.querySelector<HTMLButtonElement>('.lib-toggle')!;
  const body = host.querySelector<HTMLElement>('.lib-body')!;
  const list = host.querySelector<HTMLElement>('.lib-sets')!;
  const scroller = host.querySelector<HTMLElement>('.lib-grid')!;
  const grid = host.querySelector<HTMLElement>('.lib-cells')!;
  const more = host.querySelector<HTMLElement>('.lib-more')!;
  const title = host.querySelector<HTMLElement>('.lib-title')!;
  const meta = host.querySelector<HTMLElement>('.lib-meta')!;
  const search = host.querySelector<HTMLInputElement>('.lib-search')!;

  let active: SetInfo | null = null;
  let filtered: string[] = [];
  let shown = 0;
  let generation = 0;
  let busy = false;
  let built = false;

  async function build(): Promise<void> {
    if (built) return;
    built = true;
    const sets = await loadSets();
    list.innerHTML = sets
      .map((s) => `<button type="button" data-prefix="${s.prefix}"><span>${escapeHtml(s.name)}</span><small>${number(s.total)}</small></button>`)
      .join('');
  }

  async function choose(prefix: string): Promise<void> {
    const set = await setInfo(prefix);
    if (!set) return;
    active = set;
    for (const b of list.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.prefix === prefix));
    list.querySelector<HTMLElement>(`[data-prefix="${prefix}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    title.textContent = set.name;
    const license = set.licenseUrl ? `<a href="${set.licenseUrl}" target="_blank" rel="noopener">${escapeHtml(set.license)}</a>` : escapeHtml(set.license);
    const author = set.authorUrl ? `<a href="${set.authorUrl}" target="_blank" rel="noopener">${escapeHtml(set.author)}</a>` : escapeHtml(set.author);
    meta.innerHTML = `${number(set.total)} icons · ${license}${set.author ? ' · ' + author : ''}`;
    search.placeholder = `Search ${number(set.total)} ${set.name} icons`;
    await filter();
  }

  async function filter(): Promise<void> {
    if (!active) return;
    const gen = ++generation;
    const all = await loadNames(active.prefix);
    if (gen !== generation) return;
    const words = search.value.trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
    filtered = words.length ? all.filter((n) => words.every((w) => n.includes(w))) : all;
    shown = 0;
    grid.innerHTML = '';
    scroller.scrollTop = 0;
    more.textContent = filtered.length ? '' : 'No icon matches.';
    await page();
  }

  async function page(): Promise<void> {
    if (!active || busy || shown >= filtered.length) return;
    busy = true;
    const gen = generation;
    const set = active;
    const slice = filtered.slice(shown, shown + PAGE);
    await ensure(set.prefix, slice);
    busy = false;
    if (gen !== generation) return;
    const now = hooks.current();
    grid.insertAdjacentHTML(
      'beforeend',
      slice
        .map((name) => {
          const icon = libIcon(set.prefix, name);
          if (!icon) return '';
          const on = now.prefix === set.prefix && now.icon === name;
          return `<button type="button" class="lib-icon" data-name="${escapeHtml(name)}" title="${escapeHtml(name)}" aria-label="${escapeHtml(name)}" aria-pressed="${on}"><svg viewBox="${icon.viewBox}" aria-hidden="true">${icon.body}</svg></button>`;
        })
        .join(''),
    );
    shown += slice.length;
    more.textContent = shown < filtered.length ? `${number(shown)} of ${number(filtered.length)}` : filtered.length ? `${number(filtered.length)} icons` : 'No icon matches.';
    // Still room on screen: keep filling (only while the panel is open and laid out).
    if (shown < filtered.length && scroller.clientHeight > 0 && scroller.scrollHeight <= scroller.clientHeight + 40) void page();
  }

  const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void page(), { root: scroller, rootMargin: '400px' });
  observer.observe(more);
  // Scrolling near the end also asks for more, in case the observer is slow to report.
  scroller.addEventListener('scroll', () => {
    if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 500) void page();
  }, { passive: true });

  list.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-prefix]');
    if (button) void choose(button.dataset.prefix!);
  });
  grid.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('.lib-icon');
    if (!button || !active) return;
    hooks.pick(active.prefix, button.dataset.name!);
  });
  let timer = 0;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void filter(), 140);
  });

  async function open(prefix?: string): Promise<void> {
    toggle.setAttribute('aria-expanded', 'true');
    body.hidden = false;
    await build();
    const target = prefix ?? active?.prefix ?? hooks.current().prefix ?? 'tabler';
    if (target !== active?.prefix) await choose(target);
  }
  toggle.addEventListener('click', () => {
    if (body.hidden) void open();
    else {
      body.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
  void loadSets().then((sets) => {
    host.querySelector('.lib-count')!.textContent = `${sets.length} sets · ${number(sets.reduce((n, s) => n + s.total, 0))} icons`;
  });

  return {
    open: (prefix) => void open(prefix),
    // Highlight the icon on stage after a pick.
    mark: () => {
      const now = hooks.current();
      for (const b of grid.querySelectorAll<HTMLButtonElement>('.lib-icon[aria-pressed="true"]')) b.setAttribute('aria-pressed', 'false');
      if (active && now.prefix === active.prefix) grid.querySelector(`.lib-icon[data-name="${CSS.escape(now.icon)}"]`)?.setAttribute('aria-pressed', 'true');
    },
  };
}
