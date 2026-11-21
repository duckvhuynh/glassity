import { serializeIcon, type RasterPlan } from '../core/raster';
import type { FieldTexture } from '../gl/renderer';
import { SequenceTimeline, sequenceSegment, type SequenceOptions, type SequenceShape } from './sequence';

export interface MotionGeometry {
  key: string;
  plan: RasterPlan;
  data: Float32Array;
  empty: boolean;
  refs: number;
  texture: FieldTexture | null;
}

export interface FieldFrame {
  from: MotionGeometry;
  to: MotionGeometry;
  mix: number;
}

let captureId = 0;

/** Sample at texel centres, matching the GPU's clamped linear filtering. */
function sample(field: MotionGeometry, x: number, y: number, width: number, height: number, channel: number): number {
  const { gw, gh } = field.plan;
  if (gw === width && gh === height) return field.data[(y * gw + x) * 2 + channel];
  const px = Math.max(0, Math.min(gw - 1, (x + 0.5) / width * gw - 0.5));
  const py = Math.max(0, Math.min(gh - 1, (y + 0.5) / height * gh - 0.5));
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, gw - 1), y1 = Math.min(y0 + 1, gh - 1);
  const at = (x: number, y: number) => field.data[(y * gw + x) * 2 + channel];
  const a = at(x0, y0) * (1 - (px - x0)) + at(x1, y0) * (px - x0);
  const b = at(x0, y1) * (1 - (px - x0)) + at(x1, y1) * (px - x0);
  return a * (1 - (py - y0)) + b * (py - y0);
}

/** Include the shader's mid-morph swell so an interruption cannot snap backwards. */
export function captureFrame(frame: FieldFrame, plan: RasterPlan = frame.to.plan): MotionGeometry {
  const { from, to } = frame;
  const mix = frame.mix > 0.001 ? Math.min(1, frame.mix) : 0;
  const swell = 0.035 * 4 * mix * (1 - mix);
  const data = new Float32Array(plan.gw * plan.gh * 2);
  for (let y = 0; y < plan.gh; y++) for (let x = 0; x < plan.gw; x++) {
    for (let channel = 0; channel < 2; channel++) {
      const a = sample(from, x, y, plan.gw, plan.gh, channel);
      const b = sample(to, x, y, plan.gw, plan.gh, channel);
      data[(y * plan.gw + x) * 2 + channel] = a + (b - a) * mix + (channel ? swell : -swell);
    }
  }
  return { key: 'motion-capture-' + ++captureId, plan, data, empty: false, refs: 1, texture: null };
}

async function sourceOf(shape: SequenceShape, strokeWidth: number | null): Promise<string> {
  if (typeof shape !== 'string') return serializeIcon(shape, strokeWidth);
  // Keep markup detached: scripts, handlers and embedded HTML never enter the page.
  const xml = shape.replace(/<svg(?=[\s>])/, '<svg xmlns="http://www.w3.org/2000/svg"');
  const doc = new DOMParser().parseFromString(/<svg[^>]*\sxmlns=/.test(shape) ? shape : xml, 'image/svg+xml');
  const svg = doc.documentElement;
  if (doc.querySelector('parsererror') || svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg')
    throw new TypeError('glassity: sequence shapes must be SVG elements or complete SVG markup');
  if (!svg.hasAttribute('viewBox')) {
    const width = parseFloat(svg.getAttribute('width') ?? '') || 24;
    const height = parseFloat(svg.getAttribute('height') ?? '') || 24;
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  if (strokeWidth !== null) {
    for (const node of [svg, ...svg.querySelectorAll('*')]) {
      node.setAttribute('stroke-width', String(strokeWidth));
      (node as SVGElement).style?.setProperty('stroke-width', String(strokeWidth));
    }
  }
  return new XMLSerializer().serializeToString(svg).replace(/^<svg/, '<svg width="__W__" height="__H__"');
}

interface FieldSequenceHooks {
  plan: RasterPlan;
  padding: number;
  strokeWidth: number | null;
  initial: MotionGeometry | null;
  acquire(key: string, source: string, plan: RasterPlan, padding: number): Promise<MotionGeometry>;
  release(field: MotionGeometry): void;
  requestFrame(): void;
  reducedMotion(): boolean;
  changed(): void;
  cancelled(): void;
}

interface SequenceFrameSettings {
  plan: RasterPlan;
  padding: number;
  strokeWidth: number | null;
}

function sameSettings(a: SequenceFrameSettings, b: SequenceFrameSettings): boolean {
  return a.padding === b.padding && a.strokeWidth === b.strokeWidth &&
    (Object.keys(a.plan) as (keyof RasterPlan)[]).every((key) => a.plan[key] === b.plan[key]);
}

/** Own preloaded CPU fields; the engine uploads only the current pair to its shared GPU. */
export class FieldSequence {
  readonly controller: SequenceTimeline;
  frame: FieldFrame | null = null;
  private fields: MotionGeometry[] = [];
  private pending = new Set<MotionGeometry[]>();
  private stopped = false;
  private revision = 0;
  private readonly shapes: readonly SequenceShape[];
  private initial: MotionGeometry | null;
  private requested: SequenceFrameSettings;
  private applied: SequenceFrameSettings | null = null;

  constructor(shapes: readonly SequenceShape[], options: SequenceOptions, private hooks: FieldSequenceHooks) {
    this.controller = new SequenceTimeline(options, {
      render: (progress) => this.render(progress),
      requestFrame: hooks.requestFrame,
      reducedMotion: hooks.reducedMotion,
      cancel: () => {
        try { hooks.cancelled(); }
        finally { this.dispose(); }
      },
    });
    this.shapes = shapes.slice();
    // Keep the original capture as a CPU template, so repeated resizes never compound filtering.
    this.initial = hooks.initial;
    hooks.initial = null;
    this.requested = { plan: hooks.plan, padding: hooks.padding, strokeWidth: hooks.strokeWidth };
    this.schedule(this.requested);
  }

  /** Keep the old fields visible while rebuilding, without touching the playback clock. */
  reframe(plan: RasterPlan, padding: number, strokeWidth: number | null): void {
    if (this.stopped) return;
    const settings = { plan, padding, strokeWidth };
    if (sameSettings(settings, this.requested)) return;
    this.requested = settings;
    this.schedule(settings);
  }

  private schedule(settings: SequenceFrameSettings): void {
    const revision = ++this.revision;
    this.releasePending();
    // Defer even synchronous validation until the owner has stored this instance.
    void Promise.resolve().then(() => this.load(revision, settings));
  }

  private render(progress: number): void {
    if (!this.fields.length || this.stopped) return;
    const { from, to, mix } = sequenceSegment(progress, this.fields.length);
    this.frame = { from: this.fields[from], to: this.fields[to], mix };
    this.hooks.changed();
  }

  private async load(revision: number, settings: SequenceFrameSettings): Promise<void> {
    const { hooks } = this;
    const current = () => !this.stopped && revision === this.revision;
    const pending: MotionGeometry[] = [];
    this.pending.add(pending);
    try {
      if (!current()) return;
      if (this.shapes.length < 2) throw new RangeError('glassity: a sequence needs at least two shapes');
      // Sequential acquisition bounds transient raster memory for long sequences.
      for (const shape of this.shapes) {
        if (!current()) return;
        const source = await sourceOf(shape, settings.strokeWidth);
        if (!current()) return;
        const p = settings.plan;
        const key = p.gw + 'x' + p.gh + '|' + p.cssW + 'x' + p.cssH + '|' + settings.padding + '|' + source;
        const field = await hooks.acquire(key, source, p, settings.padding);
        pending.push(field);
        if (!current()) return;
        if (field.empty) throw new Error('glassity: a sequence shape draws no readable pixels');
      }
      if (this.initial) {
        const first = captureFrame({ from: this.initial, to: this.initial, mix: 0 }, settings.plan);
        const replaced = pending[0];
        pending[0] = first;
        hooks.release(replaced);
      }
      const previous = this.fields;
      const activate = !this.applied;
      this.fields = pending.splice(0);
      this.applied = settings;
      try {
        if (activate) this.controller.activate();
        else this.render(this.controller.progress);
      } finally {
        for (const field of previous) hooks.release(field);
      }
    } catch (error) {
      if (!current()) return;
      if (!this.applied) this.controller.fail(error);
      else {
        // A failed resize keeps a usable sequence and permits a later resize to retry.
        this.requested = this.applied;
        console.warn('glassity: could not resize this sequence; keeping its previous fields.', error);
      }
    } finally {
      this.pending.delete(pending);
      for (const field of pending.splice(0)) hooks.release(field);
    }
  }

  private releasePending(): void {
    for (const fields of this.pending) for (const field of fields.splice(0)) this.hooks.release(field);
    this.pending.clear();
  }

  private dispose(): void {
    this.stopped = true;
    this.revision++;
    this.releasePending();
    for (const field of this.fields) this.hooks.release(field);
    this.fields = [];
    if (this.initial) this.hooks.release(this.initial);
    this.initial = null;
    this.frame = null;
  }
}
