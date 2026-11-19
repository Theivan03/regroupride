-- ReGroupRide · 13 — la web de eventos, como Luma.
-- Ejecutar una vez en Supabase → SQL Editor, después de 12_plaza_por_push.sql. Se puede ejecutar más de una vez.
--
-- Qué añade:
--  · Inscripción desde la web SIN cuenta ni app (nombre, correo y teléfono). Comparten el aforo con los apuntados de la app.
--  · Opciones del evento: hora de fin, indicaciones del punto de salida, aprobación manual, preguntas de inscripción,
--    enseñar o no la lista de asistentes, abrir/cerrar inscripciones y aparecer o no en la página de la comunidad.
--  · Entrada con código (QR) y control de llegada (check-in) para los administradores.
--  · Página pública de la comunidad con sus eventos.

-- ============ Columnas nuevas ============
alter table public.events add column if not exists ends_at timestamptz;
alter table public.events add column if not exists meet_note text not null default '';
alter table public.events add column if not exists require_approval boolean not null default false;
alter table public.events add column if not exists questions jsonb not null default '[]';
alter table public.events add column if not exists show_guests boolean not null default true;
alter table public.events add column if not exists allow_guests boolean not null default true;
alter table public.events add column if not exists open_reg boolean not null default true;
alter table public.events add column if not exists listed boolean not null default true;
alter table public.communities add column if not exists web_public boolean not null default true;
alter table public.event_attendees add column if not exists checked_in_at timestamptz;

-- Inscritos desde la web sin cuenta. Solo se llega a ellos por las funciones de abajo.
create table if not exists public.event_guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  email text not null check (char_length(email) between 5 and 120),
  phone text not null default '' check (char_length(phone) <= 24),
  companion boolean not null default false,
  answers jsonb not null default '{}',
  status text not null default 'going' check (status in ('pending', 'going', 'waiting', 'declined', 'no')),
  code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  joined_at timestamptz not null default now(),
  checked_in_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (event_id, email)
);
create index if not exists event_guests_idx on public.event_guests(event_id, status, joined_at);
alter table public.event_guests enable row level security;
revoke all on public.event_guests from anon, authenticated;

-- Secreto para los códigos de entrada de los miembros (nadie lo lee desde fuera).
create table if not exists public.web_secret (id int primary key check (id = 1), s text not null);
insert into public.web_secret values (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) on conflict do nothing;
alter table public.web_secret enable row level security;
revoke all on public.web_secret from anon, authenticated;

create or replace function public.member_code(p_event uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select 'm' || substr(md5((select s from public.web_secret where id = 1) || p_event::text || p_user::text), 1, 23);
$$;
revoke all on function public.member_code(uuid, uuid) from public, anon, authenticated;

-- Plazas ocupadas (motos): apuntados de la app con plaza o con plaza ofrecida + inscritos de la web con plaza.
create or replace function public.event_taken(p_event uuid, p_but uuid default null) returns int
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.event_attendees where event_id = p_event and status in ('going', 'offered') and (p_but is null or user_id <> p_but))::int
       + (select count(*) from public.event_guests where event_id = p_event and status = 'going' and (p_but is null or id <> p_but))::int;
$$;
revoke all on function public.event_taken(uuid, uuid) from public, anon, authenticated;

-- ============ Repartir las plazas libres (ahora con las dos listas de espera juntas, por orden de llegada) ============
create or replace function public.event_promote(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cap int; st timestamptz; k text; nxt uuid;
begin
  select capacity, starts_at into cap, st from public.events where id = p_event for update;
  if not found or st < now() then return; end if;
  perform set_config('rg.sys', '1', true);
  if cap is null then
    update public.event_attendees set status = 'going' where event_id = p_event and status in ('waiting', 'offered');
    update public.event_guests set status = 'going' where event_id = p_event and status = 'waiting';
  else
    loop
      exit when public.event_taken(p_event) >= cap;
      k := null;
      select q.kind, q.id into k, nxt from (
        select 'a' as kind, user_id as id, (offered_at is not null) as o, coalesce(offered_at, joined_at) as t from public.event_attendees where event_id = p_event and status = 'waiting'
        union all
        select 'g', id, false, joined_at from public.event_guests where event_id = p_event and status = 'waiting') q
      order by q.o, q.t limit 1;
      exit when k is null;
      if k = 'a' then update public.event_attendees set status = 'offered', offered_at = now() where event_id = p_event and user_id = nxt;
      else update public.event_guests set status = 'going', updated_at = now() where id = nxt; end if;   -- sin app no hay aviso: la plaza es suya directamente
    end loop;
  end if;
  perform set_config('rg.sys', '', true);
end $$;
revoke all on function public.event_promote(uuid) from public, anon, authenticated;

-- Apuntarse desde la app: igual que antes, pero contando también a los inscritos de la web.
create or replace function public.att_place() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int;
begin
  if coalesce(current_setting('rg.sys', true), '') = '1' then return new; end if;
  if tg_op = 'UPDATE' then
    new.joined_at := old.joined_at; new.offered_at := old.offered_at;
    if new.status = 'no' then return new; end if;
    if new.status = old.status then return new; end if;
    if old.status in ('going', 'offered') then
      if new.status = 'going' then return new; end if;
      new.status := old.status; return new;
    end if;
    if old.status = 'no' then new.joined_at := now(); new.offered_at := null; end if;
  else
    new.joined_at := now(); new.offered_at := null;
    if new.status = 'no' then return new; end if;
  end if;
  new.status := 'going';
  select capacity into cap from public.events where id = new.event_id for update;
  if cap is null then return new; end if;
  if public.event_taken(new.event_id, new.user_id) >= cap then new.status := 'waiting'; end if;
  return new;
end $$;

-- Un inscrito de la web deja su plaza: pasa al siguiente.
create or replace function public.guest_freed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('rg.sys', true), '') = '1' then return null; end if;
  if old.status = 'going' and (tg_op = 'DELETE' or new.status <> 'going') then perform public.event_promote(old.event_id); end if;
  return null;
end $$;
drop trigger if exists t_guest_freed on public.event_guests;
create trigger t_guest_freed after update or delete on public.event_guests for each row execute function public.guest_freed();

-- ============ Página pública de un evento ============
drop function if exists public.event_public(uuid);
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
    'route_name', e.route->>'name', 'route_km', round(((e.route->>'dist')::numeric), 1),
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

-- ============ Inscribirse desde la web sin cuenta ============
-- Con el mismo correo y teléfono devuelve la entrada que ya había (sirve para recuperarla).
create or replace function public.event_register(p_event uuid, p_name text, p_email text, p_phone text, p_companion boolean default false, p_answers jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.events; g public.event_guests; em text := lower(btrim(coalesce(p_email, ''))); nm text := btrim(coalesce(p_name, '')); ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'); q jsonb; st text;
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
  if not e.open_reg then raise exception 'Las inscripciones están cerradas'; end if;
  if (select count(*) from public.event_guests where event_id = e.id) >= 3000 then raise exception 'No se admiten más inscripciones'; end if;
  for q in select * from jsonb_array_elements(e.questions) loop
    if coalesce((q->>'required')::boolean, false) and btrim(coalesce(p_answers->>(q->>'id'), '')) in ('', 'false') then raise exception 'Falta contestar: %', q->>'label'; end if;
  end loop;
  if pg_column_size(p_answers) > 8000 then raise exception 'Respuestas demasiado largas'; end if;
  st := case when e.require_approval then 'pending' when e.capacity is not null and public.event_taken(e.id) >= e.capacity then 'waiting' else 'going' end;
  if g.id is not null then
    update public.event_guests set name = nm, companion = coalesce(p_companion, false), answers = coalesce(p_answers, '{}'), status = st, joined_at = now(), updated_at = now(), checked_in_at = null where id = g.id returning * into g;
  else
    insert into public.event_guests (event_id, name, email, phone, companion, answers, status) values (e.id, nm, em, ph, coalesce(p_companion, false), coalesce(p_answers, '{}'), st) returning * into g;
  end if;
  return jsonb_build_object('code', g.code, 'status', g.status);
end $$;
revoke all on function public.event_register(uuid, text, text, text, boolean, jsonb) from public;
grant execute on function public.event_register(uuid, text, text, text, boolean, jsonb) to anon, authenticated;

create or replace function public.guest_cancel(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.event_guests set status = 'no', updated_at = now() where code = p_code and status <> 'no';
  return jsonb_build_object('ok', found);
end $$;
revoke all on function public.guest_cancel(text) from public;
grant execute on function public.guest_cancel(text) to anon, authenticated;

-- ============ Gestión (administradores del evento) ============
create or replace function public.event_manage(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_run_event(p_event) then raise exception 'Solo un administrador puede ver esto'; end if;
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', a.user_id, 'name', coalesce(nullif(btrim(p.name), ''), 'Sin nombre'), 'phone', coalesce(u.raw_user_meta_data->>'phone', ''),
        'status', a.status, 'companion', a.companion, 'checked_in', a.checked_in_at is not null, 'joined_at', (extract(epoch from a.joined_at) * 1000)::bigint) order by a.joined_at)
      from public.event_attendees a left join public.profiles p on p.id = a.user_id left join auth.users u on u.id = a.user_id
      where a.event_id = p_event and a.status <> 'no'), '[]'::jsonb),
    'guests', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'email', g.email, 'phone', g.phone, 'status', g.status, 'companion', g.companion,
        'answers', g.answers, 'checked_in', g.checked_in_at is not null, 'joined_at', (extract(epoch from g.joined_at) * 1000)::bigint) order by g.joined_at)
      from public.event_guests g where g.event_id = p_event and g.status <> 'no'), '[]'::jsonb));
end $$;
revoke all on function public.event_manage(uuid) from public, anon;
grant execute on function public.event_manage(uuid) to authenticated;

-- Aprobar, rechazar, quitar o marcar la llegada de un inscrito de la web.
create or replace function public.guest_set(p_guest uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.event_guests; cap int;
begin
  select * into g from public.event_guests where id = p_guest;
  if g.id is null or auth.uid() is null or not public.can_run_event(g.event_id) then raise exception 'Solo un administrador puede hacer esto'; end if;
  if p_action = 'approve' then
    select capacity into cap from public.events where id = g.event_id for update;
    update public.event_guests set status = case when cap is not null and public.event_taken(g.event_id, g.id) >= cap then 'waiting' else 'going' end, updated_at = now()
      where id = g.id and status in ('pending', 'declined', 'waiting');
  elsif p_action = 'decline' then update public.event_guests set status = 'declined', updated_at = now() where id = g.id;
  elsif p_action = 'remove' then update public.event_guests set status = 'no', updated_at = now() where id = g.id;
  elsif p_action = 'checkin' then update public.event_guests set checked_in_at = now() where id = g.id and status = 'going';
  elsif p_action = 'uncheck' then update public.event_guests set checked_in_at = null where id = g.id;
  else raise exception 'Acción desconocida'; end if;
  select * into g from public.event_guests where id = p_guest;
  return jsonb_build_object('status', g.status, 'checked_in', g.checked_in_at is not null);
end $$;
revoke all on function public.guest_set(uuid, text) from public, anon;
grant execute on function public.guest_set(uuid, text) to authenticated;

create or replace function public.member_checkin(p_event uuid, p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_run_event(p_event) then raise exception 'Solo un administrador puede hacer esto'; end if;
  perform set_config('rg.sys', '1', true);
  update public.event_attendees set checked_in_at = case when p_on then now() end where event_id = p_event and user_id = p_user;
  perform set_config('rg.sys', '', true);
end $$;
revoke all on function public.member_checkin(uuid, uuid, boolean) from public, anon;
grant execute on function public.member_checkin(uuid, uuid, boolean) to authenticated;

-- Leer el código de una entrada (QR) en la puerta.
create or replace function public.event_checkin(p_event uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.event_guests; uid uuid; a public.event_attendees; nm text; cd text := btrim(coalesce(p_code, ''));
begin
  if auth.uid() is null or not public.can_run_event(p_event) then raise exception 'Solo un administrador puede hacer esto'; end if;
  select * into g from public.event_guests where code = cd;
  if g.id is not null then
    if g.event_id <> p_event then return jsonb_build_object('ok', false, 'error', 'Esa entrada es de otro evento'); end if;
    if g.status <> 'going' then return jsonb_build_object('ok', false, 'name', g.name, 'error', case g.status when 'waiting' then 'Está en lista de espera' when 'pending' then 'Pendiente de aprobar' else 'No tiene plaza' end); end if;
    update public.event_guests set checked_in_at = coalesce(checked_in_at, now()) where id = g.id;
    return jsonb_build_object('ok', true, 'name', g.name, 'companion', g.companion, 'already', g.checked_in_at is not null);
  end if;
  select x.user_id into uid from public.event_attendees x where x.event_id = p_event and public.member_code(p_event, x.user_id) = cd;
  if uid is null then return jsonb_build_object('ok', false, 'error', 'Entrada no válida'); end if;
  select * into a from public.event_attendees where event_id = p_event and user_id = uid;
  select coalesce(nullif(btrim(name), ''), 'Sin nombre') into nm from public.profiles where id = uid;
  if a.status <> 'going' then return jsonb_build_object('ok', false, 'name', nm, 'error', 'No tiene plaza confirmada'); end if;
  perform set_config('rg.sys', '1', true);
  update public.event_attendees set checked_in_at = coalesce(checked_in_at, now()) where event_id = p_event and user_id = uid;
  perform set_config('rg.sys', '', true);
  return jsonb_build_object('ok', true, 'name', nm, 'companion', a.companion, 'already', a.checked_in_at is not null);
end $$;
revoke all on function public.event_checkin(uuid, text) from public, anon;
grant execute on function public.event_checkin(uuid, text) to authenticated;

-- ============ Página pública de la comunidad ============
create or replace function public.community_public(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description,
    'member', auth.uid() is not null and exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id = auth.uid()),
    'admin', auth.uid() is not null and public.is_community_admin(c.id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', (extract(epoch from e.starts_at) * 1000)::bigint,
        'ends_at', case when e.ends_at is not null then (extract(epoch from e.ends_at) * 1000)::bigint end,
        'meet_name', e.meet_name, 'cover_url', e.cover_url, 'capacity', e.capacity, 'taken', public.event_taken(e.id), 'description', left(e.description, 600)) order by e.starts_at)
      from public.events e where e.community_id = c.id and e.listed and e.starts_at > now() - interval '120 days'), '[]'::jsonb))
  from public.communities c where c.id = p_id and c.web_public;
$$;
revoke all on function public.community_public(uuid) from public;
grant execute on function public.community_public(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
