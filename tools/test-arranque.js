// Arranque del inclinómetro: tiene que marcar desde que se abre la app.
// 1) Sin referencia y con el móvil en la mano (tiembla): listo en menos de medio segundo.
// 2) Referencia guardada y moto parada inclinada 12° (pata de cabra): marca 12° en la primera muestra, no sube desde 0.
// 3) Referencia guardada de otra postura del móvil (40° distinta): parado, se corrige sola en unos 3 s.
// 4) Parada 10 s inclinada 12° con referencia buena: no se pone a cero.
// 5) La app vuelve de segundo plano con la moto en otra inclinación: marca bien al instante.
const LeanCore = require('../www/lean-core.js');
const G = LeanCore.G, D2R = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function axes(tiltDeg, yawDeg) {
  const t = tiltDeg * D2R, y = yawDeg * D2R;
  return { X: [Math.sin(y), -Math.cos(y), 0], Y: [Math.sin(t) * Math.cos(y), Math.sin(t) * Math.sin(y), Math.cos(t)], Z: [-Math.cos(t) * Math.cos(y), -Math.cos(t) * Math.sin(y), Math.sin(t)] };
}
let seedN = 7; const rnd = () => { seedN = (seedN * 16807) % 2147483647; return seedN / 2147483647; };
const noise = s => (rnd() - 0.5) * 2 * s;
const mount = axes(35, 6), toPhone = (A, b) => [dot(b, A.X), dot(b, A.Y), dot(b, A.Z)];
const still = (A, lean) => toPhone(A, [0, G * Math.sin(lean * D2R), G * Math.cos(lean * D2R)]);
const goodFrame = () => LeanCore.buildFrame(toPhone(mount, [0, 0, G]));
// alimenta "dur" segundos de móvil parado con una inclinación dada; devuelve [t, phi, ready] de cada muestra
function feed(est, A, lean, dur, o) {
  o = o || {}; const hz = o.hz || 200, dt = 1 / hz, out = []; let t = o.t0 || 0;
  for (let i = 0; i < Math.round(dur * hz); i++) {
    const acc = still(A, lean).map(x => x + noise(o.accN == null ? 0.05 : o.accN)), rot = [0, 0, 0].map(() => noise(o.rotN == null ? 0.3 : o.rotN) + 0.3);
    if (o.gps) est.setSpeed(0, t * 1000);
    const first = i === 0 && o.gap != null, s = est.update(acc, rot, i === 0 ? (o.gap != null ? o.gap : 0) : dt, t * 1000);
    out.push([t - (o.t0 || 0), s.phi, s.ready]); t += dt;
  }
  return out;
}
const results = [];
function check(name, ok, detail) { results.push(!!ok); console.log((ok ? 'OK    ' : 'FALLO ') + name.padEnd(58) + '  ' + detail); }

// 1
(function () {
  const est = LeanCore.createEstimator(), kinds = []; est.setOnFrame(f => kinds.push(f.kind));
  const o = feed(est, mount, 0, 2, { accN: 0.9, rotN: 8 }), at = o.find(x => x[2]);
  check('sin referencia, móvil en la mano', !!at && at[0] <= 0.5 && kinds[0] === 'auto-quick', at ? 'listo a los ' + Math.round(at[0] * 1000) + ' ms (' + kinds.join(' → ') + ')' : 'no llegó a estar listo');
})();
// 1b: quieto en el soporte, la provisional se afina en reposo
(function () {
  const est = LeanCore.createEstimator(), kinds = []; est.setOnFrame(f => kinds.push(f.kind));
  const o = feed(est, mount, 0, 3), at = o.find(x => x[2]);
  check('sin referencia, quieto en el soporte', !!at && at[0] <= 0.5 && kinds.join() === 'auto-quick,auto-still', 'listo a los ' + (at ? Math.round(at[0] * 1000) : '—') + ' ms (' + kinds.join(' → ') + ')');
})();
// 2
(function () {
  const est = LeanCore.createEstimator(); est.setFrame(goodFrame(), [0.3, 0.3, 0.3], 'auto-ride');
  const o = feed(est, mount, 12, 1), a = o[1][1], b = o[o.length - 1][1];
  check('referencia guardada, parada a 12°: primera lectura', Math.abs(a - 12) < 1.5 && Math.abs(b - 12) < 1, 'muestra 2: ' + a.toFixed(1) + '° · tras 1 s: ' + b.toFixed(1) + '°');
})();
// 3
(function () {
  const est = LeanCore.createEstimator(); let at = null, tNow = 0; est.setOnFrame(f => { if (at == null) at = [tNow, f.kind]; });
  est.setFrame(LeanCore.buildFrame(still(mount, 40)), [0, 0, 0], 'auto-ride'); // referencia tomada con el móvil 40° ladeado
  let start = null, end = null;
  for (let k = 0; k < 50; k++) { const o = feed(est, mount, 0, 0.1, { gps: true, t0: k * 0.1, gap: k ? 0.005 : null }); tNow = (k + 1) * 0.1; if (k === 5) start = o[0][1]; end = o[o.length - 1][1]; }
  check('referencia de otra postura (40° ladeada), parado', Math.abs(start) > 30 && at && at[1] === 'auto-still' && at[0] <= 3.6 && Math.abs(end) < 1, 'marcaba ' + start.toFixed(0) + '° · corregida a los ' + (at ? at[0].toFixed(1) : '—') + ' s · final ' + end.toFixed(1) + '°');
})();
// 4
(function () {
  const est = LeanCore.createEstimator(), kinds = []; est.setOnFrame(f => kinds.push(f.kind));
  est.setFrame(goodFrame(), [0.3, 0.3, 0.3], 'auto-ride');
  const o = feed(est, mount, 12, 10, { gps: true }), end = o[o.length - 1][1];
  check('parada 10 s a 12° con referencia buena: no se pone a cero', kinds.length === 0 && Math.abs(end - 12) < 1, 'final ' + end.toFixed(1) + '° · cambios de referencia: ' + (kinds.join(', ') || 'ninguno'));
})();
// 5
(function () {
  const est = LeanCore.createEstimator(); est.setFrame(goodFrame(), [0.3, 0.3, 0.3], 'auto-ride');
  feed(est, mount, 0, 2);
  const o = feed(est, mount, -10, 0.5, { t0: 62, gap: 60 }), a = o[1][1];
  check('vuelve de segundo plano con otra inclinación', Math.abs(a + 10) < 1.5, 'muestra 2 tras volver: ' + a.toFixed(1) + '°');
})();
// 6: a 50 Hz (navegador) también arranca rápido
(function () {
  const est = LeanCore.createEstimator(); const o = feed(est, mount, 0, 2, { hz: 50 }), at = o.find(x => x[2]);
  check('sin referencia a 50 muestras/s', !!at && at[0] <= 0.5, 'listo a los ' + (at ? Math.round(at[0] * 1000) : '—') + ' ms');
})();

// ---- Vertical medida en marcha: que el cero tomado en parado (pata de cabra, cuesta) no estropee nada ----
// tramos: [segundos, km/h, inclinación real, pendiente]. Devuelve el error |medido − real| por instante.
function ride(est, A, plan, t0) {
  const dt = 1 / 100, out = []; let t = t0 || 0, phi = plan[0][2], v = plan[0][1] / 3.6;
  for (const [dur, vKmh, target, slope] of plan) {
    for (let i = 0; i < Math.round(dur / dt); i++) {
      const prev = phi; phi += (target - phi) * Math.min(1, dt / 0.5); v += (vKmh / 3.6 - v) * Math.min(1, dt / 1.2);
      const p = (phi - prev) / dt, r = v > 0.5 ? -(G * Math.tan(phi * D2R) / v) / D2R : 0, sl = (slope || 0) * D2R;
      const aBody = v > 0.5 ? [G * Math.sin(sl), 0, G * Math.cos(sl) / Math.cos(phi * D2R)] : [G * Math.sin(sl), G * Math.sin(phi * D2R) * Math.cos(sl), G * Math.cos(phi * D2R) * Math.cos(sl)];
      const acc = toPhone(A, aBody).map(x => x + noise(0.4)), rot = toPhone(A, [p, 0, r]).map(x => x + noise(1.5) + 0.3);
      if (Math.floor(t) !== Math.floor(t - dt)) est.setSpeed(v, t * 1000 - 600);   // GPS a 1 Hz, con retraso
      const s = est.update(acc, rot, dt, t * 1000);
      out.push({ t: t - (t0 || 0), v: v * 3.6, err: Math.abs(s.phi - phi), phi: s.phi, real: phi, confirmed: s.confirmed, kind: s.frameKind }); t += dt;
    }
  }
  return out;
}
const worstAfter = (o, t) => Math.max(...o.filter(x => x.t >= t).map(x => x.err));
// 7) aparcada en la pata de cabra (12° a la izquierda) y cuesta arriba del 10 %: sale y entra directa en una curva
(function () {
  const est = LeanCore.createEstimator(), kinds = []; est.setOnFrame(f => kinds.push(f.kind));
  const o = ride(est, mount, [[4, 0, -12, 6], [1, 0, 0, 6], [3, 40, 0, 6], [5, 40, 25, 0], [7, 40, 0, 0], [3, 60, -30, 0], [5, 60, -30, 0]]);
  const parked = o.find(x => x.t > 3.5).phi, moving = o.find(x => x.v >= 16), conf = o.find(x => x.confirmed), w = worstAfter(o, conf ? conf.t + 0.5 : 99);
  const wFlat = worstAfter(o, 23.5);   // curva mantenida tras la primera recta en llano
  check('pata de cabra y cuesta: vertical buena al poco de arrancar', conf && conf.t - moving.t < 3 && w < 4 && wFlat < 2.5 && kinds[kinds.length - 1] === 'auto-ride',
    'en parado marcaba ' + parked.toFixed(1) + '° (provisional) · confirmada ' + (conf ? (conf.t - moving.t).toFixed(1) : '—') + ' s después de pasar de 16 km/h · error máx después: ' + w.toFixed(1) + '° (en cuesta) y ' + wFlat.toFixed(1) + '° (ya en llano) (' + kinds.join(' → ') + ')');
})();
// 8) la referencia guardada es buena y el móvil está donde siempre: se confirma sin tocarla
(function () {
  const est = LeanCore.createEstimator(), kinds = []; est.setOnFrame(f => kinds.push(f.kind)); est.setFrame(goodFrame(), [0.3, 0.3, 0.3], 'auto-ride');
  const o = ride(est, mount, [[3, 0, -12, 0], [1, 0, 0, 0], [3, 40, 0, 0], [5, 50, 28, 0], [3, 50, 0, 0]]), conf = o.find(x => x.confirmed), w = worstAfter(o, 4.5);
  check('referencia guardada buena: se confirma y no se toca', conf && kinds.length === 0 && w < 2.5, 'cambios de referencia: ' + (kinds.join(', ') || 'ninguno') + ' · error máx en marcha: ' + w.toFixed(1) + '°');
})();
// 9) referencia guardada con el soporte movido 8°: se corrige al arrancar, aunque sea en plena curva
(function () {
  const est = LeanCore.createEstimator(), kinds = []; est.setOnFrame(f => kinds.push(f.kind)); est.setFrame(LeanCore.buildFrame(still(mount, 8)), [0.3, 0.3, 0.3], 'auto-ride');
  const o = ride(est, mount, [[2, 0, 0, 0], [2, 35, 20, 0], [5, 35, 20, 0], [3, 35, 0, 0]]), moving = o.find(x => x.v >= 16), conf = o.find(x => x.confirmed), w = worstAfter(o, conf ? conf.t + 0.5 : 99);
  check('soporte movido 8° desde la última vez: corregido al arrancar en curva', conf && conf.t - moving.t < 3 && w < 3 && kinds.join() === 'auto-ride', 'confirmada ' + (conf ? (conf.t - moving.t).toFixed(1) : '—') + ' s después de pasar de 16 km/h · error máx después: ' + w.toFixed(1) + '°');
})();
const all = results.every(Boolean); console.log(all ? '\nOK' : '\nFALLO'); process.exit(all ? 0 : 1);
