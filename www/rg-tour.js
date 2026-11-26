/* ReGroupRide · recorrido de bienvenida: viñetas que van señalando cada parte de la app. Diez pasos sobre la navegación de cuatro pestañas. Se puede saltar y repetir desde Yo › Ayuda. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A) return;
  var $ = function (s) { return document.querySelector(s); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  var STEPS = [
    { s: '#btnRide', v: 'map', t: 'Iniciar ruta', x: 'Empieza a grabar: recorrido, kilómetros, velocidad e inclinación en cada curva. Debajo tienes «Solo medir», para un recado que no quieres guardar.' },
    { s: '#asWho', v: 'map', t: '¿Con quién vas?', x: 'Es lo único que se pregunta antes de salir. Solo: la app vigila las paradas bruscas y avisa a tus contactos. En grupo: os veis todos en el mapa.' },
    { s: '#btnNear', v: 'map', t: 'Cerca', x: 'Gasolineras con precio, peligros avisados, sitios moteros y fotógrafos, todo lo que tienes alrededor.' },
    { s: '.tab[data-view=rides]', v: 'map', t: 'Rutas', x: 'Las que has hecho, las que planeas y las de otros. Dibuja una en el mapa, deja que la app te genere una vuelta o importa un GPX.' },
    { s: '.tab[data-view=club]', v: 'map', t: 'Comunidad', x: 'Tu grupo: sus salidas, sus chats y su información. Tocando el nombre cambias de comunidad, buscas otra o creas la tuya.' },
    { s: '#clubBody .as-ev, #clTabs [data-t=events], #clubBody', v: 'club', t: 'Una salida', x: 'Tócala para verla entera: el plan, el chat, las fotos y quién va. Un solo botón: «Apuntarme».' },
    { s: '#clTabs [data-t=chats], #clubBody', v: 'club', t: 'Chats', x: 'Los avisos de la comunidad, los chats de tus salidas y los grupos, en un sitio. La campana ya solo trae avisos.' },
    { s: '.tab[data-view=profile]', v: 'profile', t: 'Yo', x: 'Tu perfil y cinco accesos: tu moto, tus estadísticas y logros, la seguridad, los ajustes y la ayuda.' },
    { s: '#yoNav [data-go=garage]', v: 'profile', t: 'Mi moto', x: 'El odómetro, el taller, los papeles con sus vencimientos y los gastos. La moto que guardes aquí se usa al apuntarte a una salida.' },
    { s: '#yoNav [data-go=security]', v: 'profile', t: 'Seguridad', x: 'Tus contactos de emergencia, el enlace para que tu familia vea por dónde vas y la zona de privacidad de las rutas que publicas.', end: true }
  ];
  var el = null, i = 0, running = false;
  function stop(done) { running = false; document.body.classList.remove('rg-touring'); if (el) { el.classList.add('out'); var e = el; el = null; setTimeout(function () { e.remove(); }, 260); } window.removeEventListener('resize', place); if (done !== false) mark(); if (A.showView) A.showView('map'); }
  function place() {
    if (!el) return;
    var st = STEPS[i], hole = el.querySelector('.rg-tour-hole'), bub = el.querySelector('.rg-tour-bub'), t = st.s ? st.s.split(', ').map($).filter(function (n) { return n && n.getBoundingClientRect().width; })[0] : null, r = t ? t.getBoundingClientRect() : null;
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
      '<div class="rg-tour-act">' + (st.end ? '' : '<button class="link" data-a="skip" type="button">Saltar</button>') + '<button class="btn small primary" data-a="next" type="button">' + (st.end ? 'Terminar' : (i === 0 ? 'Empezar' : 'Siguiente')) + '</button></div>';
    setTimeout(function () { place(); void bub.offsetWidth; bub.classList.add('in'); }, st.v === 'club' ? 500 : 80);
  }
  function start() {
    if (running) return; running = true; i = 0; document.body.classList.add('rg-touring');
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
  // Una sola vez por CUENTA, la primera vez que entra: queda apuntado en la cuenta (vale en cualquier móvil y tras cerrar sesión).
  // Para volver a verlo está Ayuda › «Cómo funciona». Las cuentas anteriores a este cambio se dan por vistas.
  var CUT = Date.parse('2026-11-26T00:00:00Z');
  function seen(u) {
    if (!u) return true;
    var md = u.user_metadata || {};
    return md.tour === true || store('rg.tour.' + u.id) === '1' || (Date.parse(u.created_at || '') || 0) < CUT;
  }
  function mark() {
    var u = Cl && Cl.user && Cl.user(); if (!u) return;
    store('rg.tour.' + u.id, '1');
    if (!(u.user_metadata && u.user_metadata.tour === true) && Cl.sb) { try { Cl.sb.auth.updateUser({ data: { tour: true } }).then(function () {}, function () {}); } catch (e) {} }
  }
  var calm = 0, auto = !navigator.webdriver || store('rg.test.tour') === '1', timer = null;
  function watch() {
    clearInterval(timer); calm = 0;
    if (!auto) return;
    timer = setInterval(function () {
      var u = Cl && Cl.user && Cl.user();
      if (!u) { calm = 0; return; }
      if (seen(u)) { clearInterval(timer); return; }
      var sh = $('#rgSheet'), ok = sh && sh.hidden && !(Cl.pageOpen && Cl.pageOpen()) && !(A.isRec && A.isRec()) && document.visibilityState !== 'hidden' && !$('.rg-crop');
      calm = ok ? calm + 1 : 0;
      if (calm >= 3) { clearInterval(timer); mark(); start(); }       // se apunta al empezar: si lo cierran a medias, no vuelve a salir
    }, 1500);
  }
  if (Cl && Cl.onChange) Cl.onChange(function () { watch(); }); else watch();
  window.RGTour = { start: function () { if (Cl && Cl.closeSheet) Cl.closeSheet(); start(); }, watch: function () { auto = true; watch(); } };
})();
