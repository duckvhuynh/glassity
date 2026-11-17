import { mount } from 'svelte';
import { isSupported } from 'glassity';
import App from './App.svelte';

window.__glassity = isSupported();
mount(App, { target: document.getElementById('app') });
