-- 31 · Carretera: gasolineras con precio, incidencias de la DGT y avisos de peligro de los moteros.
--  · fuel_stations / road_incidents: los rellena la función «road-data» con datos públicos. Se consultan por cercanía.
--  · data_refresh: cuándo se actualizó cada fuente; las consultas piden otra pasada cuando se queda viejo.
--  · hazards: gravilla, aceite, animales, obras… avisados por los moteros; caducan solos.
--  · news_extra(): también avisa a los administradores de quien pide sitio en una salida abierta, y al que le aceptan.

create table if not exists public.fuel_stations (
  id text primary key, name text not null, addr text, town text, lat double precision not null, lon double precision not null,
  g95 numeric(5,3), g98 numeric(5,3), hours text, updated_at timestamptz not null default now());
create index if not exists fuel_stations_pos on public.fuel_stations (lat, lon);
alter table public.fuel_stations enable row level security;

create table if not exists public.road_incidents (
  id text primary key, kind text not null, sub text, road text, lat double precision not null, lon double precision not null,
  starts_at timestamptz, severity text, seen_at timestamptz not null default now());
create index if not exists road_incidents_pos on public.road_incidents (lat, lon);
alter table public.road_incidents enable row level security;

create table if not exists public.data_refresh (name text primary key, at timestamptz, tried_at timestamptz, note text);
alter table public.data_refresh enable row level security;

create table if not exists public.hazards (
  id bigserial primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('grava', 'aceite', 'animales', 'obras', 'obstaculo', 'mojado', 'otro')),
  lat double precision not null, lon double precision not null, note text check (note is null or char_length(note) <= 140),
  created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '8 hours', gone integer not null default 0);
create index if not exists hazards_pos on public.hazards (lat, lon);
alter table public.hazards enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'hazards' and policyname = 'avisar peligro') then
    create policy "avisar peligro" on public.hazards for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hazards' and policyname = 'mis avisos de peligro') then
    create policy "mis avisos de peligro" on public.hazards for select to authenticated using (user_id = auth.uid());
  end if; end $$;

-- pide a la función que actualice una fuente si lleva demasiado sin hacerlo (no espera a que termine)
create or replace function public.road_refresh(p_what text, p_max interval)
returns void language plpgsql security definer set search_path = public as $$
declare d public.data_refresh; begin
  select * into d from public.data_refresh where name = p_what;
  if d.at is not null and d.at > now() - p_max then return; end if;
  if d.tried_at is not null and d.tried_at > now() - interval '3 minutes' then return; end if;
  begin
    perform net.http_post(url := (select regexp_replace(url, '/functions/v1/.*$', '/functions/v1/road-data') from public.push_config where id = 1),
                          body := jsonb_build_object('what', p_what), headers := '{"Content-Type":"application/json"}'::jsonb);
  exception when others then null; end;
end $$;
revoke all on function public.road_refresh(text, interval) from public, anon, authenticated;

create or replace function public.fuel_near(p_lat double precision, p_lon double precision, p_km integer default 25)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k integer := least(greatest(coalesce(p_km, 25), 2), 80); dl double precision := k / 111.0; dn double precision := k / (111.0 * greatest(cos(radians(p_lat)), 0.2)); r jsonb; begin
  perform public.road_refresh('fuel', interval '5 hours');
  select coalesce(jsonb_agg(x order by (x->>'km')::numeric), '[]'::jsonb) into r from (
    select jsonb_build_object('id', id, 'name', name, 'addr', addr, 'town', town, 'lat', lat, 'lon', lon, 'g95', g95, 'g98', g98, 'hours', hours,
      'km', round(public.km_between(p_lat, p_lon, lat, lon)::numeric, 1)) x
    from public.fuel_stations where lat between p_lat - dl and p_lat + dl and lon between p_lon - dn and p_lon + dn and public.km_between(p_lat, p_lon, lat, lon) <= k
    order by public.km_between(p_lat, p_lon, lat, lon) limit 150) q;
  return jsonb_build_object('rows', r, 'at', (select (extract(epoch from at) * 1000)::bigint from public.data_refresh where name = 'fuel'), 'note', (select note from public.data_refresh where name = 'fuel'));
end $$;

create or replace function public.fuel_box(a_lat double precision, a_lon double precision, b_lat double precision, b_lon double precision)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'town', town, 'lat', lat, 'lon', lon, 'g95', g95, 'g98', g98)), '[]'::jsonb) from (
    select * from public.fuel_stations where lat between least(a_lat, b_lat) - 0.03 and greatest(a_lat, b_lat) + 0.03 and lon between least(a_lon, b_lon) - 0.03 and greatest(a_lon, b_lon) + 0.03
      and abs(a_lat - b_lat) < 6 and abs(a_lon - b_lon) < 8 limit 3000) q;
$$;

create or replace function public.hazards_near(p_lat double precision, p_lon double precision, p_km integer default 40)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k integer := least(greatest(coalesce(p_km, 40), 2), 150); dl double precision := k / 111.0; dn double precision := k / (111.0 * greatest(cos(radians(p_lat)), 0.2)); a jsonb; b jsonb; begin
  perform public.road_refresh('dgt', interval '12 minutes');
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'sub', sub, 'road', road, 'lat', lat, 'lon', lon, 'since', (extract(epoch from starts_at) * 1000)::bigint,
      'km', round(public.km_between(p_lat, p_lon, lat, lon)::numeric, 1))), '[]'::jsonb) into a from (
    select * from public.road_incidents where lat between p_lat - dl and p_lat + dl and lon between p_lon - dn and p_lon + dn limit 400) q;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'note', note, 'lat', lat, 'lon', lon, 'at', (extract(epoch from created_at) * 1000)::bigint, 'mine', user_id = auth.uid(),
      'km', round(public.km_between(p_lat, p_lon, lat, lon)::numeric, 1))), '[]'::jsonb) into b from (
    select * from public.hazards where expires_at > now() and lat between p_lat - dl and p_lat + dl and lon between p_lon - dn and p_lon + dn limit 300) q;
  return jsonb_build_object('dgt', a, 'hz', b, 'at', (select (extract(epoch from at) * 1000)::bigint from public.data_refresh where name = 'dgt'));
end $$;

-- «ya no está»: quien lo avisó lo quita; si lo dicen dos moteros más, también desaparece
create or replace function public.hazard_gone(p_id bigint)
returns void language sql security definer set search_path = public as $$
  update public.hazards set gone = gone + 1, expires_at = case when user_id = auth.uid() or gone + 1 >= 2 then now() else expires_at end where id = p_id and auth.uid() is not null;
$$;

revoke all on function public.fuel_near(double precision, double precision, integer) from public, anon;
revoke all on function public.fuel_box(double precision, double precision, double precision, double precision) from public, anon;
revoke all on function public.hazards_near(double precision, double precision, integer) from public, anon;
revoke all on function public.hazard_gone(bigint) from public, anon;
grant execute on function public.fuel_near(double precision, double precision, integer) to authenticated;
grant execute on function public.fuel_box(double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.hazards_near(double precision, double precision, integer) to authenticated;
grant execute on function public.hazard_gone(bigint) to authenticated;

create or replace function public.news_extra(u uuid, t0 timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('kind', 'note', 'id', 'solo-' || a.id, 'community', 'Voy solo', 'token', a.token, 'lat', a.lat, 'lon', a.lon,
      'head', '⚠️ ' || coalesce(nullif(btrim(p.name), ''), 'Un contacto') || ' puede necesitar ayuda',
      'title', 'Se ha parado en ruta y no responde. Toca para ver dónde está y llámale.', 'at', (extract(epoch from a.created_at) * 1000)::bigint) x
    from public.solo_alerts a left join public.profiles p on p.id = a.user_id where a.to_user = u and a.created_at > greatest(t0, now() - interval '24 hours')
    union all
    select jsonb_build_object('kind', 'note', 'id', 'solok-' || a.id, 'community', 'Voy solo',
      'head', coalesce(nullif(btrim(p.name), ''), 'Tu contacto') || ' está bien', 'title', 'Ha cancelado el aviso.', 'at', (extract(epoch from a.ok_at) * 1000)::bigint)
    from public.solo_alerts a left join public.profiles p on p.id = a.user_id where a.to_user = u and a.ok_at is not null and a.ok_at > greatest(t0, now() - interval '24 hours')
    union all
    select jsonb_build_object('kind', 'note', 'id', 'oreq-' || g.id, 'community', c.name, 'event', e.id, 'head', 'Piden sitio en «' || e.title || '»',
      'title', g.name || coalesce(' · ' || nullif(g.bike, ''), '') || '. Ábrela en «Gestionar» para aceptar o no.', 'at', (extract(epoch from g.joined_at) * 1000)::bigint)
    from public.event_guests g join public.events e on e.id = g.event_id join public.communities c on c.id = e.community_id
      join public.community_members m on m.community_id = e.community_id and m.user_id = u and m.role = 'admin'
    where g.status = 'pending' and g.joined_at > t0 and e.starts_at > now()
    union all
    select jsonb_build_object('kind', 'note', 'id', 'oacc-' || g.id, 'community', c.name, 'head', '¡Tienes plaza en «' || e.title || '»!',
      'title', 'El organizador ha aceptado tu solicitud. Mira los detalles en Explorar → Salidas cerca.', 'at', (extract(epoch from g.updated_at) * 1000)::bigint)
    from public.event_guests g join public.events e on e.id = g.event_id join public.communities c on c.id = e.community_id
    where g.status = 'going' and e.open_near and g.updated_at > t0 and g.updated_at > g.joined_at + interval '5 seconds' and e.starts_at > now()
      and g.email = (select lower(email) from auth.users where id = u)) q;
$$;

-- El servidor del Ministerio corta las conexiones que no vienen de España, así que la función «road-data» no puede
-- bajar las gasolineras. Las baja el teléfono (por provincia) y las deja aquí para todos con fuel_put(), que solo
-- acepta filas con forma y precios razonables. fuel_near() ya no pide la actualización al servidor.
create or replace function public.fuel_near(p_lat double precision, p_lon double precision, p_km integer default 25)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k integer := least(greatest(coalesce(p_km, 25), 2), 80); dl double precision := k / 111.0; dn double precision := k / (111.0 * greatest(cos(radians(p_lat)), 0.2)); r jsonb; t timestamptz; begin
  select coalesce(jsonb_agg(x order by (x->>'km')::numeric), '[]'::jsonb), min(u) into r, t from (
    select jsonb_build_object('id', id, 'name', name, 'addr', addr, 'town', town, 'lat', lat, 'lon', lon, 'g95', g95, 'g98', g98, 'hours', hours,
      'km', round(public.km_between(p_lat, p_lon, lat, lon)::numeric, 1)) x, updated_at u
    from public.fuel_stations where lat between p_lat - dl and p_lat + dl and lon between p_lon - dn and p_lon + dn and public.km_between(p_lat, p_lon, lat, lon) <= k
    order by public.km_between(p_lat, p_lon, lat, lon) limit 150) q;
  return jsonb_build_object('rows', r, 'at', (extract(epoch from t) * 1000)::bigint);
end $$;

create or replace function public.fuel_put(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer; begin
  if auth.uid() is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 4000 then return 0; end if;
  insert into public.fuel_stations (id, name, addr, town, lat, lon, g95, g98, hours, updated_at)
  select x->>'id', left(coalesce(x->>'name', 'Gasolinera'), 60), left(x->>'addr', 120), left(x->>'town', 60), (x->>'lat')::float8, (x->>'lon')::float8,
         (x->>'g95')::numeric(5,3), (x->>'g98')::numeric(5,3), left(x->>'hours', 80), now()
  from jsonb_array_elements(p_rows) x
  where x->>'id' ~ '^[0-9]{1,7}$' and (x->>'lat')::float8 between 27 and 44.5 and (x->>'lon')::float8 between -18.5 and 4.6
    and coalesce((x->>'g95')::numeric, 1.5) between 0.7 and 3.5 and coalesce((x->>'g98')::numeric, 1.5) between 0.7 and 3.5
  on conflict (id) do update set name = excluded.name, addr = excluded.addr, town = excluded.town, lat = excluded.lat, lon = excluded.lon, g95 = excluded.g95, g98 = excluded.g98, hours = excluded.hours, updated_at = now();
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.fuel_put(jsonb) from public, anon;
grant execute on function public.fuel_put(jsonb) to authenticated;
