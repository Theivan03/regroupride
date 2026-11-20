/* ReGroupRide · recorrido de bienvenida: viñetas que van señalando cada parte de la app. Se puede saltar y repetir desde Ajustes. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A) return;
  var $ = function (s) { return document.querySelector(s); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  var STEPS = [
    { t: '¡Bienvenido a ReGroupRide!', x: 'En medio minuto te enseño dónde está cada cosa. Puedes saltarlo cuando quieras y repetirlo desde Ajustes.' },
    { s: '#btnProfile', v: 'map', t: 'Tu perfil', x: 'Empieza por aquí: pon tu nombre y tu foto con el botón «Cambiar foto de perfil». Es lo que verá el resto del grupo.' },
    { s: '#btnRide', v: 'map', t: 'Iniciar ruta', x: 'Empieza a grabar tu salida: recorrido, kilómetros, velocidad e inclinación en cada curva.' },
    { s: '#btnTrip', v: 'map', t: 'Trayecto', x: 'Para un desplazamiento corto: mide tiempo y kilómetros sin guardar el recorrido.' },
    { s: '#btnMore', v: 'map', t: 'Opciones del mapa', x: 'Centrar el mapa, planificar una ruta, aparcar la moto, capas… todo lo del mapa está aquí.' },
    { s: '.tab[data-view=rides]', t: 'Rutas', x: 'Tus rutas grabadas y planificadas, y las que comparten otros moteros.' },
    { s: '.tab[data-view=club]', t: 'Comunidad', x: 'El corazón de la app: únete a tu grupo, apúntate a sus eventos, habla en el chat de cada salida y rodad juntos sin perder a nadie.' },
    { s: '.tab[data-view=stats]', t: 'Datos', x: 'Tus números: kilómetros, inclinaciones máximas, logros y evolución.' },
    { s: '.tab[data-view=garage]', t: 'Garaje', x: 'Tus motos y su mantenimiento. La moto que guardes aquí se usa al apuntarte a un evento.' },
    { s: '.tab[data-view=settings]', t: 'Ajustes', x: 'Tu cuenta, los permisos y la voz. Aquí también verás quién ha creado ReGroupRide y podrás escribirle tus sugerencias o los fallos que encuentres.' },
    { t: '¡Listo para rodar!', x: 'Lo primero: entra en Comunidad y únete a tu grupo con el código que te pase el organizador. Buena ruta.', end: true }
  ];
  var el = null, i = 0, running = false;
  function stop(done) { running = false; if (el) { el.classList.add('out'); var e = el; el = null; setTimeout(function () { e.remove(); }, 260); } window.removeEventListener('resize', place); if (done !== false) store('rg.tour', '1'); if (A.showView) A.showView('map'); }
  function place() {
    if (!el) return;
    var st = STEPS[i], hole = el.querySelector('.rg-tour-hole'), bub = el.querySelector('.rg-tour-bub'), t = st.s ? $(st.s) : null, r = t ? t.getBoundingClientRect() : null;
    var W = window.innerWidth, H = window.innerHeight;
    if (r && r.width && r.height) {
      var p = 8; hole.style.cssText = 'left:' + (r.left - p) + 'px;top:' + (r.top - p) + 'px;width:' + (r.width + 2 * p) + 'px;height:' + (r.height + 2 * p) + 'px;opacity:1';
      var bw = Math.min(330, W - 24), bx = Math.min(W - bw - 12, Math.max(12, r.left + r.width / 2 - bw / 2));
      bub.style.width = bw + 'px'; bub.style.left = bx + 'px';
      var below = r.top + r.height / 2 < H / 2, bh = bub.offsetHeight;
      bub.style.top = (below ? Math.min(H - bh - 12, r.bottom + 22) : Math.max(12, r.top - bh - 22)) + 'px';
      bub.dataset.arrow = below ? 'up' : 'down';
      bub.style.setProperty('--ax', Math.min(bw - 28, Math.max(28, r.left + r.width / 2 - bx)) + 'px');
    } else {
      hole.style.cssText = 'left:' + W / 2 + 'px;top:' + H / 2 + 'px;width:0;height:0;opacity:1';
      var w2 = Math.min(340, W - 24); bub.style.width = w2 + 'px'; bub.style.left = (W - w2) / 2 + 'px'; bub.style.top = Math.max(12, (H - bub.offsetHeight) / 2) + 'px'; bub.dataset.arrow = 'none';
    }
  }
  function show() {
    var st = STEPS[i]; if (st.v && A.showView) A.showView(st.v);
    var bub = el.querySelector('.rg-tour-bub');
    bub.classList.remove('in');
    bub.innerHTML = '<span class="rg-tour-n">' + (i + 1) + ' de ' + STEPS.length + '</span><b>' + st.t + '</b><p>' + st.x + '</p>' +
      '<div class="rg-tour-act">' + (st.end ? '' : '<button class="link" data-a="skip" type="button">Saltar</button>') + (i > 0 && !st.end ? '<button class="btn small" data-a="prev" type="button">Atrás</button>' : '') +
      '<button class="btn small primary" data-a="next" type="button">' + (st.end ? '¡Vamos!' : (i === 0 ? 'Empezar' : 'Siguiente')) + '</button></div>';
    setTimeout(function () { place(); void bub.offsetWidth; bub.classList.add('in'); }, 60);
  }
  function start() {
    if (running) return; running = true; i = 0;
    el = document.createElement('div'); el.className = 'rg-tour'; el.innerHTML = '<div class="rg-tour-hole"></div><div class="rg-tour-bub"></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'skip') { stop(); return; }
      if (b.dataset.a === 'prev') i = Math.max(0, i - 1); else if (i >= STEPS.length - 1) { stop(); return; } else i++;
      show();
    });
    window.addEventListener('resize', place);
    show();
  }
  // Primera vez: cuando ya hay sesión y no queda ninguna ventana abierta (entrada, permisos…).
  var calm = 0, auto = !navigator.webdriver || store('rg.test.tour') === '1';
  var timer = setInterval(function () {
    if (store('rg.tour') === '1' || !auto) { clearInterval(timer); return; }
    var sh = $('#rgSheet'), ok = Cl && Cl.user && Cl.user() && sh && sh.hidden && !(A.isRec && A.isRec()) && document.visibilityState !== 'hidden' && !$('.rg-crop');
    calm = ok ? calm + 1 : 0;
    if (calm >= 3) { clearInterval(timer); start(); }
  }, 1500);
  window.RGTour = { start: function () { if (Cl && Cl.closeSheet) Cl.closeSheet(); start(); } };
})();
