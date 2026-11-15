// Acceso a Supabase y a las funciones nativas del móvil.
import { createClient } from '@supabase/supabase-js';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Device } from '@capacitor/device';
import { App } from '@capacitor/app';
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION } from './config.js';

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  : null;
export const isNative = Capacitor.isNativePlatform();

function check(res) {
  if (res.error) throw new Error(translate(res.error.message));
  return res.data;
}

function translate(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('invalid login')) return 'Correo o contraseña incorrectos.';
  if (m.includes('already registered')) return 'Ese correo ya tiene cuenta. Entra con tu contraseña.';
  if (m.includes('password should be')) return 'La contraseña tiene que tener al menos 6 caracteres.';
  if (m.includes('email not confirmed')) return 'Tienes que confirmar el correo antes de entrar.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sin conexión con el servidor. Revisa tu cobertura.';
  return msg;
}
export const errText = (e) => translate(e?.message || String(e));

// ---------- Sesión ----------
export async function currentUser() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user || null;
}
export async function signIn(email, password) {
  return check(await sb.auth.signInWithPassword({ email, password }));
}
export async function signUp(name, email, password) {
  const data = check(await sb.auth.signUp({ email, password, options: { data: { name } } }));
  if (!data.session) throw new Error('Cuenta creada. Confirma el correo que te hemos enviado y luego entra.');
  return data;
}
export async function signOut() { await sb.auth.signOut(); }
export async function resetPassword(email) { return check(await sb.auth.resetPasswordForEmail(email)); }

// ---------- Perfil ----------
export async function getProfile(uid) {
  const [p, priv] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
    sb.from('profile_private').select('*').eq('id', uid).maybeSingle(),
  ]);
  return { ...(check(p) || {}), ...(check(priv) || {}) };
}
export async function saveProfile(uid, v) {
  check(await sb.from('profiles').update({
    name: v.name, bike_brand: v.bike_brand, bike_model: v.bike_model, bike_color: v.bike_color,
    range_km: v.range_km || null, is_public: v.is_public,
  }).eq('id', uid));
  check(await sb.from('profile_private').update({ emergency_name: v.emergency_name, emergency_phone: v.emergency_phone }).eq('id', uid));
}
export async function isAdmin(uid) {
  const r = await sb.from('app_admins').select('user_id').eq('user_id', uid).maybeSingle();
  return Boolean(r.data);
}

// ---------- Rutas ----------
const ROUTE_COLS = 'id, owner_id, name, description, waypoints, geometry, distance_m, duration_s, visibility, source_url, updated_at';
export async function myRoutes(uid) {
  return check(await sb.from('routes').select(ROUTE_COLS).eq('owner_id', uid).order('updated_at', { ascending: false }));
}
export async function publicRoutes(uid) {
  return check(await sb.from('routes').select(ROUTE_COLS).eq('visibility', 'public').neq('owner_id', uid)
    .order('updated_at', { ascending: false }).limit(50));
}
export async function getRoute(id) {
  return check(await sb.from('routes').select(ROUTE_COLS).eq('id', id).maybeSingle());
}
export async function saveRoute(route) {
  const row = {
    name: route.name, description: route.description || '', waypoints: route.waypoints, geometry: route.geometry,
    distance_m: Math.round(route.distance_m || 0), duration_s: Math.round(route.duration_s || 0),
    visibility: route.visibility || 'private', source_url: route.source_url || null,
  };
  if (route.id) return check(await sb.from('routes').update(row).eq('id', route.id).select('id').single());
  return check(await sb.from('routes').insert(row).select('id').single());
}
export async function deleteRoute(id) { check(await sb.from('routes').delete().eq('id', id)); }

// ---------- Sugerencias y fallos ----------
export async function deviceInfo() {
  const out = { app_version: APP_VERSION };
  try {
    const d = await Device.getInfo();
    Object.assign(out, { platform: d.platform, model: `${d.manufacturer || ''} ${d.model || ''}`.trim(), os: d.operatingSystem, os_version: d.osVersion, webview: d.webViewVersion });
  } catch { /* navegador */ }
  try { if (isNative) { const a = await App.getInfo(); out.app_build = a.build; out.app_version = a.version || APP_VERSION; } } catch { /* nada */ }
  return out;
}
export async function sendFeedback(uid, { kind, message, file }) {
  let screenshot_path = null;
  if (file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    screenshot_path = `${uid}/${Date.now()}.${ext}`;
    check(await sb.storage.from('feedback').upload(screenshot_path, file, { contentType: file.type || 'image/jpeg' }));
  }
  const device = await deviceInfo();
  check(await sb.from('feedback').insert({ kind, message, screenshot_path, device, app_version: device.app_version }));
}
export async function myFeedback(uid) {
  return check(await sb.from('feedback').select('*').eq('user_id', uid).order('created_at', { ascending: false }));
}
export async function allFeedback() {
  return check(await sb.from('feedback').select('*').order('created_at', { ascending: false }).limit(200));
}
export async function setFeedbackStatus(id, status, admin_note) {
  check(await sb.from('feedback').update({ status, admin_note }).eq('id', id));
}
export async function screenshotUrl(path) {
  const r = await sb.storage.from('feedback').createSignedUrl(path, 3600);
  return r.data?.signedUrl || null;
}

// ---------- Ubicación ----------
export async function getPosition() {
  if (isNative) {
    const perm = await Geolocation.checkPermissions();
    if (perm.location !== 'granted') {
      const req = await Geolocation.requestPermissions({ permissions: ['location'] });
      if (req.location !== 'granted') throw new Error('Sin permiso de ubicación. Actívalo en Ajustes → Aplicaciones → ReGroupRide.');
    }
  }
  const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  return { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
}
export async function watchPosition(cb) {
  const id = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }, (p, err) => {
    if (p) cb({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
  });
  return () => Geolocation.clearWatch({ id });
}

// ---------- Enlaces cortos de Google Maps ----------
export async function expandShortLink(url) {
  if (!isNative) throw new Error('Los enlaces cortos solo se pueden abrir desde la app del móvil. En el ordenador, pega el enlace largo.');
  const r = await CapacitorHttp.request({ url, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile' } });
  if (r.url && /google\.[a-z.]+\/maps/i.test(r.url)) return r.url;
  const body = typeof r.data === 'string' ? r.data : '';
  const m = body.match(/https:\/\/www\.google\.[a-z.]+\/maps\/[^"'\s<>]+/i);
  if (m) return m[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
  throw new Error('No he podido abrir el enlace corto. Prueba a copiar el enlace completo desde el navegador.');
}
