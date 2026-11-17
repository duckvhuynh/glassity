<script>
  import { Bell, Calendar, Camera, Star } from '@lucide/svelte';
  import { glass, glassProvider } from 'glassity/svelte';

  let color = $state('#ffffff');
  let swapped = $state(false);
  let shown = $state(true);
</script>

<button id="color" onclick={() => (color = '#ffd400')}>color</button>
<button id="swap" onclick={() => (swapped = !swapped)}>swap</button>
<button id="toggle" onclick={() => (shown = !shown)}>toggle</button>

<div class="stage">
  {#if shown}
    <!-- A component: the action goes on a wrapper. -->
    <span use:glass={{ accessibility: false }}><Star data-expect-glass="action" /></span>
  {/if}
</div>

<div class="stage" use:glassProvider={{ accessibility: false, tile: true }}>
  <Calendar data-glass data-expect-glass="provider" />
  {#if !swapped}
    <Bell data-glass data-expect-glass="swap-a" />
  {:else}
    <Camera data-glass data-expect-glass="swap-b" />
  {/if}
  <!-- style="…" replaces the whole style attribute on every change. -->
  <svg data-glass data-expect-glass="string-style" style="color: {color}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" />
  </svg>
</div>
