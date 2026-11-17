-- ReGroupRide · 0.18 — Aviso cuando se publica algo en la comunidad (evento, tablón o info).
-- Ejecutar una vez en Supabase → SQL Editor, después de 08_plaza_avisada.sql. Se puede ejecutar más de una vez.
--
-- No hay notificaciones push, así que el teléfono pregunta cada 15 minutos qué hay nuevo en las comunidades de su dueño.
-- Para poder preguntar con la app cerrada (sin sesión) cada cuenta tiene una clave de novedades: con ella solo se
-- pueden leer los títulos de lo publicado en sus comunidades, nada más.

-- ============ Clave de novedades de cada cuenta ============
create table if not exists public.news_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  key uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.news_keys enable row level security;      -- sin políticas: solo se llega por las funciones de abajo

create or replace function public.news_key() returns uuid
language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  if auth.uid() is null then return null; end if;
  insert into public.news_keys(user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select key into k from public.news_keys where user_id = auth.uid();
  return k;
end $$;
revoke all on function public.news_key() from public, anon;
grant execute on function public.news_key() to authenticated;

-- ============ Quién ha tocado una página de info ============
-- Para no avisar a quien la escribe, y para que cambiar el orden de las páginas no cuente como novedad.
alter table public.community_pages add column if not exists updated_by uuid;
create or replace function public.page_who() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.updated_by := auth.uid();
  elsif new.title is distinct from old.title or new.body is distinct from old.body or new.links is distinct from old.links then
    new.updated_by := auth.uid();
  else
    new.updated_at := old.updated_at; new.updated_by := old.updated_by;      -- solo ha cambiado el orden
  end if;
  return new;
end $$;
drop trigger if exists t_pages_who on public.community_pages;
create trigger t_pages_who before insert or update on public.community_pages for each row execute function public.page_who();   -- va después de t_pages (orden alfabético)

-- ============ Qué hay nuevo desde p_since ============
-- Eventos, mensajes del tablón y páginas de info de las comunidades de quien tiene la clave, publicados por otros.
create or replace function public.community_news(p_key uuid, p_since timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; s timestamptz; res jsonb;
begin
  if p_key is null then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  select user_id into u from public.news_keys where key = p_key;
  if u is null then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  s := greatest(coalesce(p_since, now()), now() - interval '3 days');
  select coalesce(jsonb_agg(q.x order by q.t), '[]'::jsonb) into res from (
    select n.t, n.x from (
      select e.created_at as t, jsonb_build_object('kind', 'event', 'id', e.id, 'community', c.name, 'title', e.title,
               'starts_at', (extract(epoch from e.starts_at) * 1000)::bigint, 'at', (extract(epoch from e.created_at) * 1000)::bigint) as x
        from public.events e
        join public.communities c on c.id = e.community_id
        join public.community_members m on m.community_id = c.id and m.user_id = u
        where e.created_at > s and e.created_by <> u and e.starts_at > now()
      union all
      select p.created_at, jsonb_build_object('kind', 'post', 'id', p.id, 'community', c.name, 'title', left(p.body, 160),
               'at', (extract(epoch from p.created_at) * 1000)::bigint)
        from public.community_posts p
        join public.communities c on c.id = p.community_id
        join public.community_members m on m.community_id = c.id and m.user_id = u
        where p.created_at > s and p.author_id <> u
      union all
      select g.updated_at, jsonb_build_object('kind', 'page', 'id', g.id, 'community', c.name, 'title', g.title,
               'at', (extract(epoch from g.updated_at) * 1000)::bigint)
        from public.community_pages g
        join public.communities c on c.id = g.community_id
        join public.community_members m on m.community_id = c.id and m.user_id = u
        where g.updated_at > s and g.updated_by is distinct from u
    ) n order by n.t limit 12
  ) q;
  return jsonb_build_object('ok', true, 'now', (extract(epoch from now()) * 1000)::bigint, 'items', res);
end $$;
revoke all on function public.community_news(uuid, timestamptz) from public;
grant execute on function public.community_news(uuid, timestamptz) to anon, authenticated;   -- el teléfono la llama sin sesión, solo con la clave
