import { afterEach, describe, expect, it } from 'vitest';
import { configure } from '../src/index';
import { resolveOptions } from '../src/options';
import { inheritedOptions, ScopeRegistry, type Scope } from '../src/scopes';

// Only ancestry is needed; scope resolution must not depend on browser globals.
const element = (parentElement: Element | null = null, host?: Element): Element =>
  ({ parentElement, getRootNode: () => ({ host }) }) as unknown as Element;

const outer = element();
const inner = element(outer);
const svg = element(inner);

afterEach(() => inheritedOptions.delete(svg));

describe('page defaults and scope inheritance', () => {
  it('resumes only surviving discovery controllers', () => {
    const scopes = new ScopeRegistry();
    const first: Scope = { root: outer, options: {} };
    const second: Scope = { root: outer, options: {} };
    const scans: string[] = [];
    scopes.add(first, () => scans.push('first'));
    scopes.add(second, () => scans.push('second'));
    scopes.delete(second);
    scopes.discover();
    expect(scans).toEqual(['first']);
    expect(scopes.hasRoot(outer)).toBe(true);
    scopes.delete(first);
    expect(scopes.hasRoot(outer)).toBe(false);
  });

  it('keeps configure safe to call during server rendering', () => {
    expect(() => configure({ look: 'crystal' })).not.toThrow();
    expect(() => configure({})).not.toThrow();
  });

  it('replaces and resets page defaults for existing and future icons', () => {
    const scopes = new ScopeRegistry();
    const options = { depth: 0.7, look: 'frosted' as const };
    scopes.configure(options);
    options.depth = 1.2;
    expect(resolveOptions(...scopes.layers(svg))).toMatchObject({ depth: 0.7, frost: 0.8 });
    expect(resolveOptions(...scopes.layers(element()))).toMatchObject({ depth: 0.7, frost: 0.8 });
    scopes.configure({ look: 'clear' });
    expect(resolveOptions(...scopes.layers(svg))).toMatchObject({ depth: 0.16, frost: 0, tintOpacity: 0.04 });
    scopes.configure({});
    expect(resolveOptions(...scopes.layers(svg))).toEqual(resolveOptions());
  });

  it('orders scopes by DOM ancestry, even when the inner scope registers first', () => {
    const scopes = new ScopeRegistry();
    scopes.configure({ depth: 0.1, shine: 0.2, frost: 0.1, weight: 0.01 });
    scopes.add({ root: inner, options: { depth: 0.3, shine: 0.4 } });
    scopes.add({ root: outer, options: { depth: 0.2, frost: 0.5 } });
    scopes.add({ root: null, options: { depth: 0.15, rim: 2 } });
    const resolved = resolveOptions(...scopes.layers(svg), { depth: 0.4, shine: 0.6 }, { depth: 0.5 });
    expect(resolved).toMatchObject({ depth: 0.5, shine: 0.6, frost: 0.5, weight: 0.01, rim: 2 });
    expect(resolveOptions(...scopes.layers(svg)).depth).toBe(0.3);
  });

  it('reads updated outer options and drops them when that scope is destroyed', () => {
    const scopes = new ScopeRegistry();
    const parent: Scope = { root: outer, options: { look: 'crystal', shine: 2 } };
    const child: Scope = { root: inner, options: { depth: 0.4 } };
    scopes.add(parent);
    scopes.add(child);
    expect(resolveOptions(...scopes.layers(svg))).toMatchObject({ variant: 'clear', depth: 0.4, shine: 2 });
    parent.options = { look: 'tinted', rim: 3 };
    expect(resolveOptions(...scopes.layers(svg))).toMatchObject({ variant: 'regular', depth: 0.4, curvature: 1, shine: 1, rim: 3, tint: '#2f6bef' });
    scopes.delete(parent);
    expect(resolveOptions(...scopes.layers(svg))).toEqual(resolveOptions(child.options));
  });

  it('puts every explicit layer above the winning look recipe', () => {
    const scopes = new ScopeRegistry();
    scopes.configure({ depth: 0.9, frost: 0.6 });
    scopes.add({ root: outer, options: { look: 'crystal' } });
    scopes.add({ root: inner, options: { look: 'clear' } });
    expect(resolveOptions(...scopes.layers(svg))).toMatchObject({ depth: 0.9, frost: 0.6, curvature: 1, dispersion: 0.5 });
  });

  it('inherits from the new ancestors when a scope moves', () => {
    const scopes = new ScopeRegistry();
    const other = element();
    scopes.add({ root: outer, options: { depth: 0.2 } });
    scopes.add({ root: other, options: { depth: 0.8 } });
    const moving = element(outer);
    scopes.add({ root: moving, options: { shine: 2 } });
    const icon = element(moving);
    expect(resolveOptions(...scopes.layers(icon)).depth).toBe(0.2);
    Object.assign(moving, { parentElement: other });
    expect(resolveOptions(...scopes.layers(icon))).toMatchObject({ depth: 0.8, shine: 2 });
  });

  it('keeps unrelated roots separate and follows a shadow host', () => {
    const scopes = new ScopeRegistry();
    scopes.add({ root: element(), options: { depth: 1 } });
    scopes.add({ root: outer, options: { shine: 3 } });
    const shadowIcon = element(null, inner);
    expect(resolveOptions(...scopes.layers(shadowIcon))).toMatchObject({ depth: 0.16, shine: 3 });
  });

  it('uses provider context for portals below DOM scopes, attributes and own options', () => {
    const scopes = new ScopeRegistry();
    inheritedOptions.set(svg, { depth: 0.3, shine: 2 });
    expect(resolveOptions(...scopes.layers(svg))).toMatchObject({ depth: 0.3, shine: 2 });
    scopes.add({ root: inner, options: { depth: 0.4 } });
    expect(resolveOptions(...scopes.layers(svg), { depth: 0.5 }, { shine: 3 })).toMatchObject({ depth: 0.5, shine: 3 });
  });
});
