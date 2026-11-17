import { render } from 'solid-js/web';
import { isSupported } from 'glassity';
import { App } from './App.jsx';

window.__glassity = isSupported();
render(() => <App />, document.getElementById('app'));
