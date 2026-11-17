/* ReGroupRide · tiempo real entre personas.
   Usa los canales en directo de Supabase (Realtime, «broadcast»), que ya vienen en la librería: no hace falta tocar el
   servidor. Funciona mientras la app está abierta o en segundo plano (y siempre durante una ruta, porque el servicio de
   la ruta la mantiene viva). Con la app cerrada del todo avisa el propio teléfono (EventNotices, cada minuto).

   Los mensajes son solo «timbres»: dicen QUÉ ha pasado ({kind, cid, id…}), nunca el contenido. Quien lo recibe pide los
   datos al servidor con su sesión, así que nadie ve nada que no pudiera ver ya.

   Canales:
     rg-c-<comunidad>  evento nuevo o cambiado, mensaje del tablón, página de info, alguien se apunta o se va, empieza una ruta
     rg-r-<grupo>      dentro de una ruta en grupo: empieza, aviso, aviso visto, reparto en grupos, administradores, se termina */
(function () {
  'use strict';
  var Cl = window.RGCloud, sb = Cl && Cl.sb;
  var noop = function () {};
  if (!sb || !sb.channel) { window.RGLive = { only: noop, send: noop, join: noop, leave: noop, ok: false }; return; }
  var chans = {}, fns = {};

  function join(topic, fn) {
    fns[topic] = fn;
    if (chans[topic]) return;
    var ch = sb.channel(topic, { config: { broadcast: { self: false, ack: false } } });
    ch.on('broadcast', { event: 'ping' }, function (m) { var f = fns[topic]; if (f) { try { f((m && m.payload) || {}, topic); } catch (e) { console.warn('live', e); } } });
    ch.subscribe();
    chans[topic] = ch;
  }
  function leave(topic) {
    var ch = chans[topic]; delete chans[topic]; delete fns[topic];
    if (ch) { try { sb.removeChannel(ch); } catch (e) {} }
  }
  // Deja abiertos exactamente estos canales del prefijo dado (los demás de ese prefijo se cierran).
  function only(prefix, topics, fn) {
    Object.keys(chans).forEach(function (t) { if (t.indexOf(prefix) === 0 && topics.indexOf(t) < 0) leave(t); });
    topics.forEach(function (t) { join(t, fn); });
  }
  // Toca el timbre. Si el canal no está abierto, la librería lo manda por la web (sin abrirlo).
  function send(topic, payload) {
    var ch = chans[topic], tmp = false;
    try {
      if (!ch) { ch = sb.channel(topic, { config: { broadcast: { self: false } } }); tmp = true; }
      var p = ch.send({ type: 'broadcast', event: 'ping', payload: payload || {} });
      var end = function () { if (tmp) { try { sb.removeChannel(ch); } catch (e) {} } };
      if (p && p.then) p.then(end, end); else end();
    } catch (e) { console.warn('live send', e); }
  }
  // Al volver la conexión, la librería reabre los canales sola. Al cerrar sesión, fuera todos.
  if (Cl.onChange) Cl.onChange(function (u) { if (!u) Object.keys(chans).forEach(leave); });

  window.RGLive = { only: only, send: send, join: join, leave: leave, ok: true, open: function () { return Object.keys(chans); },
    // para las pruebas: como si llegara un timbre
    emit: function (t, p) { var f = fns[t]; if (f) f(p || {}, t); } };
})();
