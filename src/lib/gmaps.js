// Lee enlaces de Google Maps y saca los puntos de la ruta. Sin dependencias.
// Formatos admitidos:
//   https://www.google.com/maps/dir/A/B/C/@lat,lng,z/data=...   (el que se copia del navegador o de la app)
//   https://www.google.com/maps/dir/?api=1&origin=..&destination=..&waypoints=a|b
//   https://www.google.com/maps/place/Nombre/@lat,lng,z   y   ?q=lat,lng   (un solo punto)
// Los enlaces cortos (maps.app.goo.gl) hay que expandirlos antes (ver expandShortLink en services).

import { insertByDetour } from './geo.js';

const COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const num = (s) => Number.parseFloat(s);
const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export function isShortLink(url) {
  return /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(String(url).trim());
}

export function extractUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : null;
}

function decodeSeg(s) {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')).trim(); } catch { return s.replace(/\+/g, ' ').trim(); }
}

function parseCoordText(s) {
  const m = String(s || '').match(COORD);
  if (!m) return null;
  const lat = num(m[1]), lng = num(m[2]);
  return valid(lat, lng) ? { lat, lng } : null;
}

function withKinds(points) {
  return points.map((p, i) => ({
    ...p,
    kind: p.kind === 'via' ? 'via' : i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'stop',
  }));
}

/** Devuelve { points: [{lat,lng,name,kind}], unresolved: [nombres], error? } */
export function parseGoogleMapsUrl(input) {
  const raw = extractUrl(input) || String(input || '').trim();
  let u;
  try { u = new URL(raw); } catch { return { points: [], unresolved: [], error: 'No parece un enlace válido.' }; }
  if (!/google\.[a-z.]+$/i.test(u.hostname) && !/^maps\.google\./i.test(u.hostname)) {
    if (isShortLink(raw)) return { points: [], unresolved: [], error: 'short' };
    return { points: [], unresolved: [], error: 'El enlace no es de Google Maps.' };
  }

  // 1) Formato con parámetros api=1
  const qp = u.searchParams;
  if (qp.get('api') === '1' && (qp.get('destination') || qp.get('origin'))) {
    const names = [qp.get('origin'), ...(qp.get('waypoints') || '').split('|'), qp.get('destination')]
      .filter((x) => x && x.trim());
    const points = [], unresolved = [];
    for (const n of names) {
      const c = parseCoordText(n);
      if (c) points.push({ ...c, name: '' }); else unresolved.push(n);
    }
    return { points: withKinds(points), unresolved };
  }

  // 2) /maps/dir/A/B/C/@.../data=...
  const path = u.pathname;
  const dirIdx = path.indexOf('/dir/');
  if (dirIdx >= 0) {
    const after = path.slice(dirIdx + 5);
    const segs = [];
    for (const s of after.split('/')) {
      if (s.startsWith('@') || s.startsWith('data=') || s.startsWith('am=')) break;
      segs.push(decodeSeg(s));
    }
    const dataPart = (path.match(/\/data=([^/?#]+)/) || [])[1] || '';
    // Pares de lugar: !2m2!1d<lng>!2d<lat>. Pares de paso arrastrado (via): !1m2!1d<lng>!2d<lat>.
    const placePairs = [...dataPart.matchAll(/!2m2!1d(-?[\d.]+)!2d(-?[\d.]+)/g)].map((m) => ({ lat: num(m[2]), lng: num(m[1]) }));
    const viaPairs = [...dataPart.matchAll(/!3m4!1m2!1d(-?[\d.]+)!2d(-?[\d.]+)/g)].map((m) => ({ lat: num(m[2]), lng: num(m[1]) }));

    const nonEmpty = segs.map((s, i) => ({ s, i })).filter((x) => x.s !== '');
    const named = nonEmpty.filter((x) => !parseCoordText(x.s));
    const points = [], unresolved = [];
    let usePairsForAll = placePairs.length === nonEmpty.length;
    let pi = 0;
    for (const { s } of nonEmpty) {
      const c = parseCoordText(s);
      if (usePairsForAll) {
        const p = placePairs[pi++];
        points.push({ ...p, name: c ? '' : s });
      } else if (c) {
        points.push({ ...c, name: '' });
      } else if (placePairs.length >= named.length && pi < placePairs.length) {
        points.push({ ...placePairs[pi++], name: s });
      } else {
        unresolved.push(s);
      }
    }
    let result = withKinds(points);
    for (const v of viaPairs) {
      if (!valid(v.lat, v.lng)) continue;
      result = insertByDetour(result, { ...v, name: '', kind: 'via' });
    }
    result = withKinds(result);
    if (!result.length && !unresolved.length) return { points: [], unresolved: [], error: 'El enlace no tiene puntos de ruta.' };
    return { points: result, unresolved };
  }

  // 3) Un solo punto: ?q=lat,lng  o  /place/.../@lat,lng
  const q = parseCoordText(qp.get('q') || qp.get('query') || '');
  if (q) return { points: withKinds([{ ...q, name: '' }]), unresolved: [] };
  const at = path.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) {
    const name = (path.match(/\/place\/([^/]+)/) || [])[1];
    return { points: withKinds([{ lat: num(at[1]), lng: num(at[2]), name: name ? decodeSeg(name) : '' }]), unresolved: [] };
  }
  return { points: [], unresolved: [], error: 'No he encontrado puntos en el enlace.' };
}
