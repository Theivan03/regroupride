// Datos públicos del proyecto de Supabase (Project Settings → API).
// La clave "anon / publishable" es pública por diseño: la seguridad la ponen las reglas RLS de supabase/schema.sql.
// Se pueden sobrescribir al compilar con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
const env = import.meta.env || {};
export const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://lpkeaxtzfbuqjkkusjit.supabase.co';
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_lUo3IlFV8X0pVL5HUfbgNA_VLeizTOw';
export const APP_VERSION = '0.1.0';
