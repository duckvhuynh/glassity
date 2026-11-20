import { describe, expect, it, vi } from 'vitest';
import { InteractionState, INTERACTION_PRESETS, stepSpring, type InteractionPreset } from '../src/motion/interaction';

class Host extends EventTarget {
  ownerDocument = Object.assign(new EventTarget(), { defaultView: new EventTarget() });
  disabled = false;
  focusVisible = false;
  matches(selector: string): boolean {
    if (selector.startsWith(':disabled')) return this.disabled;
    if (selector === ':focus-visible') return this.focusVisible;
    return true;
  }
  closest(): null { return null; }
  getBoundingClientRect() { return { left: 20, top: 30, width: 60, height: 40 }; }
}

function event(target: EventTarget, type: string, properties: object = {}): void {
  target.dispatchEvent(Object.assign(new Event(type), properties));
}

function setup() {
  const request = vi.fn();
  const press = vi.fn();
  const state = new InteractionState(request, press);
  const host = new Host();
  state.bind(host as unknown as Element);
  return { state, host, request, press };
}

function settle(state: InteractionState, preset: InteractionPreset = 'subtle') {
  for (let i = 0; i < 240; i++) state.step(1 / 60, false, preset);
}

describe('interaction presets', () => {
  it('gives bouncy a larger swell and more overshoot than subtle', () => {
    const peaks = (['subtle', 'bouncy'] as const).map((preset) => {
      let spring = { value: 0, velocity: 0 };
      let peak = 0;
      for (let i = 0; i < 120; i++) {
        spring = stepSpring(spring, 1, 1 / 60, preset);
        peak = Math.max(peak, spring.value);
      }
      expect(spring).toEqual({ value: 1, velocity: 0 });
      return peak;
    });
    expect(peaks[1]).toBeGreaterThan(peaks[0] + 0.1);
    expect(INTERACTION_PRESETS.bouncy.scale).toBeGreaterThan(INTERACTION_PRESETS.subtle.scale);
    expect(INTERACTION_PRESETS.none.scale).toBe(0);
  });

  it('keeps long frames finite and leaves nonpositive time unchanged', () => {
    const start = { value: 0.2, velocity: 0.4 };
    expect(stepSpring(start, 1, 0, 'bouncy')).toEqual(start);
    expect(stepSpring(start, 1, -1, 'bouncy')).toEqual(start);
    const next = stepSpring(start, 1, 30, 'bouncy');
    expect(Number.isFinite(next.value)).toBe(true);
    expect(next.value).toBeLessThan(2);
  });
});

describe('host interaction', () => {
  it('uses the same lift for hover and keyboard focus-visible', () => {
    const { state, host } = setup();
    event(host, 'pointerenter', { pointerType: 'mouse' });
    settle(state);
    const hover = state.highlight;
    expect(hover).toBeGreaterThan(0);
    event(host, 'pointerleave');
    host.focusVisible = true;
    event(host, 'focusin');
    settle(state);
    expect(state.highlight).toBe(hover);
    event(host, 'focusout');
    settle(state);
    expect(state.highlight).toBe(0);
  });

  it.each(['Enter', ' '])('animates a quick %j tap and ignores keyboard repeat', (key) => {
    const { state, host, press } = setup();
    event(host, 'keydown', { key, repeat: false });
    event(host, 'keydown', { key, repeat: true });
    event(host, 'keyup', { key });
    expect(press).toHaveBeenCalledTimes(1);
    expect(press).toHaveBeenLastCalledWith({ x: 50, y: 50 });
    expect(state.step(1 / 60, false, 'subtle')).toBe(true);
    expect(state.scale).toBeGreaterThan(1);
    settle(state);
    expect(state.scale).toBe(1);
    expect(state.glow).toBe(0);
  });

  it('releases an outside pointerup and resets listeners when rebound or disposed', () => {
    const { state, host, press } = setup();
    event(host, 'pointerdown', { button: 0, pointerId: 7, clientX: 31, clientY: 42 });
    expect(press).toHaveBeenLastCalledWith({ x: 31, y: 42 });
    state.step(1 / 60, false, 'bouncy');
    event(host.ownerDocument, 'pointerup', { pointerId: 7 });
    settle(state, 'bouncy');
    expect(state.scale).toBe(1);
    const next = new Host();
    state.bind(next as unknown as Element);
    event(host, 'keydown', { key: 'Enter' });
    expect(press).toHaveBeenCalledTimes(1);
    state.dispose();
    event(next, 'keydown', { key: 'Enter' });
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('ignores disabled buttons, secondary pointers and unsupported keys', () => {
    const { state, host, press } = setup();
    host.disabled = true;
    event(host, 'keydown', { key: 'Enter' });
    host.disabled = false;
    event(host, 'keydown', { key: 'Escape' });
    event(host, 'pointerdown', { button: 2, pointerId: 7, clientX: 31, clientY: 42 });
    expect(press).not.toHaveBeenCalled();
    state.step(1 / 60, false, 'subtle');
    expect(state.scale).toBe(1);
  });

  it('keeps reduced-motion feedback static without deformation and none disables feedback', () => {
    const { state, host } = setup();
    event(host, 'pointerenter', { pointerType: 'mouse' });
    event(host, 'pointerdown', { button: 0, pointerId: 7, clientX: 31, clientY: 42 });
    state.step(1 / 60, true, 'bouncy');
    expect(state.scale).toBe(1);
    expect(state.highlight).toBe(INTERACTION_PRESETS.bouncy.highlight);
    expect(state.glow).toBe(1);
    state.step(1 / 60, false, 'none');
    expect([state.scale, state.highlight, state.glow]).toEqual([1, 0, 0]);
  });

  it('releases a held keyboard key when the browser loses focus', () => {
    const { state, host } = setup();
    event(host, 'keydown', { key: 'Enter' });
    state.step(1 / 60, false, 'subtle');
    event(host.ownerDocument.defaultView, 'blur');
    settle(state);
    expect(state.scale).toBe(1);
  });
});
