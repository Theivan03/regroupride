-- 33 · Borrar un viaje y rotular en «Estás apuntado» si es una salida o un viaje.
create or replace function public.trip_delete(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.events; k text; begin
  select * into e from public.events where id = p_event;
  if e.id is null then return; end if;
  if e.trip is null then raise exception 'Eso no es un viaje'; end if;
  if not public.is_community_admin(e.community_id) then raise exception 'Solo quien organiza el viaje puede borrarlo'; end if;
  select kind into k from public.communities where id = e.community_id;
  delete from public.events where id = e.id;
  if k = 'trip' and not exists (select 1 from public.events where community_id = e.community_id) then
    delete from public.communities where id = e.community_id;      -- viaje «entre amigos»: su grupo se va con él
  end if;
end $$;
revoke all on function public.trip_delete(uuid) from public, anon;
grant execute on function public.trip_delete(uuid) to authenticated;

do $$ declare d text := pg_get_functiondef('public.event_inbox'::regproc); begin
  if position('''is_trip''' in d) = 0 then
    if position('''has_route'', e.route is not null,' in d) = 0 then raise exception 'event_inbox no tiene la forma esperada'; end if;
    execute replace(d, '''has_route'', e.route is not null,', '''has_route'', e.route is not null, ''is_trip'', e.trip is not null,');
  end if; end $$;
