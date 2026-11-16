/* ReGroupRide — copia de las rutas en la cuenta.
   Las rutas planificadas y las grabadas dejan de vivir solo en el teléfono: se suben a la cuenta y, en un móvil nuevo
   (o tras reinstalar), se recuperan al iniciar sesión.
     · Planificadas → tabla routes (privadas, salvo las que se publiquen).
     · Grabadas → tabla rides (la ficha: km, tiempos, inclinaciones, curvas…) + su trazado comprimido en el almacén «rides».
     · Garaje (vehículos y mantenimiento) → una ficha por cuenta en user_backup (supabase/07).
   Es automática: cada cambio (guardar, editar, borrar) dispara la copia sola, y si falla se reintenta. No hay nada que pulsar.
   Es una unión: lo que hay en el móvil sube, lo que solo está en la cuenta baja. Lo que se borra en el móvil se borra
   de la cuenta. Nunca se borra nada del móvil por su cuenta. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud, DB = window.DB;
  if (!A || !Cl || !Cl.sb || !DB) return;
  var sb = Cl.sb, $ = function (s) { return document.querySelector(s); }, esc = Cl.esc;
  var S = { busy: false, at: 0, timer: null, step: '', again: false, fail: 0, noGarage: false };
  // Las escrituras de la propia copia usan estas; las de DB.* (de la app) avisan de que hay algo nuevo que copiar.
  var rawPutRide = DB.putRide, rawPutVehicle = DB.putVehicle, rawDelVehicle = DB.deleteVehicle;
  var LOCAL_ONLY = { cloudHash: 1, cloudTrack: 1, inProgress: 1 };

  function ls(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function lset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function uid() { var u = Cl.user(); return u ? u.id : null; }
  function state() { return ls('rg.sync', {}); }
  function tombs() { var t = ls('rg.sync.del', {}); t.rides = t.rides || []; t.plans = t.plans || []; return t; }
  function must(r) { if (r.error) throw r.error; return r.data; }
  function clean(r) { var o = {}; Object.keys(r).forEach(function (k) { if (!LOCAL_ONLY[k]) o[k] = r[k]; }); return o; }
  function hash(obj) { var s = JSON.stringify(obj), h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return s.length + ':' + h; }
  function syncable(r) { return r && !r.demo && !r.inProgress && r.id; }

  /* ---- trazados: JSON comprimido (un cuarto de lo que ocupa sin comprimir, o menos) ---- */
  function pack(points) {
    var blob = new Blob([JSON.stringify(points)], { type: 'application/json' });
    if (typeof CompressionStream === 'undefined') return Promise.resolve({ blob: blob, ext: '.json' });
    return new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob().then(function (b) { return { blob: new Blob([b], { type: 'application/gzip' }), ext: '.json.gz' }; },
      function () { return { blob: blob, ext: '.json' }; });
  }
  function unpack(blob, path) {
    if (!/\.gz$/.test(path)) return blob.text().then(JSON.parse);
    return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text().then(JSON.parse);
  }

  /* ---- rutas planificadas ---- */
  function planRow(p) {
    return { owner_id: uid(), local_id: p.id, name: (p.name || 'Ruta').slice(0, 120), waypoints: p.wps || [], distance_m: Math.round((p.dist || 0) * 1000), duration_s: Math.round(p.dur || 0),
      visibility: p.pub ? 'public' : 'private', start_lat: p.coords[0][1], start_lon: p.coords[0][0],
      plan: { wps: p.wps || [], pois: p.pois || [], coords: p.coords, steps: p.steps || [], dist: p.dist, dur: p.dur, created: p.created || null, from: p.from || null, gpx: !!p.gpx } };
  }
  // Sube una ruta planificada (o la actualiza). Devuelve la ruta con su cloudId puesto.
  function pushPlan(p) {
    if (!uid() || !p.coords || p.coords.length < 2) return Promise.resolve(p);
    var row = planRow(p), insert = function () { return sb.from('routes').upsert(row, { onConflict: 'owner_id,local_id' }).select('id').single().then(function (r) { p.cloudId = must(r).id; return p; }); };
    if (!p.cloudId) return insert();
    // Ya tiene fila en la cuenta (por ejemplo, las publicadas antes de esta versión): se actualiza esa, no se crea otra.
    return sb.from('routes').update(row).eq('id', p.cloudId).select('id').then(function (r) { var d = must(r); if (d && d.length) return p; delete p.cloudId; return insert(); });
  }
  function syncPlans(t) {
    var me = uid(), changed = false, n = 0;
    return sb.from('routes').select('id,local_id,visibility').eq('owner_id', me).then(function (r) {
      var cloud = must(r) || [], byId = {}, byLocal = {}, used = {};
      cloud.forEach(function (c) { byId[c.id] = c; if (c.local_id != null) byLocal[c.local_id] = c; });
      var local = A.plans().filter(function (p) { return !p.preview && p.coords && p.coords.length > 1; }), chain = Promise.resolve();
      local.forEach(function (p) {
        var c = (p.cloudId && byId[p.cloudId]) || byLocal[p.id];
        if (c) {
          used[c.id] = 1; n++;
          var pub = c.visibility === 'public';
          if (p.cloudId !== c.id || p.pub !== pub) { p.cloudId = c.id; p.pub = pub; changed = true; }
          if (c.local_id == null) chain = chain.then(function () { return sb.from('routes').update({ local_id: p.id }).eq('id', c.id).then(function () {}, function () {}); });   // las publicadas antes de esta versión
        } else if (p.cloudId) {
          // Estaba en la cuenta y ya no: se borró desde otro móvil. Aquí se queda, pero no se vuelve a subir sola.
          if (p.pub) { p.pub = false; changed = true; }
        } else {
          n++; chain = chain.then(function () { S.step = 'Subiendo «' + p.name + '»…'; paint(); return pushPlan(p).then(function () { changed = true; }); });
        }
      });
      // Lo que está en la cuenta y no en este móvil: se baja.
      var gone = {}; t.plans.forEach(function (id) { gone[id] = 1; });
      var missing = cloud.filter(function (c) { return !used[c.id] && !gone[c.id]; }), fresh = [];
      missing.forEach(function (c) {
        chain = chain.then(function () {
          S.step = 'Recuperando rutas planificadas…'; paint();
          return sb.from('routes').select('id,local_id,name,visibility,distance_m,duration_s,plan').eq('id', c.id).single().then(function (q) {
            var x = must(q), pl = x.plan; if (!pl || !(pl.coords || []).length) return;
            fresh.push({ id: x.local_id != null ? x.local_id : parseInt(x.id.replace(/-/g, '').slice(0, 12), 16), name: x.name, wps: pl.wps || [], pois: pl.pois || [], coords: pl.coords, steps: pl.steps || [],
              dist: pl.dist != null ? pl.dist : Math.round((x.distance_m || 0) / 100) / 10, dur: pl.dur != null ? pl.dur : (x.duration_s || 0), routed: true, created: pl.created || Date.now(), from: pl.from || undefined, gpx: pl.gpx || undefined, cloudId: x.id, pub: x.visibility === 'public' });
          });
        });
      });
      return chain.then(function () { return A.mergePlans(local, fresh, changed || fresh.length > 0); }).then(function () { return { down: fresh.length, total: n + fresh.length }; });
    });
  }

  /* ---- rutas grabadas ---- */
  function syncRides(t) {
    var me = uid(), got = 0, sent = 0, n = 0;
    return Promise.all([sb.from('rides').select('local_id,track').eq('owner_id', me), DB.allRides()]).then(function (res) {
      var cloud = must(res[0]) || [], inCloud = {}, local = (res[1] || []).filter(syncable), have = {}, chain = Promise.resolve();
      cloud.forEach(function (c) { inCloud[c.local_id] = c; });
      local.forEach(function (r) {
        have[r.id] = 1;
        var meta = clean(r), h = hash(meta), c = inCloud[r.id];
        if (c && r.cloudHash === h) { n++; return; }      // ya está, y sin cambios
        if (!c && r.cloudHash) return;                     // estaba y se borró desde otro móvil: aquí se queda, pero no se vuelve a subir sola
        n++;
        chain = chain.then(function () {
          S.step = 'Subiendo rutas grabadas… ' + (++sent); paint();
          // El trazado se sube una vez; si solo ha cambiado la ficha (nombre, nota, favorita), solo la ficha.
          var up = (c && c.track) ? Promise.resolve(c.track) : DB.getTrack(r.id).then(function (pts) {
            if (!pts || pts.length < 2) return null;
            return pack(pts).then(function (z) { var path = me + '/' + r.id + z.ext; return sb.storage.from('rides').upload(path, z.blob, { upsert: true, contentType: z.blob.type }).then(function (u) { must(u); return path; }); });
          });
          return up.then(function (path) {
            return sb.from('rides').upsert({ owner_id: me, local_id: r.id, started_at: r.start ? new Date(r.start).toISOString() : null, km: Math.round((r.dist || 0) * 100) / 100, meta: meta, track: path || null }, { onConflict: 'owner_id,local_id' }).then(function (q) {
              must(q); r.cloudHash = h; r.cloudTrack = path || ''; return rawPutRide(r);
            });
          });
        });
      });
      // Lo que está en la cuenta y no en este móvil: se baja con su trazado.
      var gone = {}; t.rides.forEach(function (id) { gone[id] = 1; });
      var counted = ls('rg.statsSent', {});
      cloud.filter(function (c) { return !have[c.local_id] && !gone[c.local_id]; }).forEach(function (c) {
        chain = chain.then(function () {
          S.step = 'Recuperando rutas grabadas… ' + (++got); paint();
          return sb.from('rides').select('meta,track').eq('owner_id', me).eq('local_id', c.local_id).single().then(function (q) {
            var x = must(q), r = x.meta; if (!r || !r.id) return;
            var pts = x.track ? sb.storage.from('rides').download(x.track).then(function (d) { return unpack(must(d), x.track); }).catch(function () { return null; }) : Promise.resolve(null);
            return pts.then(function (points) {
              r.hasTrack = !!(points && points.length > 1); r.cloudHash = hash(clean(r)); r.cloudTrack = x.track || ''; delete r.inProgress;
              counted[r.id] = 1;      // sus medias ya se sumaron en su día: no se cuentan otra vez
              return rawPutRide(r).then(function () { if (r.hasTrack) return DB.putTrack(r.id, points); });
            });
          });
        });
      });
      return chain.then(function () { lset('rg.statsSent', counted); if (got) return A.reloadRides(); }).then(function () { return { up: sent, down: got, total: n + got }; });
    });
  }

  /* ---- garaje: vehículos con su mantenimiento ----
     Por vehículo gana el cambio más reciente (mod). Un vehículo borrado deja una marca con su fecha; si alguien lo
     había cambiado después en otro móvil, se conserva. Sin la tabla (falta el 07) no se hace nada y no es un error. */
  function byId(a) { return a.slice().sort(function (x, y) { return x.id - y.id; }); }
  function syncGarage() {
    var me = uid(); if (S.noGarage) return Promise.resolve(null);
    return Promise.all([sb.from('user_backup').select('garage').eq('owner_id', me).maybeSingle(), DB.allVehicles()]).then(function (res) {
      if (res[0].error) { if (/user_backup|schema cache|does not exist|not find/i.test(res[0].error.message || '')) { S.noGarage = true; return null; } throw res[0].error; }
      var cloud = (res[0].data && res[0].data.garage) || {}, cv = cloud.vehicles || [], cdel = cloud.deleted || {}, local = res[1] || [], ldel = ls('rg.sync.vdel', {});
      var del = {}, k, now = Date.now(), map = {}, merged = [], jobs = [], touched = false;
      for (k in cdel) if (now - cdel[k] < 180 * 864e5) del[k] = cdel[k];
      for (k in ldel) if (!(del[k] >= ldel[k])) del[k] = ldel[k];
      cv.forEach(function (v) { map[v.id] = { c: v }; }); local.forEach(function (v) { (map[v.id] = map[v.id] || {}).l = v; });
      Object.keys(map).forEach(function (id) {
        var l = map[id].l, c = map[id].c, lm = l ? (l.mod || 0) : -1, cm = c ? (c.mod || 0) : -1, best = lm >= cm ? l : c;
        if (del[id] && del[id] >= Math.max(lm, cm)) { if (l) { jobs.push(rawDelVehicle(l.id)); touched = true; } return; }
        merged.push(best);
        if (best !== l) { jobs.push(rawPutVehicle(best)); touched = true; }
      });
      var same = JSON.stringify(byId(cv)) === JSON.stringify(byId(merged)) && JSON.stringify(cdel) === JSON.stringify(del);
      return Promise.all(jobs).then(function () {
        if (!same) return sb.from('user_backup').upsert({ owner_id: me, garage: { vehicles: merged, deleted: del }, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' }).then(must);
      }).then(function () { lset('rg.sync.vdel', {}); if (touched && A.reloadVehicles) return A.reloadVehicles(); }).then(function () { return merged.length; });
    });
  }
  DB.putRide = function (r) { var p = rawPutRide(r); if (r && !r.inProgress && !r.demo) soon(6000); return p; };
  DB.putVehicle = function (v) { if (v) v.mod = Date.now(); soon(5000); return rawPutVehicle(v); };
  DB.deleteVehicle = function (id) { var d = ls('rg.sync.vdel', {}); d[id] = Date.now(); lset('rg.sync.vdel', d); soon(3000); return rawDelVehicle(id); };

  /* ---- lo borrado en el móvil se borra de la cuenta ---- */
  function flushDeleted() {
    var t = tombs(), me = uid(), jobs = [];
    t.rides.slice().forEach(function (id) {
      jobs.push(sb.from('rides').select('track').eq('owner_id', me).eq('local_id', id).maybeSingle().then(function (q) {
        var tr = q.data && q.data.track;
        return (tr ? sb.storage.from('rides').remove([tr]) : Promise.resolve()).then(function () { return sb.from('rides').delete().eq('owner_id', me).eq('local_id', id); }).then(function (d) { must(d); var x = tombs(); x.rides = x.rides.filter(function (y) { return y !== id; }); lset('rg.sync.del', x); });
      }));
    });
    t.plans.slice().forEach(function (cid) {
      jobs.push(sb.from('routes').delete().eq('id', cid).then(function (d) { must(d); var x = tombs(); x.plans = x.plans.filter(function (y) { return y !== cid; }); lset('rg.sync.del', x); }));
    });
    return Promise.all(jobs.map(function (j) { return j.catch(function () {}); }));
  }
  function rideDeleted(id) { var t = tombs(); if (t.rides.indexOf(id) < 0) t.rides.push(id); lset('rg.sync.del', t); soon(1500); }
  function planDeleted(p) { if (!p || !p.cloudId) return; var t = tombs(); if (t.plans.indexOf(p.cloudId) < 0) t.plans.push(p.cloudId); lset('rg.sync.del', t); soon(1500); }

  /* ---- sincronizar ---- */
  function friendly(e) {
    var m = String((e && e.message) || e || '');
    if (/could not find the table|relation .* does not exist|schema cache|local_id|bucket not found/i.test(m)) return 'La copia en la cuenta aún no está activada en el servidor: falta ejecutar 05_copia_en_la_cuenta.sql en Supabase.';
    if (/fetch|network|failed/i.test(m)) return 'Sin conexión: se copiará cuando vuelva.';
    return Cl.msg ? Cl.msg(e) : m;
  }
  function sync(manual) {
    var me = uid();
    if (!me) return Promise.resolve();
    if (S.busy) { S.again = true; return Promise.resolve(); }                    // ha cambiado algo a mitad de copia: otra pasada al acabar
    var st = state();
    if (st.owner && st.owner !== me) { paint(); return Promise.resolve(); }      // las rutas de este móvil son de otra cuenta: se pregunta antes
    if (A.isRec() && !manual) { S.again = false; soon(60000); return Promise.resolve(); }   // en ruta no se gasta batería ni datos: se deja para después
    if (navigator.onLine === false) { st.err = 'Sin conexión: se copiará sola en cuanto vuelva.'; lset('rg.sync', st); paint(); return Promise.resolve(); }
    S.busy = true; S.again = false; S.step = 'Copiando…'; paint();
    var t, missing = false;
    return flushDeleted().then(function () { t = tombs(); return syncPlans(t); }).then(function (p) {
      return syncRides(t).then(function (r) {
        return syncGarage().then(function (g) {
          lset('rg.sync', { owner: me, at: Date.now(), plans: p.total, rides: r.total, vehicles: g, err: '' }); S.fail = 0;
          if (manual) A.toast('Copia al día: ' + r.total + ' grabadas y ' + p.total + ' planificadas en tu cuenta.', 'ok');
        });
      });
    }).catch(function (e) {
      var s2 = state(); s2.owner = s2.owner || me; s2.err = friendly(e); lset('rg.sync', s2); S.fail++; missing = /no está activada/.test(s2.err);
      if (manual) A.toast(s2.err, 'bad');
    }).then(function () {
      S.busy = false; S.step = ''; S.at = Date.now(); paint();
      if (S.fail) soon(missing ? 15 * 60000 : Math.min(15 * 60000, 30000 * Math.pow(2, S.fail - 1)));   // reintento solo: 30 s, 1 min, 2 min… hasta 15 min
      else if (S.again) soon(3000);
    });
  }
  function soon(ms) { clearTimeout(S.timer); S.timer = setTimeout(function () { sync(false); }, ms || 4000); }

  /* ---- lo que se ve en Ajustes ---- */
  function ago(ts) { var m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'ahora mismo' : (m < 60 ? 'hace ' + m + ' min' : (m < 1440 ? 'hace ' + Math.round(m / 60) + ' h' : 'el ' + new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }))); }
  function paint() {
    var box = $('#rgSyncBox'); if (!box) return;
    var me = uid(); if (!me) { box.hidden = true; return; }
    var st = state(); box.hidden = false;
    if (st.owner && st.owner !== me) {
      box.innerHTML = '<span class="label">Copia en tu cuenta</span><div class="notice">Las rutas guardadas en este móvil son de otra cuenta. No se copian a la tuya salvo que lo pidas.</div><div class="rg-row"><button class="btn small" id="syAdopt" type="button">Copiarlas también a esta cuenta</button></div>';
      $('#syAdopt').addEventListener('click', function (ev) {
        if (!ev.currentTarget.dataset.armed) { ev.currentTarget.dataset.armed = '1'; ev.currentTarget.textContent = '¿Seguro? Toca otra vez'; return; }
        adopt().then(function () { sync(true); });
      });
      return;
    }
    var veh = st.vehicles != null ? ', ' + st.vehicles + (st.vehicles === 1 ? ' vehículo' : ' vehículos') : '';
    var line = S.busy ? esc(S.step || 'Copiando…') : (st.err ? esc(st.err) : (st.at ? (st.rides || 0) + (st.rides === 1 ? ' ruta grabada' : ' rutas grabadas') + ', ' + (st.plans || 0) + (st.plans === 1 ? ' planificada' : ' planificadas') + veh + ' a salvo en tu cuenta · ' + ago(st.at) : 'La primera copia se hace sola en unos segundos.'));
    box.innerHTML = '<span class="label">Copia en tu cuenta</span><div class="perm"><div><b>Tus rutas y tu garaje, también fuera del teléfono</b><span class="muted">' + line + '</span></div><span class="mstatus ' + (S.busy ? 'soon">Copiando' : (st.err ? 'due">Pendiente' : (st.at ? 'ok">Al día' : 'soon">Pendiente'))) + '</span></div>' +
      (st.err && !S.busy ? '<div class="rg-row"><button class="btn small" id="syNow" type="button">Reintentar ahora</button></div>' : '<p class="muted rg-small" style="text-align:left;margin:8px 0 0">Es automática: se copia sola cada vez que guardas, cambias o borras algo. No hay que pulsar nada.</p>');
    if ($('#syNow')) $('#syNow').addEventListener('click', function () { sync(true); });
  }
  // Otra persona inicia sesión en este móvil y quiere quedarse también con las rutas que hay en él.
  function adopt() {
    return DB.allRides().then(function (all) {
      return Promise.all(all.filter(function (r) { return r.cloudHash || r.cloudTrack; }).map(function (r) { delete r.cloudHash; delete r.cloudTrack; return rawPutRide(r); }));
    }).then(function () {
      var ps = A.plans(); ps.forEach(function (p) { delete p.cloudId; p.pub = false; });
      lset('rg.sync', { owner: uid() }); lset('rg.sync.del', {});
      return A.mergePlans(ps, [], true);
    });
  }

  // Cuándo: al entrar, con cada cambio (guardar, editar, borrar), al volver a la app, al recuperar la conexión,
  // cada 10 minutos con la app abierta y, si algo falla, reintentando sola.
  Cl.onChange(function (u) { paint(); if (u) soon(6000); });
  document.addEventListener('visibilitychange', function () {
    if (!uid()) return;
    if (document.visibilityState === 'visible') { if (Date.now() - S.at > 60000) soon(2500); }
    else if (!A.isRec()) sync(false);                                            // al salir de la app: lo que quede pendiente, ahora
  });
  setInterval(function () { if (uid() && document.visibilityState === 'visible' && Date.now() - S.at > 9 * 60000) sync(false); }, 60000);
  window.addEventListener('online', function () { if (uid()) soon(2000); });
  var tab = document.querySelector('.tab[data-view="settings"]'); if (tab) tab.addEventListener('click', paint);
  paint(); if (uid()) soon(6000);

  window.RGSync = { sync: sync, soon: soon, pushPlan: pushPlan, rideDeleted: rideDeleted, planDeleted: planDeleted, state: S };
})();
