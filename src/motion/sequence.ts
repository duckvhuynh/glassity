/** A sequence accepts existing SVGs or complete SVG markup. */
export type SequenceShape = SVGSVGElement | string;

export interface SequenceOptions {
  /** Total time through all shapes, in milliseconds. Default 1000. */
  duration?: number;
  /** Restart at the first shape on completion. Repeat it last for a seamless loop. Default false. */
  loop?: boolean;
  /** Start after every shape is ready. Default true. */
  autoplay?: boolean;
}

export type SequenceResult = 'completed' | 'cancelled';

export interface SequenceController {
  /** Resolves when shapes are loaded (or cancelled); rejects if a shape cannot be read. */
  readonly ready: Promise<void>;
  /** Settles once, on first completion or cancellation. Looping waits for cancel(). */
  readonly finished: Promise<SequenceResult>;
  readonly progress: number;
  /** Resume, or restart a completed sequence. Reduced motion jumps to the last shape. */
  play(): void;
  /** Freeze the currently drawn shape. */
  pause(): void;
  /** Scrub through the shapes; clamps to 0–1 and keeps the playback state. */
  seek(progress: number): void;
  /** Stop permanently, keeping the current visual state. */
  cancel(): void;
}

export interface SequenceHooks {
  render(progress: number): void;
  requestFrame(): void;
  reducedMotion(): boolean;
  now?(): number;
  cancel?(): void;
}

/** Equal time per adjacent pair; the final endpoint never indexes past the last shape. */
export function sequenceSegment(progress: number, count: number): { from: number; to: number; mix: number } {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('glassity: a sequence needs at least one shape');
  const position = clampProgress(progress) * (count - 1);
  const from = Math.min(Math.floor(position), Math.max(0, count - 2));
  return { from, to: Math.min(from + 1, count - 1), mix: position - from };
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('glassity: sequence progress must be finite');
  return Math.min(1, Math.max(0, value));
}

/** The engine owns loading and drawing; this clock never allocates its own animation frame. */
export class SequenceTimeline implements SequenceController {
  readonly ready: Promise<void>;
  readonly finished: Promise<SequenceResult>;
  private resolveReady!: () => void;
  private rejectReady!: (error: unknown) => void;
  private resolveFinished!: (result: SequenceResult) => void;
  private readonly duration: number;
  private readonly loop: boolean;
  private loaded = false;
  private cancelled = false;
  private running: boolean;
  private value = 0;
  private anchor = 0;
  private anchorProgress = 0;

  constructor(options: SequenceOptions, private readonly hooks: SequenceHooks) {
    this.duration = options.duration ?? 1000;
    if (!Number.isFinite(this.duration) || this.duration < 0)
      throw new RangeError('glassity: sequence duration must be a finite non-negative number');
    this.loop = options.loop ?? false;
    this.running = options.autoplay ?? true;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Loading failures remain observable through ready without an unhandled rejection
    // when a caller only keeps the controller for scroll-driven seeking.
    void this.ready.catch(() => {});
    this.finished = new Promise<SequenceResult>((resolve) => { this.resolveFinished = resolve; });
  }

  get progress(): number { return this.value; }

  private now(): number { return this.hooks.now?.() ?? performance.now(); }

  /** Called once after all fields are available, including a queued seek or pause. */
  activate(): void {
    if (this.loaded || this.cancelled) return;
    this.loaded = true;
    this.anchor = this.now();
    this.anchorProgress = this.value;
    if (this.running && (this.hooks.reducedMotion() || this.duration === 0)) this.complete();
    else {
      this.hooks.render(this.value);
      if (this.running) this.hooks.requestFrame();
    }
    this.resolveReady();
  }

  /** Release pending work on a loading failure. */
  fail(error: unknown): void {
    if (this.cancelled || this.loaded) return;
    this.rejectReady(error);
    this.cancel();
  }

  play(): void {
    if (this.cancelled) return;
    if (this.loaded && (this.hooks.reducedMotion() || this.duration === 0)) {
      this.complete();
      return;
    }
    if (this.running) return;
    this.running = true;
    if (!this.loaded) return;
    if (this.value === 1) {
      this.value = 0;
      this.hooks.render(0);
    }
    this.anchor = this.now();
    this.anchorProgress = this.value;
    this.hooks.requestFrame();
  }

  pause(): void {
    // Do not advance between frames: an interruption freezes what the user saw.
    this.running = false;
  }

  seek(progress: number): void {
    if (this.cancelled) return;
    this.value = clampProgress(progress);
    this.anchor = this.now();
    this.anchorProgress = this.value;
    if (!this.loaded) return;
    this.hooks.render(this.value);
    if (this.running) this.hooks.requestFrame();
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.running = false;
    this.resolveReady();
    this.resolveFinished('cancelled');
    this.hooks.cancel?.();
  }

  /** Returns whether the engine needs another frame. */
  tick(now: number): boolean {
    if (!this.loaded || !this.running || this.cancelled) return false;
    if (this.hooks.reducedMotion() || this.duration === 0) {
      this.complete();
      return false;
    }
    const position = this.anchorProgress + Math.max(0, now - this.anchor) / this.duration;
    if (!this.loop && position >= 1) {
      this.complete();
      return false;
    }
    this.value = this.loop ? position % 1 : position;
    this.hooks.render(this.value);
    return true;
  }

  private complete(): void {
    this.value = 1;
    this.running = false;
    this.hooks.render(1);
    this.resolveFinished('completed');
  }
}
