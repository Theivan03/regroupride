/* ReGroupRide · quién hace la app, señal diaria de uso (sin datos personales) y acceso al panel del creador. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!Cl || !Cl.sb) return;
  var native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  /* ---------- señal de uso (una por arranque y al entrar en una cuenta) y comprobación de bloqueo ---------- */
  // Identificador del aparato: el de Android (el mismo aunque se reinstale la app) cuando lo hay, además del propio de la app.
  var hw = store('rg.hw') || '';
  try { var Dv = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Device; if (native && Dv && Dv.getId) Dv.getId().then(function (r) { var v = r && (r.identifier || r.uuid); if (v) { hw = String(v); store('rg.hw', hw); } }, function () {}); } catch (e) {}
  if (!store('rg.dev')) store('rg.dev', uuid());
  function blockedScreen() {
    if (document.querySelector('.rg-blocked')) return;
    var el = document.createElement('div'); el.className = 'rg-blocked';
    el.innerHTML = '<div><b>Cuenta bloqueada</b><p>No puedes usar ReGroupRide con esta cuenta ni desde este dispositivo.</p><p class="muted">Si crees que es un error, escribe al creador de la app.</p></div>';
    document.body.appendChild(el);
    try { store('rg.wall', '1'); Cl.sb.auth.signOut().then(function () {}, function () {}); } catch (e) {}
  }
  var pinged = '';
  function ping() {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    var id = store('rg.dev'), u = Cl.user && Cl.user(), mark = new Date().toDateString() + '|' + (u ? u.id : '');
    if (pinged === mark) return;
    Cl.sb.rpc('app_ping', { p_device: id, p_platform: native ? window.Capacitor.getPlatform() : 'web', p_version: (A && A.version) || '', p_hw: hw })
      .then(function (r) { if (r.error) return; pinged = mark; if (r.data === true) blockedScreen(); }, function () {});
  }
  setTimeout(ping, 3500);
  document.addEventListener('visibilitychange', function () { setTimeout(ping, 1500); });
  setInterval(ping, 60000);

  /* ---------- foto de perfil: la que pones en «Perfil» se sube a tu cuenta para que la vean los demás ---------- */
  var avaBusy = false;
  function syncAva() {
    var u = Cl.user && Cl.user(), img = document.querySelector('#avatarBig img');
    if (!u || avaBusy || !img || img.src.indexOf('data:image') !== 0) return;
    var src = img.src, sig = u.id + '|' + src.length + '|' + src.slice(-24);
    if (store('rg.ava.up') === sig) return;
    avaBusy = true;
    Promise.resolve().then(function () {
      var m = /^data:(image\/\w+);base64,(.*)$/.exec(src); if (!m) throw new Error('formato');
      var bin = atob(m[2]), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var path = u.id + '/' + Date.now().toString(36) + '.' + (m[1] === 'image/png' ? 'png' : 'jpg');
      return Cl.sb.storage.from('avatars').upload(path, new Blob([arr], { type: m[1] }), { contentType: m[1] }).then(function (r) {
        if (r.error) throw r.error;
        return Cl.sb.from('profiles').update({ avatar_url: Cl.sb.storage.from('avatars').getPublicUrl(path).data.publicUrl }).eq('id', u.id);
      });
    }).then(function (r) { if (r && !r.error) store('rg.ava.up', sig); }).catch(function () {}).then(function () { avaBusy = false; });
  }
  setTimeout(syncAva, 6000); setInterval(syncAva, 8000);

  /* ---------- quién hace ReGroupRide ---------- */
  var about = document.getElementById('about');
  if (about) {
    var box = document.createElement('div');
    box.className = 'rg-maker';
    box.innerHTML = '<span class="label">Quién hace ReGroupRide</span>' +
      '<img class="rg-maker-banner" src="creador-moto.jpg" alt="Ivan con su moto" loading="lazy">' +
      '<h3>Hola, soy Ivan</h3><span class="muted" style="margin-top:-6px">23 años, motero, y uno más del grupo</span>' +
      '<p>No soy nadie especial: soy uno más de los que quedan el domingo para rodar. ReGroupRide nació porque en cada salida pasaba lo mismo: alguien se quedaba atrás, otro se perdía en un cruce y al final estábamos todos parados mirando el WhatsApp.</p>' +
      '<p>Pensé que hacía falta algo sencillo para rodar juntos sin perder a nadie y, como no lo encontré, me puse a hacerlo. La hago yo solo, en mis ratos libres, con la ayuda de la gente de <b>Ratone Bikes</b>, que la prueba en cada ruta y me dice sin filtros qué falla y qué falta.</p>' +
      '<p>Esta app es tan vuestra como mía. Si echas algo en falta o algo no va, escríbeme: lo leo yo y te contesto yo. Nos vemos en la carretera ✌️</p>' +
      '<p>Ah, y estoy soltero, chicas 😜</p>' +
      '<div class="rg-row"><button class="btn small primary" id="makerWrite" type="button">Escribirme</button><button class="btn small" id="makerTour" type="button">Ver el tutorial</button></div>';
    var syncBox = document.getElementById('rgSyncBox'); if (syncBox) syncBox.parentNode.insertBefore(box, syncBox); else about.parentNode.insertBefore(box, about);
    box.querySelector('#makerWrite').addEventListener('click', function () { Cl.openFeedback(); });
    box.querySelector('#makerTour').addEventListener('click', function () { if (window.RGTour) RGTour.start(); });

    /* ---------- resumen del creador: solo aparece en la cuenta del creador ---------- */
    var dev = document.createElement('div'); dev.className = 'rg-maker rg-dev'; dev.hidden = true;
    var acc = document.getElementById('rgAccount'); if (acc && acc.nextSibling) acc.parentNode.insertBefore(dev, acc.nextSibling); else about.parentNode.insertBefore(dev, about);
    var devU = null, devAt = 0;
    function devLoad(force) {
      var u = Cl.user && Cl.user(), id = u ? u.id : '';
      if (id !== devU) { devU = id; devAt = 0; dev.hidden = true; }
      if (!id || (!force && Date.now() - devAt < 5 * 60000)) return;
      devAt = Date.now();
      Cl.sb.rpc('dev_stats').then(function (r) {
        if (r.error || !r.data || devU !== id) { if (r.error) devAt = Date.now() + 30 * 60000; return; }      // no es el creador: no se vuelve a preguntar en un buen rato
        var s = r.data, k = function (v, l) { return '<div><b>' + v + '</b><span>' + l + '</span></div>'; };
        dev.hidden = false;
        dev.innerHTML = '<span class="label">Panel del creador · solo lo ves tú</span>' +
          '<div class="tr-kpis">' + k(s.dau, 'hoy') + k(s.wau, '7 días') + k(s.mau, '30 días') + k(s.accounts, 'cuentas') + '</div>' +
          '<div class="tr-kpis">' + k(s.devices, 'aparatos') + k(s.returning_30, 'vuelven') + k(s.communities, 'comunid.') + k(s.feedback_unanswered, 'sin contestar') + '</div>' +
          '<p class="muted rg-small">Activos ayer: ' + s.dau_prev + ' · Cuentas nuevas en 7 días: ' + s.accounts_7 + ' · Eventos próximos: ' + s.events_next + ' · Inscripciones: ' + s.signups + ' · Rutas grabadas: ' + s.rides + ' (' + Number(s.km).toLocaleString('es-ES') + ' km)</p>' +
          '<div class="rg-row"><a class="btn small primary" href="https://regroupride-eventos.netlify.app/?dev=1" target="_blank" rel="noopener">Panel completo</a><button class="btn small" id="devPh" type="button">Altas de fotógrafos</button><button class="btn small" id="devEr" type="button">Errores de la app</button><button class="btn small" id="devRl" type="button">Actualizar</button></div>';
        dev.querySelector('#devEr').addEventListener('click', devErrors);
        dev.querySelector('#devRl').addEventListener('click', function () { devLoad(true); });
        dev.querySelector('#devPh').addEventListener('click', function () { if (window.RGPhoto) RGPhoto.open('admin'); });
      }, function () {});
    }
    // Errores que la app ha registrado sola en los móviles de la gente: qué, dónde, en qué versión y cuántas veces.
    function devErrors() {
      var esc = Cl.esc, ago = function (ms) { var m = Math.round((Date.now() - ms) / 60000); return m < 60 ? 'hace ' + Math.max(1, m) + ' min' : m < 1440 ? 'hace ' + Math.round(m / 60) + ' h' : 'hace ' + Math.round(m / 1440) + ' d'; };
      Cl.sheet('<div class="head" data-full><h1>Errores de la app</h1><button class="btn small icon" id="deX" type="button" title="Cerrar"><svg><use href="#i-close"/></svg></button></div><div id="deList"><p class="muted rg-load">Cargando…</p></div>', 'full');
      document.getElementById('deX').addEventListener('click', Cl.closeSheet);
      Cl.sb.rpc('dev_errors').then(function (r) {
        var box = document.getElementById('deList'); if (!box) return;
        if (r.error) { box.innerHTML = '<div class="empty">' + esc(Cl.msg(r.error)) + '</div>'; return; }
        var rows = r.data || [];
        box.innerHTML = rows.length ? '<p class="muted rg-small" style="text-align:left;margin:0 0 8px">Los últimos ' + rows.length + '. Un mismo error en la misma versión se cuenta, no se repite. Se borran solos a los 60 días.</p>' + rows.map(function (e) {
          return '<details class="rg-err" data-raw><summary><b>' + esc(e.message) + '</b><small>' + esc([e.hits + (e.hits === 1 ? ' vez' : ' veces'), ago(e.last), 'v' + (e.version || '?'), e.platform, e.view].filter(Boolean).join(' · ')) + '</small></summary>' +
            '<p class="muted rg-small">' + esc([e.source, e.device, e.who ? 'último: ' + e.who : ''].filter(Boolean).join(' · ')) + '</p>' + (e.stack ? '<pre>' + esc(e.stack) + '</pre>' : '') + '</details>';
        }).join('') + '<button class="btn" id="deClear" type="button">Vaciar la lista</button>' : '<div class="empty"><b>Sin errores registrados</b>Cuando la app falle en el móvil de alguien, aparecerá aquí.</div>';
        var c = document.getElementById('deClear'); if (c) c.addEventListener('click', function () { Cl.busy(c, function () { return Cl.sb.rpc('dev_errors_clear').then(function (q) { if (q.error) throw q.error; devErrors(); }); }); });
      }, function () {});
    }
    setTimeout(devLoad, 4000); setInterval(devLoad, 15000);

    /* ---------- códigos de ventaja ---------- */
    var NAMES = { sin_anuncios: 'Sin publicidad', premium: 'Premium', todo_gratis: 'Todo gratis' };
    var cb = document.createElement('div'); cb.className = 'rg-maker';
    cb.innerHTML = '<span class="label">¿Tienes un código?</span><div class="rg-ben" id="benList" hidden></div>' +
      '<form class="rg-code" id="codeForm"><input id="codeIn" maxlength="24" autocomplete="off" autocapitalize="characters" placeholder="Escríbelo aquí" aria-label="Código"><button class="btn small primary" type="submit">Usar</button></form>';
    about.parentNode.insertBefore(cb, about);
    var paint = function (list) { Cl.benefits = list || []; var el = cb.querySelector('#benList'); el.hidden = !Cl.benefits.length; el.innerHTML = Cl.benefits.map(function (x) { return '<span>' + (NAMES[x.benefit] || x.benefit) + '</span>'; }).join(''); };
    var benU = null, loadBen = function () { var u = Cl.user && Cl.user(), id = u ? u.id : ''; if (id === benU) return; benU = id; if (!id) { paint([]); return; } Cl.sb.rpc('my_benefits').then(function (r) { if (!r.error && benU === id) paint(r.data); }, function () {}); };
    setTimeout(loadBen, 3500); setInterval(loadBen, 6000);
    cb.querySelector('#codeForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var inp = cb.querySelector('#codeIn'), code = inp.value.trim(); if (code.length < 3) return;
      if (!(Cl.user && Cl.user())) { Cl.openAuth(false); return; }
      var b = ev.target.querySelector('button'); b.disabled = true;
      Cl.sb.rpc('promo_redeem', { p_code: code }).then(function (r) {
        b.disabled = false;
        if (r.error) { A.toast(r.error.message || 'No se ha podido usar el código.', 'bad'); return; }
        inp.value = ''; A.toast(r.data.again ? 'Ese código ya lo tenías activado.' : '¡Código activado! ' + (NAMES[r.data.benefit] || ''), 'ok'); benU = null; loadBen();
      }, function () { b.disabled = false; A.toast('Sin conexión. Prueba otra vez.', 'bad'); });
    });
  }
})();
