-- ReGroupRide · grupo en vivo durante la ruta
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar todo este archivo → Run. Se puede ejecutar más de una vez.
--
-- Diseño para gastar lo mínimo del plan gratis (sin Realtime):
--   · Cada móvil llama a ride_sync cada 15 s: guarda SU posición (una fila por usuario y grupo, que se actualiza)
--     y recibe en la misma llamada las posiciones del grupo.
--   · Las posiciones se borran al terminar: al parar tu ruta, al salir del grupo o cuando el organizador lo cierra.
--     Lo que quede olvidado se limpia solo a las 24 horas.
--   · Las tablas no tienen acceso directo: solo se tocan con estas funciones.
--   · Salida conjunta (ride_start) y avisos de SOS, avería y gasolina (ride_alert) viajan en esa misma llamada.

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

-- Momento en que quien creó el grupo inicia la ruta: a los demás se les inicia sola al verlo.
alter table public.ride_sessions add column if not exists started_at timestamptz;

-- Avisos durante la ruta (SOS, avería, gasolina): quedan en la fila de quien avisa, con el sitio desde donde avisó,
-- hasta que los cancela, sale del grupo o el grupo termina.
alter table public.ride_positions add column if not exists alert text;
alter table public.ride_positions add column if not exists alert_at timestamptz;
alter table public.ride_positions add column if not exists alert_lat double precision;
alter table public.ride_positions add column if not exists alert_lon double precision;
alter table public.ride_positions add column if not exists alert_seen timestamptz;

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
           'at', (extract(epoch from updated_at) * 1000)::bigint, 'owner', user_id = s.owner_id,
           'alert', alert, 'alert_at', (extract(epoch from alert_at) * 1000)::bigint, 'alert_lat', alert_lat, 'alert_lon', alert_lon, 'seen', alert_seen is not null)), '[]'::jsonb)
    into rows from public.ride_positions where session_id = p_id;
  return jsonb_build_object('ended', false, 'now', (extract(epoch from now()) * 1000)::bigint,
    'started', (extract(epoch from s.started_at) * 1000)::bigint, 'positions', rows);
end; $$;

-- Quien creó el grupo inicia la ruta: se apunta la hora y a los demás se les inicia al verla.
create or replace function public.ride_start(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.ride_sessions set started_at = now() where id = p_id and owner_id = auth.uid() and ended_at is null;
  if not found then raise exception 'Solo quien creó el grupo puede iniciar la ruta'; end if;
end; $$;

-- Avisar al grupo: p_kind = 'sos', 'averia' o 'gasolina'; null cancela mi aviso. Guarda desde dónde se avisa.
create or replace function public.ride_alert(p_id uuid, p_kind text default null, p_lat double precision default null, p_lon double precision default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind is not null and p_kind not in ('sos', 'averia', 'gasolina') then raise exception 'Aviso no válido'; end if;
  if not exists (select 1 from public.ride_sessions where id = p_id and ended_at is null) then raise exception 'El grupo ha terminado'; end if;
  if p_kind is null then
    update public.ride_positions set alert = null, alert_at = null, alert_lat = null, alert_lon = null, alert_seen = null where session_id = p_id and user_id = auth.uid();
  else
    update public.ride_positions set alert = p_kind, alert_at = now(), alert_lat = coalesce(p_lat, lat), alert_lon = coalesce(p_lon, lon), alert_seen = null where session_id = p_id and user_id = auth.uid();
  end if;
  if not found then raise exception 'No estás en este grupo'; end if;
end; $$;

-- «Entendido»: quien creó el grupo marca como visto el aviso de alguien (o cualquiera, si quien avisa es quien lo creó).
create or replace function public.ride_alert_seen(p_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare own uuid;
begin
  select owner_id into own from public.ride_sessions where id = p_id;
  if own is null or not exists (select 1 from public.ride_positions where session_id = p_id and user_id = auth.uid()) then raise exception 'No estás en este grupo'; end if;
  if auth.uid() <> own and p_user <> own then return; end if;
  update public.ride_positions set alert_seen = now() where session_id = p_id and user_id = p_user and alert is not null and user_id <> auth.uid();
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
grant execute on function public.ride_start(uuid) to authenticated;
grant execute on function public.ride_alert(uuid, text, double precision, double precision) to authenticated;
grant execute on function public.ride_alert_seen(uuid, uuid) to authenticated;
grant execute on function public.ride_leave(uuid) to authenticated;
grant execute on function public.ride_end(uuid) to authenticated;
