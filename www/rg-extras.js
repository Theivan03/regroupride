/* ReGroupRide · extras del mapa: la barra de pestañas se recoge al rodar y la música que suena aparece en el mapa. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var A = window.RGApp, P = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins : {};
  var native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }

  /* ---------- pestañas: al iniciar una ruta se recogen en una pastilla; un toque las vuelve a abrir ---------- */
  var tabs = $('.tabs'), handle = document.createElement('button'), riding = false, backT = 0;
  handle.type = 'button'; handle.id = 'tabsHandle'; handle.setAttribute('aria-label', 'Abrir el menú');
  handle.innerHTML = '<i></i><svg viewBox="0 0 24 24"><path d="M6 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.appendChild(handle);
  function fold(on) { document.body.classList.toggle('rg-tabs-min', !!on); clearTimeout(backT); }
  function later() { clearTimeout(backT); if (riding) backT = setTimeout(function () { if (riding) fold(true); }, 7000); }
  handle.addEventListener('click', function () { fold(false); later(); });
  if (tabs) { tabs.addEventListener('click', later); tabs.addEventListener('touchstart', later, { passive: true }); }
  setInterval(function () {
    var now = !!(A && A.isRec && A.isRec());
    if (now === riding) return;
    riding = now; document.body.classList.toggle('rg-riding', riding); fold(riding);
  }, 700);

  /* ---------- música ---------- */
  var host = $('.map-bottom'); if (!host) return;
  var bar = document.createElement('div'), M = native && P.RgMedia ? P.RgMedia : null, key = '', art = '', last = null, timer = 0;
  bar.id = 'musicBar'; bar.hidden = true; host.insertBefore(bar, host.firstChild);
  var NOTE = '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  var X = '<button class="mb-x" data-m="hide" type="button" aria-label="Quitar"><svg><use href="#i-close"/></svg></button>';
  function ic(n) { return '<svg><use href="#i-' + n + '"/></svg>'; }
  function draw(html, cls) { bar.className = cls || ''; bar.innerHTML = html; bar.hidden = false; }
  function off() { return store('rg.music.off') === '1'; }
  function paint(s) {
    last = s;
    if (off()) { bar.hidden = true; return; }
    if (!M) {      // versión web (iPhone, ordenador): el navegador no puede ver qué suena; solo un acceso rápido
      draw('<span class="mb-art">' + NOTE + '</span><div class="mb-txt"><b>Música</b><span>Abre tu app de música</span></div><button class="btn small" data-m="spotify" type="button">Spotify</button>' + X, 'mb-web');
      return;
    }
    if (!s || !s.granted) {
      draw('<span class="mb-art">' + NOTE + '</span><div class="mb-txt"><b>Tu música en el mapa</b><span>Canción y botones de pausa y siguiente</span></div><button class="btn small primary" data-m="grant" type="button">Activar</button>' + X, 'mb-ask');
      return;
    }
    if (!s.active) { bar.hidden = true; return; }
    var k = s.title + '|' + s.artist;
    if (k !== key || bar.hidden || bar.className !== 'mb-on') {
      draw('<button class="mb-art" data-m="open" type="button" aria-label="Abrir ' + esc(s.app || 'la música') + '">' + (art && k === key ? '<img alt="" src="' + art + '">' : NOTE) + '</button>' +
        '<div class="mb-txt" data-m="open"><b>' + esc(s.title) + '</b><span>' + esc(s.artist || s.app || '') + '</span></div>' +
        '<button class="mb-b" data-m="prev" type="button" aria-label="Anterior">' + ic('prev') + '</button><button class="mb-b mb-play" data-m="toggle" type="button" aria-label="Pausa o seguir"></button><button class="mb-b" data-m="next" type="button" aria-label="Siguiente">' + ic('next') + '</button>', 'mb-on');
    }
    var pb = bar.querySelector('.mb-play'); if (pb) { pb.innerHTML = ic(s.playing ? 'pause' : 'play'); bar.classList.toggle('mb-playing', !!s.playing); }
    if (k !== key) {
      key = k; art = '';
      M.state({ art: true }).then(function (r) { if (r && r.art && r.title + '|' + r.artist === key) { art = r.art; var a = bar.querySelector('.mb-art'); if (a) a.innerHTML = '<img alt="" src="' + art + '">'; } }, function () {});
    }
  }
  function poll() {
    if (!M) { paint(null); return; }
    if (document.visibilityState !== 'visible' || off()) return;
    M.state({}).then(paint, function () {});
  }
  bar.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-m]'); if (!b) return; var m = b.dataset.m;
    if (m === 'hide') { store('rg.music.off', '1'); bar.hidden = true; if (A && A.toast) A.toast('Quitado. Puedes volver a ponerlo en Ajustes → Música en el mapa.', 'ok'); return; }
    if (m === 'spotify') { window.open('https://open.spotify.com/', '_blank'); return; }
    if (m === 'grant') { M.access().catch(function () {}); if (A && A.toast) A.toast('Busca «ReGroupRide» en la lista y actívalo. Al volver, la música aparece aquí.', 'ok'); return; }
    var cmd = m === 'toggle' ? (last && last.playing ? 'pause' : 'play') : m;
    if (m === 'toggle' && last) { last.playing = !last.playing; paint(last); }
    M.cmd({ cmd: cmd }).then(function () { setTimeout(poll, 350); setTimeout(poll, 1200); }, function () {});
  });
  // Interruptor en Ajustes
  var set = $('#view-settings');
  if (set) {
    var row = document.createElement('div'); row.className = 'card rg-music-set';
    row.innerHTML = '<div><b>Música en el mapa</b><span class="muted">' + (native ? 'Enseña la canción que suena y botones de pausa y siguiente.' : 'Un acceso rápido a tu app de música.') + '</span></div><button class="btn small" id="musicToggle" type="button"></button>';
    set.appendChild(row);
    var tg = row.querySelector('#musicToggle'), lab = function () { tg.textContent = off() ? 'Activar' : 'Quitar'; };
    lab(); tg.addEventListener('click', function () { store('rg.music.off', off() ? '0' : '1'); lab(); poll(); if (off()) bar.hidden = true; });
  }
  poll();
  if (M) { timer = setInterval(poll, 2500); document.addEventListener('visibilitychange', poll); }
})();
