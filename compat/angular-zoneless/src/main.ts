import { afterNextRender, ApplicationRef, Component, Directive, inject, input, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { isSupported } from 'glassity';
import { injectGlass, injectGlassProvider, provideGlassity, type GlassOptions } from 'glassity/angular';

declare global {
  interface Window {
    __glassity?: boolean;
    __ticks?: number;
  }
}

/** The directive recipe from the README: a few lines over injectGlass. */
@Directive({ selector: '[glass]' })
export class GlassDirective {
  readonly glass = input<GlassOptions | ''>('');
  constructor() {
    injectGlass(() => this.glass() || {});
  }
}

/** A container whose icons are glass, through injectGlassProvider. */
@Component({
  selector: 'app-stage',
  template: '<ng-content />',
  host: { class: 'stage' },
})
export class Stage {
  constructor() {
    injectGlassProvider({ accessibility: false, tile: true });
  }
}

@Component({
  selector: 'app-root',
  imports: [GlassDirective, Stage],
  template: `
    <button id="color" (click)="color.set('#ffd400')">color</button>
    <button id="swap" (click)="swapped.set(!swapped())">swap</button>
    <button id="toggle" (click)="shown.set(!shown())">toggle</button>

    <div class="stage">
      @if (shown()) {
        <svg [glass]="{ accessibility: false }" data-expect-glass="directive" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
          <path d="M12 2l3 7h7l-5.5 4 2 7-6.5-4.5L5.5 20l2-7L2 9h7z" />
        </svg>
      }
      <!-- provideGlassity: any [data-glass] in the app -->
      <svg data-glass data-expect-glass="app-wide" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      </svg>
    </div>

    <app-stage>
      <svg data-glass data-expect-glass="provider" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
        <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" />
      </svg>
      @if (!swapped()) {
        <svg data-glass data-expect-glass="swap-a" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="8" /></svg>
      } @else {
        <svg data-glass data-expect-glass="swap-b" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="3" /></svg>
      }
      <!-- [attr.style] replaces the whole style attribute on every change -->
      <svg data-glass data-expect-glass="string-style" [attr.style]="'color:' + color()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" />
      </svg>
    </app-stage>
  `,
})
export class App {
  readonly color = signal('#ffffff');
  readonly swapped = signal(false);
  readonly shown = signal(true);

  constructor() {
    // Without zone.js, change detection runs when ApplicationRef.tick is scheduled.
    // Count those: glassity must not cause any while the page is idle.
    window.__ticks = 0;
    const app = inject(ApplicationRef);
    const tick = app.tick.bind(app);
    app.tick = () => {
      window.__ticks = (window.__ticks ?? 0) + 1;
      tick();
    };
    afterNextRender(() => (window.__glassity = isSupported()));
  }
}

bootstrapApplication(App, {
  providers: [provideZonelessChangeDetection(), provideGlassity({ accessibility: false })],
}).catch((error) => console.error(error));
