-- 32 · Aviso de moto robada, álbum de fotos de cada salida, sitios moteros y retos de comunidad.
--  · stolen_bikes + stolen_report()/stolen_near(): la ficha llega a mis comunidades y a quien tenga su zona cerca.
--  · event_photos: fotos de los asistentes (en el almacén «covers», carpeta de cada uno).
--  · biker_places: bares, miradores, talleres y alojamientos que proponen las comunidades; los ve cualquiera.
--  · challenges + challenge_progress: kilómetros o salidas del periodo. Nunca velocidad ni inclinación.

create table if not exists public.stolen_bikes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  bike text not null check (char_length(bike) between 2 and 80), plate text check (plate is null or char_length(plate) <= 12), color text check (color is null or char_length(color) <= 30),
  zone text not null check (char_length(zone) between 2 and 80), lat double precision, lon double precision, note text check (note is null or char_length(note) <= 300),
  photo_url text check (photo_url is null or photo_url ~* '^https://'), phone text check (phone is null or char_length(phone) <= 24),
  created_at timestamptz not null default now(), found_at timestamptz);
alter table public.stolen_bikes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'stolen_bikes' and policyname = 'mi moto robada') then
    create policy "mi moto robada" on public.stolen_bikes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if; end $$;

create or replace function public.stolen_report(p_bike text, p_plate text, p_color text, p_zone text, p_lat double precision, p_lon double precision, p_note text, p_photo text, p_phone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); nid uuid; ids uuid[]; begin
  if u is null then raise exception 'Sin sesión'; end if;
  if (select count(*) from public.stolen_bikes where user_id = u and created_at > now() - interval '1 day') >= 3 then raise exception 'Ya has enviado varios avisos hoy'; end if;
  insert into public.stolen_bikes (user_id, bike, plate, color, zone, lat, lon, note, photo_url, phone)
    values (u, btrim(p_bike), nullif(upper(btrim(coalesce(p_plate, ''))), ''), nullif(btrim(coalesce(p_color, '')), ''), btrim(p_zone), p_lat, p_lon, nullif(btrim(coalesce(p_note, '')), ''), nullif(p_photo, ''), nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), ''))
    returning id into nid;
  select array_agg(distinct x) into ids from (
    select m2.user_id x from public.community_members m1 join public.community_members m2 on m2.community_id = m1.community_id where m1.user_id = u and m2.user_id <> u
    union select z.user_id from public.user_zone z where p_lat is not null and z.user_id <> u and public.km_between(z.lat::float8, z.lon::float8, p_lat, p_lon) <= 80) q;
  if ids is not null then begin perform public.push_send(ids, 'stolen'); exception when others then null; end; end if;
  return nid;
end $$;

create or replace function public.stolen_near(p_lat double precision, p_lon double precision)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'at')::bigint desc), '[]'::jsonb) from (
    select jsonb_build_object('id', s.id, 'bike', s.bike, 'plate', s.plate, 'color', s.color, 'zone', s.zone, 'note', s.note, 'photo_url', s.photo_url, 'phone', s.phone,
      'name', coalesce(nullif(btrim(p.name), ''), 'Motero'), 'mine', s.user_id = auth.uid(), 'at', (extract(epoch from s.created_at) * 1000)::bigint,
      'km', case when p_lat is null or s.lat is null then null else round(public.km_between(p_lat, p_lon, s.lat, s.lon)::numeric) end) x
    from public.stolen_bikes s left join public.profiles p on p.id = s.user_id
    where s.found_at is null and s.created_at > now() - interval '90 days' and auth.uid() is not null
      and (s.user_id = auth.uid() or p_lat is null or s.lat is null or public.km_between(p_lat, p_lon, s.lat, s.lon) <= 300
           or exists (select 1 from public.community_members m1 join public.community_members m2 on m2.community_id = m1.community_id where m1.user_id = auth.uid() and m2.user_id = s.user_id))
    limit 60) q;
$$;
revoke all on function public.stolen_report(text, text, text, text, double precision, double precision, text, text, text) from public, anon;
revoke all on function public.stolen_near(double precision, double precision) from public, anon;
grant execute on function public.stolen_report(text, text, text, text, double precision, double precision, text, text, text) to authenticated;
grant execute on function public.stolen_near(double precision, double precision) to authenticated;

create table if not exists public.event_photos (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, url text not null check (url ~* '^https://' and char_length(url) <= 600),
  created_at timestamptz not null default now());
create index if not exists event_photos_event on public.event_photos (event_id, created_at desc);
alter table public.event_photos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'event_photos' and policyname = 'álbum ver') then
    create policy "álbum ver" on public.event_photos for select to authenticated using (exists (select 1 from public.events e where e.id = event_id and public.is_member(e.community_id)));
    create policy "álbum subir" on public.event_photos for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.events e where e.id = event_id and public.is_member(e.community_id)));
    create policy "álbum borrar" on public.event_photos for delete to authenticated using (user_id = auth.uid() or exists (select 1 from public.events e where e.id = event_id and public.is_community_admin(e.community_id)));
  end if; end $$;

create table if not exists public.biker_places (
  id uuid primary key default gen_random_uuid(), community_id uuid not null references public.communities(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  kind text not null check (kind in ('bar', 'mirador', 'taller', 'alojamiento', 'otro')), name text not null check (char_length(name) between 2 and 80),
  note text check (note is null or char_length(note) <= 300), lat double precision not null, lon double precision not null, parking boolean not null default false,
  discount text check (discount is null or char_length(discount) <= 120), created_at timestamptz not null default now());
create index if not exists biker_places_pos on public.biker_places (lat, lon);
alter table public.biker_places enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'biker_places' and policyname = 'sitios ver') then
    create policy "sitios ver" on public.biker_places for select to authenticated using (true);
    create policy "sitios proponer" on public.biker_places for insert to authenticated with check (created_by = auth.uid() and public.is_member(community_id));
    create policy "sitios cambiar" on public.biker_places for update to authenticated using (created_by = auth.uid() or public.is_community_admin(community_id)) with check (public.is_member(community_id));
    create policy "sitios borrar" on public.biker_places for delete to authenticated using (created_by = auth.uid() or public.is_community_admin(community_id));
  end if; end $$;
create or replace function public.places_near(p_lat double precision, p_lon double precision, p_km integer default 100)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'km')::numeric), '[]'::jsonb) from (
    select jsonb_build_object('id', b.id, 'kind', b.kind, 'name', b.name, 'note', b.note, 'lat', b.lat, 'lon', b.lon, 'parking', b.parking, 'discount', b.discount,
      'community', c.name, 'community_id', b.community_id, 'mine', b.created_by = auth.uid() or public.is_community_admin(b.community_id),
      'km', round(public.km_between(p_lat, p_lon, b.lat, b.lon)::numeric, 1)) x
    from public.biker_places b join public.communities c on c.id = b.community_id
    where auth.uid() is not null and public.km_between(p_lat, p_lon, b.lat, b.lon) <= least(greatest(coalesce(p_km, 100), 5), 500) limit 200) q;
$$;
revoke all on function public.places_near(double precision, double precision, integer) from public, anon;
grant execute on function public.places_near(double precision, double precision, integer) to authenticated;

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(), community_id uuid not null references public.communities(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null, title text not null check (char_length(title) between 2 and 80),
  kind text not null check (kind in ('km', 'salidas')), goal integer check (goal is null or goal between 1 and 100000),
  starts_on date not null, ends_on date not null check (ends_on >= starts_on), created_at timestamptz not null default now());
alter table public.challenges enable row level security;
create table if not exists public.challenge_progress (
  challenge_id uuid not null references public.challenges(id) on delete cascade, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  value numeric(8,1) not null default 0 check (value between 0 and 100000), updated_at timestamptz not null default now(), primary key (challenge_id, user_id));
alter table public.challenge_progress enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'challenges' and policyname = 'retos ver') then
    create policy "retos ver" on public.challenges for select to authenticated using (public.is_member(community_id));
    create policy "retos crear" on public.challenges for insert to authenticated with check (public.is_community_admin(community_id));
    create policy "retos cambiar" on public.challenges for update to authenticated using (public.is_community_admin(community_id)) with check (public.is_community_admin(community_id));
    create policy "retos borrar" on public.challenges for delete to authenticated using (public.is_community_admin(community_id));
    create policy "avance ver" on public.challenge_progress for select to authenticated using (exists (select 1 from public.challenges c where c.id = challenge_id and public.is_member(c.community_id)));
    create policy "avance apuntar" on public.challenge_progress for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.challenges c where c.id = challenge_id and public.is_member(c.community_id)));
    create policy "avance cambiar" on public.challenge_progress for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if; end $$;

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
      and g.email = (select lower(email) from auth.users where id = u)
    union all
    select jsonb_build_object('kind', 'note', 'id', 'stl-' || s.id, 'community', 'Moto robada', 'head', '🚨 Moto robada en ' || s.zone,
      'title', s.bike || coalesce(' · ' || s.color, '') || coalesce(' · ' || s.plate, '') || '. Si la ves, avisa: toca para ver la ficha.', 'at', (extract(epoch from s.created_at) * 1000)::bigint)
    from public.stolen_bikes s
    where s.created_at > greatest(t0, now() - interval '7 days') and s.found_at is null and s.user_id <> u
      and (exists (select 1 from public.community_members m1 join public.community_members m2 on m2.community_id = m1.community_id where m1.user_id = u and m2.user_id = s.user_id)
           or exists (select 1 from public.user_zone z where z.user_id = u and s.lat is not null and public.km_between(z.lat::float8, z.lon::float8, s.lat, s.lon) <= 80))) q;
$$;
