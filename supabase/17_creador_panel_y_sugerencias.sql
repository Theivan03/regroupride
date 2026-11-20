-- ReGroupRide · 17 — sugerencias que llegan al creador, respuestas que llegan al usuario y panel de uso.
-- Ejecutar una vez en Supabase → SQL Editor, después de 16_aviso_solo_apuntados.sql. Se puede ejecutar más de una vez.
-- (Si alguna vez se vuelve a ejecutar 12_plaza_por_push.sql, hay que volver a ejecutar este archivo después.)
--
--  · Sugerencias y fallos: al llegar una, aviso al móvil del creador y correo (función «feedback-mail»); cuando el
--    creador contesta, aviso al móvil de quien la envió.
--  · Uso de la app: cada aparato manda una señal al día, sin datos personales (un identificador al azar, la
--    plataforma y la versión). Con eso se cuentan aparatos, activos al día y cuántos vuelven.
--  · dev_stats() y dev_feedback(): solo para quien esté en app_admins.

-- ============ Sugerencias: cuándo se contestó y si ya se mandó el correo ============
alter table public.feedback add column if not exists replied_at timestamptz;
alter table public.feedback add column if not exists mailed_at timestamptz;

create or replace function public.feedback_replied() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.admin_note, '') <> '' and new.admin_note is distinct from old.admin_note then new.replied_at := now(); end if;
  return new;
end $$;
create or replace trigger t_feedback_replied before update on public.feedback for each row execute function public.feedback_replied();

create or replace function public.feedback_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.push_send(array(select user_id from public.app_admins where user_id <> new.user_id), 'feedback');
    begin
      perform net.http_post(url := (select regexp_replace(url, '/functions/v1/.*$', '/functions/v1/feedback-mail') from public.push_config where id = 1),
                            body := jsonb_build_object('id', new.id), headers := '{"Content-Type":"application/json"}'::jsonb);
    exception when others then null;
    end;
  elsif new.replied_at is distinct from old.replied_at and new.replied_at is not null then
    perform public.push_send(array[new.user_id], 'feedback');
  end if;
  return new;
end $$;
create or replace trigger t_feedback_notify after insert or update on public.feedback for each row execute function public.feedback_notify();

-- Las novedades que lee el móvil con la app cerrada: se añaden las respuestas a mis sugerencias y, para el creador, las nuevas.
do $$
begin
  if position('community_news_base' in (select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'community_news')) = 0 then
    alter function public.community_news(uuid, timestamptz) rename to community_news_base;
  end if;
end $$;
revoke all on function public.community_news_base(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.community_news(p_key uuid, p_since timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r jsonb; u uuid; t0 timestamptz; extra jsonb;
begin
  r := public.community_news_base(p_key, p_since);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  select user_id into u from public.news_keys where key = p_key;
  t0 := greatest(coalesce(p_since, now()), now() - interval '3 days');
  select coalesce(jsonb_agg(z.x order by z.t), '[]'::jsonb) into extra from (
    select f.replied_at as t, jsonb_build_object('kind', 'note', 'id', 'fbr-' || f.id || '-' || (extract(epoch from f.replied_at))::bigint, 'community', 'ReGroupRide',
             'head', 'ReGroupRide te ha contestado', 'title', left(f.admin_note, 220), 'at', (extract(epoch from f.replied_at) * 1000)::bigint) as x
      from public.feedback f where f.user_id = u and f.replied_at > t0 and coalesce(f.admin_note, '') <> ''
    union all
    select f.created_at, jsonb_build_object('kind', 'note', 'id', 'fbn-' || f.id, 'community', 'ReGroupRide',
             'head', (case f.kind when 'fallo' then 'Fallo nuevo' else 'Mejora propuesta' end) || ' · ' || coalesce(nullif(btrim(p.name), ''), 'Alguien'),
             'title', left(f.message, 220), 'at', (extract(epoch from f.created_at) * 1000)::bigint)
      from public.feedback f left join public.profiles p on p.id = f.user_id
      where f.created_at > t0 and f.user_id <> u and exists (select 1 from public.app_admins a where a.user_id = u)
    limit 8) z;
  return jsonb_set(r, '{items}', coalesce(r->'items', '[]'::jsonb) || extra);
end $$;
revoke all on function public.community_news(uuid, timestamptz) from public;
grant execute on function public.community_news(uuid, timestamptz) to anon, authenticated;

-- ============ Uso de la app ============
create table if not exists public.app_devices (
  device_id uuid primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  platform text not null default '',
  version text not null default '',
  user_id uuid references auth.users(id) on delete set null
);
create table if not exists public.app_days (
  device_id uuid not null references public.app_devices(device_id) on delete cascade,
  day date not null,
  primary key (device_id, day)
);
create index if not exists app_days_day_idx on public.app_days(day);
alter table public.app_devices enable row level security;
alter table public.app_days enable row level security;
revoke all on public.app_devices, public.app_days from anon, authenticated;

create or replace function public.app_ping(p_device uuid, p_platform text, p_version text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_device is null then return; end if;
  insert into public.app_devices (device_id, platform, version, user_id)
    values (p_device, left(coalesce(p_platform, ''), 20), left(coalesce(p_version, ''), 20), auth.uid())
  on conflict (device_id) do update set last_seen = now(), platform = excluded.platform, version = excluded.version,
    user_id = coalesce(excluded.user_id, public.app_devices.user_id);
  insert into public.app_days (device_id, day) values (p_device, (now() at time zone 'Europe/Madrid')::date) on conflict do nothing;
end $$;
revoke all on function public.app_ping(uuid, text, text) from public;
grant execute on function public.app_ping(uuid, text, text) to anon, authenticated;

create or replace function public.dev_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/Madrid')::date; res jsonb;
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede ver esto'; end if;
  select jsonb_build_object(
    'today', today,
    'since', (select min(first_seen) from public.app_devices),
    'devices', (select count(*) from public.app_devices),
    'devices_account', (select count(*) from public.app_devices where user_id is not null),
    'accounts', (select count(*) from auth.users),
    'accounts_7', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'accounts_30', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'accounts_active_30', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'dau', (select count(*) from public.app_days where day = today),
    'dau_prev', (select count(*) from public.app_days where day = today - 1),
    'wau', (select count(distinct device_id) from public.app_days where day > today - 7),
    'mau', (select count(distinct device_id) from public.app_days where day > today - 30),
    'days_per_device_30', (select round(coalesce(avg(n), 0), 1) from (select count(*) n from public.app_days where day > today - 30 group by device_id) q),
    'returning_30', (select count(*) from (select 1 from public.app_days where day > today - 30 group by device_id having count(*) >= 3) q),
    'series', (select jsonb_agg(jsonb_build_object('day', d::date,
        'active', (select count(*) from public.app_days a where a.day = d::date),
        'new_devices', (select count(*) from public.app_devices x where (x.first_seen at time zone 'Europe/Madrid')::date = d::date),
        'new_accounts', (select count(*) from auth.users u where (u.created_at at time zone 'Europe/Madrid')::date = d::date)) order by d)
      from generate_series(today - 29, today, interval '1 day') d),
    'retention', (select jsonb_build_object(
        'base1', count(*) filter (where fd <= today - 1), 'd1', count(*) filter (where fd <= today - 1 and exists (select 1 from public.app_days a where a.device_id = q.device_id and a.day = q.fd + 1)),
        'base7', count(*) filter (where fd <= today - 7), 'd7', count(*) filter (where fd <= today - 7 and exists (select 1 from public.app_days a where a.device_id = q.device_id and a.day between q.fd + 1 and q.fd + 7)),
        'base30', count(*) filter (where fd <= today - 30), 'd30', count(*) filter (where fd <= today - 30 and exists (select 1 from public.app_days a where a.device_id = q.device_id and a.day >= q.fd + 30)))
      from (select device_id, (first_seen at time zone 'Europe/Madrid')::date as fd from public.app_devices) q),
    'platforms', (select coalesce(jsonb_object_agg(platform, n), '{}'::jsonb) from (select coalesce(nullif(platform, ''), '?') platform, count(*) n from public.app_devices where last_seen > now() - interval '30 days' group by 1) q),
    'versions', (select coalesce(jsonb_object_agg(version, n), '{}'::jsonb) from (select coalesce(nullif(version, ''), '?') version, count(*) n from public.app_devices where last_seen > now() - interval '30 days' group by 1 order by 2 desc limit 8) q),
    'push_devices', (select count(*) from public.push_tokens),
    'communities', (select count(*) from public.communities),
    'members', (select count(*) from public.community_members),
    'events_next', (select count(*) from public.events where starts_at > now()),
    'events_total', (select count(*) from public.events),
    'signups', (select count(*) from public.event_attendees where status in ('going', 'offered', 'waiting')) + (select count(*) from public.event_guests where status in ('going', 'waiting', 'pending')),
    'web_guests', (select count(*) from public.event_guests where status <> 'no'),
    'group_rides_30', (select count(*) from public.ride_sessions where created_at > now() - interval '30 days'),
    'rides', (select coalesce(sum(rides), 0) from public.rider_stats),
    'km', (select round(coalesce(sum(km), 0)) from public.rider_stats),
    'feedback_open', (select count(*) from public.feedback where status in ('recibido', 'en curso')),
    'feedback_unanswered', (select count(*) from public.feedback where coalesce(admin_note, '') = '' and status = 'recibido')
  ) into res;
  return res;
end $$;
revoke all on function public.dev_stats() from public, anon;
grant execute on function public.dev_stats() to authenticated;

create or replace function public.dev_feedback() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede ver esto'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'message', f.message, 'status', f.status, 'admin_note', coalesce(f.admin_note, ''),
      'app_version', coalesce(f.app_version, ''), 'device', f.device, 'created_at', (extract(epoch from f.created_at) * 1000)::bigint,
      'replied_at', case when f.replied_at is not null then (extract(epoch from f.replied_at) * 1000)::bigint end,
      'name', coalesce(nullif(btrim(p.name), ''), 'Sin nombre'), 'email', u.email) order by f.created_at desc)
    from (select * from public.feedback order by created_at desc limit 200) f
    left join public.profiles p on p.id = f.user_id left join auth.users u on u.id = f.user_id), '[]'::jsonb);
end $$;
revoke all on function public.dev_feedback() from public, anon;
grant execute on function public.dev_feedback() to authenticated;

notify pgrst, 'reload schema';
