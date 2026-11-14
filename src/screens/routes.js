import { $, $$, esc, toast, busy, topbar, makeMap, drawRoute, pinIcon, pinLabel, L } from '../ui.js';
import { myRoutes, publicRoutes, getRoute, saveRoute, deleteRoute, getPosition, expandShortLink, errText } from '../services.js';
import { parseGoogleMapsUrl, isShortLink, extractUrl } from '../lib/gmaps.js';
import { routeThrough } from '../lib/routing.js';
import { rejoinPlan, formatKm, formatDuration, distance } from '../lib/geo.js';
import { legsFor, openExternal } from '../lib/mapsLaunch.js';
import { activeRide, startRide, endRide, follow } from '../ride.js';
import { Clipboard } from '@capacitor/clipboard';

async function readClipboard() {
  const r = await Clipboard.read();
  return r.value || '';
}

const VIS = { private: 'Privada', community: 'Mi comunidad', public: 'Pública' };
const visChip = (v) => `<span class="chip ${v === 'public' ? 'green' : ''}">${VIS[v] || v}</span>`;
const stops = (r) => (r.waypoints || []).filter((w) => w.kind !== 'via').length;

// ===================== Lista =====================
let listTab = 'mine';
export async function routesScreen(app, { user }) {
  const ride = activeRide();
  app.innerHTML = `${topbar('Rutas')}
    ${ride ? `<a class="banner" style="display:block;color:inherit;text-decoration:none" href="#/ruta/${ride.routeId}"><b>Ruta en curso:</b> ${esc(ride.name)}<br><span class="muted small">Toca para reengancharte o terminarla.</span></a>` : ''}
    <a class="btn primary big" href="#/nueva">+ Nueva ruta</a>
    <div class="seg"><button data-t="mine" class="${listTab === 'mine' ? 'on' : ''}">Mis rutas</button><button data-t="public" class="${listTab === 'public' ? 'on' : ''}">Públicas</button></div>
    <div class="list" id="list"><div class="empty"><span class="spin"></span></div></div>`;
  $$('[data-t]', app).forEach((b) => (b.onclick = () => { listTab = b.dataset.t; routesScreen(app, { user }); }));
  try {
    const rows = listTab === 'mine' ? await myRoutes(user.id) : await publicRoutes(user.id);
    $('#list', app).innerHTML = rows.length
      ? rows.map((r) => `<a class="card" href="#/ruta/${r.id}"><div class="title">${esc(r.name)}</div>
          <div class="chips"><span class="chip">${formatKm(r.distance_m || 0)}</span><span class="chip">${formatDuration(r.duration_s || 0)}</span><span class="chip">${stops(r)} puntos</span>${listTab === 'mine' ? visChip(r.visibility) : ''}</div></a>`).join('')
      : `<div class="empty">${listTab === 'mine' ? 'Aún no tienes rutas.<br>Crea la primera pegando un enlace de Google Maps.' : 'Todavía no hay rutas públicas de otros moteros.'}</div>`;
  } catch (e) {
    $('#list', app).innerHTML = `<div class="empty">${esc(errText(e))}</div>`;
  }
}

// ===================== Detalle =====================
export async function routeDetailScreen(app, { user, id }) {
  app.innerHTML = `${topbar('Ruta', '#/rutas')}<div class="empty"><span class="spin"></span></div>`;
  let route;
  try { route = await getRoute(id); } catch (e) { app.innerHTML = `${topbar('Ruta', '#/rutas')}<div class="empty">${esc(errText(e))}</div>`; return; }
  if (!route) { app.innerHTML = `${topbar('Ruta', '#/rutas')}<div class="empty">Esta ruta ya no existe o no es visible para ti.</div>`; return; }
  const mine = route.owner_id === user.id;
  const pts = route.waypoints || [];
  const legs = legsFor(pts);
  const render = () => {
    const ride = activeRide();
    const riding = ride?.routeId === route.id;
    app.innerHTML = `${topbar(route.name, '#/rutas')}
      ${riding ? `<div class="banner"><b>Ruta en curso.</b> <span class="muted small">Si te pierdes o paras, pulsa «Reengancharme».</span>
        <button class="btn small ghost" id="end" style="margin-top:8px">Terminar ruta</button></div>` : ''}
      <div class="map" id="map"></div>
      <div class="stats"><div class="stat"><b>${formatKm(route.distance_m || 0)}</b><span>distancia</span></div>
        <div class="stat"><b>${formatDuration(route.duration_s || 0)}</b><span>sin paradas</span></div>
        <div class="stat"><b>${stops(route)}</b><span>puntos</span></div></div>
      <button class="btn primary big" id="start">${riding ? 'Abrir navegación' : 'Iniciar ruta'}</button>
      ${legs.length > 1 ? `<p class="muted small">La ruta es larga para Google Maps y va en ${legs.length} tramos. Al acabar cada tramo, vuelve aquí y abre el siguiente.</p>
        <div id="legs">${legs.map((l, i) => `<button class="btn ghost" data-leg="${i}">Tramo ${i + 1}: puntos ${l.from + 1} a ${l.to + 1}</button>`).join('')}</div>` : ''}
      <button class="btn big" id="rejoin">Reengancharme</button>
      ${route.description ? `<h2>Descripción</h2><div class="card" style="white-space:pre-wrap">${esc(route.description)}</div>` : ''}
      <h2>Puntos</h2>
      ${pts.filter((p) => p.kind !== 'via').map((p) => `<div class="pt"><div class="n">${pinLabel(pts, pts.indexOf(p))}</div><div>${esc(p.name || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`)}</div></div>`).join('')}
      ${mine ? `<h2>Opciones</h2>
        <label>Quién la ve</label>
        <div class="seg" id="vis">${['private', 'public'].map((v) => `<button data-v="${v}" class="${route.visibility === v ? 'on' : ''}">${VIS[v]}</button>`).join('')}</div>
        <p class="muted small">«Mi comunidad» llegará con las comunidades. Al hacerla pública, cualquiera con la app puede verla y llevarla.</p>
        <a class="btn" href="#/editar/${route.id}">Editar ruta</a>
        <button class="btn danger" id="del">Borrar ruta</button>` : ''}`;
    const map = makeMap($('#map', app));
    drawRoute(map, { line: route.geometry, points: pts });
    if (riding && ride.lastFix) L.marker([ride.lastFix.lat, ride.lastFix.lng], { icon: pinIcon('me') }).addTo(map);

    $('#start', app).onclick = () => {
      if (!riding) startRide(route);
      openExternal(legs[0].url);
      render();
    };
    $$('[data-leg]', app).forEach((b) => (b.onclick = () => {
      if (!activeRide()) startRide(route);
      openExternal(legs[Number(b.dataset.leg)].url);
    }));
    $('#rejoin', app).onclick = (e) => busy(e.currentTarget, () => rejoin(route));
    const end = $('#end', app);
    if (end) end.onclick = () => { endRide(); toast('Ruta terminada.'); render(); };
    $$('#vis [data-v]', app).forEach((b) => (b.onclick = async () => {
      try { route.visibility = b.dataset.v; await saveRoute(route); toast(b.dataset.v === 'public' ? 'Ahora es pública.' : 'Ahora es privada.'); render(); }
      catch (err) { toast(errText(err), true); }
    }));
    const del = $('#del', app);
    if (del) del.onclick = async () => {
      if (!confirmInline(del, '¿Seguro? Pulsa otra vez para borrar.')) return;
      try { await deleteRoute(route.id); if (activeRide()?.routeId === route.id) endRide(); toast('Ruta borrada.'); location.hash = '#/rutas'; }
      catch (err) { toast(errText(err), true); }
    };
  };
  render();
  if (activeRide()?.routeId === route.id) follow(route);
}

function confirmInline(btn, text) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  btn.textContent = text;
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Borrar ruta'; }, 4000);
  return false;
}

async function rejoin(route) {
  let pos;
  try { pos = await getPosition(); } catch (e) { toast(errText(e), true); return; }
  const ride = activeRide();
  const progress = ride?.routeId === route.id ? ride.progressAlong : 0;
  const line = route.geometry?.length > 1 ? route.geometry : route.waypoints;
  const plan = rejoinPlan(pos, line, route.waypoints, progress);
  if (plan.finished) { toast('Ya estás al final de la ruta.'); return; }
  if (!ride || ride.routeId !== route.id) startRide(route);
  const pts = [plan.target, ...plan.remaining];
  // Si el objetivo está casi encima del siguiente punto, sobra.
  if (plan.remaining.length && distance(plan.target, plan.remaining[0]) < 150) pts.shift();
  const legs = legsFor(pts);
  toast(plan.offRouteMeters > 80
    ? `Estás a ${formatKm(plan.offRouteMeters)} de la ruta. Te llevo a un punto por delante.`
    : 'Vas por la ruta. Abro la navegación con lo que queda.');
  setTimeout(() => openExternal(legs[0].url), 600);
}

// ===================== Crear / editar =====================
export async function routeEditorScreen(app, { user, id }) {
  let route = { name: '', description: '', visibility: 'private', waypoints: [], geometry: null, distance_m: 0, duration_s: 0, source_url: null };
  if (id) {
    app.innerHTML = `${topbar('Editar ruta', '#/ruta/' + id)}<div class="empty"><span class="spin"></span></div>`;
    try { route = await getRoute(id); } catch (e) { toast(errText(e), true); return; }
    if (!route || route.owner_id !== user.id) { location.hash = '#/rutas'; return; }
  }
  let points = (route.waypoints || []).map((p) => ({ ...p }));
  let unresolved = [];
  let addMode = !id && false;
  let routing = null;
  let routedKey = id ? key(points) : '';
  let map, layer, editLayer;

  app.innerHTML = `${topbar(id ? 'Editar ruta' : 'Nueva ruta', id ? '#/ruta/' + id : '#/rutas')}
    <div id="import">
      <label for="link">Pega el enlace de la ruta de Google Maps</label>
      <textarea id="link" rows="3" style="min-height:80px" placeholder="https://maps.app.goo.gl/… o https://www.google.com/maps/dir/…"></textarea>
      <div class="row"><button class="btn" id="paste">Pegar</button><button class="btn primary" id="read">Leer enlace</button></div>
      <p class="muted small">En Google Maps: abre la ruta, pulsa Compartir y copia el enlace. También puedes marcar los puntos tocando el mapa.</p>
    </div>
    <div id="warn"></div>
    <div class="map tall" id="map"></div>
    <div class="row"><button class="btn small ghost" id="add">Añadir puntos tocando el mapa</button></div>
    <div id="stats" style="margin-top:10px"></div>
    <div id="pts"></div>
    <label for="name">Nombre de la ruta</label><input id="name" maxlength="120" placeholder="Ej.: Vuelta por la Vall de Laguar" value="${esc(route.name)}">
    <label for="desc">Descripción (opcional)</label><textarea id="desc" placeholder="Salida, paradas, nivel, lo que quieras contar">${esc(route.description || '')}</textarea>
    <label>Quién la ve</label>
    <div class="seg" id="vis">${['private', 'public'].map((v) => `<button type="button" data-v="${v}" class="${route.visibility === v ? 'on' : ''}">${VIS[v]}</button>`).join('')}</div>
    <button class="btn primary big" id="save" style="margin-top:22px">Guardar ruta</button>`;

  map = makeMap($('#map', app));
  layer = L.layerGroup().addTo(map);
  editLayer = L.layerGroup().addTo(map);

  const fixKinds = () => {
    points = points.map((p, i) => ({ ...p, kind: i === 0 ? 'start' : i === points.length - 1 ? 'end' : p.kind === 'via' ? 'via' : 'stop' }));
  };
  const renderPoints = () => {
    $('#pts', app).innerHTML = points.length ? `<h2>Puntos (${points.length})</h2>` + points.map((p, i) => `
      <div class="pt ${p.kind === 'via' ? 'via' : ''}"><div class="n">${p.kind === 'via' ? '·' : pinLabel(points, i)}</div>
        <input data-name="${i}" value="${esc(p.name || '')}" placeholder="${p.kind === 'via' ? 'Punto de paso' : 'Nombre (opcional)'}">
        ${i > 0 && i < points.length - 1 ? `<button class="kind" data-kind="${i}">${p.kind === 'via' ? 'Paso' : 'Parada'}</button>` : ''}
        <button data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">&#8593;</button>
        <button data-del="${i}" aria-label="Quitar">&#10005;</button></div>`).join('')
      + '<p class="muted small">Toca «Parada» o «Paso» para cambiarlo. Un paso solo sirve para que el trazado vaya por donde quieres. Arrastra los puntos en el mapa para moverlos.</p>' : '';
    $$('[data-name]', app).forEach((inp) => (inp.oninput = () => { points[Number(inp.dataset.name)].name = inp.value; }));
    $$('[data-kind]', app).forEach((b) => (b.onclick = () => { const p = points[Number(b.dataset.kind)]; p.kind = p.kind === 'via' ? 'stop' : 'via'; changed(); }));
    $$('[data-up]', app).forEach((b) => (b.onclick = () => { const i = Number(b.dataset.up); [points[i - 1], points[i]] = [points[i], points[i - 1]]; changed(); }));
    $$('[data-del]', app).forEach((b) => (b.onclick = () => { points.splice(Number(b.dataset.del), 1); changed(); }));
  };
  const renderMap = (fit = false) => {
    drawRoute(map, { line: route.geometry, points: [], layer, fit: false });
    editLayer.clearLayers();
    points.forEach((p, i) => {
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(p.kind, pinLabel(points, i)), draggable: true }).addTo(editLayer);
      m.on('dragend', () => { const ll = m.getLatLng(); points[i] = { ...points[i], lat: ll.lat, lng: ll.lng }; changed(); });
    });
    if (fit) {
      const all = [...points, ...(route.geometry || [])].map((p) => [p.lat, p.lng]);
      if (all.length > 1) map.fitBounds(all, { padding: [28, 28] }); else if (all.length === 1) map.setView(all[0], 14);
    }
  };
  const renderStats = (msg) => {
    $('#stats', app).innerHTML = msg
      ? `<p class="muted small">${msg}</p>`
      : route.geometry && points.length > 1
        ? `<div class="stats"><div class="stat"><b>${formatKm(route.distance_m)}</b><span>distancia</span></div><div class="stat"><b>${formatDuration(route.duration_s)}</b><span>sin paradas</span></div></div>`
        : '';
  };
  const renderWarn = () => {
    $('#warn', app).innerHTML = unresolved.length
      ? `<div class="banner warn">No he podido situar en el mapa: <b>${unresolved.map(esc).join(', ')}</b>. Activa «Añadir puntos» y tócalos en el mapa, o en Google Maps usa puntos marcados en el mapa en vez de nombres.</div>` : '';
  };
  let timer;
  const changed = (fit = false) => {
    fixKinds(); renderPoints(); renderMap(fit);
    clearTimeout(timer);
    timer = setTimeout(recompute, 500);
  };
  async function recompute() {
    if (points.length < 2) { route.geometry = null; renderStats(points.length ? 'Añade al menos otro punto.' : ''); renderMap(); return; }
    const k = key(points);
    if (k === routedKey && route.geometry) { renderStats(); return; }
    renderStats('<span class="spin" style="display:inline-block;vertical-align:middle;width:16px;height:16px"></span> Calculando el trazado…');
    routing?.abort();
    routing = new AbortController();
    try {
      const r = await routeThrough(points, { signal: routing.signal });
      route.geometry = r.line; route.distance_m = r.distance; route.duration_s = r.duration; routedKey = k;
      renderStats(); renderMap();
    } catch (e) {
      if (e.name === 'AbortError') return;
      route.geometry = points.map(({ lat, lng }) => ({ lat, lng }));
      route.distance_m = points.slice(1).reduce((s, p, i) => s + distance(points[i], p), 0); route.duration_s = 0; routedKey = '';
      renderStats('No he podido calcular el trazado por carretera (' + esc(e.message) + '). Se guardará en línea recta y Google Maps hará el resto.');
      renderMap();
    }
  }

  // Importar enlace
  $('#paste', app).onclick = async () => {
    try { $('#link', app).value = await readClipboard(); } catch { toast('No puedo leer el portapapeles. Mantén pulsado el campo y pega.', true); }
  };
  $('#read', app).onclick = (e) => busy(e.currentTarget, async () => {
    let url = extractUrl($('#link', app).value);
    if (!url) return toast('Pega primero un enlace de Google Maps.', true);
    try {
      if (isShortLink(url)) url = await expandShortLink(url);
      const r = parseGoogleMapsUrl(url);
      if (r.error) throw new Error(r.error === 'short' ? 'No he podido abrir el enlace corto.' : r.error);
      points = r.points; unresolved = r.unresolved; route.source_url = url; route.geometry = null; routedKey = '';
      if (!$('#name', app).value && points.length) {
        const names = points.filter((p) => p.name && p.kind !== 'via').map((p) => p.name.split(',')[0]);
        if (names.length >= 2) $('#name', app).value = `${names[0]} – ${names.at(-1)}`.slice(0, 120);
      }
      renderWarn(); changed(true);
      toast(`${points.filter((p) => p.kind !== 'via').length} puntos leídos.`);
    } catch (err) { toast(errText(err), true); }
  });

  // Añadir puntos tocando el mapa
  const addBtn = $('#add', app);
  const setAdd = (on) => { addMode = on; addBtn.textContent = on ? 'Listo, dejar de añadir' : 'Añadir puntos tocando el mapa'; addBtn.classList.toggle('primary', on); };
  addBtn.onclick = () => setAdd(!addMode);
  map.on('click', (ev) => {
    if (!addMode) return;
    points.push({ lat: ev.latlng.lat, lng: ev.latlng.lng, name: '', kind: 'stop' });
    if (unresolved.length) { unresolved.shift(); renderWarn(); }
    changed();
  });

  // Visibilidad
  $$('#vis [data-v]', app).forEach((b) => (b.onclick = () => { route.visibility = b.dataset.v; $$('#vis [data-v]', app).forEach((x) => x.classList.toggle('on', x === b)); }));

  // Guardar
  $('#save', app).onclick = (e) => busy(e.currentTarget, async () => {
    route.name = $('#name', app).value.trim();
    route.description = $('#desc', app).value.trim();
    if (points.length < 2) return toast('La ruta necesita al menos dos puntos.', true);
    if (!route.name) return toast('Ponle un nombre a la ruta.', true);
    clearTimeout(timer);
    if (!route.geometry || key(points) !== routedKey) await recompute();
    fixKinds();
    route.waypoints = points.map(({ lat, lng, name, kind }) => ({ lat: +lat.toFixed(6), lng: +lng.toFixed(6), name: name || '', kind }));
    try {
      const saved = await saveRoute(route);
      toast('Ruta guardada.');
      location.replace('#/ruta/' + (saved.id || route.id));
    } catch (err) { toast(errText(err), true); }
  });

  if (id) { renderPoints(); renderMap(true); renderStats(); } else {
    // Centra el mapa donde estás, si se puede, sin molestar si no hay permiso.
    getPosition().then((p) => { if (!points.length) map.setView([p.lat, p.lng], 12); }).catch(() => {});
  }
}

function key(points) { return points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)},${p.kind === 'via' ? 'v' : 's'}`).join(';'); }
