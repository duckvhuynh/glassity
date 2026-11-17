// The directive has nothing to do on the server, but must exist so templates compile.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('glass', {});
});
