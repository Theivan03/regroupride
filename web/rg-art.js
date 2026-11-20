/* ReGroupRide · ilustraciones de la pantalla de entrada (dibujos propios) y el selector partido en diagonal. */
(function () {
  'use strict';
  var BIKE = '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="46" cy="104" r="21" stroke-width="7"/><circle cx="152" cy="104" r="21" stroke-width="7"/>' +
    '<circle cx="46" cy="104" r="5" fill="currentColor" stroke="none"/><circle cx="152" cy="104" r="5" fill="currentColor" stroke="none"/>' +
    '<path d="M46 104 L90 92" stroke-width="6"/><path d="M139 60 L152 104" stroke-width="6"/></g>' +
    '<path fill="currentColor" d="M30 66 L74 62 L92 54 Q116 44 138 54 L164 74 L150 82 L122 92 L96 98 L72 94 L60 78 L34 74 Z"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" d="M128 50 Q144 38 152 56"/>' +
    '<path class="a2" d="M86 66 L118 60 L134 70 L104 84 Z"/>';
  var LOGIN = '<svg viewBox="0 0 200 140" aria-hidden="true">' +
    '<g class="a2s" fill="none" stroke-width="4" stroke-linecap="round"><path d="M4 58 H26"/><path d="M0 76 H18"/><path d="M8 94 H20"/></g>' + BIKE +
    '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M78 56 L100 38" stroke-width="14"/><path d="M100 40 L132 54" stroke-width="7"/><path d="M80 60 L102 76 L92 94" stroke-width="9"/></g>' +
    '<circle cx="108" cy="26" r="12" fill="currentColor"/><path class="a2" d="M110 22 h10 a12 12 0 0 1 0 8 h-10 Z"/></svg>';
  var SIGNUP = '<svg viewBox="0 0 200 140" aria-hidden="true">' +
    '<g transform="translate(52 6) scale(.74)">' + BIKE + '</g>' +
    '<g class="a2s" fill="none" stroke-width="4" stroke-linecap="round"><path d="M168 22 v12 M162 28 h12"/><path d="M186 46 v8 M182 50 h8"/><path d="M150 10 v6 M147 13 h6"/></g>' +
    '<circle cx="32" cy="34" r="11" fill="currentColor"/>' +
    '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M32 52 V88" stroke-width="14"/><path d="M32 88 L24 124 M32 88 L42 124" stroke-width="8"/><path d="M34 56 L58 44" stroke-width="7"/></g>' +
    '<g class="a2s" fill="none" stroke-width="4" stroke-linecap="round"><circle cx="66" cy="38" r="6"/><path d="M72 38 H88 M82 38 v6 M87 38 v5"/></g></svg>';
  function split(mode) {
    var b = function (m, art, t, s) { return '<button type="button" data-m="' + m + '" aria-pressed="' + (mode === m) + '"><span class="art">' + art + '</span><span class="tx"><b>' + t + '</b><small>' + s + '</small></span></button>'; };
    return '<div class="rg-split" id="rgMode" data-on="' + mode + '">' + b('login', LOGIN, 'Entrar', 'Ya tengo cuenta') + b('signup', SIGNUP, 'Crear cuenta', 'Soy nuevo') + '<i></i></div>';
  }
  window.RGArt = { login: LOGIN, signup: SIGNUP, split: split };
})();
