import './styles.css';
import { $, $$, ICONS } from './ui.js';
import { sb, configured, currentUser, isAdmin, isNative } from './services.js';
import { authScreen, setupScreen } from './screens/auth.js';
import { routesScreen, routeDetailScreen, routeEditorScreen } from './screens/routes.js';
import { profileScreen } from './screens/profile.js';
import { feedbackScreen, adminScreen } from './screens/feedback.js';
import { App } from '@capacitor/app';

const app = $('#app');
const tabs = $('#tabs');
const state = { user: null, admin: false };

// Iconos de la barra inferior
const tabIcons = { rutas: ICONS.route, sugerencias: ICONS.chat, perfil: ICONS.user };
$$('#tabs a').forEach((a) => { a.querySelector('.ico').outerHTML = tabIcons[a.dataset.tab]; });

const routes = [
  [/^#\/rutas$/, (p) => routesScreen(app, p), 'rutas'],
  [/^#\/nueva$/, (p) => routeEditorScreen(app, p), null],
  [/^#\/editar\/([\w-]+)$/, (p, m) => routeEditorScreen(app, { ...p, id: m[1] }), null],
  [/^#\/ruta\/([\w-]+)$/, (p, m) => routeDetailScreen(app, { ...p, id: m[1] }), 'rutas'],
  [/^#\/perfil$/, (p) => profileScreen(app, { ...p, onSignOut: signedOut }), 'perfil'],
  [/^#\/sugerencias$/, (p) => feedbackScreen(app, p), 'sugerencias'],
  [/^#\/admin$/, (p) => adminScreen(app, p), 'perfil'],
];

function render() {
  if (!configured) { tabs.hidden = true; document.body.classList.add('no-tabs'); return setupScreen(app); }
  if (!state.user) {
    tabs.hidden = true; document.body.classList.add('no-tabs');
    return authScreen(app, { onDone: signedIn });
  }
  const hash = location.hash || '#/rutas';
  for (const [re, fn, tab] of routes) {
    const m = hash.match(re);
    if (m) {
      tabs.hidden = !tab; document.body.classList.toggle('no-tabs', !tab);
      $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
      window.scrollTo(0, 0);
      return fn({ user: state.user, admin: state.admin }, m);
    }
  }
  location.replace('#/rutas');
}

async function signedIn() {
  state.user = await currentUser();
  state.admin = state.user ? await isAdmin(state.user.id).catch(() => false) : false;
  if (!location.hash || location.hash === '#/') location.replace('#/rutas');
  render();
}
function signedOut() { state.user = null; state.admin = false; location.replace('#/rutas'); render(); }

window.addEventListener('hashchange', render);

if (isNative) {
  // Botón atrás de Android: navega hacia atrás y, en la pantalla principal, sale de la app.
  App.addListener('backButton', () => {
    const h = location.hash;
    if (!h || h === '#/rutas' || h === '#/perfil' || h === '#/sugerencias') App.exitApp();
    else history.back();
  });
}

(async () => {
  if (configured) {
    state.user = await currentUser();
    if (state.user) state.admin = await isAdmin(state.user.id).catch(() => false);
    sb.auth.onAuthStateChange((_e, session) => {
      const had = Boolean(state.user);
      state.user = session?.user || null;
      if (had && !state.user) render();
    });
  }
  render();
})();
