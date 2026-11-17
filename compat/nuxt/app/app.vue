<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Bell, Calendar, Camera, Heart, Star } from '@lucide/vue';
import { GlassProvider } from 'glassity/vue';
import { isSupported } from 'glassity';

const color = ref('#ffffff');
const swapped = ref(false);
const shown = ref(true);

// Scroll the lazily hydrated component into view; once Vue has hydrated it (its button
// responds), its icons must become glass, and Vue must not have found anything foreign.
const reveal = async () => {
  document.getElementById('later')?.scrollIntoView();
  const button = document.getElementById('later-button') as HTMLButtonElement;
  for (let i = 0; i < 100 && button.textContent?.trim() !== 'clicked 1'; i++) {
    button.click();
    await new Promise((r) => setTimeout(r, 50));
  }
  document.getElementById('later')?.setAttribute('data-expect-glass', 'late-1');
  document.getElementById('later-2')?.setAttribute('data-expect-glass', 'late-2');
  window.scrollTo(0, 0);
};

// Runs after hydration: the checker waits for it before clicking.
onMounted(() => {
  (window as unknown as { __glassity?: boolean }).__glassity = isSupported();
});
</script>

<template>
  <main>
    <button id="color" @click="color = '#ffd400'">color</button>
    <button id="swap" @click="swapped = !swapped">swap</button>
    <button id="toggle" @click="shown = !shown">toggle</button>
    <button data-compat-step="lazy component revealed" @click="reveal">reveal</button>

    <div class="stage">
      <span v-if="shown"><Star v-glass="{ accessibility: false }" data-expect-glass="directive" /></span>
      <!-- handled by glassity/auto from the client plugin -->
      <Heart data-glass data-expect-glass="auto" />
    </div>

    <GlassProvider class="stage" :options="{ accessibility: false }" tile>
      <Calendar data-glass data-expect-glass="provider" />
      <Bell v-if="!swapped" data-glass data-expect-glass="swap-a" />
      <Camera v-else data-glass data-expect-glass="swap-b" />
      <!-- A string style replaces the whole style attribute on every change. -->
      <svg data-glass data-expect-glass="string-style" :style="'color:' + color" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" />
      </svg>
    </GlassProvider>

    <!-- Far below the fold: hydrates only when visible, which only the last step does. -->
    <div style="height: 2000px"></div>
    <LazyLaterIcons hydrate-on-visible />
  </main>
</template>
