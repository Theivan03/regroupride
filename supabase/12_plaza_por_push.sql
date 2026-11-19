-- ReGroupRide · 0.22 — La plaza ofrecida viaja con las novedades: el teléfono no necesita haber guardado nada antes.
-- Ejecutar después de 11_push_y_web.sql. Se puede ejecutar más de una vez.

create or replace function public.community_news(p_key uuid, p_since timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare u uuid; t0 timestamptz; res jsonb;
begin
  if p_key is null then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  select user_id into u from public.news_keys where key = p_key;
  if u is null then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  t0 := greatest(coalesce(p_since, now()), now() - interval '3 days');
  -- que no falte la clave de los eventos en los que tengo una plaza ofrecida
  insert into public.event_keys(event_id, user_id)
    select a.event_id, u from public.event_attendees a where a.user_id = u and a.status = 'offered' on conflict do nothing;
  select coalesce(jsonb_agg(q.x order by q.t), '[]'::jsonb) into res from (
    select n.t, n.x from (
      select e.created_at as t, jsonb_build_object('kind', 'event', 'id', e.id, 'community', c.name, 'title', e.title,
               'starts_at', (extract(epoch from e.starts_at) * 1000)::bigint, 'at', (extract(epoch from e.created_at) * 1000)::bigint) as x
        from public.events e
        join public.communities c on c.id = e.community_id
        join public.community_members m on m.community_id = c.id and m.user_id = u
        where e.created_at > t0 and e.created_by <> u and e.starts_at > now()
      union all
      select p.created_at, jsonb_build_object('kind', 'post', 'id', p.id, 'community', c.name, 'title', left(p.body, 160),
               'at', (extract(epoch from p.created_at) * 1000)::bigint)
        from public.community_posts p
        join public.communities c on c.id = p.community_id
        join public.community_members m on m.community_id = c.id and m.user_id = u
        where p.created_at > t0 and p.author_id <> u
      union all
      select g.updated_at, jsonb_build_object('kind', 'page', 'id', g.id, 'community', c.name, 'title', g.title,
               'at', (extract(epoch from g.updated_at) * 1000)::bigint)
        from public.community_pages g
        join public.communities c on c.id = g.community_id
        join public.community_members m on m.community_id = c.id and m.user_id = u
        where g.updated_at > t0 and g.updated_by is distinct from u
      union all
      select s.created_at, jsonb_build_object('kind', 'call', 'id', s.id, 'community', c.name, 'title', s.name,
               'by', coalesce(nullif(pr.name, ''), 'El organizador'), 'at', (extract(epoch from s.created_at) * 1000)::bigint)
        from public.ride_sessions s
        join public.events e on e.id = s.event_id
        join public.communities c on c.id = e.community_id
        left join public.profiles pr on pr.id = s.owner_id
        where s.created_at > t0 and s.ended_at is null and s.owner_id <> u
          and not exists (select 1 from public.ride_positions rp where rp.session_id = s.id and rp.user_id = u)
          and (exists (select 1 from public.event_attendees a where a.event_id = e.id and a.user_id = u and a.status in ('going', 'offered'))
            or exists (select 1 from public.event_admins x where x.event_id = e.id and x.user_id = u))
      union all
      -- plaza ofrecida y aún sin contestar: siempre (no depende de p_since), con la clave para contestar desde el aviso
      select a.offered_at, jsonb_build_object('kind', 'offer', 'id', e.id::text || ':' || (extract(epoch from a.offered_at) * 1000)::bigint::text,
               'event_id', e.id, 'cid', c.id, 'community', c.name, 'title', e.title, 'key', k.key,
               'offered_at', (extract(epoch from a.offered_at) * 1000)::bigint,
               'deadline', (extract(epoch from public.offer_deadline(a.offered_at, e.starts_at)) * 1000)::bigint,
               'starts_at', (extract(epoch from e.starts_at) * 1000)::bigint, 'at', 0)
        from public.event_attendees a
        join public.events e on e.id = a.event_id
        join public.communities c on c.id = e.community_id
        join public.event_keys k on k.event_id = e.id and k.user_id = u
        where a.user_id = u and a.status = 'offered' and a.offered_at is not null and e.starts_at > now()
    ) n order by n.t limit 12
  ) q;
  return jsonb_build_object('ok', true, 'now', (extract(epoch from now()) * 1000)::bigint, 'items', res);
end $$;
revoke all on function public.community_news(uuid, timestamptz) from public;
grant execute on function public.community_news(uuid, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';
