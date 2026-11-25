/* ReGroupRide — idioma (español o inglés) y unidades (km o millas).
   El texto de la app está escrito en español y en kilómetros. Con otro idioma u otras unidades, esta capa cambia lo que
   se pinta: traduce los textos de la app (no lo que escribe la gente: nombres, chats, descripciones…) y pasa a millas
   las distancias y las velocidades, allí donde salgan. Los datos se siguen guardando en kilómetros.
   Por defecto: español y km. Se eligen al crear la cuenta (idioma) y en Yo › Ajustes. */
(function () {
  'use strict';
  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var LANG = ls('rg.lang') === 'en' ? 'en' : 'es', MI = ls('rg.units') === 'mi', D = (LANG === 'en' && window.RG_EN) || {};
  var KM = 1.609344;
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} location.reload(); }

  /* ---------- números ---------- */
  function parse(s) { return parseFloat(String(s).replace(/\./g, '').replace(',', '.')); }
  function fmt(n, dec) { var t = n.toFixed(dec).split('.'); t[0] = t[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return t.join(','); }
  function decs(s) { var m = /,(\d+)$/.exec(s); return m ? m[1].length : 0; }
  function conv(num, unit) {              // «12,3» + «km» → «7,6» + «mi»
    var v = parse(num), d = decs(num); if (!isFinite(v)) return null;
    if (unit === 'km/h') return [fmt(v / KM, d), 'mph'];
    if (unit === 'km') { var mi = v / KM; return [fmt(mi, d || (mi < 10 && v % 1 !== 0 ? 1 : 0)), 'mi']; }
    if (unit === 'm') { var ft = v * 3.28084; return [fmt(ft >= 300 ? Math.round(ft / 50) * 50 : Math.round(ft), 0), 'ft']; }
    if (unit === '/100 km') return [fmt(v * KM, d), '/100 mi'];
    return null;
  }
  var RE_100 = /(\d[\d.]*(?:,\d+)?)(\s?(?:l|€))\/100 km/g, RE_U = /(\d[\d.]*(?:,\d+)?)(\s?)(km\/h|km)(?![\w\/])/g, RE_M = /(\d[\d.]*(?:,\d+)?)( )(m)(?![\w\/])/g;
  function units(t) {
    if (!MI || !/\d/.test(t) && !/km|kil[oó]met/i.test(t)) return t;
    t = t.replace(RE_100, function (m, n, u) { var c = conv(n, '/100 km'); return c ? c[0] + u + c[1] : m; });
    t = t.replace(/\/100 km/g, '/100\u0001');
    var f = function (m, n, sp, u) { var c = conv(n, u); return c ? c[0] + sp + c[1] : m; };
    t = t.replace(RE_U, f).replace(RE_M, f).replace(/\/100\u0001/g, '/100 mi');
    return t.replace(/\b([Kk])m\/h\b/g, 'mph').replace(/\bKm\b/g, 'Mi').replace(/\bkm\b/g, 'mi').replace(/\bkilómetros\b/g, 'millas').replace(/\bkilometres\b/g, 'miles').replace(/\bKilómetros\b/g, 'Millas').replace(/\bKilometres\b/g, 'Miles');
  }

  /* ---------- traducción ---------- */
  var MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'], MEN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var cache = {}, big = null, keys = null;
  var WD = { lun: 'Mon', mar: 'Tue', 'mié': 'Wed', jue: 'Thu', vie: 'Fri', 'sáb': 'Sat', dom: 'Sun' }, MO = { ene: 'Jan', feb: 'Feb', mar: 'Mar', abr: 'Apr', may: 'May', jun: 'Jun', jul: 'Jul', ago: 'Aug', sep: 'Sep', sept: 'Sep', oct: 'Oct', nov: 'Nov', dic: 'Dec' };
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }
  var L = 'A-Za-zÁÉÍÓÚÑáéíóúñü', one = null;
  function alt(list) { return list.map(function (k) { return (new RegExp('^[' + L + ']').test(k) ? '(?<![' + L + '])' : '') + esc(k) + (new RegExp('[' + L + ']$').test(k) ? '(?![' + L + '])' : ''); }).join('|'); }
  function build() {
    keys = Object.keys(D).filter(function (k) { return k.length >= 3; }).sort(function (a, b) { return b.length - a.length; });
    // frases de varias palabras: valen en medio de un texto. Una palabra suelta en minúscula («curvas», «días») solo detrás de una cifra.
    var multi = keys.filter(function (k) { return /\s/.test(k.trim()) || /^[·,.:;(«»)]/.test(k); }), single = keys.filter(function (k) { return !/\s/.test(k.trim()) && /^[a-záéíóúñ]/.test(k); });
    try { big = new RegExp(alt(multi), 'g'); one = new RegExp('(\\d\\s?)(' + single.map(esc).join('|') + ')(?![' + L + '])', 'g'); } catch (e) { big = /$^/g; one = null; }
  }
  function tr(text) {
    if (LANG !== 'en' || !text) return text;
    var core = text.trim(); if (core.length < 2 || !/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(core)) return text;
    var hit = cache[core];
    if (hit === undefined) {
      hit = D[core];
      if (hit === undefined) {
        if (!big) build();
        hit = core.replace(big, function (m) { return D[m] !== undefined ? D[m] : m; });
        if (one) hit = hit.replace(one, function (m, n, w) { return n + (D[w] !== undefined ? D[w] : w); });
        hit = hit.replace(/^de (\d+)$/, 'of $1').replace(/\bDía (\d+)/g, 'Day $1').replace(/^Salida (\d)/, 'Departure $1').replace(/^Pagado por /, 'Paid by ').replace(/€ entre (\d+)/g, '€ split by $1').replace(/^Añadir (\d+) tareas?$/, 'Add $1 tasks').replace(/^Añadir /, 'Add ').replace(/ el (\d+ [A-Za-z]{3})\b/g, ' on $1');
        hit = hit.replace(new RegExp('\\b(' + MES.join('|') + ')( de)? (\\d{4})', 'gi'), function (m, a, de, y) { return MEN[MES.indexOf(a.toLowerCase())] + ' ' + y; });
        hit = hit.replace(/(^|[^A-Za-zñáéíóú])(lun|mar|mié|jue|vie|sáb|dom)( \d{1,2} )/g, function (m, b, w, r) { return b + WD[w] + r; })
          .replace(/(\d{1,2}) (ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)(?![A-Za-zñáéíóú])/g, function (m, d, mo) { return d + ' ' + MO[mo]; })
          .replace(/^Add (.+)$/, function (m, r) { return 'Add ' + (D[r] !== undefined ? D[r] : r); });
        hit = hit.replace(/(\d+) de (\d+)\b/g, '$1 of $2').replace(/\bhace (\d+) (min|h|d)\b/g, '$1 $2 ago').replace(/^Hoy\b/, 'Today').replace(/\bNivel (\d+)/g, 'Level $1').replace(/\ba (\d[\d.,]*\s?(?:km|mi|m|ft))\b/g, '$1 away');
      }
      if (Object.keys(cache).length < 6000) cache[core] = hit;
    }
    return hit === core ? text : text.replace(core, function () { return hit; });
  }
  function nums(t) { return t.replace(/(\d)\.(\d{3})(?!\d)/g, '$1\u0001$2').replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2').replace(/\u0001/g, ','); }
  function both(t) { var a = tr(t), b = units(a); return LANG === 'en' && b !== t ? nums(b) : b; }
  function enNum(t) { return t.replace(/(\d)\.(\d{3})(?!\d)/g, '$1\u0001$2').replace(/(\d),(\d)/g, '$1.$2').replace(/\u0001/g, ','); }

  /* ---------- lo que no se toca: lo que ha escrito la gente ---------- */
  var DEEP = '.ev-msg,.club-body,.maplibregl-map,.gr-pin,[data-po],[data-raw],textarea,script,style,.rt-desc,.as-desc,.so-c',
    DIRECT = '.as-evhead h1,.as-ev-t b,.as-hoy-t b,#clNameT,#detailTitle,.as-plan-t b,#followName,.vehicle .name,.vhead .muted,.as-card-h b,.as-card>p,.as-fuel-t>b,.as-frow-t>b,.club-find b,.rg-ava,.as-ticket b,.mname,.ph-place,.club-person b,.as-rows [data-ch="ev"] b,.as-rows [data-cid] b,.as-rows [data-pg] b,.as-rows [data-pg] small,.gr-item b,.gr-item small,.gr-info,.tr-day h3,.tr-stop b,.rg-sheet .head h1.raw,.tr-t,.as-checks li,.name-input';
  function raw(el) { return !!(el && el.matches && (el.matches(DIRECT) || el.closest(DEEP))); }
  var done = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function isNum(s) { return /^\s*-?\d[\d.]*(,\d+)?\s*$/.test(s); }
  var UNIT = { 'km': 'km', 'km/h': 'km/h', 'KM/H': 'km/h', 'Km': 'km', 'l/100 km': '/100 km', '€/100 km': '/100 km' };
  // «47,0» en un sitio y «km» en el de al lado: se localiza la pareja
  function unitEl(n) { var a = n.nextSibling; if (a && a.nodeType === 1 && a.dataset.rgu) return a; var p = n.parentNode && n.parentNode.nextElementSibling; return p && p.dataset.rgu ? p : null; }
  function numNode(el) { var a = el.previousSibling; if (a && a.nodeType === 3 && isNum(a.data)) return a; var p = el.previousElementSibling; if (p && p.childNodes.length === 1 && p.firstChild.nodeType === 3 && isNum(p.firstChild.data)) return p.firstChild; return null; }
  function text(n) {
    var p = n.parentNode; if (!p || p.nodeType !== 1) return;
    var v = n.data; if (done && done.get(n) === v) return;
    if (raw(p)) { var k = v.trim(); if (LANG === 'en' && !p.closest(DEEP) && /\s\S+\s/.test(k) && D[k] !== undefined) { var o0 = v.replace(k, D[k]); if (done) done.set(n, o0); n.data = o0; } return; }
    var out = v, nou = MI && p.closest('[data-nou]'), core = out.trim();
    if (isNum(core)) {
      if (MI && !nou) { var ue = unitEl(n); if (ue) { var c = conv(core, ue.dataset.rgu); if (c) out = out.replace(core, c[0]); } }
      if (LANG === 'en') out = enNum(out);
    } else if (MI && !nou && UNIT[core] && p.childNodes.length === 1 && !p.dataset.rgu) {      // un elemento que solo dice «km»
      p.dataset.rgu = UNIT[core]; var nn = numNode(p);
      if (nn && !(done && done.get(nn) === nn.data)) { var c2 = conv(nn.data.trim(), p.dataset.rgu); if (c2) { var o2 = nn.data.replace(nn.data.trim(), c2[0]); if (LANG === 'en') o2 = enNum(o2); if (done) done.set(nn, o2); nn.data = o2; } }
      out = units(out);
    } else {
      if (LANG === 'en') out = tr(out);
      if (MI && !nou) out = units(out);
      if (LANG === 'en' && out !== v) out = nums(out);
    }
    if (done) done.set(n, out);
    if (out !== v) n.data = out;
  }
  var ATTRS = ['placeholder', 'title', 'aria-label'];
  // campos que guardan kilómetros: en millas se enseñan y se escriben en millas, y se devuelven en km al guardar
  var KMIN = { vOdo: 1, mKm: 1, mLastKm: 1, fuO: 1, raN: 1 };
  function elem(el) {
    if (el.nodeType !== 1) return;
    for (var i = 0; i < ATTRS.length; i++) { var a = el.getAttribute(ATTRS[i]); if (a && el.dataset['rgi' + i] !== a) { var o = el.closest('[data-raw],.maplibregl-map') ? a : both(a); el.dataset['rgi' + i] = o; if (o !== a) el.setAttribute(ATTRS[i], o); } }
    if (MI && el.tagName === 'INPUT' && KMIN[el.id] && !el.dataset.rgmi) { el.dataset.rgmi = '1'; if (el.value && isFinite(+el.value)) el.value = String(Math.round(+el.value / KM)); }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { text(root); return; }
    if (root.nodeType !== 1 || /^(SCRIPT|STYLE|svg)$/.test(root.tagName)) return;
    elem(root); if (root.tagName === 'TEXTAREA') return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: function (n) { if (n.nodeType === 1 && n.tagName === 'TEXTAREA') { elem(n); return NodeFilter.FILTER_REJECT; } return n.nodeType === 1 && /^(SCRIPT|STYLE|svg)$/.test(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } }), n, list = [];
    while ((n = w.nextNode())) list.push(n);
    for (var i = 0; i < list.length; i++) { if (list[i].nodeType === 3) text(list[i]); else elem(list[i]); }
  }
  function toKm(on) { Array.prototype.forEach.call(document.querySelectorAll('input[data-rgmi]'), function (el) { if (!el.value || !isFinite(+el.value)) return; if (on && el.dataset.rgmi === '1') { el.dataset.rgmi = 'km'; el.dataset.rgshow = el.value; el.value = String(Math.round(+el.value * KM)); } else if (!on && el.dataset.rgmi === 'km') { el.dataset.rgmi = '1'; el.value = el.dataset.rgshow; } }); }

  var active = LANG === 'en' || MI;
  if (active) {
    document.documentElement.lang = LANG;
    if (LANG === 'en') {      // fechas y horas en inglés
      ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'].forEach(function (f) { var o = Date.prototype[f]; Date.prototype[f] = function (loc, opt) { return o.call(this, loc === 'es-ES' || loc === 'es' ? 'en-GB' : loc, opt); }; });
    }
    var start = function () {
      walk(document.body);
      new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
          var m = ms[i];
          if (m.type === 'characterData') text(m.target);
          else if (m.type === 'attributes') elem(m.target);
          else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    if (MI) {
      var back = function () { setTimeout(function () { toKm(false); }, 0); };
      document.addEventListener('submit', function () { toKm(true); back(); }, true);
      document.addEventListener('click', function (ev) { if (ev.target.closest && ev.target.closest('button,.btn')) { toKm(true); back(); } }, true);
    }
  }
  window.RGI18N = {
    lang: LANG, mi: MI, t: both, tr: tr,
    setLang: function (l) { if ((l === 'en' ? 'en' : 'es') !== LANG) set('rg.lang', l === 'en' ? 'en' : 'es'); },
    setUnits: function (u) { if ((u === 'mi') !== MI) set('rg.units', u === 'mi' ? 'mi' : 'km'); },
    pick: function (l) { try { localStorage.setItem('rg.lang', l === 'en' ? 'en' : 'es'); } catch (e) {} },      // al crear la cuenta: se guarda y se aplica al entrar
    dist: function (km) { return MI ? km / KM : km; }, toKm: function (v) { return MI ? v * KM : v; }, unit: MI ? 'mi' : 'km'
  };
})();
