import type { GlassOptions } from './options';

/** Options shared by a provider or an auto() root. Ownership is separate from inheritance. */
export interface Scope {
  root: Element | null;
  options: GlassOptions;
}

// Adapters are separate bundles; their portal context must reach the shared engine.
const KEY = Symbol.for('glassity.inherited@' + __VERSION__);
const store = globalThis as unknown as Record<symbol, WeakMap<Element, GlassOptions> | undefined>;
export const inheritedOptions = (store[KEY] ??= new WeakMap<Element, GlassOptions>());

/** Raw layers only: resolving a recipe here would turn its values into explicit overrides. */
export class ScopeRegistry {
  private page: GlassOptions = {};
  private scopes = new Set<Scope>();
  private discovery = new Map<Scope, () => void>();

  configure(options: GlassOptions): void {
    this.page = { ...options };
  }

  add(scope: Scope, discover?: () => void): void {
    this.scopes.add(scope);
    if (discover) this.discovery.set(scope, discover);
  }

  delete(scope: Scope): void {
    this.scopes.delete(scope);
    this.discovery.delete(scope);
  }

  /** A surviving controller may need to reclaim icons when another owner goes away. */
  discover(): void {
    for (const discover of this.discovery.values()) discover();
  }

  hasRoot(root: Element): boolean {
    return [...this.scopes].some((scope) => scope.root === root);
  }

  layers(element: Element): GlassOptions[] {
    const layers = [this.page];
    const inherited = inheritedOptions.get(element);
    if (inherited) layers.push(inherited);
    for (const scope of this.scopes) if (!scope.root) layers.push(scope.options);
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; ) {
      ancestors.push(node);
      // Icons in open shadow roots inherit the scopes surrounding their host.
      node = node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null;
    }
    for (const node of ancestors.reverse())
      for (const scope of this.scopes) if (scope.root === node) layers.push(scope.options);
    return layers;
  }
}
