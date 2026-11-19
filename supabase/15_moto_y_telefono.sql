-- ReGroupRide · 15 — moto y teléfono al apuntarse.
-- Ejecutar una vez en Supabase → SQL Editor, después de 14_enlace_ruta.sql. Se puede ejecutar más de una vez.
-- Cada apuntado dice con qué moto viene; el administrador ve la moto y el teléfono de cada uno en la lista de inscritos.

alter table public.event_attendees add column if not exists bike text;
alter table public.event_guests add column if not exists bike text;
alter table public.event_attendees drop constraint if exists event_attendees_bike_check;
alter table public.event_attendees add constraint event_attendees_bike_check check (bike is null or char_length(bike) <= 80);

drop function if exists public.event_register(uuid, text, text, text, boolean, jsonb);
create or replace function public.event_register(p_event uuid, p_name text, p_email text, p_phone text, p_companion boolean default false, p_answers jsonb default '{}', p_bike text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.events; g public.event_guests; em text := lower(btrim(coalesce(p_email, ''))); nm text := btrim(coalesce(p_name, '')); ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'); q jsonb; st text; bk text := left(btrim(coalesce(p_bike, '')), 80);
begin
  select * into e from public.events where id = p_event for update;
  if e.id is null then raise exception 'Evento no encontrado'; end if;
  if not e.allow_guests then raise exception 'Este evento solo admite inscripciones desde la app'; end if;
  if char_length(nm) < 2 or char_length(nm) > 60 then raise exception 'Escribe tu nombre'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or char_length(em) > 120 then raise exception 'Revisa el correo'; end if;
  if char_length(ph) < 9 or char_length(ph) > 20 then raise exception 'Revisa el teléfono'; end if;
  select * into g from public.event_guests where event_id = e.id and email = em;
  if g.id is not null and g.phone <> ph then raise exception 'Ya hay una inscripción con ese correo. Para recuperarla, escribe el mismo teléfono que usaste.'; end if;
  if g.id is not null and g.status <> 'no' then return jsonb_build_object('code', g.code, 'status', g.status, 'again', true); end if;
  if e.starts_at < now() then raise exception 'Este evento ya ha pasado'; end if;
  if char_length(bk) < 2 then raise exception 'Escribe con qué moto vienes'; end if;
  if not e.open_reg then raise exception 'Las inscripciones están cerradas'; end if;
  if (select count(*) from public.event_guests where event_id = e.id) >= 3000 then raise exception 'No se admiten más inscripciones'; end if;
  for q in select * from jsonb_array_elements(e.questions) loop
    if coalesce((q->>'required')::boolean, false) and btrim(coalesce(p_answers->>(q->>'id'), '')) in ('', 'false') then raise exception 'Falta contestar: %', q->>'label'; end if;
  end loop;
  if pg_column_size(p_answers) > 8000 then raise exception 'Respuestas demasiado largas'; end if;
  st := case when e.require_approval then 'pending' when e.capacity is not null and public.event_taken(e.id) >= e.capacity then 'waiting' else 'going' end;
  if g.id is not null then
    update public.event_guests set name = nm, bike = bk, companion = coalesce(p_companion, false), answers = coalesce(p_answers, '{}'), status = st, joined_at = now(), updated_at = now(), checked_in_at = null where id = g.id returning * into g;
  else
    insert into public.event_guests (event_id, name, email, phone, bike, companion, answers, status) values (e.id, nm, em, ph, bk, coalesce(p_companion, false), coalesce(p_answers, '{}'), st) returning * into g;
  end if;
  return jsonb_build_object('code', g.code, 'status', g.status);
end $$;
revoke all on function public.event_register(uuid, text, text, text, boolean, jsonb, text) from public;
grant execute on function public.event_register(uuid, text, text, text, boolean, jsonb, text) to anon, authenticated;

create or replace function public.event_manage(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_run_event(p_event) then raise exception 'Solo un administrador puede ver esto'; end if;
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', a.user_id, 'name', coalesce(nullif(btrim(p.name), ''), 'Sin nombre'), 'phone', coalesce(nullif(btrim(pp.ride_phone), ''), u.raw_user_meta_data->>'phone', ''), 'bike', coalesce(a.bike, ''),
        'status', a.status, 'companion', a.companion, 'checked_in', a.checked_in_at is not null, 'joined_at', (extract(epoch from a.joined_at) * 1000)::bigint) order by a.joined_at)
      from public.event_attendees a left join public.profiles p on p.id = a.user_id left join auth.users u on u.id = a.user_id left join public.profile_private pp on pp.id = a.user_id
      where a.event_id = p_event and a.status <> 'no'), '[]'::jsonb),
    'guests', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'email', g.email, 'phone', g.phone, 'bike', coalesce(g.bike, ''), 'status', g.status, 'companion', g.companion,
        'answers', g.answers, 'checked_in', g.checked_in_at is not null, 'joined_at', (extract(epoch from g.joined_at) * 1000)::bigint) order by g.joined_at)
      from public.event_guests g where g.event_id = p_event and g.status <> 'no'), '[]'::jsonb));
end $$;
revoke all on function public.event_manage(uuid) from public, anon;
grant execute on function public.event_manage(uuid) to authenticated;

notify pgrst, 'reload schema';
