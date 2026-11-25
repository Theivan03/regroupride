/* ReGroupRide — entrar con Google (sin contraseña). El botón solo aparece si el proveedor está activado en Supabase
   (Authentication → Providers → Google). En la app, Google se abre en el navegador del teléfono y vuelve con
   com.regroupride.app://auth; en la web, vuelve a la misma página. */
(function () {
  'use strict';
  var Cl = window.RGCloud, A = window.RGApp; if (!Cl || !Cl.sb || !Cl.cfg) return;
  var sb = Cl.sb, P = (window.Capacitor && Capacitor.Plugins) || {}, native = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  var BACK = 'com.regroupride.app://auth', on = false;
  try { on = localStorage.getItem('rg.oauth.google') === '1'; } catch (e) {}
  fetch(Cl.cfg.url + '/auth/v1/settings', { headers: { apikey: Cl.cfg.key } }).then(function (r) { return r.json(); }).then(function (d) {
    on = !!(d && d.external && d.external.google); try { localStorage.setItem('rg.oauth.google', on ? '1' : '0'); } catch (e) {} paint();
  }, function () {});
  function paint() {
    var box = document.getElementById('rgAuthBox'), had = document.getElementById('rgGoogle');
    if (!box || !on) { if (had && !on) had.parentNode.removeChild(had); return; }
    if (had) return;
    var w = document.createElement('div'); w.className = 'rg-google-wrap'; w.id = 'rgGoogle';
    w.innerHTML = '<span class="rg-or">o</span><button class="btn big rg-google" type="button"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.200a5.300 5.300 0 0 1-2.300 3.500v2.900h3.700c2.200-2 3.400-5 3.400-8.500z"/><path fill="#34A853" d="M12 23.500c3.100 0 5.700-1 7.600-2.800l-3.700-2.900c-1 .700-2.300 1.100-3.900 1.100-3 0-5.500-2-6.400-4.700H1.800v3A11.500 11.500 0 0 0 12 23.500z"/><path fill="#FBBC05" d="M5.600 14.200a6.900 6.900 0 0 1 0-4.400v-3H1.800a11.500 11.500 0 0 0 0 10.400l3.800-3z"/><path fill="#EA4335" d="M12 5.100c1.700 0 3.200.6 4.400 1.700l3.300-3.300A11.500 11.500 0 0 0 1.800 6.800l3.800 3C6.500 7.100 9 5.100 12 5.100z"/></svg>Continuar con Google</button>';
    box.appendChild(w);
    w.querySelector('button').addEventListener('click', function (ev) {
      var b = ev.currentTarget; b.disabled = true; setTimeout(function () { b.disabled = false; }, 4000);
      sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: native ? BACK : location.origin + location.pathname, skipBrowserRedirect: native } }).then(function (r) {
        if (r.error) throw r.error; if (native && r.data && r.data.url) window.open(r.data.url, '_blank');
      }).catch(function (e) { if (A) A.toast(Cl.msg ? Cl.msg(e) : 'No se ha podido abrir Google.', 'warn'); });
    });
  }
  if (window.MutationObserver) new MutationObserver(paint).observe(document.getElementById('rgSheet') || document.body, { childList: true, subtree: true });
  // Vuelta de Google: la dirección trae la sesión (#access_token…) o un código (?code=…). Vale para la app y para la web.
  function back(u) {
    var q = {}; (u.split('#')[1] || '').split('&').concat(((u.split('?')[1] || '').split('#')[0]).split('&')).forEach(function (kv) { var a = kv.split('='); if (a[0]) { try { q[a[0]] = decodeURIComponent(a[1] || ''); } catch (e) { q[a[0]] = a[1] || ''; } } });
    var job = q.access_token && q.refresh_token ? sb.auth.setSession({ access_token: q.access_token, refresh_token: q.refresh_token }) : q.code ? sb.auth.exchangeCodeForSession(q.code) : null;
    if (!job) { if (q.error_description && A) A.toast(q.error_description.replace(/\+/g, ' '), 'warn'); return !!q.error_description; }
    job.then(function (r) {
      if (r && r.error) { if (A) A.toast(Cl.msg ? Cl.msg(r.error) : 'No se ha podido entrar.', 'warn'); return; }
      if (Cl.closeSheet) Cl.closeSheet(); if (A) A.toast('Has entrado con Google.', 'ok');
    }, function () { if (A) A.toast('No se ha podido entrar.', 'warn'); });
    return true;
  }
  var seen = '';
  function once(u) { if (!u || u === seen) return; seen = u; back(u); }
  if (native) {
    if (P.App && P.App.addListener) P.App.addListener('appUrlOpen', function (ev) { var u = (ev && ev.url) || ''; if (u.indexOf(BACK) === 0) once(u); });
    // si Android cerró la app mientras estabas en Google, la dirección llega como «de arranque»
    if (P.App && P.App.getLaunchUrl) P.App.getLaunchUrl().then(function (r) { var u = (r && r.url) || ''; if (u.indexOf(BACK) === 0) once(u); }, function () {});
  } else if (/[#?&](access_token|code|error_description)=/.test(location.href)) {
    // en la web Google devuelve a esta misma página: se recoge la sesión y se limpia la dirección
    var href = location.href;
    if (back(href)) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  }
})();
