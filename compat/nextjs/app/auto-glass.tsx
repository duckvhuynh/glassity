'use client';

// Side-effect import: every [data-glass] on the page becomes glass. It starts at module
// load in the browser, before React has hydrated, so it has to wait on its own.
import 'glassity/auto';

export function AutoGlass() {
  return null;
}
