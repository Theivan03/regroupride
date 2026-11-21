/* ReGroupRide · margen de inclinación orientativo de la moto: aviso solo visual al acercarse y, si el dueño quiere, visible para el grupo. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A) return;
  function limit() { var v = (A.vehicles ? A.vehicles() : []).filter(function (x) { return x.principal && x.type !== 'coche'; })[0]; return v && v.leanLimit ? { deg: v.leanLimit, share: !!v.leanShare } : null; }
  // Aviso solo visual y solo en el propio indicador: la línea que se inclina (aguja y arco) se pone naranja al acercarse
  // al margen (80 %) y parpadea en rojo cuando falta un 10 % o menos para alcanzarlo.
  var full = document.getElementById('leanFull'), gauges = [document.getElementById('gaugeFull'), document.getElementById('gaugeMini')].filter(Boolean), note = null;
  if (full) { note = document.createElement('div'); note.className = 'lean-margin'; note.hidden = true; var rd = full.querySelector('.readout'); if (rd) rd.appendChild(note); }
  var lastState = null;
  setInterval(function () {
    var L = limit(), lean = A.leanNow ? A.leanNow() : null, st = '';
    if (L && lean != null) { var r = lean / L.deg; st = r >= 0.9 ? 'over' : r >= 0.8 ? 'warn' : ''; }
    if (note) { note.hidden = !L; if (L) note.textContent = 'Margen orientativo de tu moto: ' + L.deg + '°'; }
    if (st === lastState) return; lastState = st;
    gauges.forEach(function (g) { g.classList.toggle('lean-warn', st === 'warn'); g.classList.toggle('lean-over', st === 'over'); });
  }, 200);

  // Compartir el margen con el grupo: solo si el dueño lo ha marcado en su moto principal (por defecto, no).
  var sent;
  function share() {
    if (!Cl || !Cl.sb || !Cl.user) return; var u = Cl.user(); if (!u) return;
    var L = limit(), val = L && L.share ? L.deg : null, key = u.id + '|' + val;
    if (key === sent) return;
    Cl.sb.from('profiles').update({ lean_limit: val }).eq('id', u.id).then(function (r) { if (!r.error) sent = key; }, function () {});
  }
  setTimeout(share, 8000); setInterval(share, 20000);
})();
