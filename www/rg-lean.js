/* ReGroupRide · margen de inclinación orientativo de la moto: aviso solo visual al acercarse y, si el dueño quiere, visible para el grupo. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A) return;
  function limit() { var v = (A.vehicles ? A.vehicles() : []).filter(function (x) { return x.principal && x.type !== 'coche'; })[0]; return v && v.leanLimit ? { deg: v.leanLimit, share: !!v.leanShare } : null; }
  var badge = document.createElement('div'); badge.className = 'lean-badge'; badge.hidden = true; document.body.appendChild(badge);
  var full = document.getElementById('leanFull'), note = null;
  if (full) { note = document.createElement('div'); note.className = 'lean-margin'; note.hidden = true; var rd = full.querySelector('.readout'); if (rd) rd.appendChild(note); }
  var lastState = '';
  setInterval(function () {
    var L = limit(), lean = A.leanNow ? A.leanNow() : null, rec = A.isRec && A.isRec(), inFull = full && !full.hidden;
    var st = '';
    if (L && lean != null && (rec || inFull)) { var r = lean / L.deg; st = r >= 1 ? 'over' : r >= 0.8 ? 'warn' : ''; }
    if (note) { note.hidden = !L; if (L) note.textContent = 'Margen orientativo de tu moto: ' + L.deg + '°'; }
    if (st !== lastState) {
      lastState = st;
      if (full) { full.classList.toggle('lean-warn', st === 'warn'); full.classList.toggle('lean-over', st === 'over'); }
      badge.className = 'lean-badge' + (st ? ' ' + st : '');
    }
    var show = !!st && rec && !inFull;
    badge.hidden = !show;
    if (show) badge.textContent = Math.round(lean) + '° · ' + (st === 'over' ? 'por encima del margen (' + L.deg + '°)' : 'cerca del margen (' + L.deg + '°)');
  }, 250);

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
