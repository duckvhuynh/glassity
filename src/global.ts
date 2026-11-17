/**
 * Script-tag build: `<script src="…/glassity.global.js"></script>` exposes
 * `window.glassity` and starts the page-wide auto mode.
 */
import { auto } from './index';

export * from './index';

/** The controller for the page-wide auto mode. */
export const controller = auto();
