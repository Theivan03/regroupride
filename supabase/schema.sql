-- ReGroupRide · esquema de la fase 1
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar todo este archivo → Run.
-- Se puede ejecutar más de una vez sin romper nada.

-- ============ Perfiles ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  avatar_url text,
  bike_brand text default '',
  bike_model text default '',
  bike_color text default '',
  range_km integer check (range_km is null or range_km between 30 and 1500),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Datos privados: solo los ve su dueño (y en fases futuras, el SOS).
create table if not exists public.profile_private (
  id uuid primary key references auth.users(id) on delete cascade,
  emergency_name text default '',
  emergency_phone text default '',
  updated_at timestamptz not null default now()
);

-- Administradores de la app (tú). Se añade a mano: ver el final del archivo.
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create or replace function public.is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

-- Al registrarse, se crean su perfil y su parte privada.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name) values (new.id, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  insert into public.profile_private (id) values (new.id) on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ Rutas ============
create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 120),
  description text default '',
  waypoints jsonb not null,           -- [{lat,lng,name,kind}] kind: start|stop|via|end
  geometry jsonb,                     -- [{lat,lng}] trazado simplificado
  distance_m integer,
  duration_s integer,
  source_url text,
  visibility text not null default 'private' check (visibility in ('private','community','public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists routes_owner_idx on public.routes(owner_id, updated_at desc);

-- ============ Sugerencias y fallos ============
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('fallo','mejora')),
  message text not null check (char_length(message) between 3 and 4000),
  screenshot_path text,
  device jsonb,
  app_version text,
  status text not null default 'recibido' check (status in ('recibido','en curso','hecho','descartado')),
  admin_note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback(created_at desc);

-- updated_at automático
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists t_profiles on public.profiles;
create trigger t_profiles before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists t_profile_private on public.profile_private;
create trigger t_profile_private before update on public.profile_private for each row execute function public.touch_updated_at();
drop trigger if exists t_routes on public.routes;
create trigger t_routes before update on public.routes for each row execute function public.touch_updated_at();
drop trigger if exists t_feedback on public.feedback;
create trigger t_feedback before update on public.feedback for each row execute function public.touch_updated_at();

-- El usuario no puede cambiar el estado de su propio aviso: solo el admin.
create or replace function public.feedback_guard() returns trigger language plpgsql as $$
begin
  if not public.is_app_admin() then
    new.status = old.status; new.admin_note = old.admin_note;
  end if;
  return new;
end; $$;
drop trigger if exists t_feedback_guard on public.feedback;
create trigger t_feedback_guard before update on public.feedback for each row execute function public.feedback_guard();

-- ============ Seguridad (RLS) ============
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.app_admins enable row level security;
alter table public.routes enable row level security;
alter table public.feedback enable row level security;

drop policy if exists "perfiles visibles" on public.profiles;
create policy "perfiles visibles" on public.profiles for select to authenticated
  using (is_public or id = auth.uid() or public.is_app_admin());
drop policy if exists "perfil propio" on public.profiles;
create policy "perfil propio" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "privado propio lee" on public.profile_private;
create policy "privado propio lee" on public.profile_private for select to authenticated using (id = auth.uid());
drop policy if exists "privado propio edita" on public.profile_private;
create policy "privado propio edita" on public.profile_private for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "admins se ven" on public.app_admins;
create policy "admins se ven" on public.app_admins for select to authenticated using (user_id = auth.uid());

drop policy if exists "rutas leer" on public.routes;
create policy "rutas leer" on public.routes for select to authenticated
  using (owner_id = auth.uid() or visibility = 'public' or public.is_app_admin());
drop policy if exists "rutas crear" on public.routes;
create policy "rutas crear" on public.routes for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "rutas editar" on public.routes;
create policy "rutas editar" on public.routes for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "rutas borrar" on public.routes;
create policy "rutas borrar" on public.routes for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "feedback leer" on public.feedback;
create policy "feedback leer" on public.feedback for select to authenticated
  using (user_id = auth.uid() or public.is_app_admin());
drop policy if exists "feedback crear" on public.feedback;
create policy "feedback crear" on public.feedback for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "feedback admin" on public.feedback;
create policy "feedback admin" on public.feedback for update to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());

-- ============ Archivos (capturas de los avisos y fotos de perfil) ============
insert into storage.buckets (id, name, public) values ('feedback', 'feedback', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;

drop policy if exists "feedback subir" on storage.objects;
create policy "feedback subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'feedback' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "feedback ver" on storage.objects;
create policy "feedback ver" on storage.objects for select to authenticated
  using (bucket_id = 'feedback' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_app_admin()));
drop policy if exists "avatar subir" on storage.objects;
create policy "avatar subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar cambiar" on storage.objects;
create policy "avatar cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============ Hacerte administrador ============
-- Después de registrarte en la app, ejecuta esto cambiando el correo por el tuyo:
-- insert into public.app_admins (user_id) select id from auth.users where email = 'TU_CORREO' on conflict do nothing;
