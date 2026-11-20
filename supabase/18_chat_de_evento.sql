-- ReGroupRide · 18 — chat de cada evento, solo para quien va (apuntados, lista de espera y administradores).
-- Ejecutar una vez en Supabase → SQL Editor, después de 17_creador_panel_y_sugerencias.sql. Se puede ejecutar más de una vez.

create table if not exists public.event_messages (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists event_messages_ev_idx on public.event_messages(event_id, id);
alter table public.event_messages enable row level security;
grant select, insert, delete on public.event_messages to authenticated;

create or replace function public.event_chat_user_ok(p_event uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    exists (select 1 from public.event_attendees a where a.event_id = p_event and a.user_id = p_user and a.status in ('going', 'waiting', 'offered'))
    or exists (select 1 from public.event_admins x where x.event_id = p_event and x.user_id = p_user)
    or exists (select 1 from public.events e join public.community_members m on m.community_id = e.community_id
               where e.id = p_event and m.user_id = p_user and m.role = 'admin'));
$$;
create or replace function public.event_chat_ok(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$ select public.event_chat_user_ok(p_event, auth.uid()); $$;
revoke all on function public.event_chat_user_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function public.event_chat_ok(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'event_messages' and policyname = 'chat ver') then
    create policy "chat ver" on public.event_messages for select to authenticated using (public.event_chat_ok(event_id));
    create policy "chat escribir" on public.event_messages for insert to authenticated with check (user_id = auth.uid() and public.event_chat_ok(event_id));
    create policy "chat borrar" on public.event_messages for delete to authenticated
      using (user_id = auth.uid() or exists (select 1 from public.events e where e.id = event_id and public.is_community_admin(e.community_id)));
  end if;
end $$;

-- Aviso al móvil del resto de participantes.
create or replace function public.event_message_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.push_send(array(
    select a.user_id from public.event_attendees a where a.event_id = new.event_id and a.status in ('going', 'waiting', 'offered') and a.user_id <> new.user_id
    union select x.user_id from public.event_admins x where x.event_id = new.event_id and x.user_id <> new.user_id), 'chat');
  return new;
exception when others then return new;
end $$;
create or replace trigger t_event_message_notify after insert on public.event_messages for each row execute function public.event_message_notify();

-- Novedades con la app cerrada: a lo de antes se añaden los mensajes del chat (como mucho un aviso por evento cada 10 minutos).
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
    union all
    select max(m.created_at), jsonb_build_object('kind', 'note', 'id', 'chat-' || m.event_id || '-' || (floor(extract(epoch from m.created_at) / 600))::bigint,
             'community', e.title, 'head', 'Chat · ' || e.title, 'event', m.event_id,
             'title', (array_agg(coalesce(nullif(btrim(p.name), ''), 'Alguien') || ': ' || left(m.body, 160) order by m.created_at desc))[1],
             'at', (extract(epoch from max(m.created_at)) * 1000)::bigint)
      from public.event_messages m join public.events e on e.id = m.event_id left join public.profiles p on p.id = m.user_id
      where m.created_at > t0 and m.user_id <> u and public.event_chat_user_ok(m.event_id, u)
      group by m.event_id, e.title, (floor(extract(epoch from m.created_at) / 600))::bigint
    limit 12) z;
  return jsonb_set(r, '{items}', coalesce(r->'items', '[]'::jsonb) || extra);
end $$;
revoke all on function public.community_news(uuid, timestamptz) from public;
grant execute on function public.community_news(uuid, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';
