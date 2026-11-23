-- 30 · Modo «voy solo» (contactos de emergencia y aviso), enlace de seguimiento y salidas abiertas cerca.
--  · emergency_contacts: los contactos de cada uno (solo los ve su dueño).
--  · live_shares: un enlace de seguimiento por ruta; quien tenga el enlace ve la posición (live_share_get, sin cuenta).
--  · solo_alert()/solo_ok(): avisa a los contactos que tengan la app (por su teléfono) y lo retira.
--  · news_extra(): avisos añadidos a community_news() sin tener que volver a tocarla.
--  · events.open_near + open_events_near(): salidas que el organizador abre a quien esté cerca.

create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  phone text not null check (char_length(phone) between 6 and 24),
  created_at timestamptz not null default now());
alter table public.emergency_contacts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'emergency_contacts' and policyname = 'contactos propios') then
    create policy "contactos propios" on public.emergency_contacts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if; end $$;
create index if not exists emergency_contacts_user on public.emergency_contacts (user_id);

create table if not exists public.live_shares (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text, started_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '14 hours',
  lat double precision, lon double precision, speed real, updated_at timestamptz,
  status text not null default 'on' check (status in ('on', 'alert', 'ended')),
  trail jsonb not null default '[]'::jsonb);
alter table public.live_shares enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'live_shares' and policyname = 'seguimiento propio') then
    create policy "seguimiento propio" on public.live_shares for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if; end $$;
create index if not exists live_shares_user on public.live_shares (user_id, started_at desc);

create table if not exists public.solo_alerts (
  id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, to_user uuid not null references auth.users(id) on delete cascade,
  token uuid, lat double precision, lon double precision, created_at timestamptz not null default now(), ok_at timestamptz);
alter table public.solo_alerts enable row level security;
create index if not exists solo_alerts_to on public.solo_alerts (to_user, created_at desc);

create or replace function public.live_share_ping(p_token uuid, p_lat double precision, p_lon double precision, p_speed real default null)
returns void language sql security definer set search_path = public as $$
  update public.live_shares set lat = p_lat, lon = p_lon, speed = p_speed, updated_at = now(),
    trail = (case when jsonb_array_length(trail) >= 500 then trail - 0 else trail end) || jsonb_build_array(jsonb_build_array(round(p_lon::numeric, 5), round(p_lat::numeric, 5)))
  where token = p_token and user_id = auth.uid() and status <> 'ended' and p_lat between -90 and 90 and p_lon between -180 and 180;
$$;

create or replace function public.live_share_get(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', coalesce(nullif(btrim(s.name), ''), 'Motero'), 'started_at', (extract(epoch from s.started_at) * 1000)::bigint,
    'updated_at', (extract(epoch from s.updated_at) * 1000)::bigint, 'lat', s.lat, 'lon', s.lon, 'speed', s.speed,
    'status', case when s.status <> 'ended' and s.expires_at < now() then 'ended' else s.status end, 'trail', s.trail, 'now', (extract(epoch from now()) * 1000)::bigint)
  from public.live_shares s where s.token = p_token;
$$;
grant execute on function public.live_share_get(uuid) to anon, authenticated;

create or replace function public.solo_alert(p_token uuid, p_lat double precision, p_lon double precision)
returns integer language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); ids uuid[]; begin
  if u is null then raise exception 'Sin sesión'; end if;
  update public.live_shares set status = 'alert', lat = coalesce(p_lat, lat), lon = coalesce(p_lon, lon), updated_at = now(), expires_at = greatest(expires_at, now() + interval '6 hours') where token = p_token and user_id = u;
  select array_agg(distinct pp.id) into ids from public.emergency_contacts c join public.profile_private pp
    on right(regexp_replace(coalesce(pp.ride_phone, ''), '[^0-9]', '', 'g'), 9) = right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 9)
  where c.user_id = u and pp.id <> u and char_length(regexp_replace(c.phone, '[^0-9]', '', 'g')) >= 9;
  if ids is null then return 0; end if;
  if exists (select 1 from public.solo_alerts where user_id = u and created_at > now() - interval '3 minutes' and ok_at is null) then return coalesce(array_length(ids, 1), 0); end if;
  insert into public.solo_alerts (user_id, to_user, token, lat, lon) select u, x, p_token, p_lat, p_lon from unnest(ids) x;
  begin perform public.push_send(ids, 'solo'); exception when others then null; end;
  return array_length(ids, 1);
end $$;

create or replace function public.solo_ok(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); ids uuid[]; begin
  update public.live_shares set status = 'on' where token = p_token and user_id = u and status = 'alert';
  with up as (update public.solo_alerts set ok_at = now() where user_id = u and ok_at is null and created_at > now() - interval '12 hours' returning to_user)
  select array_agg(distinct to_user) into ids from up;
  if ids is not null then begin perform public.push_send(ids, 'solo'); exception when others then null; end; end if;
end $$;

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
    from public.solo_alerts a left join public.profiles p on p.id = a.user_id where a.to_user = u and a.ok_at is not null and a.ok_at > greatest(t0, now() - interval '24 hours')) q;
$$;

do $$ declare d text := pg_get_functiondef('public.community_news'::regproc); begin
  if position('news_extra' in d) = 0 then
    if position('|| extra || ph);' in d) = 0 then raise exception 'community_news no tiene la forma esperada'; end if;
    execute replace(d, '|| extra || ph);', '|| extra || ph || public.news_extra(u, t0));');
  end if; end $$;

alter table public.events add column if not exists open_near boolean not null default false;
create or replace function public.open_events_near(p_lat double precision, p_lon double precision, p_km integer default 150)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'starts_at')::bigint), '[]'::jsonb) from (
    select jsonb_build_object('id', e.id, 'title', e.title, 'description', left(coalesce(e.description, ''), 240), 'starts_at', (extract(epoch from e.starts_at) * 1000)::bigint,
      'meet_name', e.meet_name, 'meet_lat', e.meet_lat, 'meet_lon', e.meet_lon, 'km', round(public.km_between(p_lat, p_lon, e.meet_lat, e.meet_lon)::numeric),
      'community', c.name, 'zone', c.zone, 'style', c.ride_style, 'capacity', e.capacity, 'taken', public.event_taken(e.id), 'approval', e.require_approval,
      'has_route', e.route is not null, 'cover_url', e.cover_url, 'mine', public.is_member(e.community_id)) x
    from public.events e join public.communities c on c.id = e.community_id
    where e.open_near and e.open_reg and e.allow_guests and e.starts_at > now() and e.starts_at < now() + interval '90 days'
      and e.meet_lat is not null and e.meet_lon is not null and p_lat is not null and p_lon is not null
      and public.km_between(p_lat, p_lon, e.meet_lat, e.meet_lon) <= least(greatest(coalesce(p_km, 150), 10), 600)
    limit 60) q;
$$;
revoke all on function public.open_events_near(double precision, double precision, integer) from public, anon;
grant execute on function public.open_events_near(double precision, double precision, integer) to authenticated;
revoke all on function public.solo_alert(uuid, double precision, double precision) from public, anon;
revoke all on function public.solo_ok(uuid) from public, anon;
revoke all on function public.live_share_ping(uuid, double precision, double precision, real) from public, anon;
revoke all on function public.news_extra(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.solo_alert(uuid, double precision, double precision) to authenticated;
grant execute on function public.solo_ok(uuid) to authenticated;
grant execute on function public.live_share_ping(uuid, double precision, double precision, real) to authenticated;

-- campos sueltos de una salida (canal de voz, lista antes de salir…) sin una columna por cada uno
alter table public.events add column if not exists extra jsonb not null default '{}'::jsonb;
alter table public.events add constraint events_extra_size check (pg_column_size(extra) <= 6000) not valid;
