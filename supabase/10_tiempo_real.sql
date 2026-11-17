-- ReGroupRide · 0.19 — Más rápido entre personas, terminar la ruta para todos, editar eventos y mapas en las rutas públicas.
-- Ejecutar una vez en Supabase → SQL Editor, después de 09_novedades.sql. Se puede ejecutar más de una vez.
--
-- 1. Cualquier administrador de la ruta (no solo quien la inició) puede terminarla para todos.
-- 2. Los administradores de una ruta (event_admins) pueden editar ese evento, no solo los de la comunidad.
-- 3. Las novedades que el teléfono consulta con la app cerrada incluyen «ha empezado la ruta» (para los apuntados).
-- 4. Las rutas públicas traen un trazado reducido (40 puntos) para dibujar su mapa en la ficha.

-- ============ 1. Terminar la ruta para todos ============
create or replace function public.ride_end(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ride_sessions where id = p_id and owner_id = auth.uid())
     and not exists (select 1 from public.ride_positions where session_id = p_id and user_id = auth.uid() and is_admin) then
    raise exception 'Solo un administrador de la ruta puede terminarla para todos';
  end if;
  delete from public.ride_positions where session_id = p_id;
  update public.ride_sessions set ended_at = now(), route = null where id = p_id;
end; $$;
grant execute on function public.ride_end(uuid) to authenticated;

-- ============ 2. Editar eventos: también los administradores de esa ruta ============
drop policy if exists "eventos admin de la ruta" on public.events;
create policy "eventos admin de la ruta" on public.events for update to authenticated
  using (exists (select 1 from public.event_admins x where x.event_id = events.id and x.user_id = auth.uid()))
  with check (exists (select 1 from public.event_admins x where x.event_id = events.id and x.user_id = auth.uid()));
-- Un evento no se cambia de comunidad al editarlo.
create or replace function public.event_keep_community() returns trigger
language plpgsql as $$ begin new.community_id := old.community_id; new.created_by := old.created_by; return new; end $$;
drop trigger if exists t_event_keep on public.events;
create trigger t_event_keep before update on public.events for each row execute function public.event_keep_community();

-- ============ 3. Novedades (con «ha empezado la ruta») ============
create or replace function public.community_news(p_key uuid, p_since timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; t0 timestamptz; res jsonb;
begin
  if p_key is null then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  select user_id into u from public.news_keys where key = p_key;
  if u is null then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  t0 := greatest(coalesce(p_since, now()), now() - interval '3 days');
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
    ) n order by n.t limit 12
  ) q;
  return jsonb_build_object('ok', true, 'now', (extract(epoch from now()) * 1000)::bigint, 'items', res);
end $$;
revoke all on function public.community_news(uuid, timestamptz) from public;
grant execute on function public.community_news(uuid, timestamptz) to anon, authenticated;

-- ============ 4. Rutas públicas con su trazado reducido ============
create or replace function public.routes_public(p_lat double precision default null, p_lon double precision default null, p_limit integer default 40) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.o), '[]'::jsonb) from (
    select jsonb_build_object('id', r.id, 'name', r.name, 'description', r.description, 'm', r.distance_m, 's', r.duration_s,
             'lat', r.start_lat, 'lon', r.start_lon, 'at', (extract(epoch from r.created_at) * 1000)::bigint,
             'by', coalesce(nullif(pr.name, ''), 'Motero'), 'mine', r.owner_id = auth.uid(),
             'line', (select jsonb_agg(t.c order by t.i) from jsonb_array_elements(case when jsonb_typeof(r.plan->'coords') = 'array' then r.plan->'coords' else '[]'::jsonb end) with ordinality as t(c, i)
                       where (t.i - 1) % greatest(1, jsonb_array_length(case when jsonb_typeof(r.plan->'coords') = 'array' then r.plan->'coords' else '[]'::jsonb end) / 40) = 0)) as o
    from public.routes r left join public.profiles pr on pr.id = r.owner_id
    where r.visibility = 'public' and r.plan is not null
    order by case when p_lat is not null and r.start_lat is not null
               then power(r.start_lat - p_lat, 2) + power((r.start_lon - p_lon) * cos(radians(p_lat)), 2) end nulls last, r.created_at desc
    limit least(greatest(coalesce(p_limit, 40), 1), 100)) x;
$$;
grant execute on function public.routes_public(double precision, double precision, integer) to authenticated;

notify pgrst, 'reload schema';
