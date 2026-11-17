// Client-only plugin: every [data-glass] on the page becomes glass. Nuxt runs plugins
// before hydration, so glassity has to wait on its own.
import 'glassity/auto';
import { vGlass } from 'glassity/vue';

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('glass', vGlass);
});
