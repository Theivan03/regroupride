import test from 'node:test';
import assert from 'node:assert/strict';
import { distance, rejoinPlan, simplify, cumulative, projectOnLine } from '../src/lib/geo.js';
import { legsFor, MAX_WAYPOINTS } from '../src/lib/mapsLaunch.js';

// Ruta recta hacia el este a lo largo del paralelo 38.6, unos 35 km.
const line = Array.from({ length: 41 }, (_, i) => ({ lat: 38.6, lng: -0.5 + i * 0.01 }));
const wps = [
  { ...line[0], kind: 'start' }, { ...line[10], kind: 'stop' }, { ...line[25], kind: 'stop' }, { ...line[40], kind: 'end' },
];

test('distancia aproximada', () => {
  const d = distance({ lat: 38.6, lng: 0 }, { lat: 38.6, lng: 0.01 });
  assert.ok(d > 860 && d < 880, d);
});

test('reenganche: en la ruta, el objetivo es tu posición y quedan los puntos de delante', () => {
  const p = rejoinPlan({ lat: 38.6, lng: -0.35 }, line, wps);
  assert.ok(p.offRouteMeters < 5);
  assert.equal(p.remaining.length, 2);
});

test('reenganche: fuera de ruta, el objetivo queda por delante', () => {
  const pos = { lat: 38.62, lng: -0.35 }; // unos 2,2 km al norte
  const p = rejoinPlan(pos, line, wps);
  assert.ok(p.offRouteMeters > 2000);
  assert.ok(p.target.lng > -0.35 + 0.02, 'el objetivo debe estar al este, por delante');
  assert.ok(p.remaining.every((w) => w.lng > p.target.lng));
});

test('reenganche: con progreso, no vuelve al principio en ida y vuelta', () => {
  const out = Array.from({ length: 11 }, (_, i) => ({ lat: 38.6, lng: -0.5 + i * 0.01 }));
  const back = out.slice(0, -1).reverse().map((p) => ({ ...p, lat: 38.6001 }));
  const loop = [...out, ...back];
  const w = [{ ...loop[0], kind: 'start' }, { ...loop[10], kind: 'stop' }, { ...loop[20], kind: 'end' }];
  const total = cumulative(loop).at(-1);
  const p = rejoinPlan({ lat: 38.6001, lng: -0.47 }, loop, w, total * 0.75);
  assert.ok(p.progressAlong > total * 0.6, 'debe situarse en la vuelta');
});

test('final de ruta', () => {
  const p = rejoinPlan({ lat: 38.6, lng: -0.1 }, line, wps);
  assert.ok(p.finished);
});

test('simplificar mantiene extremos y reduce puntos en recta', () => {
  const s = simplify(line, 10);
  assert.equal(s.length, 2);
});

test('proyección', () => {
  const r = projectOnLine({ lat: 38.601, lng: -0.455 }, line);
  assert.ok(r.dist > 100 && r.dist < 120);
});

test('tramos de Google Maps con 9 intermedios como máximo', () => {
  const pts = Array.from({ length: 23 }, (_, i) => ({ lat: 38 + i / 100, lng: -0.1 }));
  const legs = legsFor(pts);
  assert.equal(legs.length, 3);
  for (const l of legs) {
    const wp = new URL(l.url).searchParams.get('waypoints');
    assert.ok(!wp || wp.split('|').length <= MAX_WAYPOINTS);
  }
  assert.equal(new URL(legs[0].url).searchParams.get('origin'), null);
  assert.equal(new URL(legs[1].url).searchParams.get('origin'), new URL(legs[0].url).searchParams.get('destination'));
  assert.equal(legs.at(-1).to, 22);
});
