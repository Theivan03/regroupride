-- ReGroupRide · grupo en vivo durante la ruta
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar todo este archivo → Run. Se puede ejecutar más de una vez.
--
-- Diseño para gastar lo mínimo del plan gratis (sin Realtime):
--   · Cada móvil llama a ride_sync cada 15 s: guarda SU posición (una fila por usuario y grupo, que se actualiza)
--     y recibe en la misma llamada las posiciones del grupo.
--   · Las posiciones se borran al terminar: al parar tu ruta, al salir del grupo o cuando el organizador lo cierra.
--     Lo que quede olvidado se limpia solo a las 24 horas.
--   · Las tablas no tienen acceso directo: solo se tocan con estas funciones.

create table if not exists public.ride_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  route jsonb,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.ride_positions (
  session_id uuid not null references public.ride_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  lat double precision,
  lon double precision,
  speed real,
  along real,                         -- metros recorridos de la ruta (para saber quién va delante y quién atrás)
  off boolean not null default false, -- se ha salido de la ruta
  updated_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

alter table public.ride_sessions enable row level security;
alter table public.ride_positions enable row level security;
-- Sin reglas: nadie lee ni escribe estas tablas directamente.

create or replace function public.ride_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from public.ride_sessions where created_at < now() - interval '24 hours';
$$;

-- Crear un grupo para una ruta. Devuelve {id, code, name}.
create or replace function public.ride_create(p_name text, p_route jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid; c text; nm text;
begin
  if auth.uid() is null then raise exception 'Hay que iniciar sesión'; end if;
  perform public.ride_cleanup();
  loop
    c := upper(substr(translate(md5(random()::text || clock_timestamp()::text), '01', 'XY'), 1, 5));
    exit when not exists (select 1 from public.ride_sessions where code = c);
  end loop;
  insert into public.ride_sessions (code, name, route, owner_id) values (c, coalesce(nullif(trim(p_name), ''), 'Ruta'), p_route, auth.uid()) returning id into sid;
  select coalesce(nullif(name, ''), 'Motero') into nm from public.profiles where id = auth.uid();
  insert into public.ride_positions (session_id, user_id, name) values (sid, auth.uid(), coalesce(nm, 'Motero'));
  return jsonb_build_object('id', sid, 'code', c, 'name', coalesce(nullif(trim(p_name), ''), 'Ruta'));
end; $$;

-- Unirse con el código. Devuelve {id, code, name, route, owner}.
create or replace function public.ride_join(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.ride_sessions; nm text;
begin
  if auth.uid() is null then raise exception 'Hay que iniciar sesión'; end if;
  perform public.ride_cleanup();
  select * into s from public.ride_sessions where code = upper(trim(p_code)) and ended_at is null;
  if s.id is null then raise exception 'Código no válido'; end if;
  select coalesce(nullif(name, ''), 'Motero') into nm from public.profiles where id = auth.uid();
  insert into public.ride_positions (session_id, user_id, name) values (s.id, auth.uid(), coalesce(nm, 'Motero')) on conflict do nothing;
  return jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'route', s.route, 'owner', s.owner_id = auth.uid());
end; $$;

-- Guardar mi posición (si la mando) y leer la del grupo, en una sola llamada.
-- p_clear = true borra mi posición (he parado la ruta) sin sacarme del grupo.
create or replace function public.ride_sync(p_id uuid, p_lat double precision default null, p_lon double precision default null,
  p_speed real default null, p_along real default null, p_off boolean default false, p_clear boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.ride_sessions; rows jsonb;
begin
  select * into s from public.ride_sessions where id = p_id;
  if s.id is null or s.ended_at is not null then return jsonb_build_object('ended', true, 'positions', '[]'::jsonb); end if;
  if not exists (select 1 from public.ride_positions where session_id = p_id and user_id = auth.uid()) then raise exception 'No estás en este grupo'; end if;
  if p_clear then
    update public.ride_positions set lat = null, lon = null, speed = null, along = null, off = false, updated_at = now() where session_id = p_id and user_id = auth.uid();
  elsif p_lat is not null and p_lon is not null then
    update public.ride_positions set lat = p_lat, lon = p_lon, speed = p_speed, along = p_along, off = coalesce(p_off, false), updated_at = now() where session_id = p_id and user_id = auth.uid();
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', name, 'lat', lat, 'lon', lon, 'speed', speed, 'along', along, 'off', off,
           'at', (extract(epoch from updated_at) * 1000)::bigint, 'owner', user_id = s.owner_id)), '[]'::jsonb)
    into rows from public.ride_positions where session_id = p_id;
  return jsonb_build_object('ended', false, 'now', (extract(epoch from now()) * 1000)::bigint, 'positions', rows);
end; $$;

-- Salir del grupo: borra mi fila (y con ella mi posición).
create or replace function public.ride_leave(p_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.ride_positions where session_id = p_id and user_id = auth.uid();
$$;

-- Terminar el grupo para todos (solo quien lo creó): borra todas las posiciones.
create or replace function public.ride_end(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ride_sessions where id = p_id and owner_id = auth.uid()) then raise exception 'Solo quien creó el grupo puede terminarlo'; end if;
  delete from public.ride_positions where session_id = p_id;
  update public.ride_sessions set ended_at = now(), route = null where id = p_id;
end; $$;

revoke all on function public.ride_cleanup() from public, anon, authenticated;
grant execute on function public.ride_create(text, jsonb) to authenticated;
grant execute on function public.ride_join(text) to authenticated;
grant execute on function public.ride_sync(uuid, double precision, double precision, real, real, boolean, boolean) to authenticated;
grant execute on function public.ride_leave(uuid) to authenticated;
grant execute on function public.ride_end(uuid) to authenticated;
