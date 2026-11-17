<script setup lang="ts">
import { ref } from 'vue';

// Rendered on the server, hydrated only when scrolled into view (hydrate-on-visible).
// Until then glassity must leave it alone, or Vue finds a canvas it did not render.
const clicks = ref(0);
</script>

<template>
  <div class="stage">
    <svg data-glass id="later" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
      <circle cx="12" cy="12" r="8" />
    </svg>
    <button id="later-button" @click="clicks++">clicked {{ clicks }}</button>
    <svg data-glass id="later-2" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  </div>
</template>
