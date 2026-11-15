import { $, esc, toast, busy, topbar } from '../ui.js';
import { getProfile, saveProfile, signOut, errText } from '../services.js';
import { APP_VERSION } from '../config.js';

export async function profileScreen(app, { user, admin, onSignOut }) {
  app.innerHTML = `${topbar('Perfil')}<div class="empty"><span class="spin"></span></div>`;
  let p;
  try { p = await getProfile(user.id); } catch (e) { app.innerHTML = `${topbar('Perfil')}<div class="empty">${esc(errText(e))}</div>`; return; }
  app.innerHTML = `${topbar('Perfil')}
    <p class="muted">${esc(user.email)}</p>
    <form id="f">
      <label for="name">Nombre</label><input id="name" maxlength="60" value="${esc(p.name)}" required>
      <h2>Tu moto</h2>
      <div class="row"><div><label for="brand">Marca</label><input id="brand" maxlength="40" value="${esc(p.bike_brand)}" placeholder="Zontes"></div>
        <div><label for="model">Modelo</label><input id="model" maxlength="40" value="${esc(p.bike_model)}" placeholder="703RR"></div></div>
      <div class="row"><div><label for="color">Color</label><input id="color" maxlength="30" value="${esc(p.bike_color)}" placeholder="Negra"></div>
        <div><label for="range">Autonomía (km)</label><input id="range" type="number" inputmode="numeric" min="30" max="1500" value="${p.range_km ?? ''}" placeholder="250"></div></div>
      <p class="muted small">La autonomía servirá para avisarte de los tramos largos sin gasolineras.</p>
      <h2>Contacto de emergencia</h2>
      <p class="muted small">Privado: no lo ve nadie. Solo se usará para avisarle si pulsas SOS (llegará en la fase 2).</p>
      <label for="ename">Nombre</label><input id="ename" maxlength="60" value="${esc(p.emergency_name)}">
      <label for="ephone">Teléfono</label><input id="ephone" type="tel" maxlength="20" value="${esc(p.emergency_phone)}">
      <h2>Privacidad</h2>
      <div class="seg" id="pub"><button type="button" data-v="1" class="${p.is_public ? 'on' : ''}">Perfil público</button><button type="button" data-v="0" class="${p.is_public ? '' : 'on'}">Perfil privado</button></div>
      <p class="muted small">Público: los demás ven tu nombre y tu moto en las rutas. Tu correo y tu contacto de emergencia nunca se muestran.</p>
      <button class="btn primary big" type="submit" style="margin-top:22px">Guardar</button>
    </form>
    ${admin ? '<a class="btn" href="#/admin">Panel de administración</a>' : ''}
    <button class="btn danger" id="out">Cerrar sesión</button>
    <p class="muted small" style="text-align:center">ReGroupRide ${APP_VERSION}</p>`;
  let isPublic = p.is_public;
  app.querySelectorAll('#pub [data-v]').forEach((b) => (b.onclick = () => {
    isPublic = b.dataset.v === '1';
    app.querySelectorAll('#pub [data-v]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#f', app).onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      try {
        await saveProfile(user.id, {
          name: $('#name', app).value.trim(), bike_brand: $('#brand', app).value.trim(), bike_model: $('#model', app).value.trim(),
          bike_color: $('#color', app).value.trim(), range_km: parseInt($('#range', app).value, 10) || null, is_public: isPublic,
          emergency_name: $('#ename', app).value.trim(), emergency_phone: $('#ephone', app).value.trim(),
        });
        toast('Perfil guardado.');
      } catch (err) { toast(errText(err), true); }
    });
  };
  $('#out', app).onclick = async () => { await signOut(); onSignOut(); };
}
