import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleMapsUrl, isShortLink, extractUrl } from '../src/lib/gmaps.js';

test('dir con coordenadas y nombres (pares en data para todos)', () => {
  const url = 'https://www.google.com/maps/dir/38.6378,-0.0428/Calp,+Alicante/Benidorm/@38.6,-0.1,11z/data=!3m1!4b1!4m20!4m19!1m3!2m2!1d-0.0428!2d38.6378!1m5!1m1!1s0x1:0x2!2m2!1d0.0445!2d38.6447!1m5!1m1!1s0x3:0x4!2m2!1d-0.1300!2d38.5400!3e0';
  const r = parseGoogleMapsUrl(url);
  assert.equal(r.points.length, 3);
  assert.deepEqual(r.unresolved, []);
  assert.equal(r.points[1].name, 'Calp, Alicante');
  assert.equal(r.points[1].lat, 38.6447);
  assert.equal(r.points[0].kind, 'start');
  assert.equal(r.points[2].kind, 'end');
});

test('dir con nombres y solo pares de los nombrados', () => {
  const url = 'https://www.google.com/maps/dir/38.6378,-0.0428/Benidorm/@38.6,-0.1,11z/data=!4m9!4m8!1m0!1m5!1m1!1s0x3:0x4!2m2!1d-0.1300!2d38.5400';
  const r = parseGoogleMapsUrl(url);
  assert.equal(r.points.length, 2);
  assert.equal(r.points[1].name, 'Benidorm');
  assert.equal(r.points[1].lng, -0.13);
});

test('punto arrastrado (via) se inserta en su tramo', () => {
  const url = 'https://www.google.com/maps/dir/38.60,-0.10/38.60,-0.30/38.60,-0.50/data=!4m12!4m11!1m3!2m2!1d-0.10!2d38.60!1m5!3m4!1m2!1d-0.40!2d38.65!3s0x0:0x0!1m0!1m3!2m2!1d-0.50!2d38.60';
  const r = parseGoogleMapsUrl(url);
  const kinds = r.points.map((p) => p.kind);
  assert.deepEqual(kinds, ['start', 'stop', 'via', 'end']);
  assert.equal(r.points[2].lng, -0.40);
});

test('formato api=1', () => {
  const r = parseGoogleMapsUrl('https://www.google.com/maps/dir/?api=1&origin=38.1,-0.2&destination=38.3,-0.4&waypoints=38.2,-0.3%7C38.25,-0.35');
  assert.equal(r.points.length, 4);
  assert.equal(r.points[3].kind, 'end');
});

test('lugar suelto y texto con enlace dentro', () => {
  const r = parseGoogleMapsUrl('Mira: https://www.google.com/maps/place/Bar+Ratoners/@38.70,-0.05,17z más texto');
  assert.equal(r.points.length, 1);
  assert.equal(r.points[0].name, 'Bar Ratoners');
});

test('enlaces cortos y errores', () => {
  assert.ok(isShortLink('https://maps.app.goo.gl/AbCd123'));
  assert.equal(parseGoogleMapsUrl('https://maps.app.goo.gl/AbCd123').error, 'short');
  assert.ok(parseGoogleMapsUrl('hola').error);
  assert.equal(extractUrl('ruta: https://x.y/z ok'), 'https://x.y/z');
});
