-- ReGroupRide · rutas de evento, administradores de ruta, avisos al administrador más cercano,
-- niveles y medias de cada motero, grupos por ritmo y rutas públicas.
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar todo este archivo → Run. Se puede ejecutar más de una vez.
-- Necesita haber ejecutado antes schema.sql, 02_comunidades.sql y 03_grupo.sql.

-- ============ Perfil: nivel y teléfono para las rutas ============
alter table public.profiles add column if not exists level smallint;
do $$ begin
  alter table public.profiles add constraint profiles_level_chk check (level is null or level between 1 and 5);
exception when duplicate_object then null; end $$;
-- El teléfono es privado: solo lo ven los administradores de una ruta en la que también lo seas tú, y quien pida ayuda en ella.
alter table public.profile_private add column if not exists ride_phone text default '';

-- ============ Medias de cada motero (acumuladas: no se recalculan cada vez) ============
create table if not exists public.rider_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rides integer not null default 0,
  km real not null default 0,
  moving_s real not null default 0,      -- segundos en movimiento: km / moving_s = velocidad media
  corners integer not null default 0,
  lean_sum real not null default 0,      -- suma de la inclinación máxima de cada curva: lean_sum / corners = inclinación media en curva
  lean_max real not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.rider_stats enable row level security;
drop policy if exists "medias propias" on public.rider_stats;
create policy "medias propias" on public.rider_stats for select to authenticated using (user_id = auth.uid());

-- Sumar una o varias rutas a mis medias (la app lo llama al guardar cada ruta).
create or replace function public.stats_add(p_rides integer, p_km real, p_moving_s real, p_corners integer, p_lean_sum real, p_lean_max real) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Hay que iniciar sesión'; end if;
  if p_rides is null or p_rides < 1 or p_rides > 5000 or coalesce(p_km, 0) < 0 or p_km > 3000 * p_rides or coalesce(p_moving_s, 0) < 0
     or coalesce(p_corners, 0) < 0 or coalesce(p_lean_sum, 0) < 0 or p_lean_sum > 70.0 * greatest(p_corners, 1) or coalesce(p_lean_max, 0) > 75 then
    raise exception 'Datos de ruta no válidos';
  end if;
  insert into public.rider_stats (user_id, rides, km, moving_s, corners, lean_sum, lean_max)
    values (auth.uid(), p_rides, coalesce(p_km, 0), coalesce(p_moving_s, 0), coalesce(p_corners, 0), coalesce(p_lean_sum, 0), coalesce(p_lean_max, 0))
  on conflict (user_id) do update set rides = rider_stats.rides + excluded.rides, km = rider_stats.km + excluded.km, moving_s = rider_stats.moving_s + excluded.moving_s,
    corners = rider_stats.corners + excluded.corners, lean_sum = rider_stats.lean_sum + excluded.lean_sum, lean_max = greatest(rider_stats.lean_max, excluded.lean_max), updated_at = now();
end; $$;
grant execute on function public.stats_add(integer, real, real, integer, real, real) to authenticated;

-- ============ Administradores de una ruta concreta (evento) ============
create table if not exists public.event_admins (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (event_id, user_id)
);
alter table public.event_admins enable row level security;
drop policy if exists "admins de ruta ver" on public.event_admins;
create policy "admins de ruta ver" on public.event_admins for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.is_member(e.community_id)));
drop policy if exists "admins de ruta poner" on public.event_admins;
create policy "admins de ruta poner" on public.event_admins for insert to authenticated
  with check (exists (select 1 from public.events e where e.id = event_id and public.is_community_admin(e.community_id)));
drop policy if exists "admins de ruta quitar" on public.event_admins;
create policy "admins de ruta quitar" on public.event_admins for delete to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.is_community_admin(e.community_id)));

-- ¿Puedo llevar esta ruta? (administrador de la comunidad o administrador solo de esta ruta)
create or replace function public.can_run_event(eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.events e where e.id = eid and public.is_community_admin(e.community_id))
      or exists (select 1 from public.event_admins a where a.event_id = eid and a.user_id = auth.uid());
$$;

-- ============ Grupo en vivo: más columnas ============
alter table public.ride_sessions add column if not exists event_id uuid references public.events(id) on delete set null;
alter table public.ride_sessions add column if not exists groups jsonb;          -- reparto por grupos que ha enviado un administrador
alter table public.ride_sessions add column if not exists groups_at timestamptz;
alter table public.ride_positions add column if not exists is_admin boolean not null default false;
alter table public.ride_positions add column if not exists alert_to uuid;         -- administrador más cercano: el que tiene que atender el aviso
alter table public.ride_positions add column if not exists alert_seen_by uuid;
alter table public.ride_positions add column if not exists pace_speed real;       -- medición durante esta ruta: velocidad media en movimiento
alter table public.ride_positions add column if not exists pace_lean real;        -- e inclinación media en curva
alter table public.ride_positions add column if not exists pace_min real;         -- minutos en movimiento que lleva medidos

-- Iniciar la ruta de un evento: crea el grupo (o devuelve el que ya esté en marcha) con la ruta del evento.
-- A los apuntados les sale «¿Vienes?» en la app (ride_calls).
create or replace function public.event_start(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.events; s public.ride_sessions; c text; nm text;
begin
  if auth.uid() is null then raise exception 'Hay que iniciar sesión'; end if;
  select * into e from public.events where id = p_event;
  if e.id is null or not public.can_run_event(p_event) then raise exception 'Solo un administrador puede iniciar esta ruta'; end if;
  if e.route is null then raise exception 'Este evento no tiene ruta'; end if;
  perform public.ride_cleanup();
  select * into s from public.ride_sessions where event_id = p_event and ended_at is null and created_at > now() - interval '18 hours' order by created_at desc limit 1;
  if s.id is null then
    loop
      c := upper(substr(translate(md5(random()::text || clock_timestamp()::text), '01', 'XY'), 1, 5));
      exit when not exists (select 1 from public.ride_sessions where code = c);
    end loop;
    insert into public.ride_sessions (code, name, route, owner_id, event_id) values (c, e.title, e.route, auth.uid(), e.id) returning * into s;
  end if;
  select coalesce(nullif(name, ''), 'Motero') into nm from public.profiles where id = auth.uid();
  insert into public.ride_positions (session_id, user_id, name, is_admin) values (s.id, auth.uid(), coalesce(nm, 'Motero'), true)
    on conflict (session_id, user_id) do update set is_admin = true;
  return jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'route', s.route, 'owner', s.owner_id = auth.uid(), 'event_id', s.event_id);
end; $$;

-- Rutas de evento en marcha a las que estoy apuntado y en las que aún no he entrado.
create or replace function public.ride_calls() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'event_id', s.event_id, 'by', coalesce(nullif(pr.name, ''), 'El organizador'),
           'at', (extract(epoch from s.created_at) * 1000)::bigint)), '[]'::jsonb)
  from public.ride_sessions s join public.events e on e.id = s.event_id left join public.profiles pr on pr.id = s.owner_id
  where auth.uid() is not null and s.ended_at is null and s.created_at > now() - interval '12 hours'
    and not exists (select 1 from public.ride_positions p where p.session_id = s.id and p.user_id = auth.uid())
    and (exists (select 1 from public.event_attendees a where a.event_id = e.id and a.user_id = auth.uid() and a.status = 'going')
      or exists (select 1 from public.event_admins x where x.event_id = e.id and x.user_id = auth.uid()));
$$;

-- «Sí, voy»: entrar en la ruta del evento sin código.
create or replace function public.ride_join_event(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.ride_sessions; e public.events; nm text;
begin
  if auth.uid() is null then raise exception 'Hay que iniciar sesión'; end if;
  select * into s from public.ride_sessions where id = p_id and ended_at is null;
  if s.id is null or s.event_id is null then raise exception 'Esa ruta ya ha terminado'; end if;
  select * into e from public.events where id = s.event_id;
  if not public.is_member(e.community_id) then raise exception 'No eres de esta comunidad'; end if;
  select coalesce(nullif(name, ''), 'Motero') into nm from public.profiles where id = auth.uid();
  insert into public.ride_positions (session_id, user_id, name, is_admin) values (s.id, auth.uid(), coalesce(nm, 'Motero'), public.can_run_event(e.id))
    on conflict (session_id, user_id) do update set is_admin = excluded.is_admin;
  return jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'route', s.route, 'owner', s.owner_id = auth.uid(), 'event_id', s.event_id);
end; $$;

-- Unirse con el código (igual que antes; si la ruta es de un evento y soy administrador suyo, entro como tal).
create or replace function public.ride_join(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.ride_sessions; nm text; adm boolean := false;
begin
  if auth.uid() is null then raise exception 'Hay que iniciar sesión'; end if;
  perform public.ride_cleanup();
  select * into s from public.ride_sessions where code = upper(trim(p_code)) and ended_at is null;
  if s.id is null then raise exception 'Código no válido'; end if;
  if s.event_id is not null then adm := public.can_run_event(s.event_id); end if;
  select coalesce(nullif(name, ''), 'Motero') into nm from public.profiles where id = auth.uid();
  insert into public.ride_positions (session_id, user_id, name, is_admin) values (s.id, auth.uid(), coalesce(nm, 'Motero'), adm) on conflict do nothing;
  return jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'route', s.route, 'owner', s.owner_id = auth.uid(), 'event_id', s.event_id);
end; $$;

-- Guardar mi posición (si la mando) y leer la del grupo, en una sola llamada.
-- Devuelve además quién es administrador, a quién le toca cada aviso, el reparto por grupos y, solo a los administradores,
-- el nivel y las medias de cada uno. El teléfono de un administrador solo lo reciben los demás administradores y quien ha pedido ayuda.
create or replace function public.ride_sync(p_id uuid, p_lat double precision default null, p_lon double precision default null,
  p_speed real default null, p_along real default null, p_off boolean default false, p_clear boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.ride_sessions; me public.ride_positions; adm boolean; rows jsonb;
begin
  select * into s from public.ride_sessions where id = p_id;
  if s.id is null or s.ended_at is not null then return jsonb_build_object('ended', true, 'positions', '[]'::jsonb); end if;
  select * into me from public.ride_positions where session_id = p_id and user_id = auth.uid();
  if me.user_id is null then raise exception 'No estás en este grupo'; end if;
  if p_clear then
    update public.ride_positions set lat = null, lon = null, speed = null, along = null, off = false, updated_at = now() where session_id = p_id and user_id = auth.uid();
  elsif p_lat is not null and p_lon is not null then
    update public.ride_positions set lat = p_lat, lon = p_lon, speed = p_speed, along = p_along, off = coalesce(p_off, false), updated_at = now() where session_id = p_id and user_id = auth.uid();
  end if;
  adm := (s.owner_id = auth.uid()) or me.is_admin;
  select coalesce(jsonb_agg(
      jsonb_build_object('user_id', p.user_id, 'name', p.name, 'lat', p.lat, 'lon', p.lon, 'speed', p.speed, 'along', p.along, 'off', p.off,
        'at', (extract(epoch from p.updated_at) * 1000)::bigint, 'owner', p.user_id = s.owner_id, 'admin', (p.user_id = s.owner_id or p.is_admin),
        'alert', p.alert, 'alert_at', (extract(epoch from p.alert_at) * 1000)::bigint, 'alert_lat', p.alert_lat, 'alert_lon', p.alert_lon,
        'alert_to', p.alert_to, 'seen', p.alert_seen is not null, 'seen_by', p.alert_seen_by)
      || case when adm then jsonb_build_object('level', pr.level, 'hr', coalesce(rs.rides, 0),
           'hs', case when rs.moving_s > 600 then round((rs.km / (rs.moving_s / 3600.0))::numeric, 1) end,
           'hl', case when rs.corners >= 5 then round((rs.lean_sum / rs.corners)::numeric, 1) end,
           'ps', p.pace_speed, 'pl', p.pace_lean, 'pm', p.pace_min) else '{}'::jsonb end
      || case when (p.user_id = s.owner_id or p.is_admin) and (adm or me.alert is not null) and coalesce(pp.ride_phone, '') <> ''
           then jsonb_build_object('phone', pp.ride_phone) else '{}'::jsonb end), '[]'::jsonb)
    into rows
    from public.ride_positions p
      left join public.profiles pr on pr.id = p.user_id
      left join public.rider_stats rs on rs.user_id = p.user_id
      left join public.profile_private pp on pp.id = p.user_id
    where p.session_id = p_id;
  return jsonb_build_object('ended', false, 'now', (extract(epoch from now()) * 1000)::bigint,
    'started', (extract(epoch from s.started_at) * 1000)::bigint, 'admin', adm, 'event_id', s.event_id,
    'groups', s.groups, 'groups_at', (extract(epoch from s.groups_at) * 1000)::bigint, 'positions', rows);
end; $$;

-- Iniciar la ruta para todos: cualquier administrador de la ruta.
create or replace function public.ride_start(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.ride_sessions s set started_at = now() where s.id = p_id and s.ended_at is null
    and (s.owner_id = auth.uid() or exists (select 1 from public.ride_positions p where p.session_id = p_id and p.user_id = auth.uid() and p.is_admin));
  if not found then raise exception 'Solo un administrador de la ruta puede iniciarla'; end if;
end; $$;

-- Avisar: 'sos', 'averia' o 'gasolina'; null cancela mi aviso. Se apunta desde dónde se avisa y qué administrador está más cerca.
create or replace function public.ride_alert(p_id uuid, p_kind text default null, p_lat double precision default null, p_lon double precision default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.ride_sessions; me public.ride_positions; alat double precision; alon double precision; target uuid;
begin
  if p_kind is not null and p_kind not in ('sos', 'averia', 'gasolina') then raise exception 'Aviso no válido'; end if;
  select * into s from public.ride_sessions where id = p_id and ended_at is null;
  if s.id is null then raise exception 'El grupo ha terminado'; end if;
  select * into me from public.ride_positions where session_id = p_id and user_id = auth.uid();
  if me.user_id is null then raise exception 'No estás en este grupo'; end if;
  if p_kind is null then
    update public.ride_positions set alert = null, alert_at = null, alert_lat = null, alert_lon = null, alert_seen = null, alert_to = null, alert_seen_by = null
      where session_id = p_id and user_id = auth.uid();
    return;
  end if;
  alat := coalesce(p_lat, me.lat); alon := coalesce(p_lon, me.lon);
  -- El administrador más cercano con posición reciente; si ninguno la tiene, quien creó el grupo.
  select p.user_id into target from public.ride_positions p
    where p.session_id = p_id and p.user_id <> auth.uid() and (p.user_id = s.owner_id or p.is_admin)
    order by (p.lat is null or p.updated_at < now() - interval '3 minutes'),
             case when alat is not null and p.lat is not null then power(p.lat - alat, 2) + power((p.lon - alon) * cos(radians(alat)), 2) end nulls last,
             (p.user_id = s.owner_id) desc
    limit 1;
  update public.ride_positions set alert = p_kind, alert_at = now(), alert_lat = alat, alert_lon = alon, alert_seen = null, alert_to = target, alert_seen_by = null
    where session_id = p_id and user_id = auth.uid();
end; $$;

-- «Entendido»: un administrador (o aquel a quien le toca el aviso) lo marca como visto.
create or replace function public.ride_alert_seen(p_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.ride_sessions; me public.ride_positions; a public.ride_positions;
begin
  select * into s from public.ride_sessions where id = p_id;
  select * into me from public.ride_positions where session_id = p_id and user_id = auth.uid();
  if s.id is null or me.user_id is null then raise exception 'No estás en este grupo'; end if;
  select * into a from public.ride_positions where session_id = p_id and user_id = p_user;
  if a.user_id is null or a.alert is null or a.user_id = auth.uid() then return; end if;
  if not (s.owner_id = auth.uid() or me.is_admin or a.alert_to = auth.uid() or a.alert_to is null) then return; end if;
  update public.ride_positions set alert_seen = now(), alert_seen_by = auth.uid() where session_id = p_id and user_id = p_user;
end; $$;

-- Dar o quitar el papel de administrador de esta ruta a alguien del grupo.
create or replace function public.ride_set_admin(p_id uuid, p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ride_sessions s where s.id = p_id and s.ended_at is null
       and (s.owner_id = auth.uid() or exists (select 1 from public.ride_positions p where p.session_id = p_id and p.user_id = auth.uid() and p.is_admin))) then
    raise exception 'Solo un administrador de la ruta puede hacerlo';
  end if;
  update public.ride_positions set is_admin = coalesce(p_on, false) where session_id = p_id and user_id = p_user;
end; $$;

-- Mi medición durante esta ruta (velocidad media en movimiento, inclinación media en curva, minutos medidos).
create or replace function public.ride_pace(p_id uuid, p_speed real, p_lean real, p_min real) returns void
language sql security definer set search_path = public as $$
  update public.ride_positions set pace_speed = least(greatest(p_speed, 0), 250), pace_lean = least(greatest(p_lean, 0), 70), pace_min = greatest(p_min, 0)
    where session_id = p_id and user_id = auth.uid();
$$;

-- Enviar a todos el reparto por grupos (null lo retira). Solo administradores de la ruta.
create or replace function public.ride_groups(p_id uuid, p_groups jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.ride_sessions s set groups = p_groups, groups_at = case when p_groups is null then null else now() end
    where s.id = p_id and s.ended_at is null
      and (s.owner_id = auth.uid() or exists (select 1 from public.ride_positions p where p.session_id = p_id and p.user_id = auth.uid() and p.is_admin));
  if not found then raise exception 'Solo un administrador de la ruta puede organizar los grupos'; end if;
end; $$;

grant execute on function public.event_start(uuid) to authenticated;
grant execute on function public.ride_calls() to authenticated;
grant execute on function public.ride_join_event(uuid) to authenticated;
grant execute on function public.ride_set_admin(uuid, uuid, boolean) to authenticated;
grant execute on function public.ride_pace(uuid, real, real, real) to authenticated;
grant execute on function public.ride_groups(uuid, jsonb) to authenticated;

-- ============ Rutas públicas ============
alter table public.routes add column if not exists plan jsonb;                   -- la ruta tal como la usa la app: {wps, coords, steps, pois, dist, dur}
alter table public.routes add column if not exists start_lat double precision;
alter table public.routes add column if not exists start_lon double precision;
create index if not exists routes_public_idx on public.routes(created_at desc) where visibility = 'public';

-- El administrador de la app puede retirar una ruta pública denunciada.
drop policy if exists "rutas borrar" on public.routes;
create policy "rutas borrar" on public.routes for delete to authenticated using (owner_id = auth.uid() or public.is_app_admin());

-- Lista de rutas públicas (sin el trazado, que se pide al abrir una). Con posición, primero las que salen más cerca.
create or replace function public.routes_public(p_lat double precision default null, p_lon double precision default null, p_limit integer default 40) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.o), '[]'::jsonb) from (
    select jsonb_build_object('id', r.id, 'name', r.name, 'description', r.description, 'm', r.distance_m, 's', r.duration_s,
             'lat', r.start_lat, 'lon', r.start_lon, 'at', (extract(epoch from r.created_at) * 1000)::bigint,
             'by', coalesce(nullif(pr.name, ''), 'Motero'), 'mine', r.owner_id = auth.uid()) as o
    from public.routes r left join public.profiles pr on pr.id = r.owner_id
    where r.visibility = 'public' and r.plan is not null
    order by case when p_lat is not null and r.start_lat is not null
               then power(r.start_lat - p_lat, 2) + power((r.start_lon - p_lon) * cos(radians(p_lat)), 2) end nulls last, r.created_at desc
    limit least(greatest(coalesce(p_limit, 40), 1), 100)) x;
$$;
grant execute on function public.routes_public(double precision, double precision, integer) to authenticated;
