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
      '<div class="rg-maker-top"><span class="rg-maker-pic" id="makerPic">IC</span><div><b>Ivan Cabrera</b><span class="muted">23 años · motero · creador y único desarrollador</span></div></div>' +
      '<p>ReGroupRide la hago yo solo: la idea, el diseño y todo el desarrollo. Salgo en moto con grupo y la app nace de lo que echaba en falta en esas rutas.</p>' +
      '<p>Se hace en colaboración con la comunidad <b>Ratone Bikes</b>, que la prueba en sus salidas y propone muchas de las mejoras.</p>' +
      '<p class="muted">Todo lo que envías en «Sugerencias y fallos» me llega a mí directamente y te contesto en la propia app.</p>' +
      '<div class="rg-row"><button class="btn small primary" id="makerWrite" type="button">Escribirme</button></div>';
    about.parentNode.insertBefore(box, about);
    // La foto se enseña sola cuando exista el archivo creador.jpg; mientras, las iniciales.
    var img = new Image(); img.alt = 'Ivan Cabrera';
    img.onload = function () { var p = document.getElementById('makerPic'); p.textContent = ''; p.appendChild(img); };
    img.src = 'creador.jpg';
    box.querySelector('#makerWrite').addEventListener('click', function () { Cl.openFeedback(); });
  }
})();
