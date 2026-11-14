import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), isErr ? 4500 : 2600);
}

export async function busy(btn, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}

export function topbar(title, backHref) {
  return `<div class="topbar">${backHref ? `<button class="back" onclick="history.length > 1 ? history.back() : (location.hash='${backHref}')" aria-label="Atrás">&#8249;</button>` : ''}<h1>${esc(title)}</h1></div>`;
}

export const ICONS = {
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="5" r="2.2"/><path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  road: '<svg viewBox="0 0 24 24" fill="#0b2316"><path d="M9.6 3h4.8l5.6 18H4z"/><g fill="#2ecc71"><rect x="11.3" y="6" width="1.4" height="2.6"/><rect x="11.3" y="10.6" width="1.4" height="3"/><rect x="11.3" y="15.8" width="1.4" height="3.4"/></g></svg>',
};

// ---------- Mapas ----------
export function makeMap(el, { interactive = true } = {}) {
  const map = L.map(el, { zoomControl: false, attributionControl: true, tap: true, dragging: interactive, scrollWheelZoom: interactive })
    .setView([38.64, -0.05], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}

export function pinIcon(kind, label = '') {
  const cls = kind === 'start' ? 'start' : kind === 'end' ? 'end' : kind === 'via' ? 'via' : kind === 'me' ? 'me' : '';
  const size = kind === 'via' ? 16 : kind === 'me' ? 20 : 30;
  return L.divIcon({ className: '', html: `<div class="pin ${cls}">${kind === 'via' || kind === 'me' ? '' : esc(label)}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

export function pinLabel(points, i) {
  const p = points[i];
  if (p.kind === 'start') return 'S';
  if (p.kind === 'end') return 'F';
  let n = 0;
  for (let k = 0; k <= i; k++) if (points[k].kind === 'stop') n++;
  return String(n);
}

export function drawRoute(map, { line, points, fit = true, layer }) {
  const group = layer || L.layerGroup().addTo(map);
  group.clearLayers();
  if (line?.length > 1) {
    L.polyline(line.map((p) => [p.lat, p.lng]), { color: '#0b2316', weight: 9, opacity: 0.5 }).addTo(group);
    L.polyline(line.map((p) => [p.lat, p.lng]), { color: '#2ecc71', weight: 5 }).addTo(group);
  }
  (points || []).forEach((p, i) => L.marker([p.lat, p.lng], { icon: pinIcon(p.kind, pinLabel(points, i)), keyboard: false }).addTo(group));
  if (fit) {
    const all = [...(line || []), ...(points || [])].map((p) => [p.lat, p.lng]);
    if (all.length > 1) map.fitBounds(all, { padding: [28, 28] });
    else if (all.length === 1) map.setView(all[0], 14);
  }
  return group;
}

export { L };
