import { afterEach, describe, expect, it, vi } from 'vitest';
import { isolateLayer, MAX_LAYERS, parseLayers, resolveLayerOptions } from '../src/core/layers';
import { optionsKey, readAttributes, resolveOptions } from '../src/options';

// Small DOM double: browser rasterisation and reference resolution are covered in Chromium.
class Node {
  parentElement: Node | null = null;
  children: Node[] = [];
  style: Record<string, string>;
  constructor(readonly localName: string, readonly attrs: Record<string, string> = {}, style: Record<string, string> = {}) {
    this.style = { fill: 'none', stroke: 'none', display: 'inline', visibility: 'visible', opacity: '1', fillOpacity: '1', strokeOpacity: '1', ...style };
  }
  add(...nodes: Node[]): this {
    for (const node of nodes) { node.parentElement = this; this.children.push(node); }
    return this;
  }
  getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
  getAttributeNames(): string[] { return Object.keys(this.attrs); }
  removeAttribute(name: string): void { delete this.attrs[name]; }
  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const match = part.trim().match(/^(\w+|\*)(?:\[([^\]]+)\])?$/);
      return !!match && (match[1] === '*' || this.localName === match[1]) && (!match[2] || match[2] in this.attrs);
    });
  }
  closest(selector: string): Node | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  contains(node: Node): boolean { return node === this || this.children.some((child) => child.contains(node)); }
  querySelectorAll(selector: string): Node[] {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  remove(): void {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  clone(): Node { return new Node(this.localName, { ...this.attrs }, { ...this.style }).add(...this.children.map((child) => child.clone())); }
}

const group = (name: string, attributes: Record<string, string> = {}) => new Node('g', { 'data-glass-layer': name, ...attributes });
const svg = (node: Node) => node as unknown as SVGSVGElement;
const g = (node: Node) => node as unknown as SVGGElement;
const read = (node: Node, options = resolveOptions({ layers: true })) => parseLayers(svg(node), options);
const styles = () => vi.stubGlobal('getComputedStyle', (node: Node) => node.style);
afterEach(() => vi.unstubAllGlobals());

describe('layer option registry', () => {
  it('keeps the feature opt-in and shares attributes with options', () => {
    expect(resolveOptions()).toMatchObject({ layers: false, colors: 'default', appearance: 'default' });
    const attributes = new Node('svg', { 'data-glass-layers': '', 'data-glass-colors': 'source', 'data-glass-appearance': 'dark' });
    expect(readAttributes(attributes)).toEqual({ layers: true, colors: 'source', appearance: 'dark' });
    expect(resolveOptions({ colors: 'invalid' as never, appearance: 'invalid' as never })).toMatchObject({ colors: 'default', appearance: 'default' });
    expect(optionsKey({ layers: true, appearance: 'dark' })).not.toBe(optionsKey({ layers: true, appearance: 'clear' }));
  });
});

describe('parseLayers', () => {
  it('does not turn ordinary exporter groups or unopted SVGs into layers', () => {
    expect(read(new Node('svg').add(new Node('g')))).toEqual([]);
    expect(read(new Node('svg').add(group('base')), resolveOptions())).toEqual([]);
    expect(read(new Node('svg').add(new Node('path', { 'data-glass-layer': 'path' })))).toEqual([]);
  });

  it('uses document order, not depth or names, and limits the first four layers', () => {
    const root = new Node('svg').add(...Array.from({ length: MAX_LAYERS + 1 }, (_, i) => group('same', { 'data-glass-depth': String((5 - i) / 10) })));
    const layers = read(root);
    expect(layers).toHaveLength(4);
    expect(layers.map((layer) => layer.element)).toEqual(root.children.slice(0, 4));
    expect(layers.map((layer) => layer.options.depth)).toEqual([0.5, 0.4, 0.3, 0.2]);
  });

  it('ignores definitions and other SVG viewports', () => {
    const root = new Node('svg').add(
      new Node('defs').add(group('definition')),
      new Node('clipPath').add(group('clip')),
      new Node('svg').add(group('nested viewport')),
      group('base'),
    );
    expect(read(root).map((layer) => layer.name)).toEqual(['base']);
  });

  it('finds nested marked groups once and updates after removal', () => {
    const mark = group('mark');
    const root = new Node('svg').add(group('base').add(new Node('g').add(mark)));
    expect(read(root).map((layer) => layer.name)).toEqual(['base', 'mark']);
    mark.remove();
    expect(read(root).map((layer) => layer.name)).toEqual(['base']);
  });

  it('inherits the icon material but clamps group overrides independently', () => {
    const root = new Node('svg').add(group('base'), group('mark', {
      'data-glass-depth': '0.08', 'data-glass-frost': '2', 'data-glass-opacity': '.4', 'data-glass-tint': '#f80',
      'data-glass-refraction': '0', 'data-glass-interactive': 'true', 'data-glass-visible': 'false',
    }));
    const [base, mark] = read(root, resolveOptions({ layers: true, depth: 0.2, frost: 0.1, opacity: 0.9 }));
    expect(base.options).toMatchObject({ depth: 0.2, frost: 0.1, opacity: 0.9 });
    expect(mark.options).toMatchObject({ depth: 0.08, frost: 1, opacity: 0.4, tint: '#f80', refraction: 0, interactive: false, visible: true });
  });

  it('uses a child solid fill or stroke, excluding nested layers and definitions', () => {
    styles();
    const root = new Node('svg').add(
      group('base').add(new Node('defs').add(new Node('path', {}, { fill: '#bad' })), group('nested').add(new Node('path', {}, { fill: '#f00' })), new Node('rect', {}, { fill: '#08f' })),
      group('stroke').add(new Node('path', {}, { stroke: '#0f8' })),
    );
    expect(read(root, resolveOptions({ layers: true, colors: 'source' })).map((layer) => layer.options.tint)).toEqual(['#08f', '#f00', '#0f8']);
  });

  it('skips source paint inside hidden ancestors without treating the hidden SVG as empty', () => {
    styles();
    const root = new Node('svg', {}, { opacity: '0' }).add(group('base').add(
      new Node('g', {}, { display: 'none' }).add(new Node('path', {}, { fill: '#f00' })),
      new Node('g', {}, { opacity: '0' }).add(new Node('path', {}, { fill: '#0f0' })),
      new Node('path', {}, { fill: '#08f' }),
    ));
    expect(read(root, resolveOptions({ layers: true, colors: 'source' }))[0].options.tint).toBe('#08f');
  });

  it('skips hidden paint and gradients and lets an explicit layer tint win', () => {
    styles();
    const root = new Node('svg').add(
      group('base', { 'data-glass-tint': '#abc' }).add(new Node('rect', {}, { fill: '#08f' })),
      group('plain').add(new Node('path', {}, { fill: 'url(#gradient)' }), new Node('path', {}, { fill: '#f00', visibility: 'hidden' })),
    );
    expect(read(root, resolveOptions({ layers: true, colors: 'source', tint: '#789' })).map((layer) => layer.options.tint)).toEqual(['#abc', '#789']);
  });
});

describe('layer appearances', () => {
  it('keeps default materials and never adds an implicit plate', () => {
    const base = resolveOptions({ layers: true, tile: true, depth: 0.4 });
    expect(resolveLayerOptions(base, 0)).toMatchObject({ depth: 0.4, tile: false, legibility: 'off' });
    expect(base.tile).toBe(true);
  });

  it('makes dark bodies and light marks with group controls taking priority', () => {
    const base = resolveOptions({ layers: true, appearance: 'dark', colors: 'source' });
    expect(resolveLayerOptions(base, 0, {}, '#f00')).toMatchObject({ tint: '#172033', tintOpacity: 0.82 });
    expect(resolveLayerOptions(base, 1)).toMatchObject({ tint: '#f5f7ff', tintOpacity: 0.72 });
    expect(resolveLayerOptions(base, 1, { tint: '#abc', opacity: 0.4 })).toMatchObject({ tint: '#abc', opacity: 0.4 });
  });

  it('uses clear glass and still accepts per-layer frost', () => {
    const base = resolveOptions({ layers: true, appearance: 'clear', colors: 'source' });
    expect(resolveLayerOptions(base, 0, {}, '#08f')).toMatchObject({ variant: 'clear', frost: 0, tintOpacity: 0.04, tint: '#08f' });
    expect(resolveLayerOptions(base, 1, { frost: 0.2 }).frost).toBe(0.2);
  });

  it('makes tinted layers monochrome using the icon tint', () => {
    const base = resolveOptions({ layers: true, colors: 'source', appearance: 'tinted', tint: '#8570dd' });
    expect(resolveLayerOptions(base, 0, {}, '#f00')).toMatchObject({ tint: '#8570dd', saturation: 0 });
    expect(resolveLayerOptions(base, 1, { tint: '#0f0', saturation: 2 }, '#00f')).toMatchObject({ tint: '#8570dd', saturation: 0 });
    expect(resolveLayerOptions(resolveOptions({ appearance: 'tinted' }), 0).tint).toBe('currentColor');
  });
});

describe('isolateLayer', () => {
  it('keeps the selected layer, ancestor transforms and definitions, excluding unrelated and nested geometry', () => {
    const nested = group('nested').add(new Node('circle'));
    const chosen = group('mark', { 'data-glass-depth': '.08' }).add(new Node('path', { id: 'mark' }), nested);
    const root = new Node('svg').add(
      new Node('defs').add(new Node('clipPath', { id: 'clip' }).add(new Node('rect'))),
      new Node('path', { id: 'unmarked' }),
      new Node('g', { transform: 'translate(2 3)' }).add(group('base').add(new Node('rect')), chosen),
    );
    const clone = root.clone();
    isolateLayer(svg(root), svg(clone), g(chosen));
    expect(clone.children.map((node) => node.localName)).toEqual(['defs', 'g']);
    expect(clone.children[1].attrs.transform).toBe('translate(2 3)');
    expect(clone.children[1].children).toHaveLength(1);
    expect(clone.querySelectorAll('path').map((node) => node.attrs.id)).toEqual(['mark']);
    expect(clone.querySelectorAll('circle')).toHaveLength(0);
    expect(clone.querySelectorAll('g[data-glass-layer]')).toHaveLength(0);
    expect(root.querySelectorAll('g[data-glass-layer]')).toHaveLength(3);
  });

  it('keeps an inner marked layer through its marked ancestors without duplicating the ancestor shape', () => {
    const chosen = group('inner').add(new Node('circle'));
    const root = new Node('svg').add(group('outer', { transform: 'scale(2)' }).add(new Node('rect'), chosen));
    const clone = root.clone();
    isolateLayer(svg(root), svg(clone), g(chosen));
    expect(clone.querySelectorAll('rect')).toHaveLength(0);
    expect(clone.querySelectorAll('circle')).toHaveLength(1);
    expect(clone.children[0].attrs.transform).toBe('scale(2)');
  });
});
