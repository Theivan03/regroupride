/* ReGroupRide · el mapa de la Dirección A «Quedada».
   Un estilo propio sobre las teselas de OpenFreeMap (esquema OpenMapTiles): fondo crema o pizarra,
   verde, agua, carreteras claras con las principales en tono ocre y pocos rótulos. No pide nada a la red
   para montarse, así que el mapa arranca sin esperar a descargar un estilo. */
(function (root) {
  'use strict';
  var PAL = {
    day:   { land: '#F4F1EC', green: '#ACD2A0', water: '#A9D3E0', build: '#E9E5DE', road: '#FCFBF9', roadCase: '#C6BFB5', main: '#FBD6A4', mainCase: '#E3B67C',
             path: '#B9B2A8', rail: '#C9C4BC', border: '#B4ADA3', label: '#4A5563', labelSoft: '#727C89', labelWater: '#4F8FA6', halo: '#F4F1EC' },
    night: { land: '#1D2226', green: '#1F3226', water: '#13313F', build: '#232930', road: '#3F474F', roadCase: '#12161A', main: '#6A5839', mainCase: '#12161A',
             path: '#4A525B', rail: '#30363D', border: '#4A525B', label: '#C3CBD4', labelSoft: '#8A94A0', labelWater: '#5C93AA', halo: '#1D2226' }
  };
  function w(a, b, c, d) { return ['interpolate', ['exponential', 1.5], ['zoom'], 6, a, 10, b, 14, c, 18, d]; }
  function cls() { return ['match', ['get', 'class'], Array.prototype.slice.call(arguments), true, false]; }
  var NAME = ['coalesce', ['get', 'name:es'], ['get', 'name:latin'], ['get', 'name']];
  function style(dark) {
    var c = dark ? PAL.night : PAL.day, T = 'transportation', L = [];
    function line(id, filter, color, width, extra) {
      var l = { id: id, type: 'line', source: 'omt', 'source-layer': T, filter: filter, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': width } }, k;
      for (k in (extra || {})) { if (k === 'minzoom') l.minzoom = extra[k]; else if (k === 'cap') l.layout['line-cap'] = extra[k]; else l.paint[k] = extra[k]; }
      L.push(l);
    }
    function label(id, layer, filter, field, size, color, extra) {
      var l = { id: id, type: 'symbol', source: 'omt', 'source-layer': layer, layout: { 'text-field': field, 'text-font': ['Noto Sans Regular'], 'text-size': size, 'text-max-width': 8 },
        paint: { 'text-color': color, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } }, k;
      if (filter) l.filter = filter;
      for (k in (extra || {})) { if (k === 'minzoom' || k === 'maxzoom') l[k] = extra[k]; else l.layout[k] = extra[k]; }
      L.push(l);
    }
    L.push({ id: 'bg', type: 'background', paint: { 'background-color': c.land } });
    L.push({ id: 'verde', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('wood', 'grass'), paint: { 'fill-color': c.green, 'fill-opacity': ['match', ['get', 'class'], 'wood', dark ? 0.75 : 0.6, dark ? 0.45 : 0.35], 'fill-antialias': false } });
    L.push({ id: 'parque', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.green, 'fill-opacity': dark ? 0.55 : 0.45 } });
    L.push({ id: 'jardin', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('park', 'pitch', 'cemetery', 'stadium', 'playground'), paint: { 'fill-color': c.green, 'fill-opacity': dark ? 0.6 : 0.5 } });
    L.push({ id: 'rio', type: 'line', source: 'omt', 'source-layer': 'waterway', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.water, 'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 0.8, 13, 2.2, 18, 8] } });
    L.push({ id: 'agua', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } });
    L.push({ id: 'edificios', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': c.build, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 1] } });
    L.push({ id: 'pista', type: 'line', source: 'omt', 'source-layer': 'aeroway', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': c.roadCase, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 1, 16, 18] } });
    var fPath = cls('path', 'track'), fMinor = cls('minor', 'service'), fMid = cls('secondary', 'tertiary'), fMain = cls('primary', 'trunk'), fMw = cls('motorway');
    line('senda', fPath, c.path, ['interpolate', ['linear'], ['zoom'], 13, 0.6, 18, 2.2], { minzoom: 13, 'line-dasharray': [2, 2], cap: 'butt' });
    line('tren', cls('rail', 'transit'), c.rail, ['interpolate', ['linear'], ['zoom'], 9, 0.6, 16, 2], { minzoom: 9, cap: 'butt' });
    /* bordes primero, rellenos después: en los cruces no se pisan */
    line('calle-borde', fMinor, c.roadCase, w(0, 0, 4.4, 19), { minzoom: 12 });
    line('via-borde', fMid, c.roadCase, w(0, 2.6, 7.8, 24), { minzoom: 8 });
    line('principal-borde', fMain, c.mainCase, w(1, 3.6, 8.5, 26), { minzoom: 6 });
    line('autovia-borde', fMw, c.mainCase, w(1.8, 4.6, 10, 30), { minzoom: 5 });
    line('calle', fMinor, c.road, w(0, 0, 2.8, 16), { minzoom: 12 });
    line('via', fMid, dark ? '#454D56' : c.road, w(0, 1.6, 5.6, 21), { minzoom: 8 });
    line('principal', fMain, c.main, w(0.7, 2.4, 6.4, 23), { minzoom: 6 });
    line('autovia', fMw, c.main, w(1.2, 3.2, 7.8, 27), { minzoom: 5 });
    L.push({ id: 'frontera', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': c.border, 'line-width': 1, 'line-dasharray': [3, 2], 'line-opacity': 0.7 } });
    /* rótulos: pocos y discretos, que lo que manda es tu ruta */
    label('agua-nombre', 'water_name', null, NAME, 12, c.labelWater, { 'text-font': ['Noto Sans Italic'], minzoom: 9 });
    label('ctra-ref', 'transportation_name', ['all', ['has', 'ref'], cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary')], ['get', 'ref'], ['interpolate', ['linear'], ['zoom'], 9, 10, 15, 12], c.labelSoft,
      { 'text-font': ['Noto Sans Italic'], 'symbol-placement': 'line', 'symbol-spacing': 320, 'text-letter-spacing': 0.04, minzoom: 9, maxzoom: 14.5 });
    label('ctra-nombre', 'transportation_name', null, ['coalesce', ['get', 'name:latin'], ['get', 'name'], ['get', 'ref']], ['interpolate', ['linear'], ['zoom'], 14, 10.5, 18, 13], c.labelSoft,
      { 'text-font': ['Noto Sans Italic'], 'symbol-placement': 'line', 'symbol-spacing': 280, minzoom: 14.5 });
    L.push({ id: 'gasolinera', type: 'circle', source: 'omt', 'source-layer': 'poi', minzoom: 12.5, filter: ['==', ['get', 'class'], 'fuel'],
      paint: { 'circle-radius': 4, 'circle-color': dark ? '#FFC24A' : '#9A5B00', 'circle-stroke-color': c.halo, 'circle-stroke-width': 1.5 } });
    label('gasolinera-nombre', 'poi', ['==', ['get', 'class'], 'fuel'], NAME, 10.5, c.labelSoft, { 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true, minzoom: 14 });
    label('barrio', 'place', cls('suburb', 'neighbourhood', 'quarter', 'hamlet', 'isolated_dwelling'), NAME, 11, c.labelSoft, { 'text-transform': 'uppercase', 'text-letter-spacing': 0.06, minzoom: 12.5 });
    label('pueblo', 'place', cls('village'), NAME, ['interpolate', ['linear'], ['zoom'], 9, 11, 15, 15], c.label, { 'text-font': ['Noto Sans Bold'], minzoom: 9.5 });
    label('ciudad', 'place', cls('town'), NAME, ['interpolate', ['linear'], ['zoom'], 7, 11.5, 14, 17], c.label, { 'text-font': ['Noto Sans Bold'], minzoom: 7 });
    label('capital', 'place', cls('city'), NAME, ['interpolate', ['linear'], ['zoom'], 4, 12, 12, 20], c.label, { 'text-font': ['Noto Sans Bold'], minzoom: 3 });
    label('pais', 'place', cls('country', 'state'), NAME, ['interpolate', ['linear'], ['zoom'], 2, 11, 6, 15], c.labelSoft, { 'text-transform': 'uppercase', 'text-letter-spacing': 0.1, maxzoom: 7 });
    return {
      version: 8, name: 'ReGroupRide · Quedada · ' + (dark ? 'noche' : 'día'),
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' } },
      layers: L
    };
  }
  style.palette = PAL;
  root.RGMapStyle = style;
  if (typeof module !== 'undefined' && module.exports) module.exports = style;
})(typeof window !== 'undefined' ? window : globalThis);
