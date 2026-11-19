-- ReGroupRide · 0.21 — Notificaciones push (Firebase) y eventos con portada y página web.
-- Ejecutar una vez en Supabase → SQL Editor, después de 10_tiempo_real.sql. Se puede ejecutar más de una vez.
--
-- PUSH. Cuando pasa algo que alguien debe saber (le toca una plaza, evento nuevo, mensaje en el tablón, info nueva,
-- empieza una ruta), un disparador apunta a quién avisar en push_queue y llama a la función «push» (Edge Function,
-- supabase/functions/push). Esa función manda a sus teléfonos un «toque» por Firebase, sin contenido: el teléfono se
-- despierta y pregunta él mismo qué hay (lo de 08 y 09), y pone la notificación. Nada falla si la función no está.
--
-- WEB. Portada de los eventos (almacén público «covers») y lo que enseña la página pública de un evento.

create extension if not exists pg_net;

-- ============ Teléfonos de cada cuenta ============
create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'android',
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user on public.push_tokens(user_id);
alter table public.push_tokens enable row level security;      -- sin políticas: solo por las funciones

create or replace function public.push_register(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_token is null or char_length(p_token) < 20 then return; end if;
  insert into public.push_tokens(token, user_id) values (p_token, auth.uid())
    on conflict (token) do update set user_id = auth.uid(), updated_at = now();
end $$;
create or replace function public.push_unregister(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;
revoke all on function public.push_register(text) from public, anon;
revoke all on function public.push_unregister(text) from public, anon;
grant execute on function public.push_register(text) to authenticated;
grant execute on function public.push_unregister(text) to authenticated;

-- ============ Cola y llamada a la función ============
create table if not exists public.push_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  kind text not null default '',
  created_at timestamptz not null default now()
);
alter table public.push_queue enable row level security;
create table if not exists public.push_config (id int primary key default 1 check (id = 1), url text not null);
alter table public.push_config enable row level security;
insert into public.push_config(id, url) values (1, 'https://lpkeaxtzfbuqjkkusjit.supabase.co/functions/v1/push') on conflict (id) do nothing;

create or replace function public.push_send(p_users uuid[], p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.push_queue(user_id, kind)
    select distinct u, p_kind from unnest(p_users) as u
    where u is not null and exists (select 1 from public.push_tokens t where t.user_id = u);
  get diagnostics n = row_count;
  if n > 0 then
    perform net.http_post(url := (select url from public.push_config where id = 1), body := '{}'::jsonb,
                          headers := '{"Content-Type":"application/json"}'::jsonb);
  end if;
exception when others then null;      -- un fallo al avisar nunca estropea lo que se estaba guardando
end $$;
revoke all on function public.push_send(uuid[], text) from public, anon, authenticated;

-- ============ Qué dispara un aviso ============
create or replace function public.push_on_attendee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'offered' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.push_send(array[new.user_id], 'offer');
  end if;
  return new;
end $$;
drop trigger if exists t_push_attendee on public.event_attendees;
create trigger t_push_attendee after insert or update on public.event_attendees for each row execute function public.push_on_attendee();

create or replace function public.push_on_content() returns trigger
language plpgsql security definer set search_path = public as $$
declare who uuid; j jsonb := to_jsonb(new); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  if tg_table_name = 'events' then who := new.created_by;
  elsif tg_table_name = 'community_posts' then who := (j->>'author_id')::uuid;
  else
    who := (j->>'updated_by')::uuid;
    if tg_op = 'UPDATE' and j->>'title' is not distinct from o->>'title' and j->>'body' is not distinct from o->>'body' and j->'links' is not distinct from o->'links' then return new; end if;
  end if;
  perform public.push_send(array(select m.user_id from public.community_members m where m.community_id = new.community_id and m.user_id is distinct from who), tg_table_name);
  return new;
end $$;
drop trigger if exists t_push_event on public.events;
create trigger t_push_event after insert on public.events for each row execute function public.push_on_content();
drop trigger if exists t_push_post on public.community_posts;
create trigger t_push_post after insert on public.community_posts for each row execute function public.push_on_content();
drop trigger if exists t_push_page on public.community_pages;
create trigger t_push_page after insert or update on public.community_pages for each row execute function public.push_on_content();

create or replace function public.push_on_ride() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is not null then
    perform public.push_send(array(
      select a.user_id from public.event_attendees a where a.event_id = new.event_id and a.status in ('going', 'offered') and a.user_id <> new.owner_id
      union select x.user_id from public.event_admins x where x.event_id = new.event_id and x.user_id <> new.owner_id), 'call');
  end if;
  return new;
end $$;
drop trigger if exists t_push_ride on public.ride_sessions;
create trigger t_push_ride after insert on public.ride_sessions for each row execute function public.push_on_ride();

-- ============ Portada de los eventos ============
alter table public.events add column if not exists cover_url text;
alter table public.events drop constraint if exists events_cover_check;
alter table public.events add constraint events_cover_check check (cover_url is null or (char_length(cover_url) <= 600 and cover_url ~* '^https://'));

insert into storage.buckets (id, name, public) values ('covers', 'covers', true) on conflict (id) do update set public = true;
drop policy if exists "portadas subir" on storage.objects;
create policy "portadas subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "portadas cambiar" on storage.objects;
create policy "portadas cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "portadas borrar" on storage.objects;
create policy "portadas borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============ Página pública de un evento (quien tenga el enlace) ============
-- Enseña solo lo necesario para decidir si ir: título, cuándo, dónde, portada, descripción y cuántos van. No enseña quiénes.
create or replace function public.event_public(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description,
    'starts_at', (extract(epoch from e.starts_at) * 1000)::bigint, 'meet_name', e.meet_name, 'meet_url', e.meet_url,
    'cover_url', e.cover_url, 'capacity', e.capacity, 'community', c.name, 'community_id', c.id,
    'route_name', e.route->>'name', 'route_km', round(((e.route->>'dist')::numeric), 1),
    'going', (select count(*) + count(*) filter (where a.companion) from public.event_attendees a where a.event_id = e.id and a.status in ('going', 'offered')),
    'member', auth.uid() is not null and exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id = auth.uid()),
    'admin', auth.uid() is not null and public.is_community_admin(c.id),
    'mine', (select a.status from public.event_attendees a where a.event_id = e.id and a.user_id = auth.uid()))
  from public.events e join public.communities c on c.id = e.community_id where e.id = p_id;
$$;
revoke all on function public.event_public(uuid) from public;
grant execute on function public.event_public(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
