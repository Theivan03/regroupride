/* ReGroupRide · fotógrafos: quién está hoy y dónde, alta como fotógrafo (la aprueba el creador), «estoy aquí» y avisos
   a los moteros cercanos (plan Pro). supabase/26_fotografos.sql */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A || !Cl || !Cl.sb) return;
  var sb = Cl.sb, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var RA = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RideAlerts;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ok(r) { if (r.error) throw r.error; return r.data; }
  function fail(e) { A.toast(Cl.msg ? Cl.msg(e) : (e && e.message) || 'No se ha podido.', 'bad'); }
  function me() { var u = Cl.user && Cl.user(); return u ? u.id : null; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  function fix() { return A.anyFix ? A.anyFix() : (A.lastFix ? A.lastFix() : null); }      // vale también la posición aproximada: aquí solo se usa para distancias
  function head(t) { return '<div class="head"><h1>' + t + '</h1><button class="btn small icon" id="phX" type="button" aria-label="Cerrar"><svg><use href="#i-close"/></svg></button></div>'; }
  function hhmm(ms) { return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dayName(ms) { var d = new Date(ms), t = new Date(), k = ymd(d); if (k === ymd(t)) return 'Hoy'; t.setDate(t.getDate() + 1); if (k === ymd(t)) return 'Mañana'; return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function links(p) {
    var ig = String(p.instagram || '').replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[^\w.]/g, ''), wa = String(p.whatsapp || '').replace(/[^\d]/g, ''), web = String(p.web || '').trim();
    if (web && !/^https?:\/\//i.test(web)) web = 'https://' + web;
    var fb = String(p.facebook || '').trim(), em = String(p.email || '').trim();
    if (fb) fb = /^https?:\/\//i.test(fb) ? fb : (/^[\w.]+$/.test(fb) ? 'https://facebook.com/' + fb : 'https://www.facebook.com/search/top?q=' + encodeURIComponent(fb));
    return '<div class="ph-links">' + (ig ? '<a class="btn small" href="https://instagram.com/' + ig + '" target="_blank" rel="noopener">Instagram</a>' : '') + (web ? '<a class="btn small" href="' + esc(web) + '" target="_blank" rel="noopener">Sus fotos</a>' : '') + (wa ? '<a class="btn small" href="https://wa.me/' + (wa.length === 9 ? '34' + wa : wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') + (fb ? '<a class="btn small" href="' + esc(fb) + '" target="_blank" rel="noopener">Facebook</a>' : '') + (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) ? '<a class="btn small" href="mailto:' + esc(em) + '">Correo</a>' : '') + '</div>';
  }
  function pic(p, emo) { return '<span class="ph-ico">' + (/^https:\/\//.test(p.photo || '') ? '<img src="' + esc(p.photo) + '" alt="" loading="lazy">' : emo) + '</span>'; }
  var D = null, tab = 'spots', CAM = '<svg><use href="#i-camera"/></svg>', nearF = 'hoy';

  function load() { var f = fix(); return sb.rpc('photo_list', { p_lat: f ? f.lat : null, p_lon: f ? f.lon : null }).then(function (r) { D = ok(r); try { if (paintMarks(D.spots || [])) marksAt = Date.now(); } catch (e) {} return D; }); }
  // «Dónde están» y «Todos» viven en Cerca › Fotos; aquí queda la ficha de quien es fotógrafo (y las altas).
  function open(t) {
    if (!me()) { Cl.openAuth(false); return; }
    if (t === 'spots' || t === 'people' || !t) { D = null; if (window.RGUI) { RGUI.near('fotos'); return; } }
    tab = t === 'admin' ? 'admin' : 'mine';
    Cl.sheet(head('Soy fotógrafo') + '<p class="muted">Cargando…</p>', 'full'); $('#phX').addEventListener('click', Cl.closeSheet);
    load().then(draw).catch(function (e) { Cl.sheet(head('Soy fotógrafo') + '<p class="muted">' + esc(Cl.msg ? Cl.msg(e) : e.message) + '</p>', 'full'); $('#phX').addEventListener('click', Cl.closeSheet); });
  }
  // Pestaña «Fotos» de «Cerca de ti»
  function pane(el) {
    var SAFE = '<div class="as-note amber">' + '<svg><use href="#i-warn"/></svg><span>La foto no vale un susto. Cuando veas a un fotógrafo, pasa a tu ritmo y por tu carril.</span></div>';
    var shell = function (inner) { el.innerHTML = '<div class="pills" id="phF"><button class="pill" type="button" data-f="hoy" aria-pressed="' + (nearF === 'hoy') + '">Dónde están hoy</button><button class="pill" type="button" data-f="todos" aria-pressed="' + (nearF === 'todos') + '">Todos los fotógrafos</button></div><div id="phPane" class="as-col">' + inner + '</div>' + SAFE + '<button class="as-link" id="phMine" type="button">Soy fotógrafo</button>';
      $$('#phF button', el).forEach(function (b) { b.addEventListener('click', function () { nearF = b.dataset.f; pane(el); }); });
      $('#phMine', el).addEventListener('click', function () { open('mine'); }); };
    if (!me()) { shell('<div class="empty"><b>Entra en tu cuenta</b>Para ver dónde van a estar los fotógrafos.</div>'); return; }
    var paint = function () { if (!el.isConnected) return; shell(''); if (nearF === 'hoy') paneSpots(); else panePeople(); };
    if (D && Date.now() - (D._at || 0) < 120000) { paint(); return; }
    shell('<div class="empty"><b>Cargando…</b></div>');
    load().then(function () { D._at = Date.now(); paint(); }).catch(function () { shell('<div class="empty"><b>No se ha podido cargar</b>Revisa la conexión.</div>'); });
  }
  function draw() {
    var m = D.me, pend = (D.pending || []).filter(function (x) { return x.status === 'pending'; });
    var tabs = [['mine', m && m.status === 'approved' ? 'Mi ficha' : 'Darme de alta']];
    if (D.admin) tabs.push(['admin', 'Altas' + (pend.length ? ' · ' + pend.length : '')]);
    if (tab === 'admin' && !D.admin) tab = 'mine';
    Cl.sheet(head('Soy fotógrafo') + (tabs.length > 1 ? '<div class="seg rg-wide" id="phTabs">' + tabs.map(function (x) { return '<button type="button" data-t="' + x[0] + '" aria-pressed="' + (tab === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' : '') + '<div id="phPane"></div>', 'full');
    $('#phX').addEventListener('click', Cl.closeSheet);
    $$('#phTabs button').forEach(function (b) { b.addEventListener('click', function () { tab = b.dataset.t; draw(); }); });
    ({ mine: paneMine, admin: paneAdmin })[tab]();
  }
  function paneSpots() {
    var host = $('#phPane'), day = '';
    host.innerHTML = D.spots.length ? D.spots.map(function (s) {
      var d = dayName(s.starts_at), sep = d !== day ? '<span class="label">' + d + '</span>' : ''; day = d;
      var live = s.starts_at <= Date.now() && s.ends_at > Date.now();
      return sep + '<div class="club-card ph-card"><div class="ph-top">' + pic(s, CAM) + '<div><b>' + esc(s.name) + '</b><span class="ph-place"><svg><use href="#i-locate"/></svg>' + esc(s.place) + '</span></div>' + (live ? '<span class="mstatus ok">Ahora</span>' : '') + '</div>' +
        '<div class="rt-meta"><span><svg><use href="#i-clock"/></svg>' + hhmm(s.starts_at) + ' – ' + hhmm(s.ends_at) + '</span>' + (s.km != null ? '<span><svg><use href="#i-route"/></svg>a ' + s.km + ' km de ti</span>' : '') + '</div>' +
        (s.note ? '<p class="rt-desc">' + esc(s.note) + '</p>' : '') +
        '<div class="ph-links"><button class="btn small primary" data-go="' + s.id + '" type="button"><svg><use href="#i-route"/></svg>Llévame</button><button class="btn small" data-see="' + s.id + '" type="button"><svg><use href="#i-map"/></svg>Ver en el mapa</button><a class="btn small" href="https://www.google.com/maps/dir/?api=1&destination=' + s.lat + ',' + s.lon + '" target="_blank" rel="noopener"><svg><use href="#i-gmaps"/></svg>Google Maps</a></div>' + links(s) +
        (s.user_id === me() || D.admin ? '<button class="link danger" data-del="' + s.id + '" type="button">Quitar</button>' : '') + '</div>';
    }).join('') : '<div class="empty"><b>Nadie ha avisado todavía</b>Ahora mismo ningún fotógrafo ha dicho dónde va a estar. Vuelve a mirar el fin de semana.</div>';
    var byId = function (id) { return D.spots.filter(function (x) { return x.id === id; })[0]; };
    $$('[data-go]', host).forEach(function (b) { b.addEventListener('click', function () { goTo(byId(b.dataset.go), b); }); });
    $$('[data-see]', host).forEach(function (b) { b.addEventListener('click', function () { var s = byId(b.dataset.see), map = A.map && A.map(); Cl.closeSheet(); A.showView('map'); if (map) map.flyTo({ center: [s.lon, s.lat], zoom: 13 }); }); });
    $$('[data-del]', host).forEach(function (b) { b.addEventListener('click', function () { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = '¿Seguro? Toca otra vez'; return; } sb.from('photo_spots').delete().eq('id', b.dataset.del).then(function (r) { ok(r); D = null; open(); }).catch(fail); }); });
  }
  function panePeople() {
    $('#phPane').innerHTML = D.people.length ? D.people.map(function (p) {
      return '<div class="club-card ph-card"><div class="ph-top">' + pic(p, CAM) + '<div><b>' + esc(p.name) + '</b>' + (p.zones ? '<span class="ph-place"><svg><use href="#i-locate"/></svg>' + esc(p.zones) + '</span>' : '') + '</div>' + (p.pro ? '<span class="rt-tag">Destacado</span>' : '') + '</div>' + (p.bio ? '<p class="rt-desc">' + esc(p.bio) + '</p>' : '') + links(p) + '</div>';
    }).join('') : '<div class="empty"><b>Aún no hay fotógrafos</b>Si haces fotos en carretera, date de alta en «Soy fotógrafo».</div>';
  }
  function profileForm(m, label) {
    m = m || {};
    return '<form class="rg-form" id="phForm"><button class="rg-pic" id="pfPic" type="button"><span class="rg-ava' + (m.photo ? ' has' : '') + '" id="pfPicAva">' + (/^https:\/\//.test(m.photo || '') ? '<img src="' + esc(m.photo) + '" alt="">' : '<svg width="26" height="26"><use href="#i-camera"/></svg>') + '</span><span><b>Tu foto o logo</b><small>Es lo que verán los moteros junto a tu nombre.</small></span></button><label>Nombre con el que te conocen<input id="pfName" required minlength="2" maxlength="60" placeholder="FotoCurvas Alicante" value="' + esc(m.name || '') + '"></label>' +
      '<label>Dónde sueles ponerte<input id="pfZones" maxlength="200" placeholder="Carrasqueta, Canalís, Maigmó…" value="' + esc(m.zones || '') + '"></label>' +
      '<label>Sobre ti y cómo conseguir las fotos<textarea id="pfBio" class="note" maxlength="400" placeholder="Subo las fotos a mi web el mismo día. Precio por foto, packs…">' + esc(m.bio || '') + '</textarea></label>' +
      '<div class="tr-two"><label>Instagram<input id="pfIg" maxlength="60" placeholder="@usuario" value="' + esc(m.instagram || '') + '"></label><label>WhatsApp<input id="pfWa" type="tel" inputmode="tel" maxlength="20" placeholder="600 000 000" value="' + esc(m.whatsapp || '') + '"></label></div>' +
      '<div class="tr-two"><label>Facebook<input id="pfFb" maxlength="120" placeholder="Página o usuario" value="' + esc(m.facebook || '') + '"></label><label>Correo de contacto<input id="pfEm" type="email" maxlength="120" placeholder="tu@correo.com" value="' + esc(m.email || '') + '"></label></div>' +
      '<label>Web donde se ven o compran las fotos<input id="pfWeb" maxlength="200" placeholder="https://…" value="' + esc(m.web || '') + '"></label>' +
      '<p class="muted rg-small">Estos datos los verá cualquiera que use la app.</p><button class="btn big primary" type="submit">' + label + '</button></form>';
  }
  function wireProfile() {
    var newPic = null;
    $('#pfPic').addEventListener('click', function () { if (!window.RGCrop) return; RGCrop.pick().then(function (d) { if (!d) return; newPic = d; var a = $('#pfPicAva'); a.classList.add('has'); a.innerHTML = '<img src="' + d + '" alt="">'; }); });
    var upload = function () {      // la foto nueva se sube a la carpeta del usuario; devuelve su dirección (o null si no se ha cambiado)
      if (!newPic) return Promise.resolve(null);
      var mm = /^data:(image\/\w+);base64,(.*)$/.exec(newPic), bin = atob(mm[2]), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var path = me() + '/ph-' + Date.now().toString(36) + '.jpg';
      return sb.storage.from('avatars').upload(path, new Blob([arr], { type: mm[1] }), { contentType: mm[1] }).then(function (r) { if (r.error) throw r.error; return sb.storage.from('avatars').getPublicUrl(path).data.publicUrl; });
    };
    $('#phForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () {
        return upload().then(function (url) { return sb.rpc('photographer_save', { p_name: $('#pfName').value.trim(), p_bio: $('#pfBio').value.trim(), p_zones: $('#pfZones').value.trim(), p_instagram: $('#pfIg').value.trim(), p_web: $('#pfWeb').value.trim(), p_whatsapp: $('#pfWa').value.trim(), p_facebook: $('#pfFb').value.trim(), p_email: $('#pfEm').value.trim(), p_photo: url }); }).then(function (r) {
          var st = ok(r); A.toast(st === 'approved' ? 'Ficha guardada.' : 'Solicitud enviada. Te avisaremos cuando esté aprobada.', 'ok'); open('mine');
        });
      });
    });
  }
  function paneMine() {
    var m = D.me, host = $('#phPane');
    if (!m) { host.innerHTML = '<div class="club-card"><b>¿Haces fotos a moteros?</b><p class="muted">Date de alta gratis: tendrás tu ficha en la app y podrás avisar de dónde vas a estar para que la gente pase por delante de tu cámara.</p></div>' + profileForm(null, 'Pedir el alta'); wireProfile(); return; }
    if (m.status === 'pending') { host.innerHTML = '<div class="club-card"><b>Solicitud enviada</b><p class="muted">Estamos revisando tu ficha. Te llegará un aviso en cuanto esté aprobada.</p></div>' + profileForm(m, 'Guardar cambios'); wireProfile(); return; }
    if (m.status === 'rejected') { host.innerHTML = '<div class="club-card"><b>No hemos podido aprobar tu ficha</b><p class="muted">Revisa los datos y vuelve a enviarla.</p></div>' + profileForm(m, 'Volver a enviar'); wireProfile(); return; }
    var mine = D.spots.filter(function (s) { return s.user_id === me(); }), d = new Date(), f = fix();
    var h0 = d.getHours() >= 9 ? Math.min(20, d.getHours() + 1) : 9, t1 = ('0' + h0).slice(-2) + ':00', t2 = ('0' + Math.min(23, h0 + 4)).slice(-2) + ':00';
    var known = {}; mine.forEach(function (s) { known[s.place] = s; }); try { JSON.parse(store('rg.photo.places') || '[]').forEach(function (s) { if (!known[s.place]) known[s.place] = s; }); } catch (e) {}
    host.innerHTML = '<form class="rg-form club-card" id="spForm"><b>Avisar de dónde voy a estar</b>' +
      '<label>Sitio<input id="spPlace" required minlength="2" maxlength="80" placeholder="Curva Venta Teresa (Carrasqueta)" list="spKnown"><datalist id="spKnown">' + Object.keys(known).map(function (k) { return '<option value="' + esc(k) + '">'; }).join('') + '</datalist></label>' +
      '<label>Dónde es exactamente<input id="spWhere" required maxlength="120" placeholder="Pega las coordenadas o usa el botón" value=""></label>' +
      '<button class="btn small" id="spHere" type="button"><svg><use href="#i-locate"/></svg>Estoy aquí ahora: usar mi ubicación</button>' +
      '<p class="muted rg-small">En Google Maps, mantén pulsado el punto, copia las coordenadas (38.6123, -0.4712) y pégalas arriba.</p>' +
      '<label>Día<input id="spDay" type="date" required min="' + ymd(d) + '" value="' + ymd(d) + '"></label>' +
      '<div class="tr-two"><label>Desde<input id="spFrom" type="time" required value="' + t1 + '"></label><label>Hasta<input id="spTo" type="time" required value="' + t2 + '"></label></div>' +
      '<label>Nota (opcional)<input id="spNote" maxlength="140" placeholder="Estoy en la segunda curva, lado derecho"></label>' +
      '<div class="ph-pro ' + (m.pro ? 'on' : '') + '">' + (m.pro ? '<b>Plan Destacado activo</b><span>Al publicar, se avisa al móvil de los moteros que estén a menos de 30 km.</span>' : '<b>Avisar a los moteros a 30 km</b><span>Disponible en el plan Destacado. Escríbenos desde Ajustes → «Escribirme» si te interesa.</span>') + '</div>' +
      '<button class="btn big primary" type="submit">Publicar</button></form>' +
      (mine.length ? '<span class="label">Mis avisos</span>' + mine.map(function (s) { return '<div class="club-card ph-card"><b>' + esc(s.place) + '</b><div class="rt-meta"><span>' + dayName(s.starts_at) + ' · ' + hhmm(s.starts_at) + ' – ' + hhmm(s.ends_at) + '</span></div><button class="link danger" data-del="' + s.id + '" type="button">Quitar</button></div>'; }).join('') : '') +
      '<details class="club-card"><summary><b>Mi ficha de fotógrafo</b></summary>' + profileForm(m, 'Guardar ficha') + '</details>';
    wireProfile();
    $('#spPlace').addEventListener('change', function () { var k = known[this.value]; if (k && !$('#spWhere').value) $('#spWhere').value = k.lat + ', ' + k.lon; });
    $('#spHere').addEventListener('click', function () { var p = fix(); if (!p) { A.toast('Todavía no tengo tu ubicación. Abre el mapa un momento y vuelve.', 'warn'); return; } $('#spWhere').value = p.lat.toFixed(5) + ', ' + p.lon.toFixed(5); });
    $$('[data-del]', host).forEach(function (b) { b.addEventListener('click', function () { sb.from('photo_spots').delete().eq('id', b.dataset.del).then(function (r) { ok(r); open('mine'); }).catch(fail); }); });
    $('#spForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var w = /(-?\d{1,2}[.,]\d+)\s*[,; ]\s*(-?\d{1,3}[.,]\d+)/.exec($('#spWhere').value.replace(/@/g, ' ')), lat = w ? parseFloat(w[1].replace(',', '.')) : NaN, lon = w ? parseFloat(w[2].replace(',', '.')) : NaN;
      if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) { A.toast('No entiendo el sitio. Pega las coordenadas (38.6123, -0.4712) o pulsa «usar mi ubicación».', 'warn'); return; }
      var a = new Date($('#spDay').value + 'T' + $('#spFrom').value), b = new Date($('#spDay').value + 'T' + $('#spTo').value);
      if (isNaN(a) || isNaN(b) || b <= a) { A.toast('Revisa las horas.', 'warn'); return; }
      if (b.getTime() < Date.now()) { A.toast('Ese horario ya ha pasado: no saldría en la lista. Pon un día u hora que aún no haya terminado.', 'warn'); return; }
      var place = $('#spPlace').value.trim();
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () {
        return sb.from('photo_spots').insert({ user_id: me(), place: place, lat: lat, lon: lon, starts_at: a.toISOString(), ends_at: b.toISOString(), note: $('#spNote').value.trim() }).then(function (r) {
          ok(r); try { var L = JSON.parse(store('rg.photo.places') || '[]').filter(function (x) { return x.place !== place; }); L.unshift({ place: place, lat: lat, lon: lon }); store('rg.photo.places', JSON.stringify(L.slice(0, 12))); } catch (e) {}
          A.toast(m.pro ? 'Publicado. Avisando a los moteros de la zona.' : 'Publicado. Ya sales en «Dónde están».', 'ok'); open('spots');
        });
      });
    });
  }
  function paneAdmin() {
    var host = $('#phPane'), all = (D.pending || []).concat(D.people.map(function (p) { return Object.assign({ status: 'approved' }, p); }));
    host.innerHTML = all.length ? all.map(function (p) {
      return '<div class="club-card ph-card" data-u="' + p.user_id + '"><div class="ph-top"><div><b>' + esc(p.name) + '</b><span class="ph-place">' + esc(p.zones || 'Sin zonas') + '</span></div><span class="rt-tag ' + (p.status === 'approved' ? 'lv-facil' : p.status === 'pending' ? 'lv-media' : 'lv-exigente') + '">' + ({ approved: 'Aprobado', pending: 'Pendiente', rejected: 'Rechazado' })[p.status] + '</span></div>' +
        (p.bio ? '<p class="rt-desc">' + esc(p.bio) + '</p>' : '') + (p.account ? '<span class="muted rg-small">Cuenta: ' + esc(p.account) + '</span>' : '') + links(p) +
        '<div class="rt-acts">' + (p.status !== 'approved' ? '<button class="btn small primary" data-a="approved" type="button">Aprobar</button>' : '') + (p.status !== 'rejected' ? '<button class="link danger" data-a="rejected" type="button">' + (p.status === 'approved' ? 'Dar de baja' : 'Rechazar') + '</button>' : '') +
        (p.status === 'approved' ? '<button class="btn small" data-pro="' + (p.pro ? '0' : '1') + '" type="button">' + (p.pro ? 'Quitar plan Destacado' : 'Poner plan Destacado') + '</button>' : '') + '</div></div>';
    }).join('') : '<div class="empty">No hay fotógrafos todavía.</div>';
    $$('[data-a],[data-pro]', host).forEach(function (b) { b.addEventListener('click', function () {
      var u = b.closest('[data-u]').dataset.u;
      Cl.busy(b, function () { return sb.rpc('photographer_set', { p_user: u, p_status: b.dataset.a || null, p_pro: b.dataset.pro ? b.dataset.pro === '1' : null }).then(function (r) { ok(r); A.toast('Hecho.', 'ok'); open('admin'); }); });
    }); });
  }

  /* ---------- fotógrafos en el mapa: un punto donde hay uno o va a estar; al tocarlo, la ficha y «Llévame» ---------- */
  var marks = [], marksAt = 0;
  function goTo(s, btn) {
    var f = fix(); if (!f) { A.toast('Todavía no tengo tu ubicación. Espera a que el mapa te sitúe.', 'warn'); return; }
    Cl.busy(btn, function () { return A.routeBetween([[f.lon, f.lat], [s.lon, s.lat]]).then(function (r) {
      if (!r || !r.coords || r.coords.length < 2) throw new Error('No se ha podido calcular la ruta hasta allí.');
      Cl.closeSheet();
      A.previewPlan({ id: Date.now(), name: 'Hasta ' + s.place, wps: [[f.lon, f.lat], [s.lon, s.lat]], pois: [], coords: r.coords, dist: Math.round(r.dist * 10) / 10, dur: Math.round(r.dur), routed: !!r.routed, steps: r.steps || [], created: Date.now() });
      A.toast('Ruta hasta ' + s.place + ' en el mapa. Pulsa «Iniciar ruta» y ve a tu ritmo.', 'ok');
    }); });
  }
  function spotSheet(s) {
    var live = s.starts_at <= Date.now() && s.ends_at > Date.now();
    Cl.sheet(head('Fotógrafo') + '<div class="club-card ph-card"><div class="ph-top">' + pic(s, CAM) + '<div><b>' + esc(s.name) + '</b><span class="ph-place"><svg><use href="#i-locate"/></svg>' + esc(s.place) + '</span></div>' + (live ? '<span class="mstatus ok">Ahora</span>' : '') + '</div>' +
      '<div class="rt-meta"><span><svg><use href="#i-clock"/></svg>' + dayName(s.starts_at) + ' · ' + hhmm(s.starts_at) + ' – ' + hhmm(s.ends_at) + '</span>' + (s.km != null ? '<span><svg><use href="#i-route"/></svg>a ' + s.km + ' km de ti</span>' : '') + '</div>' + (s.note ? '<p class="rt-desc">' + esc(s.note) + '</p>' : '') + links(s) + '</div>' +
      '<div class="rt-note warn"><b><svg><use href="#i-warn"/></svg>Sin forzar para la foto</b><p>Pasa a tu ritmo y por tu carril. Una foto no vale un susto.</p></div>' +
      '<button class="btn big primary" id="phGo" type="button"><svg><use href="#i-route"/></svg>Llévame hasta allí</button><a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=' + s.lat + ',' + s.lon + '" target="_blank" rel="noopener"><svg><use href="#i-gmaps"/></svg>Abrir en Google Maps</a>');
    $('#phX').addEventListener('click', Cl.closeSheet);
    $('#phGo').addEventListener('click', function () { goTo(s, this); });
  }
  function paintMarks(spots) {
    var map = A.map && A.map(); if (!map || !window.maplibregl) return false;
    marks.forEach(function (m) { m.remove(); }); marks = [];
    var seen = {};
    spots.forEach(function (s) {
      var k = s.lat.toFixed(4) + ',' + s.lon.toFixed(4) + '|' + s.user_id; if (seen[k]) return; seen[k] = 1;      // el mismo fotógrafo en el mismo sitio varios días: un solo punto (el más próximo)
      var el = document.createElement('div'), live = s.starts_at <= Date.now() && s.ends_at > Date.now();
      el.className = 'ph-mk' + (live ? ' live' : ''); el.innerHTML = CAM; el.title = s.name + ' · ' + s.place;
      el.addEventListener('click', function (ev) { ev.stopPropagation(); spotSheet(s); });
      marks.push(new maplibregl.Marker({ element: el, anchor: 'bottom-left' }).setLngLat([s.lon, s.lat]).addTo(map));
    });
    return true;
  }
  function loadMarks(force) {
    if (!me() || (!force && Date.now() - marksAt < 10 * 60000)) return;
    var f = fix();
    sb.rpc('photo_list', { p_lat: f ? f.lat : null, p_lon: f ? f.lon : null }).then(function (r) { if (r.error || !r.data) return; if (paintMarks(r.data.spots || [])) marksAt = Date.now(); }, function () {});
  }
  setTimeout(function () { loadMarks(true); }, 7000); setInterval(function () { if (document.visibilityState !== 'hidden') loadMarks(false); }, 60000);

  /* ---------- avisos de fotógrafos cerca ---------- */
  function off() { return store('rg.photo.off') === '1'; }
  var zoneKey = '', nearAt = 0;
  function tick() {
    if (!me() || off() || document.visibilityState === 'hidden' && !(A.isRec && A.isRec())) return;
    var f = fix(); if (!f) return;
    // mi zona aproximada (unos 10 km): sirve para avisarme con la app cerrada cuando un fotógrafo publica cerca
    var k = me() + '|' + f.lat.toFixed(1) + '|' + f.lon.toFixed(1);
    if (k !== zoneKey && store('rg.photo.zone') !== k) { zoneKey = k; sb.rpc('zone_set', { p_lat: f.lat, p_lon: f.lon }).then(function (r) { if (!r.error) store('rg.photo.zone', k); }, function () {}); }
    // con la app abierta o en ruta: ¿hay algún fotógrafo destacado a menos de 30 km de donde estoy ahora?
    if (Date.now() - nearAt < 4 * 60000) return; nearAt = Date.now();
    sb.rpc('photo_near', { p_lat: f.lat, p_lon: f.lon }).then(function (r) {
      (r.data || []).forEach(function (s) {
        var headTx = s.name + ' está a ' + s.km + ' km', body = s.place + ', de ' + s.from + ' a ' + s.to + '. Pasa a tu ritmo, sin forzar para la foto: la mejor es la que te llevas a casa.';
        A.toast(headTx + ' · ' + s.place + '. Sin forzar para la foto.', 'ok');
        if (RA && RA.newsNow) RA.newsNow({ items: [{ kind: 'note', id: 'phn-' + s.id, community: 'Fotógrafos', head: headTx, title: body }], silent: false }).catch(function () {});
      });
    }, function () {});
  }
  setTimeout(tick, 9000); setInterval(tick, 60000);

  // interruptor en Ajustes
  var about = document.getElementById('about');
  if (about) {
    var box = document.createElement('div'); box.className = 'rg-maker';
    box.innerHTML = '<span class="label">Fotógrafos</span><label class="rg-check"><input type="checkbox" id="phOn"' + (off() ? '' : ' checked') + '><span><b>Avisarme si hay un fotógrafo cerca</b><small>Para saberlo, la app guarda tu zona aproximada (unos 10 km de margen), nunca tu posición exacta. Si lo apagas, se borra.</small></span></label><button class="btn small" id="phOpen" type="button">Ver fotógrafos</button>';
    about.parentNode.insertBefore(box, about);
    box.querySelector('#phOpen').addEventListener('click', function () { open('spots'); });
    box.querySelector('#phOn').addEventListener('change', function () {
      if (this.checked) { store('rg.photo.off', null); store('rg.photo.zone', null); zoneKey = ''; tick(); }
      else { store('rg.photo.off', '1'); store('rg.photo.zone', null); zoneKey = ''; if (me()) sb.rpc('zone_set', { p_lat: null, p_lon: null }).then(function () {}, function () {}); }
    });
  }
  window.RGPhoto = { open: open, pane: pane };
})();
