/* ReGroupRide · quién hace la app, señal diaria de uso (sin datos personales) y acceso al panel del creador. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!Cl || !Cl.sb) return;
  var native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var PANEL = 'https://regroupride-eventos.netlify.app/?dev=1';
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

  /* ---------- quién hace ReGroupRide ---------- */
  var about = document.getElementById('about');
  if (about) {
    var box = document.createElement('div');
    box.className = 'rg-maker';
    box.innerHTML = '<span class="label">Quién hace ReGroupRide</span>' +
      '<div class="rg-maker-top"><span class="rg-maker-pic" id="makerPic">IC</span><div><b>Ivan Cabrera</b><span class="muted">23 años · motero · creador y único desarrollador</span></div></div>' +
      '<p>ReGroupRide la hago yo solo: la idea, el diseño y todo el desarrollo. Salgo en moto con grupo y la app nace de lo que echaba en falta en esas rutas.</p>' +
      '<p>Se hace en colaboración con la comunidad <b>Ratone Bikes</b>, que la prueba en sus salidas y propone muchas de las mejoras.</p>' +
      '<p class="muted">Todo lo que envías en «Sugerencias y fallos» me llega a mí directamente y te contesto en la propia app.</p>' +
      '<div class="rg-row"><button class="btn small primary" id="makerWrite" type="button">Escribirme</button><a class="btn small" id="makerPanel" href="' + PANEL + '" target="_blank" rel="noopener" hidden>Panel del creador</a></div>';
    about.parentNode.insertBefore(box, about);
    // La foto se enseña sola cuando exista el archivo creador.jpg; mientras, las iniciales.
    var img = new Image(); img.alt = 'Ivan Cabrera';
    img.onload = function () { var p = document.getElementById('makerPic'); p.textContent = ''; p.appendChild(img); };
    img.src = 'creador.jpg';
    box.querySelector('#makerWrite').addEventListener('click', function () { Cl.openFeedback(); });
    var lastU = null;
    var admin = function () {
      var u = Cl.user && Cl.user(), id = u ? u.id : ''; if (id === lastU) return; lastU = id;
      var b = document.getElementById('makerPanel'); b.hidden = true; if (!id) return;
      Cl.sb.rpc('is_app_admin').then(function (r) { if (lastU === id) b.hidden = !(r && r.data === true); }, function () {});
    };
    setTimeout(admin, 3000); setInterval(admin, 5000);
  }
})();
