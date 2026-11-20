import { HIDDEN, OWN, parentOf } from './dom';

const EVENTS = ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'focusin', 'focusout', 'input', 'change', 'transitionend', 'animationend', 'load'];

/** One observer per tree; only affected icons are read in the engine's next frame. */
export class StyleWatch {
  private roots = new Map<Node, { count: number; observer: MutationObserver }>();
  private icons = new Map<Element, Node[]>();
  private scheme: MediaQueryList | null = null;

  constructor(private changed: (icon: Element, surroundings: boolean) => void) {}

  private readonly all = (): void => {
    for (const icon of this.icons.keys()) this.changed(icon, true);
  };

  private affected(target: Element): void {
    if (target.closest('[' + OWN + ']')) return;
    if (target.closest('style,link[rel="stylesheet"]')) {
      this.all();
      return;
    }
    for (const icon of this.icons.keys()) {
      for (let ancestor: Element | null = icon; ancestor; ancestor = parentOf(ancestor)) {
        if (ancestor !== target) continue;
        this.changed(icon, target !== icon);
        break;
      }
    }
  }

  private readonly onState = (event: Event): void => {
    const target = event.composedPath().find((node) => node instanceof Element) as Element | undefined;
    if (!target || (event.type === 'load' && !target.matches('link[rel="stylesheet"]'))) return;
    this.affected(target.closest('button,a,[role],label,summary') ?? target.closest('svg') ?? target);
  };

  observe(icon: Element): void {
    if (this.icons.get(icon)?.[0] === icon.getRootNode()) return;
    this.unobserve(icon);
    const roots: Node[] = [];
    let node: Node = icon;
    for (;;) {
      const root = node.getRootNode();
      roots.push(root);
      const entry = this.roots.get(root);
      if (entry) entry.count++;
      else {
        const observer = new MutationObserver((records) => {
          const targets = new Set<Element>();
          for (const record of records) {
            if (record.attributeName === HIDDEN || record.attributeName === OWN) continue;
            const target = record.target instanceof Element ? record.target : record.target.parentElement;
            if (!target || target.closest('[' + OWN + ']')) continue;
            if (record.type === 'childList') {
              const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
              if (nodes.length && nodes.every((child) => child instanceof Element && child.hasAttribute(OWN))) continue;
              if (nodes.some((child) => child instanceof Element && child.matches('style,link[rel="stylesheet"]'))) this.all();
            }
            targets.add(target);
          }
          for (const target of targets) this.affected(target);
        });
        observer.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
        for (const event of EVENTS) root.addEventListener(event, this.onState, true);
        this.roots.set(root, { count: 1, observer });
      }
      if (!(root instanceof ShadowRoot)) break;
      node = root.host;
    }
    this.icons.set(icon, roots);
    this.changed(icon, true);
    if (this.icons.size === 1) {
      window.addEventListener('resize', this.all, { passive: true });
      this.scheme = matchMedia('(prefers-color-scheme: dark)');
      this.scheme.addEventListener?.('change', this.all);
    }
  }

  unobserve(icon: Element): void {
    for (const root of this.icons.get(icon) ?? []) {
      const entry = this.roots.get(root)!;
      if (--entry.count) continue;
      entry.observer.disconnect();
      for (const event of EVENTS) root.removeEventListener(event, this.onState, true);
      this.roots.delete(root);
    }
    this.icons.delete(icon);
    if (!this.icons.size) {
      window.removeEventListener('resize', this.all);
      this.scheme?.removeEventListener?.('change', this.all);
      this.scheme = null;
    }
  }
}
