/* Pruebas de la lógica de ReGroupRide: enlaces de Google Maps y seguimiento de ruta. node tools/test-rg.js */
var L = require('../www/rg-lib.js'), assert = require('assert'), n = 0;
function t(name, f) { f(); n++; }

t('dir con coordenadas y nombres', function () {
  var r = L.parseMapsUrl('https://www.google.com/maps/dir/38.6378,-0.0428/Calp,+Alicante/Benidorm/@38.6,-0.1,11z/data=!3m1!4b1!4m20!4m19!1m3!2m2!1d-0.0428!2d38.6378!1m5!1m1!1s0x1:0x2!2m2!1d0.0445!2d38.6447!1m5!1m1!1s0x3:0x4!2m2!1d-0.1300!2d38.5400!3e0');
  assert.equal(r.points.length, 3); assert.equal(r.unresolved.length, 0); assert.equal(r.points[1].name, 'Calp, Alicante'); assert.equal(r.points[1].lat, 38.6447);
});
t('nombres con pares solo de los nombrados', function () {
  var r = L.parseMapsUrl('https://www.google.com/maps/dir/38.6378,-0.0428/Benidorm/@38.6,-0.1,11z/data=!4m9!4m8!1m0!1m5!1m1!1s0x3:0x4!2m2!1d-0.1300!2d38.5400');
  assert.equal(r.points.length, 2); assert.equal(r.points[1].lon, -0.13);
});
t('nombre sin coordenadas queda sin resolver', function () {
  var r = L.parseMapsUrl('https://www.google.com/maps/dir/38.6378,-0.0428/Benidorm/');
  assert.equal(r.points.length, 1); assert.deepEqual(r.unresolved, ['Benidorm']);
});
t('punto arrastrado se inserta en su tramo', function () {
  var r = L.parseMapsUrl('https://www.google.com/maps/dir/38.60,-0.10/38.60,-0.30/38.60,-0.50/data=!4m12!4m11!1m3!2m2!1d-0.10!2d38.60!1m5!3m4!1m2!1d-0.40!2d38.65!3s0x0:0x0!1m0!1m3!2m2!1d-0.50!2d38.60');
  assert.deepEqual(r.points.map(function (p) { return !!p.via; }), [false, false, true, false]); assert.equal(r.points[2].lon, -0.40);
});
t('formato api=1, lugar suelto, cortos y errores', function () {
  assert.equal(L.parseMapsUrl('https://www.google.com/maps/dir/?api=1&origin=38.1,-0.2&destination=38.3,-0.4&waypoints=38.2,-0.3%7C38.25,-0.35').points.length, 4);
  assert.equal(L.parseMapsUrl('Mira: https://www.google.com/maps/place/Bar+Ruta/@38.70,-0.05,17z ok').points[0].name, 'Bar Ruta');
  assert.ok(L.isShortLink('https://maps.app.goo.gl/AbCd123')); assert.equal(L.parseMapsUrl('https://maps.app.goo.gl/AbCd123').error, 'short'); assert.ok(L.parseMapsUrl('hola').error);
});

t('ruta real de 16 puntos con nombres, barras codificadas y vuelta al inicio', function () {
  var u = 'https://www.google.com/maps/dir/Estaci%C3%B3n+de+Servicio+Repsol,+Av.+Universitat,+S.N,+03009+Alicante/38.4432762,-0.638148/38.573175,-0.5898003/38.6277134,-0.5664904/38.7074659,-0.6522081/38.7834206,-0.5171418/38.7818667,-0.4275188/38.7853859,-0.3364889/38.8149182,-0.3561771/Restaurante%2FAlbergue+del+Serpis,+Les+Fontetes,+s%2Fn,+03860+L%27Orxa,+Alicante/38.827928,-0.2751228/38.7689865,-0.2721261/38.741984,-0.3154749/GASOLINERA+BENILLOBA+LEYBL,+Avinguda+d%27Alcoi,+03810+Benilloba,+Alicante/38.5624587,-0.4702267/Estaci%C3%B3n+de+Servicio+Repsol,+Av.+Universitat,+S.N,+03009+Alicante/@38.4999052,-0.519574,68418m/data=!3m1!1e3!4m38!4m37!1m5!1m1!1s0xd62369501ec889f:0x8d1c38cd99db3471!2m2!1d-0.508851!2d38.3762127!1m0!1m0!1m0!1m0!1m0!1m0!1m0!1m0!1m5!1m1!1s0xd6192c4384d3cc7:0xf5574a55a858502e!2m2!1d-0.312078!2d38.8473991!1m0!1m0!1m0!1m5!1m1!1s0xd618944f4108b7d:0xba3391eabc4d9b8!2m2!1d-0.3865755!2d38.6988919!1m0!1m5!1m1!1s0xd62369501ec889f:0x8d1c38cd99db3471!2m2!1d-0.508851!2d38.3762127!3e0?entry=ttu&g_ep=XXXX';
  var r = L.parseMapsUrl(u);
  assert.equal(r.points.length, 16); assert.equal(r.unresolved.length, 0);
  assert.equal(r.points[0].lat, 38.3762127); assert.equal(r.points[9].name.indexOf('Restaurante/Albergue del Serpis'), 0); assert.equal(r.points[9].lat, 38.8473991);
  assert.equal(r.points[13].lon, -0.3865755); assert.equal(r.points[15].lat, r.points[0].lat);
});
t('encontrar la dirección de Maps en redirecciones y páginas', function () {
  var full = 'https://www.google.com/maps/dir/38.1,-0.2/38.3,-0.4/@38.2,-0.3,12z/data=!4m2!4m1!3e0?entry=ttu';
  assert.equal(L.findMapsUrl(full), full);
  assert.equal(L.findMapsUrl('https://consent.google.com/ml?continue=' + encodeURIComponent(full) + '&gl=ES&hl=es'), full);
  assert.equal(L.findMapsUrl('<html><a href="' + full.replace(/&/g, '&amp;') + '">x</a>'), full);
  assert.equal(L.findMapsUrl('window.location="' + full.replace(/\//g, '\\/') + '";'), full);
  assert.equal(L.findMapsUrl('intent://www.google.com/maps/dir/38.1,-0.2/38.3,-0.4#Intent;scheme=https;end'), 'https://www.google.com/maps/dir/38.1,-0.2/38.3,-0.4');
  assert.equal(L.findMapsUrl('content="0;url=' + encodeURIComponent(full) + '"'), full);
  assert.equal(L.findMapsUrl('https://www.google.com/maps/api/js?x=1 nada más'), null); assert.equal(L.findMapsUrl('hola'), null);
  assert.equal(L.parseMapsUrl(L.findMapsUrl('https://consent.google.com/ml?continue=' + encodeURIComponent(full))).points.length, 2);
});

// Ruta recta hacia el este por el paralelo 38.6 (unos 35 km), con un giro a mitad.
var coords = []; for (var i = 0; i <= 40; i++) coords.push([-0.5 + i * 0.01, 38.6]);
var steps = [{ lat: 38.6, lon: -0.3, text: 'gira a la derecha', icon: 'right', name: 'CV-70' }, { lat: 38.6, lon: -0.1, text: 'has llegado al final de la ruta', icon: 'arrive', name: '' }];
function run(tr, pts, v, t0) { var out = [], now = t0 || 0; pts.forEach(function (p) { now += 1000; var r = tr.update({ lat: p[1], lon: p[0], acc: 8, v: v }, now); r.events.forEach(function (e) { out.push(e); }); out.last = r; }); out.now = now; return out; }
function seg(lon0, lon1, lat, stepM) { var o = [], d = stepM / 87000 * (lon1 > lon0 ? 1 : -1); for (var x = lon0; (d > 0 ? x <= lon1 : x >= lon1); x += d) o.push([x, lat]); return o; }

t('progreso y anuncios de giro', function () {
  var tr = L.Tracker(coords, steps), ev = run(tr, seg(-0.5, -0.29, 38.6, 20), 20);
  var says = ev.filter(function (e) { return e.type === 'say'; }).map(function (e) { return e.text; });
  assert.equal(ev[0].type, 'start'); assert.equal(says.length, 2, says.join(' | '));
  assert.ok(/^En \d+ metros, gira a la derecha$/.test(says[0]), says[0]); assert.equal(says[1], 'Gira a la derecha');
  assert.ok(ev.last.next && ev.last.next.icon === 'arrive'); assert.ok(Math.abs(ev.last.remaining - 87000 * 0.19) < 600, ev.last.remaining);
});
t('pasarse una salida avisa una vez y vuelve al regresar', function () {
  var tr = L.Tracker(coords, steps), ev = run(tr, seg(-0.5, -0.45, 38.6, 20), 20);
  var off = []; for (var k = 1; k <= 30; k++) off.push([-0.45 + k * 0.00023, 38.6 + k * 0.00018]);   // se va desviando al noreste
  var e2 = run(tr, off, 20, ev.now);
  assert.equal(e2.filter(function (e) { return e.type === 'off'; }).length, 1); assert.ok(e2.last.offRoute);
  var e3 = run(tr, seg(-0.44, -0.42, 38.6, 20), 20, e2.now);
  assert.equal(e3.filter(function (e) { return e.type === 'back'; }).length, 1); assert.ok(!e3.last.offRoute);
});
t('parado fuera de la ruta (gasolinera) no avisa; antes de empezar tampoco', function () {
  var tr = L.Tracker(coords, steps), ev = run(tr, seg(-0.5, -0.45, 38.6, 20), 20);
  var stopped = []; for (var k = 0; k < 40; k++) stopped.push([-0.45, 38.6012]);
  assert.equal(run(tr, stopped, 0, ev.now).filter(function (e) { return e.type === 'off'; }).length, 0);
  var tr2 = L.Tracker(coords, steps), far = []; for (k = 0; k < 40; k++) far.push([-0.6 + k * 0.0002, 38.7]);
  assert.equal(run(tr2, far, 20).filter(function (e) { return e.type === 'off'; }).length, 0);
});
t('ida y vuelta por la misma carretera no salta de sentido', function () {
  var out = seg(-0.5, -0.4, 38.6, 100), loop = out.concat(out.slice(0, -1).reverse()), tr = L.Tracker(loop, []);
  var ev = run(tr, seg(-0.5, -0.4, 38.6, 20).concat(seg(-0.4, -0.45, 38.6, 20)), 20);
  assert.ok(ev.last.along > tr.line.total * 0.7, ev.last.along + ' de ' + tr.line.total);
});
t('ruta circular: al salir no se da por terminada y acaba al volver', function () {
  var sq = seg(-0.5, -0.45, 38.6, 100); var up = []; for (var y = 38.6; y <= 38.63; y += 0.001) up.push([-0.45, y]);
  var back = seg(-0.45, -0.5, 38.63, 100), down = []; for (y = 38.63; y >= 38.6; y -= 0.001) down.push([-0.5, y]);
  var loop = sq.concat(up, back, down, [[-0.5, 38.6]]), tr = L.Tracker(loop, []);
  var ev = run(tr, [[-0.50002, 38.60003], [-0.5001, 38.59995], [-0.4998, 38.60001], [-0.4995, 38.6]], 5);
  assert.ok(!ev.last.finished && ev.last.along < 300, 'along ' + ev.last.along);
  var e2 = run(tr, sq.concat(up, back, down), 25, ev.now);
  assert.ok(e2.last.finished, 'restan ' + e2.last.remaining); assert.equal(e2.filter(function (e) { return e.type === 'off'; }).length, 0);
});
t('fin de ruta y punto de reenganche por delante', function () {
  var tr = L.Tracker(coords, steps), ev = run(tr, seg(-0.5, -0.1, 38.6, 40), 25);
  assert.equal(ev.filter(function (e) { return e.type === 'finish'; }).length, 1);
  var rj = L.rejoinTarget({ lat: 38.62, lon: -0.35 }, L.makeLine(coords), 0);
  assert.ok(rj.off > 2000 && rj.lon > -0.33 && !rj.finished, JSON.stringify(rj));
  assert.ok(L.rejoinTarget({ lat: 38.6, lon: -0.35 }, L.makeLine(coords), 0).off < 5);
});
t('pasos de OSRM a indicaciones', function () {
  var route = { legs: [{ steps: [
    { name: 'A', maneuver: { type: 'depart', location: [0, 0] } },
    { name: 'B', maneuver: { type: 'new name', modifier: 'straight', location: [0, 0] } },
    { name: 'CV-70', maneuver: { type: 'turn', modifier: 'left', location: [-0.3, 38.6] } },
    { name: '', maneuver: { type: 'roundabout', exit: 2, location: [-0.2, 38.6] } },
    { name: '', maneuver: { type: 'exit roundabout', location: [-0.2, 38.6] } },
    { name: '', maneuver: { type: 'arrive', location: [-0.1, 38.6] } }] }] };
  var s = L.stepsFromOsrm(route);
  assert.deepEqual(s.map(function (x) { return x.text; }), ['gira a la izquierda', 'en la rotonda, toma la segunda salida', 'has llegado al final de la ruta']);
  assert.equal(L.fmtDist(1234), '1,2 km'); assert.equal(L.fmtDist(340), '350 m'); assert.equal(L.spokenDist(320), '300 metros');
});
console.log('rg-lib: ' + n + ' pruebas correctas');
