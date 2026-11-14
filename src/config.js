// Datos públicos del proyecto de Supabase (Project Settings → API).
// La clave "anon / publishable" es pública por diseño: la seguridad la ponen las reglas RLS de supabase/schema.sql.
// Se pueden sobrescribir al compilar con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
const env = import.meta.env || {};
export const SUPABASE_URL = env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || '';
export const APP_VERSION = '0.1.0';
