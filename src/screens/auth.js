import { $, esc, toast, busy, ICONS } from '../ui.js';
import { signIn, signUp, resetPassword, errText, configured } from '../services.js';

const logo = `<div class="logo"><div class="mark">${ICONS.road}</div><b>Rutas<i>Ratoners</i></b></div>`;

export function setupScreen(app) {
  app.innerHTML = `${logo}
    <div class="banner warn"><b>Falta conectar el servidor.</b>
    <p class="small">Esta versión no tiene los datos de Supabase. Hay que ponerlos en <code>src/config.js</code> y volver a compilar.</p></div>`;
}

export function authScreen(app, { onDone }) {
  let mode = 'login';
  const render = () => {
    app.innerHTML = `${logo}
      <p class="muted">Rutas en grupo, sin perder a nadie.</p>
      <div class="seg" style="margin-top:22px">
        <button data-m="login" class="${mode === 'login' ? 'on' : ''}">Entrar</button>
        <button data-m="signup" class="${mode === 'signup' ? 'on' : ''}">Crear cuenta</button>
      </div>
      <form id="f" autocomplete="on">
        ${mode === 'signup' ? '<label for="name">Tu nombre</label><input id="name" required maxlength="60" autocomplete="name" placeholder="Como te conoce la gente">' : ''}
        <label for="email">Correo</label><input id="email" type="email" required autocomplete="email" inputmode="email">
        <label for="pass">Contraseña</label><input id="pass" type="password" required minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
        <button class="btn primary big" type="submit" style="margin-top:22px">${mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
      </form>
      ${mode === 'login' ? '<button class="btn ghost" id="forgot">He olvidado la contraseña</button>' : '<p class="muted small">Necesitas tener al menos 16 años.</p>'}`;
    app.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { mode = b.dataset.m; render(); }));
    $('#f', app).onsubmit = (e) => {
      e.preventDefault();
      const btn = e.submitter || $('button[type=submit]', app);
      const email = $('#email', app).value.trim();
      const pass = $('#pass', app).value;
      busy(btn, async () => {
        try {
          if (mode === 'login') await signIn(email, pass);
          else await signUp($('#name', app).value.trim(), email, pass);
          onDone();
        } catch (err) { toast(errText(err), true); }
      });
    };
    const f = $('#forgot', app);
    if (f) f.onclick = async () => {
      const email = $('#email', app).value.trim();
      if (!email) return toast('Escribe tu correo arriba y vuelve a pulsar.', true);
      try { await resetPassword(email); toast('Te hemos enviado un correo para cambiarla.'); } catch (err) { toast(errText(err), true); }
    };
  };
  if (!configured) return setupScreen(app);
  render();
}

export { esc };
