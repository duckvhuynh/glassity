import { createApp } from 'vue';
import { isSupported } from 'glassity';
import App from './App.vue';

window.__glassity = isSupported();
createApp(App).mount('#app');
