<script setup>
import { ref } from 'vue';
import { Bell, Calendar, Camera, Heart, Star } from '@lucide/vue';
import { GlassProvider, useGlass, vGlass } from 'glassity/vue';

const color = ref('#ffffff');
const swapped = ref(false);
const shown = ref(true);
const hooked = ref(null);
useGlass(hooked, { accessibility: false });
</script>

<template>
  <button id="color" @click="color = '#ffd400'">color</button>
  <button id="swap" @click="swapped = !swapped">swap</button>
  <button id="toggle" @click="shown = !shown">toggle</button>

  <div class="stage">
    <!-- On a component the directive lands on its root <svg>. Removing it must not crash Vue. -->
    <span v-if="shown"><Star v-glass="{ accessibility: false }" data-expect-glass="directive" /></span>
    <Heart ref="hooked" data-expect-glass="composable" />
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
</template>
