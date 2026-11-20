/* ReGroupRide · encuadrar una foto de perfil: se arrastra para centrarla y se acerca con el deslizador o pellizcando. */
(function () {
  'use strict';
  var OUT = 320, BOX = 280;
  function open(file) {
    return new Promise(function (resolve) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.onload = function () {
        var el = document.createElement('div'); el.className = 'rg-crop';
        el.innerHTML = '<div class="rg-crop-in"><b>Encuadra tu foto</b><span class="muted">Arrástrala para centrarla y acércala si hace falta.</span>' +
          '<div class="rg-crop-stage"><canvas width="' + BOX * 2 + '" height="' + BOX * 2 + '"></canvas><i></i></div>' +
          '<input type="range" min="100" max="400" value="100" aria-label="Acercar">' +
          '<div class="rg-crop-act"><button class="btn" data-a="no" type="button">Cancelar</button><button class="btn primary" data-a="ok" type="button">Usar esta foto</button></div></div>';
        document.body.appendChild(el);
        var cv = el.querySelector('canvas'), cx = cv.getContext('2d'), rng = el.querySelector('input'), stage = el.querySelector('.rg-crop-stage');
        var base = Math.max(1 / img.width, 1 / img.height), z = 1, ox = 0.5, oy = 0.5;      // ox, oy: punto de la foto (0–1) en el centro
        function clamp() { var hw = 0.5 / (base * z * img.width), hh = 0.5 / (base * z * img.height); ox = Math.min(1 - hw, Math.max(hw, ox)); oy = Math.min(1 - hh, Math.max(hh, oy)); }
        function paint(c, size) { var k = base * z * size, w = img.width * k, h = img.height * k; c.fillStyle = '#111'; c.fillRect(0, 0, size, size); c.drawImage(img, size / 2 - ox * w, size / 2 - oy * h, w, h); }
        function draw() { clamp(); paint(cx, cv.width); }
        var pts = {}, last = null, pinch = 0;
        stage.addEventListener('pointerdown', function (e) { stage.setPointerCapture(e.pointerId); pts[e.pointerId] = [e.clientX, e.clientY]; last = null; pinch = 0; });
        stage.addEventListener('pointermove', function (e) {
          if (!pts[e.pointerId]) return; pts[e.pointerId] = [e.clientX, e.clientY];
          var ids = Object.keys(pts), r = stage.getBoundingClientRect().width;
          if (ids.length >= 2) {
            var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
            if (pinch) { z = Math.min(4, Math.max(1, z * d / pinch)); rng.value = Math.round(z * 100); }
            pinch = d; last = null;
          } else {
            if (last) { ox -= (e.clientX - last[0]) / (r * base * z * img.width); oy -= (e.clientY - last[1]) / (r * base * z * img.height); }
            last = [e.clientX, e.clientY];
          }
          draw();
        });
        var up = function (e) { delete pts[e.pointerId]; last = null; pinch = 0; };
        stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
        stage.addEventListener('wheel', function (e) { e.preventDefault(); z = Math.min(4, Math.max(1, z * (e.deltaY < 0 ? 1.08 : 0.93))); rng.value = Math.round(z * 100); draw(); }, { passive: false });
        rng.addEventListener('input', function () { z = rng.value / 100; draw(); });
        function done(v) { URL.revokeObjectURL(url); el.remove(); resolve(v); }
        el.querySelector('[data-a=no]').addEventListener('click', function () { done(null); });
        el.querySelector('[data-a=ok]').addEventListener('click', function () {
          var c = document.createElement('canvas'); c.width = c.height = OUT; clamp(); paint(c.getContext('2d'), OUT);
          done(c.toDataURL('image/jpeg', 0.86));
        });
        draw();
      };
      img.src = url;
    });
  }
  // Abre el selector de fotos del teléfono y, con la elegida, el encuadre.
  function pick() {
    return new Promise(function (resolve) {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none'; document.body.appendChild(inp);
      inp.addEventListener('change', function () { var f = inp.files && inp.files[0]; inp.remove(); if (!f) { resolve(null); return; } open(f).then(resolve); });
      inp.click();
    });
  }
  window.RGCrop = { open: open, pick: pick };
})();
