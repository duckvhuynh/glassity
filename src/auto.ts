/**
 * Side-effect entry: `import 'glassity/auto'` turns every `[data-glass]` icon
 * on the page into glass and keeps watching for new ones.
 */
import { auto } from './index';

/** The controller for the page-wide auto mode. */
export const controller = auto();
