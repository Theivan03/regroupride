/* ReGroupRide · Resumen de la salida para compartir (historias de Instagram, WhatsApp…).
   Una imagen con el trazado, el nombre, la fecha y las cifras que elija cada uno. La velocidad y la inclinación
   vienen desmarcadas: quien las quiera enseñar, las marca. La imagen se hace en el teléfono; no se sube a ningún sitio. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A || !Cl) return;
  var $ = function (q, r) { return (r || document).querySelector(q); }, $$ = function (q, r) { return Array.prototype.slice.call((r || document).querySelectorAll(q)); };
  var I = window.RGI18N || {}, EN = I.lang === 'en', MI = !!I.mi;
  var T = function (es, en) { return EN ? en : es; };
  var FIELDS = [
    { k: 'dist', es: 'Distancia', en: 'Distance', on: true },
    { k: 'time', es: 'En marcha', en: 'Moving time', on: true },
    { k: 'climb', es: 'Desnivel', en: 'Climb', on: false },
    { k: 'avg', es: 'Velocidad media', en: 'Average speed', on: false },
    { k: 'vmax', es: 'Velocidad máxima', en: 'Top speed', on: false },
    { k: 'lean', es: 'Inclinación máxima', en: 'Max lean', on: false }
  ];
  function prefs() { try { return JSON.parse(localStorage.getItem('rg.share') || 'null') || {}; } catch (e) { return {}; } }
  function save(p) { try { localStorage.setItem('rg.share', JSON.stringify(p)); } catch (e) {} }
  function num(v, d) { return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d).replace('.', EN ? '.' : ','); }
  function value(k, r) {
    var secs = r.movingS || Math.max(0, Math.round(((r.end || r.start) - r.start) / 1000));
    if (k === 'dist') return [num((r.dist || 0) / (MI ? 1.609344 : 1), (r.dist || 0) >= 100 ? 0 : 1), MI ? 'mi' : 'km'];
    if (k === 'time') { var h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60); if (m === 60) { h++; m = 0; } return [h ? h + ' h ' + (m < 10 ? '0' : '') + m : String(m), h ? 'min' : 'min']; }
    if (k === 'climb') return r.climb ? [String(Math.round(MI ? r.climb * 3.28084 : r.climb)), MI ? 'ft' : 'm'] : null;
    if (k === 'avg') return secs > 60 && r.dist ? [String(Math.round(r.dist / (secs / 3600) / (MI ? 1.609344 : 1))), MI ? 'mph' : 'km/h'] : null;
    if (k === 'vmax') return r.vMax ? [String(Math.round(r.vMax / (MI ? 1.609344 : 1))), MI ? 'mph' : 'km/h'] : null;
    if (k === 'lean') { var l = Math.max(Math.abs(r.maxL || 0), Math.abs(r.maxR || 0)); return l >= 1 ? [String(Math.round(l)), '°'] : null; }
    return null;
  }
  function loadImg(src) { return new Promise(function (res) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = src; }); }
  function fit(g, text, maxW, size, font) { while (size > 30) { g.font = '700 ' + size + 'px ' + font; if (g.measureText(text).width <= maxW) break; size -= 4; } return size; }

  // Dibuja la imagen. story: 1080×1920 (historia); si no, 1080×1080.
  function draw(r, pts, on, story, title) {
    var W = 1080, H = story ? 1920 : 1080, c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d');
    var HEAD = '"Barlow Semi Condensed", "Barlow Condensed", system-ui, sans-serif', TXT = 'Manrope, system-ui, sans-serif';
    var ready = document.fonts && document.fonts.load ? Promise.all([document.fonts.load('700 80px "Barlow Semi Condensed"'), document.fonts.load('600 30px Manrope')]).catch(function () {}) : Promise.resolve();
    return Promise.all([ready, loadImg('simbolo.svg')]).then(function (res) {
      var logo = res[1], PAD = 84, LIME = '#D9F21C', FG = '#F4F1FA', FG2 = '#A9A3B8';
      var bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#17141F'); bg.addColorStop(0.55, '#0F0F12'); bg.addColorStop(1, '#0B0B0D'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      // cabecera: marca
      var y = story ? 170 : 96;
      if (logo) { g.save(); g.beginPath(); var s = 64, rx = 14; g.moveTo(PAD + rx, y - s + 12); g.arcTo(PAD + s, y - s + 12, PAD + s, y + 12, rx); g.arcTo(PAD + s, y + 12, PAD, y + 12, rx); g.arcTo(PAD, y + 12, PAD, y - s + 12, rx); g.arcTo(PAD, y - s + 12, PAD + s, y - s + 12, rx); g.closePath(); g.clip(); g.drawImage(logo, PAD, y - s + 12, s, s); g.restore(); }
      g.fillStyle = FG; g.font = '700 44px ' + HEAD; g.textBaseline = 'alphabetic'; g.fillText('REGROUPRIDE', PAD + (logo ? 84 : 0), y);
      // título y fecha
      var d = new Date(r.start), date = d.toLocaleDateString(EN ? 'en-GB' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      y += story ? 150 : 110;
      var name = String(title || '').toUpperCase(), size = fit(g, name, W - 2 * PAD, story ? 104 : 84, HEAD);
      // si no cabe en una línea ni reduciendo, a dos
      g.font = '700 ' + size + 'px ' + HEAD; var lines = [name];
      if (g.measureText(name).width > W - 2 * PAD) { var words = name.split(' '), a = '', b = ''; words.forEach(function (w) { if (!b && g.measureText((a + ' ' + w).trim()).width <= W - 2 * PAD) a = (a + ' ' + w).trim(); else b = (b + ' ' + w).trim(); }); lines = [a, b].filter(Boolean); }
      g.fillStyle = FG; lines.slice(0, 2).forEach(function (ln, i) { var t = ln; while (g.measureText(t).width > W - 2 * PAD && t.length > 4) t = t.slice(0, -2); g.fillText(t === ln ? ln : t + '…', PAD, y + i * (size + 8)); });
      y += (Math.min(2, lines.length) - 1) * (size + 8) + 58;
      g.fillStyle = FG2; g.font = '600 34px ' + TXT; g.fillText(date.charAt(0).toUpperCase() + date.slice(1), PAD, y);
      // cifras elegidas (abajo)
      var vals = FIELDS.filter(function (f) { return on[f.k]; }).map(function (f) { var v = value(f.k, r); return v ? { label: T(f.es, f.en).toUpperCase(), v: v[0], u: v[1] } : null; }).filter(Boolean);
      var cols = vals.length <= 3 ? Math.max(1, vals.length) : (vals.length === 4 ? 2 : 3), rows = Math.ceil(vals.length / cols), rowH = story ? 190 : 150, foot = story ? 150 : 84;
      var statsTop = H - foot - rows * rowH;
      // trazado, en el hueco que queda
      var box = { x: PAD, y: y + 60, w: W - 2 * PAD, h: statsTop - (y + 60) - (vals.length ? 70 : 20) };
      if (pts && pts.length > 1 && box.h > 120) {
        var sp = window.Geo && Geo.simplify ? Geo.simplify(pts, 8) : pts, minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
        sp.forEach(function (p) { if (p[1] < minLa) minLa = p[1]; if (p[1] > maxLa) maxLa = p[1]; if (p[2] < minLo) minLo = p[2]; if (p[2] > maxLo) maxLo = p[2]; });
        var cosLat = Math.cos(((minLa + maxLa) / 2) * Math.PI / 180), w = Math.max((maxLo - minLo) * cosLat, 1e-6), h = Math.max(maxLa - minLa, 1e-6), k = Math.min(box.w / w, box.h / h);
        var ox = box.x + (box.w - w * k) / 2, oy = box.y + (box.h - h * k) / 2, X = function (p) { return ox + (p[2] - minLo) * cosLat * k; }, Y = function (p) { return oy + (maxLa - p[1]) * k; };
        var path = function () { g.beginPath(); sp.forEach(function (p, i) { if (i) g.lineTo(X(p), Y(p)); else g.moveTo(X(p), Y(p)); }); };
        g.lineCap = 'round'; g.lineJoin = 'round';
        g.save(); g.shadowColor = 'rgba(217,242,28,.55)'; g.shadowBlur = 36; g.strokeStyle = LIME; g.lineWidth = 10; path(); g.stroke(); g.restore();
        g.strokeStyle = LIME; g.lineWidth = 10; path(); g.stroke();
        var a0 = sp[0], z0 = sp[sp.length - 1];
        g.fillStyle = '#0F0F12'; g.strokeStyle = FG; g.lineWidth = 6; g.beginPath(); g.arc(X(a0), Y(a0), 13, 0, 7); g.fill(); g.stroke();
        g.fillStyle = FG; g.beginPath(); g.arc(X(z0), Y(z0), 15, 0, 7); g.fill();
      } else if (box.h > 120) { g.fillStyle = FG2; g.font = '600 32px ' + TXT; g.textAlign = 'center'; g.fillText(T('Sin trazado', 'No track'), W / 2, box.y + box.h / 2); g.textAlign = 'left'; }
      // rejilla de cifras
      if (vals.length) {
        g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 2; g.beginPath(); g.moveTo(PAD, statsTop - 30); g.lineTo(W - PAD, statsTop - 30); g.stroke();
        var cw = (W - 2 * PAD) / cols;
        vals.forEach(function (v, i) {
          var cx = PAD + (i % cols) * cw, cy = statsTop + Math.floor(i / cols) * rowH;
          g.fillStyle = FG2; g.font = '700 26px ' + HEAD; g.fillText(v.label, cx, cy + 20);
          var big = cols === 1 ? 150 : cols === 2 ? 118 : 92; if (!story) big = Math.round(big * 0.8);
          g.fillStyle = FG; g.font = '700 ' + big + 'px ' + HEAD; var bw = g.measureText(v.v).width;
          while (bw > cw - 110 && big > 50) { big -= 6; g.font = '700 ' + big + 'px ' + HEAD; bw = g.measureText(v.v).width; }
          g.fillText(v.v, cx, cy + 20 + big);
          g.fillStyle = FG2; g.font = '700 ' + Math.round(big * 0.36) + 'px ' + HEAD; g.fillText(v.u, cx + bw + 12, cy + 20 + big);
        });
      }
      g.fillStyle = FG2; g.font = '600 28px ' + TXT; g.textAlign = 'center'; g.fillText(T('Hecha con ReGroupRide', 'Made with ReGroupRide'), W / 2, H - (story ? 70 : 34)); g.textAlign = 'left';
      return c.toDataURL('image/png');
    });
  }

  function open(r, pts, title) {
    if (!r) return;
    var p = prefs(), on = {}, story = p.fmt !== 'sq'; FIELDS.forEach(function (f) { on[f.k] = p[f.k] != null ? !!p[f.k] : f.on; });
    var avail = FIELDS.filter(function (f) { return value(f.k, r); });
    var s = Cl.sheet('<div class="head" data-full><h1>Compartir la salida</h1><button class="btn small icon" id="shX" type="button" title="Cerrar"><svg><use href="#i-close"/></svg></button></div>' +
      '<div class="sh-prev" id="shPrev"><p class="muted rg-load">Cargando…</p></div>' +
      '<div class="seg rg-wide" id="shFmt"><button type="button" data-f="st" aria-pressed="' + story + '">Historia</button><button type="button" data-f="sq" aria-pressed="' + !story + '">Cuadrada</button></div>' +
      '<span class="label">Qué cifras enseñas</span><div class="as-rows sh-opts">' + avail.map(function (f) {
        return '<label class="rg-check"><input type="checkbox" data-k="' + f.k + '"' + (on[f.k] ? ' checked' : '') + '><span><b>' + f.es + '</b></span></label>';
      }).join('') + '</div>' +
      '<p class="muted rg-small" style="text-align:left;margin:0">La velocidad y la inclinación vienen desmarcadas: enséñalas solo si quieres. La imagen se hace en tu teléfono.</p>' +
      '<div class="as-fixed"><button class="btn big primary" id="shGo" type="button"><svg><use href="#i-share"/></svg>Compartir</button></div>', 'full');
    $('#shX', s).addEventListener('click', Cl.closeSheet);
    var data = null, seq = 0;
    var paint = function () {
      var my = ++seq;
      draw(r, pts, on, story, title).then(function (url) { if (my !== seq) return; data = url; var box = $('#shPrev'); if (box) { box.className = 'sh-prev' + (story ? '' : ' sq'); box.innerHTML = '<img alt="" src="' + url + '">'; } });
    };
    $$('#shFmt button', s).forEach(function (b) { b.addEventListener('click', function () { story = b.dataset.f !== 'sq'; $$('#shFmt button', s).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); var q = prefs(); q.fmt = story ? 'st' : 'sq'; save(q); paint(); }); });
    $$('.sh-opts input', s).forEach(function (i) { i.addEventListener('change', function () { on[i.dataset.k] = i.checked; var q = prefs(); q[i.dataset.k] = i.checked; save(q); paint(); }); });
    $('#shGo', s).addEventListener('click', function (ev) {
      if (!data) return;
      var name = 'regroupride-' + new Date(r.start).toISOString().slice(0, 10) + '.png';
      Cl.busy(ev.currentTarget, function () { return Promise.resolve(window.Platform && Platform.sharePng ? Platform.sharePng(name, data, title || 'ReGroupRide') : null).then(function () {}, function (e) { if (e && /abort|cancel/i.test(String(e.name || e.message || e))) return; A.toast('No se ha podido compartir la imagen.', 'warn'); }); });
    });
    paint();
  }
  window.RGShare = { open: open, draw: draw };
})();
