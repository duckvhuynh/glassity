export const TOUCH_LIGHT_RADIUS = 120;
export const TOUCH_LIGHT_LIFETIME = 700;
const CAPACITY = 8;

interface Light { x: number; y: number; start: number }
export interface TouchLightSample { x: number; y: number; strength: number }
export interface LightRect { left: number; top: number; width: number; height: number }

/** One bounded pool per engine; coordinates stay in viewport space. */
export class TouchLight {
  private lights: Light[] = [];

  emit(x: number, y: number, now: number): void {
    if (![x, y, now].every(Number.isFinite)) return;
    this.prune(now);
    // Several icons may share one button and receive the same press.
    if (this.lights.some((light) => now - light.start < 4 && Math.hypot(x - light.x, y - light.y) < 2)) return;
    this.lights.push({ x, y, start: now });
    if (this.lights.length > CAPACITY) this.lights.shift();
  }

  sample(rect: LightRect, now: number): TouchLightSample {
    let strongest: TouchLightSample = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, strength: 0 };
    for (const light of this.lights) {
      const age = now - light.start;
      if (age < 0 || age >= TOUCH_LIGHT_LIFETIME) continue;
      const dx = light.x - Math.max(rect.left, Math.min(light.x, rect.left + rect.width));
      const dy = light.y - Math.max(rect.top, Math.min(light.y, rect.top + rect.height));
      const distance = Math.hypot(dx, dy);
      if (distance >= TOUCH_LIGHT_RADIUS) continue;
      const arrival = Math.max(0, Math.min(1, (age - distance / 0.8) / 90));
      const spread = arrival * arrival * (3 - 2 * arrival);
      const strength = spread * Math.pow(1 - distance / TOUCH_LIGHT_RADIUS, 2) * Math.pow(1 - age / TOUCH_LIGHT_LIFETIME, 2);
      if (strength > strongest.strength) strongest = { x: light.x, y: light.y, strength };
    }
    return strongest;
  }

  /** True while at least one light still needs animation frames. */
  prune(now: number): boolean {
    this.lights = this.lights.filter((light) => now - light.start < TOUCH_LIGHT_LIFETIME);
    return this.lights.length > 0;
  }

  clear(): void { this.lights = []; }
}
