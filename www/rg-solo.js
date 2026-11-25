/* ReGroupRide — modo «voy solo» y enlace de seguimiento.
   · Contactos de emergencia (supabase/30). Si ruedo solo y hay una parada brusca que no se reanuda, la app pregunta
     con una cuenta atrás de 60 s; sin respuesta, avisa a los contactos que tengan la app y marca el enlace en rojo.
   · Enlace de seguimiento: una página web (sin instalar nada) con mi posición mientras grabo la ruta.
   No llama a emergencias por su cuenta: ofrece el botón del 112. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud, L = window.RGLib; if (!A || !Cl || !Cl.sb) return;
  var sb = Cl.sb, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var RA = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.RideAlerts;
  var WEB = 'https://regroupride-eventos.netlify.app/seguir.html?s=';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function ic(n) { return '<svg><use href="#i-' + n + '"/></svg>'; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  function dist(a, b, c, d) { if (L && L.dist) return L.dist(a, b, c, d); var R = 6371000, x = (d - b) * Math.PI / 180 * Math.cos((a + c) * Math.PI / 360), y = (c - a) * Math.PI / 180; return Math.sqrt(x * x + y * y) * R; }
  var S = { on: store('rg.solo') === '1', contacts: null, share: null, buf: [], cand: null, ask: null, alerted: false, wasRec: false, pingAt: 0, auto: false };
  try { var sh = JSON.parse(store('rg.share') || 'null'); if (sh && sh.token && Date.now() - sh.at < 14 * 36e5) S.share = sh; } catch (e) {}
  function inGroup() { return !!(window.RGGroup && RGGroup.state && RGGroup.state.s); }

  /* ---------- contactos y enlace ---------- */
  function loadContacts(force) {
    if (!Cl.user()) { S.contacts = []; return Promise.resolve([]); }
    if (S.contacts && !force) return Promise.resolve(S.contacts);
    return sb.from('emergency_contacts').select('id,name,phone').order('created_at').then(function (r) { S.contacts = r.error ? [] : (r.data || []); paintBtn(); return S.contacts; }, function () { return S.contacts || []; });
  }
  function ensureShare() {
    if (S.share && Date.now() - S.share.at < 14 * 36e5) return Promise.resolve(S.share);
    if (!Cl.user()) return Promise.reject(new Error('Entra en tu cuenta para compartir tu posición.'));
    return sb.from('live_shares').insert({ name: (Cl.profileName && Cl.profileName()) || '' }).select('token').single().then(function (r) {
      if (r.error) throw r.error; S.share = { token: r.data.token, at: Date.now() }; store('rg.share', JSON.stringify(S.share)); S.pingAt = 0; return S.share;
    });
  }
  function endShare() {
    var sh = S.share; S.share = null; S.auto = false; store('rg.share', null);
    if (sh) sb.from('live_shares').update({ status: 'ended' }).eq('token', sh.token).then(function () {}, function () {});
  }
  function sendLink() {
    return ensureShare().then(function (sh) {
      var url = WEB + sh.token, text = 'Sigue mi ruta en moto en directo: ' + url, P = window.Capacitor && Capacitor.Plugins;
      ping(true);
      if (P && P.Share) return P.Share.share({ text: text, dialogTitle: 'Compartir seguimiento' }).catch(function () {});
      if (navigator.share) return navigator.share({ text: text }).catch(function () {});
      return navigator.clipboard.writeText(url).then(function () { A.toast('Enlace copiado: pégalo donde quieras.', 'warn'); });
    });
  }
  function ping(force) {
    if (!S.share) return; var f = A.lastFix && A.lastFix(); if (!f || Date.now() - f.ts > 30000) return;
    if (!force && Date.now() - S.pingAt < 20000) return; S.pingAt = Date.now();
    var v = f.v != null ? f.v * 3.6 : null;
    sb.rpc('live_share_ping', { p_token: S.share.token, p_lat: f.lat, p_lon: f.lon, p_speed: v != null && isFinite(v) ? Math.round(v) : null }).then(function () {}, function () {});
  }

  /* ---------- Yo › Seguridad: vigilancia, contactos y enlace ---------- */
  function open() { if (!Cl.user()) { Cl.openAuth(false); return; } Cl.closePages(); A.showView('security'); }
  function pane(el) {
    if (!Cl.user()) { el.innerHTML = '<div class="empty"><b>Entra en tu cuenta</b>Los contactos y el enlace de seguimiento se guardan en tu cuenta.</div>'; return; }
    var draw = function () {
      if (!el.isConnected) return;
      var cs = S.contacts || [], sharing = !!S.share;
      el.innerHTML = '<label class="as-switch-row"><span><b>Vigilar cuando ruedo solo</b><small>Si te paras de golpe y no sigues, te pregunta si estás bien y cuenta 60 segundos. Sin respuesta, avisa a tus contactos con tu posición.</small></span><span class="switch"><input type="checkbox" id="soOn"' + (S.on ? ' checked' : '') + '><span></span></span></label>' +
        '<span class="label">Contactos</span><div class="as-rows">' + (cs.length ? cs.map(function (c) { return '<div class="as-row"><span><b>' + esc(c.name) + '</b><small>' + esc(c.phone) + '</small></span><button class="as-x" data-del="' + c.id + '" type="button" title="Quitar">' + ic('close') + '</button></div>'; }).join('') : '<div class="empty small"><b>Sin contactos</b>Añade a quien quieras que se entere si te pasa algo.</div>') + '</div>' +
        (cs.length < 5 ? '<form class="as-add" id="soAdd"><input id="soName" maxlength="60" placeholder="Nombre" autocomplete="off" required><input id="soPhone" type="tel" inputmode="tel" maxlength="20" placeholder="Teléfono" autocomplete="off" required><button class="btn" type="submit">Añadir contacto</button></form>' : '') +
        '<p class="muted rg-small" style="text-align:left;margin:0">El aviso llega como notificación a los contactos que tengan ReGroupRide con ese teléfono. A quien no la tenga, pásale el enlace antes de salir. La app no llama al 112.</p>' +
        '<span class="label">Enlace de seguimiento</span><p class="muted" style="margin:0;text-align:left">Una página web con tu posición mientras grabas la ruta. Quien la abra no necesita instalar nada.' + (sharing ? ' Compartiendo desde las ' + new Date(S.share.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + '.' : '') + '</p>' +
        '<button class="btn big primary" id="soShare" type="button">' + ic('share') + 'Compartir enlace</button>' + (sharing ? '<button class="btn" id="soEnd" type="button">Dejar de compartir</button>' : '');
      $('#soOn', el).addEventListener('change', function (e) { S.on = e.target.checked; store('rg.solo', S.on ? '1' : '0'); });
      $$('[data-del]', el).forEach(function (b) { b.addEventListener('click', function () { sb.from('emergency_contacts').delete().eq('id', b.dataset.del).then(function () { return loadContacts(true); }).then(draw); }); });
      if ($('#soAdd', el)) $('#soAdd', el).addEventListener('submit', function (ev) {
        ev.preventDefault(); var n = $('#soName', el).value.trim(), p = $('#soPhone', el).value.replace(/[^0-9+]/g, '');
        if (!n || p.replace(/\D/g, '').length < 9) { A.toast('Escribe el nombre y un teléfono completo.', 'warn'); return; }
        Cl.busy(ev.submitter || $('#soAdd button', el), function () { return sb.from('emergency_contacts').insert({ name: n, phone: p }).then(function (r) { if (r.error) throw r.error; return loadContacts(true); }).then(draw); });
      });
      $('#soShare', el).addEventListener('click', function (ev) { Cl.busy(ev.currentTarget, function () { return sendLink().then(draw); }); });
      if ($('#soEnd', el)) $('#soEnd', el).addEventListener('click', function () { endShare(); draw(); });
    };
    draw(); loadContacts(true).then(draw);
  }
  function paintBtn() {}
  function setOn(v) { S.on = !!v; store('rg.solo', S.on ? '1' : '0'); }

  /* ---------- pregunta y aviso ---------- */
  function overlay(html) { closeAsk(); var el = document.createElement('div'); el.className = 'rg-stopask'; el.innerHTML = '<div class="rg-stopask-in">' + html + '</div>'; document.body.appendChild(el); return el; }
  function closeAsk() { if (S.ask) { clearInterval(S.ask.t); if (S.ask.el.parentNode) S.ask.el.parentNode.removeChild(S.ask.el); S.ask = null; } }
  function ask() {
    if (S.ask) return;
    var cs0 = S.contacts || [], whoTx = cs0.length ? (cs0.length === 1 ? cs0[0].name : cs0[0].name + ' y ' + (cs0.length - 1) + ' más') : '';
    var el = overlay('<b>¿Estás bien?</b><p>Te has parado de golpe. Si no tocas nada, cuando llegue a cero ' + (whoTx ? 'aviso a ' + esc(whoTx) + ' con tu posición.' : 'el enlace de seguimiento mostrará el aviso.') + '</p><span class="as-count cifra" id="saN">60</span><button class="btn big primary" data-a="ok" type="button">Estoy bien</button><button class="btn big" data-a="help" type="button">Necesito ayuda</button>');
    var end = Date.now() + 60000;
    S.ask = { el: el, t: setInterval(function () { var left = Math.ceil((end - Date.now()) / 1000), n = el.querySelector('#saN'); if (n) n.textContent = Math.max(0, left); if (left <= 0) alertNow(); else if (left % 10 === 0) buzz(); }, 1000) };
    el.addEventListener('click', function (ev) { var b = ev.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'help') alertNow(); else { closeAsk(); S.alerted = true; } });
    buzz(); try { if (window.Platform && Platform.canSpeak && Platform.canSpeak()) Platform.speak('¿Estás bien? Toca la pantalla o aviso a tus contactos.'); } catch (e) {}
    try { if (RA && RA.newsNow) RA.newsNow({ items: [{ kind: 'note', id: 'solo-ask-' + Date.now(), community: 'Voy solo', head: '¿Estás bien?', title: 'Abre la app y toca «Estoy bien», o aviso a tus contactos.' }], silent: false }).catch(function () {}); } catch (e) {}
  }
  function buzz() { try { if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); } catch (e) {} }
  function alertNow() {
    closeAsk(); S.alerted = true;
    var f = (A.lastFix && A.lastFix()) || (A.anyFix && A.anyFix()) || {}, cs = S.contacts || [];
    var el = overlay('<b>Avisando…</b><p id="saT">Enviando tu posición a tus contactos.</p><button class="btn big primary" data-a="ok" type="button">Estoy bien: retirar el aviso</button>' + (cs.length ? '<a class="btn big" id="saSms" href="#">Enviar SMS a mis contactos</a>' : '') + '<a class="btn big" href="tel:112">Llamar al 112</a>');
    S.ask = { el: el, t: 0 };
    ensureShare().then(function (sh) {
      var url = WEB + sh.token, body = 'Soy ' + ((Cl.profileName && Cl.profileName()) || 'yo') + '. Me he parado en ruta y puede que necesite ayuda. Estoy aquí: https://maps.google.com/?q=' + f.lat + ',' + f.lon + ' · Seguimiento: ' + url;
      var sms = el.querySelector('#saSms'); if (sms) sms.href = 'sms:' + cs.map(function (c) { return c.phone; }).join(';') + '?body=' + encodeURIComponent(body);
      return sb.rpc('solo_alert', { p_token: sh.token, p_lat: f.lat != null ? f.lat : null, p_lon: f.lon != null ? f.lon : null });
    }).then(function (r) {
      var n = r && !r.error ? (r.data || 0) : 0, t = el.querySelector('#saT'), b = el.querySelector('b'); if (b) b.textContent = 'Aviso enviado';
      if (t) t.textContent = n ? 'Lo ' + (n === 1 ? 'ha recibido 1 contacto' : 'han recibido ' + n + ' contactos') + ' con la app, con tu posición. El enlace de seguimiento también lo muestra.' : (cs.length ? 'Ninguno de tus contactos tiene la app con ese teléfono: envíales el SMS. El enlace de seguimiento ya muestra el aviso.' : 'No tienes contactos de emergencia. El enlace de seguimiento ya muestra el aviso.');
    }, function () { var t = el.querySelector('#saT'); if (t) t.textContent = 'No hay conexión para enviar el aviso. Usa el SMS o llama.'; });
    el.addEventListener('click', function (ev) { var b = ev.target.closest('[data-a]'); if (!b) return; closeAsk(); if (S.share) sb.rpc('solo_ok', { p_token: S.share.token }).then(function () {}, function () {}); });
  }

  /* ---------- vigilancia: cada 3 s mientras se graba ---------- */
  function tick() {
    var rec = A.isRec && A.isRec(), now = Date.now();
    if (!rec) { if (S.wasRec) { S.wasRec = false; S.buf = []; S.cand = null; S.alerted = false; if (S.share && !(S.ask && !S.ask.t)) endShare(); } return; }
    if (!S.wasRec) { S.wasRec = true; S.buf = []; S.cand = null; S.alerted = false; loadContacts(false); }
    var f = A.lastFix && A.lastFix(); if (!f || now - f.ts > 12000) return;
    ping(false);
    if (!S.on || (A.isDemo && A.isDemo()) || inGroup() || !Cl.user()) { S.cand = null; return; }
    if (!S.share && !S.auto && (S.contacts || []).length) { S.auto = true; ensureShare().catch(function () {}); }
    S.buf.push([now, f.lat, f.lon]); while (S.buf.length && now - S.buf[0][0] > 40000) S.buf.shift();
    var at = function (age) { var best = null; for (var i = 0; i < S.buf.length; i++) { var a = now - S.buf[i][0]; if (a >= age) best = S.buf[i]; } return best; };
    var p5 = at(5000), p8 = at(8000), p16 = at(16000);
    var vNow = p5 ? dist(p5[1], p5[2], f.lat, f.lon) / ((now - p5[0]) / 1000) : null, vBefore = p8 && p16 && p8 !== p16 ? dist(p16[1], p16[2], p8[1], p8[2]) / ((p8[0] - p16[0]) / 1000) : null;
    if (vNow != null && vNow > 4) { S.cand = null; S.alerted = false; return; }                 // en marcha
    if (!S.cand && !S.alerted && vBefore != null && vBefore >= 11 && vNow != null && vNow < 1.5) S.cand = { t: now, lat: f.lat, lon: f.lon };   // de más de 40 km/h a parado en segundos
    if (S.cand && dist(S.cand.lat, S.cand.lon, f.lat, f.lon) > 40) S.cand = null;
    if (S.cand && !S.ask && now - S.cand.t >= 40000) { S.cand = null; ask(); }
  }
  setInterval(tick, 3000);
  if (Cl.onChange) Cl.onChange(function (u) { S.contacts = null; if (u) setTimeout(function () { loadContacts(true); }, 3000); else paintBtn(); });
  window.RGSolo = { open: open, pane: pane, setOn: setOn, contacts: function () { return S.contacts || []; }, load: loadContacts, state: S, _ask: ask, _alert: alertNow, link: sendLink };
})();
