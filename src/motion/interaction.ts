export type InteractionPreset = 'none' | 'subtle' | 'bouncy';

export const INTERACTION_PRESETS = {
  none: { stiffness: 420, damping: 40, scale: 0, highlight: 0 },
  subtle: { stiffness: 420, damping: 36, scale: 0.035, highlight: 0.12 },
  bouncy: { stiffness: 420, damping: 18, scale: 0.07, highlight: 0.18 },
} as const;

export interface SpringState { value: number; velocity: number }
export interface TouchPoint { x: number; y: number }

/** Small substeps keep the spring stable after a slow frame. */
export function stepSpring(state: SpringState, target: number, dt: number, preset: InteractionPreset): SpringState {
  const { stiffness, damping } = INTERACTION_PRESETS[preset];
  let { value, velocity } = state;
  const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.064)) : 0;
  const count = Math.ceil(elapsed * 120);
  for (let i = 0; i < count; i++) {
    const step = elapsed / count;
    velocity += (stiffness * (target - value) - damping * velocity) * step;
    value += velocity * step;
  }
  if (Math.abs(value - target) < 0.001 && Math.abs(velocity) < 0.01) return { value: target, velocity: 0 };
  return { value, velocity };
}

const EVENTS = ['pointerenter', 'pointerleave', 'pointerdown', 'pointerup', 'pointercancel', 'keydown', 'keyup', 'focusin', 'focusout'] as const;

/** Host input is kept separate from rendering so no CSS transform moves the backdrop. */
export class InteractionState {
  scale = 1;
  highlight = 0;
  glow = 0;
  touch: TouchPoint = { x: 0, y: 0 };
  private host: Element | null = null;
  private pointer: number | null = null;
  private key: string | null = null;
  private hovered = false;
  private focused = false;
  private pulse = 0;
  private spring: SpringState = { value: 0, velocity: 0 };

  constructor(private requestFrame: () => void, private onPress: (point: TouchPoint) => void) {}

  bind(host: Element | null): void {
    if (host === this.host) return;
    for (const type of EVENTS) {
      this.host?.removeEventListener(type, this.event);
      host?.addEventListener(type, this.event, { passive: true });
    }
    this.host?.ownerDocument?.removeEventListener('pointerup', this.releasePointer);
    this.host?.ownerDocument?.removeEventListener('pointercancel', this.releasePointer);
    this.host?.ownerDocument?.defaultView?.removeEventListener('blur', this.resetInput);
    host?.ownerDocument?.addEventListener('pointerup', this.releasePointer, { passive: true });
    host?.ownerDocument?.addEventListener('pointercancel', this.releasePointer, { passive: true });
    host?.ownerDocument?.defaultView?.addEventListener('blur', this.resetInput);
    this.host = host;
    this.resetInput();
  }

  private disabled(): boolean {
    return !this.host || this.host.matches(':disabled,[aria-disabled="true"]');
  }

  private readonly resetInput = (): void => {
    this.pointer = this.key = null;
    this.hovered = this.focused = false;
    this.pulse = 0;
    this.requestFrame();
  };

  private readonly releasePointer = (event: Event): void => {
    if (this.pointer !== (event as PointerEvent).pointerId) return;
    this.pointer = null;
    this.requestFrame();
  };

  private press(point: TouchPoint): void {
    this.touch = point;
    // A keyboard tap can start and end between animation frames.
    this.pulse = 0.08;
    this.onPress(point);
  }

  private readonly event = (event: Event): void => {
    const host = this.host;
    if (!host) return;
    if (this.disabled()) { this.resetInput(); return; }
    switch (event.type) {
      case 'pointerenter':
        this.hovered = (event as PointerEvent).pointerType !== 'touch';
        break;
      case 'pointerleave':
        this.hovered = false;
        this.pointer = null;
        break;
      case 'pointerdown': {
        const pointer = event as PointerEvent;
        if (pointer.button !== 0 || pointer.isPrimary === false) return;
        this.pointer = pointer.pointerId;
        this.press({ x: pointer.clientX, y: pointer.clientY });
        break;
      }
      case 'pointerup':
      case 'pointercancel':
        this.releasePointer(event);
        break;
      case 'focusin':
        this.focused = host.matches(':focus-visible');
        break;
      case 'focusout':
        this.focused = false;
        this.key = null;
        break;
      case 'keydown': {
        const key = event as KeyboardEvent;
        if (key.key !== 'Enter' && key.key !== ' ') return;
        if (key.repeat || this.key !== null || !host.matches('button,a,[role="button"],summary')) return;
        const target = event.target as Element | null;
        if (target?.closest?.('input,textarea,select,[contenteditable]')) return;
        this.key = key.key;
        this.focused = host.matches(':focus-visible');
        const rect = host.getBoundingClientRect();
        this.press({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        break;
      }
      case 'keyup':
        if (this.key === (event as KeyboardEvent).key) this.key = null;
        break;
    }
    this.requestFrame();
  };

  /** Returns true for changed output or while a spring/fade still needs frames. */
  step(dt: number, reducedMotion: boolean, preset: InteractionPreset): boolean {
    const before = [this.scale, this.highlight, this.glow];
    const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.064)) : 0;
    const enabled = preset !== 'none' && !this.disabled();
    const pressed = enabled && (this.pointer !== null || this.key !== null || this.pulse > 0);
    this.pulse = Math.max(0, this.pulse - elapsed);
    const target = pressed ? 1 : 0;
    const highlight = enabled && (this.hovered || this.focused) ? INTERACTION_PRESETS[preset].highlight : 0;
    if (reducedMotion || !enabled) {
      this.spring = { value: 0, velocity: 0 };
      this.scale = 1;
      this.highlight = highlight;
      this.glow = target;
    } else {
      this.spring = stepSpring(this.spring, target, elapsed, preset);
      this.scale = 1 + this.spring.value * INTERACTION_PRESETS[preset].scale;
      this.highlight = approach(this.highlight, highlight, elapsed, 16);
      this.glow = approach(this.glow, target, elapsed, pressed ? 26 : 5);
    }
    return before.some((value, i) => value !== [this.scale, this.highlight, this.glow][i]) ||
      (!reducedMotion && (this.spring.value !== target || this.spring.velocity !== 0 || this.highlight !== highlight || this.glow !== target)) || this.pulse > 0;
  }

  dispose(): void { this.bind(null); }
}

function approach(value: number, target: number, dt: number, speed: number): number {
  const next = value + (target - value) * (1 - Math.exp(-dt * speed));
  return Math.abs(next - target) < 0.001 ? target : next;
}
