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

  /* ---------- señal de uso: una al día por aparato (y otra si se entra en una cuenta) ---------- */
  function ping() {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    var id = store('rg.dev'); if (!id) { id = uuid(); store('rg.dev', id); }
    var u = Cl.user && Cl.user(), mark = new Date().toDateString() + '|' + (u ? u.id : '');
    if (store('rg.ping') === mark) return;
    Cl.sb.rpc('app_ping', { p_device: id, p_platform: native ? window.Capacitor.getPlatform() : 'web', p_version: (A && A.version) || '' })
      .then(function (r) { if (!r.error) store('rg.ping', mark); }, function () {});
  }
  setTimeout(ping, 4000);
  document.addEventListener('visibilitychange', function () { setTimeout(ping, 1500); });
  setInterval(ping, 30 * 60000);

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
      '<p>Esta app es tan vuestra como mía. Si echas algo en falta o algo no va, escríbeme: lo leo yo y te contesto yo. Nos vemos en la carretera. V\'s ✌️</p>' +
      '<div class="rg-row"><button class="btn small primary" id="makerWrite" type="button">Escribirme</button></div>';
    about.parentNode.insertBefore(box, about);
    box.querySelector('#makerWrite').addEventListener('click', function () { Cl.openFeedback(); });

    /* ---------- códigos de ventaja ---------- */
    var NAMES = { sin_anuncios: 'Sin publicidad', premium: 'Premium', todo_gratis: 'Todo gratis' };
    var cb = document.createElement('div'); cb.className = 'rg-maker';
    cb.innerHTML = '<span class="label">¿Tienes un código?</span><div class="rg-ben" id="benList" hidden></div>' +
      '<form class="rg-code" id="codeForm"><input id="codeIn" maxlength="24" autocomplete="off" autocapitalize="characters" placeholder="Escríbelo aquí" aria-label="Código"><button class="btn small primary" type="submit">Usar</button></form>';
    about.parentNode.insertBefore(cb, box);
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
