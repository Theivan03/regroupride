import { $, $$, esc, toast, busy, topbar } from '../ui.js';
import { sendFeedback, myFeedback, allFeedback, setFeedbackStatus, screenshotUrl, errText } from '../services.js';

const STATUS = ['recibido', 'en curso', 'hecho', 'descartado'];
const stChip = (s) => `<span class="chip ${s === 'hecho' ? 'green' : s === 'en curso' ? 'amber' : s === 'descartado' ? 'red' : ''}">${esc(s)}</span>`;
const kindChip = (k) => `<span class="chip">${k === 'fallo' ? 'Fallo' : 'Mejora'}</span>`;
const when = (d) => new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export async function feedbackScreen(app, { user }) {
  let kind = 'fallo';
  app.innerHTML = `${topbar('Sugerencias y fallos')}
    <p class="muted">Cuéntanos qué falla o qué mejorarías. El modelo de móvil y la versión de la app se añaden solos.</p>
    <div class="seg" id="kind"><button data-k="fallo" class="on">Algo falla</button><button data-k="mejora">Una mejora</button></div>
    <label for="msg">¿Qué ha pasado o qué propones?</label>
    <textarea id="msg" maxlength="4000" placeholder="Cuanto más concreto, mejor: qué pantalla, qué tocaste, qué esperabas…"></textarea>
    <label for="file">Captura de pantalla (opcional)</label>
    <input id="file" type="file" accept="image/*">
    <button class="btn primary big" id="send" style="margin-top:18px">Enviar</button>
    <h2>Lo que has enviado</h2>
    <div id="mine"><div class="empty"><span class="spin"></span></div></div>`;
  $$('#kind [data-k]', app).forEach((b) => (b.onclick = () => { kind = b.dataset.k; $$('#kind [data-k]', app).forEach((x) => x.classList.toggle('on', x === b)); }));
  const load = async () => {
    try {
      const rows = await myFeedback(user.id);
      $('#mine', app).innerHTML = rows.length ? rows.map((r) => `<div class="card"><div class="chips" style="margin:0 0 6px">${kindChip(r.kind)}${stChip(r.status)}<span class="chip">${when(r.created_at)}</span></div>
        <div style="white-space:pre-wrap">${esc(r.message)}</div>${r.admin_note ? `<p class="muted small" style="margin-top:8px"><b>Respuesta:</b> ${esc(r.admin_note)}</p>` : ''}</div>`).join('')
        : '<div class="empty">Todavía no has enviado nada.</div>';
    } catch (e) { $('#mine', app).innerHTML = `<div class="empty">${esc(errText(e))}</div>`; }
  };
  $('#send', app).onclick = (e) => busy(e.currentTarget, async () => {
    const message = $('#msg', app).value.trim();
    if (message.length < 3) return toast('Escribe un poco más.', true);
    const file = $('#file', app).files[0];
    if (file && file.size > 8 * 1024 * 1024) return toast('La captura pesa demasiado (máximo 8 MB).', true);
    try {
      await sendFeedback(user.id, { kind, message, file });
      $('#msg', app).value = ''; $('#file', app).value = '';
      toast('Enviado. ¡Gracias!');
      load();
    } catch (err) { toast(errText(err), true); }
  });
  load();
}

export async function adminScreen(app, { admin }) {
  if (!admin) { location.hash = '#/perfil'; return; }
  let filter = 'abiertos';
  app.innerHTML = `${topbar('Administración', '#/perfil')}
    <div class="seg" id="flt"><button data-f="abiertos" class="on">Abiertos</button><button data-f="todos">Todos</button></div>
    <div id="list"><div class="empty"><span class="spin"></span></div></div>`;
  let rows = [];
  const render = () => {
    const show = rows.filter((r) => filter === 'todos' || r.status === 'recibido' || r.status === 'en curso');
    $('#list', app).innerHTML = show.length ? show.map((r) => `<div class="card" data-id="${r.id}">
      <div class="chips" style="margin:0 0 6px">${kindChip(r.kind)}${stChip(r.status)}<span class="chip">${when(r.created_at)}</span></div>
      <div style="white-space:pre-wrap">${esc(r.message)}</div>
      <p class="muted small">${esc([r.device?.model, r.device?.os && `${r.device.os} ${r.device.os_version || ''}`, r.app_version && `app ${r.app_version}`].filter(Boolean).join(' · '))}</p>
      ${r.screenshot_path ? `<button class="btn small ghost" data-shot="${esc(r.screenshot_path)}">Ver captura</button><div class="shot"></div>` : ''}
      <label>Estado</label><select data-st>${STATUS.map((s) => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label>Respuesta para el usuario (opcional)</label><input data-note value="${esc(r.admin_note || '')}">
      <button class="btn small primary" data-save style="margin-top:10px">Guardar</button></div>`).join('')
      : '<div class="empty">Nada pendiente.</div>';
    $$('[data-shot]', app).forEach((b) => (b.onclick = async () => {
      const url = await screenshotUrl(b.dataset.shot);
      if (url) b.nextElementSibling.innerHTML = `<img class="thumb" src="${esc(url)}" alt="Captura">`;
    }));
    $$('[data-save]', app).forEach((b) => (b.onclick = () => busy(b, async () => {
      const card = b.closest('[data-id]');
      try {
        await setFeedbackStatus(card.dataset.id, $('[data-st]', card).value, $('[data-note]', card).value.trim());
        toast('Guardado.');
        rows = await allFeedback(); render();
      } catch (err) { toast(errText(err), true); }
    })));
  };
  $$('#flt [data-f]', app).forEach((b) => (b.onclick = () => { filter = b.dataset.f; $$('#flt [data-f]', app).forEach((x) => x.classList.toggle('on', x === b)); render(); }));
  try { rows = await allFeedback(); render(); } catch (e) { $('#list', app).innerHTML = `<div class="empty">${esc(errText(e))}</div>`; }
}
