-- ReGroupRide · 14 — enlace de la ruta en Google Maps.
-- Ejecutar una vez en Supabase → SQL Editor, después de 13_web_como_luma.sql. Se puede ejecutar más de una vez.
-- Añade a cada evento un campo para pegar el enlace de la ruta en Google Maps; se enseña en la web y en la app.

alter table public.events add column if not exists route_url text;
alter table public.events drop constraint if exists events_route_url_check;
alter table public.events add constraint events_route_url_check check (route_url is null or (char_length(route_url) <= 600 and route_url ~* '^https?://'));

create or replace function public.event_public(p_id uuid, p_code text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.events; c public.communities; g public.event_guests; mine text; adm boolean; inside boolean; res jsonb;
begin
  select * into e from public.events where id = p_id;
  if e.id is null then return null; end if;
  select * into c from public.communities where id = e.community_id;
  if p_code is not null then select * into g from public.event_guests where event_id = e.id and code = p_code; end if;
  if auth.uid() is not null then select status into mine from public.event_attendees where event_id = e.id and user_id = auth.uid(); end if;
  adm := auth.uid() is not null and public.can_run_event(e.id);
  inside := adm or mine in ('going', 'offered') or g.status = 'going';
  res := jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description,
    'starts_at', (extract(epoch from e.starts_at) * 1000)::bigint,
    'ends_at', case when e.ends_at is not null then (extract(epoch from e.ends_at) * 1000)::bigint end,
    'meet_name', e.meet_name, 'meet_url', e.meet_url, 'meet_note', e.meet_note, 'meet_lat', e.meet_lat, 'meet_lon', e.meet_lon,
    'cover_url', e.cover_url, 'capacity', e.capacity, 'community', c.name, 'community_id', c.id, 'community_public', c.web_public,
    'route_name', e.route->>'name', 'route_km', round(((e.route->>'dist')::numeric), 1), 'route_url', e.route_url,
    'require_approval', e.require_approval, 'questions', e.questions, 'show_guests', e.show_guests,
    'allow_guests', e.allow_guests, 'open_reg', e.open_reg,
    'taken', public.event_taken(e.id),
    'going', (select count(*) + count(*) filter (where a.companion) from public.event_attendees a where a.event_id = e.id and a.status in ('going', 'offered'))
           + (select count(*) + count(*) filter (where x.companion) from public.event_guests x where x.event_id = e.id and x.status = 'going'),
    'member', auth.uid() is not null and exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id = auth.uid()),
    'admin', adm, 'mine', mine,
    'ticket', case when mine = 'going' then public.member_code(e.id, auth.uid()) end,
    'guest', case when g.id is not null then jsonb_build_object('name', g.name, 'status', g.status, 'companion', g.companion, 'code', g.code, 'checked_in', g.checked_in_at is not null) end);
  if e.show_guests then
    res := res || jsonb_build_object('faces', coalesce((select jsonb_agg(upper(left(btrim(n), 1))) from (
        select n from (
          select p.name as n, a.joined_at as t from public.event_attendees a join public.profiles p on p.id = a.user_id where a.event_id = e.id and a.status in ('going', 'offered')
          union all select x.name, x.joined_at from public.event_guests x where x.event_id = e.id and x.status = 'going') u
        where btrim(coalesce(n, '')) <> '' order by t limit 6) f), '[]'::jsonb));
    if inside then
      res := res || jsonb_build_object('names', coalesce((select jsonb_agg(n order by t) from (
          select split_part(btrim(p.name), ' ', 1) as n, a.joined_at as t from public.event_attendees a join public.profiles p on p.id = a.user_id where a.event_id = e.id and a.status in ('going', 'offered')
          union all select split_part(btrim(x.name), ' ', 1), x.joined_at from public.event_guests x where x.event_id = e.id and x.status = 'going') u
        where coalesce(n, '') <> ''), '[]'::jsonb));
    end if;
  end if;
  return res;
end $$;
revoke all on function public.event_public(uuid, text) from public;
grant execute on function public.event_public(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
