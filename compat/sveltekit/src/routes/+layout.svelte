<script>
  import { browser } from '$app/environment';
  let { children } = $props();

  // Every [data-glass] on the page becomes glass. Loaded as soon as the client starts,
  // before hydration has finished, so glassity has to wait on its own.
  if (browser) import('glassity/auto');
</script>

{@render children()}
