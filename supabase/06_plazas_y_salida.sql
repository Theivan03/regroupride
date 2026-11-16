-- ReGroupRide · plazas y lista de espera en los eventos, y punto de salida con enlace de Maps.
-- Se ejecuta DESPUÉS de 02, 03, 04 y 05, en el SQL Editor de Supabase. Se puede ejecutar más de una vez.
--
-- Cómo funciona:
--  · El administrador puede poner un límite de plazas al evento (motos). Sin límite, todo sigue como antes.
--  · Quien se apunta con el evento lleno queda «en lista de espera», por orden de llegada.
--  · Cuando alguien con plaza se desapunta, la plaza se le OFRECE al primero de la lista: tiene que confirmar.
--    Si dice que no, pasa al siguiente. Si no contesta en 12 horas (o en la mitad del tiempo que falte para
--    la salida, si es menos), pasa al siguiente y él vuelve al final de la lista.
--  · Las reglas las aplica la base de datos, así que también valen para móviles con una versión antigua de la app.

-- ============ Columnas nuevas ============
alter table public.events add column if not exists capacity int;
alter table public.events add column if not exists meet_url text;
alter table public.events add column if not exists meet_lat double precision;
alter table public.events add column if not exists meet_lon double precision;
alter table public.events drop constraint if exists events_capacity_check;
alter table public.events add constraint events_capacity_check check (capacity is null or capacity between 1 and 1000);
alter table public.events drop constraint if exists events_meet_url_check;
alter table public.events add constraint events_meet_url_check check (meet_url is null or (char_length(meet_url) <= 600 and meet_url ~* '^https?://'));

alter table public.event_attendees add column if not exists joined_at timestamptz not null default now();
alter table public.event_attendees add column if not exists offered_at timestamptz;
alter table public.event_attendees drop constraint if exists event_attendees_status_check;
alter table public.event_attendees add constraint event_attendees_status_check check (status in ('going', 'no', 'waiting', 'offered'));
create index if not exists event_attendees_queue_idx on public.event_attendees(event_id, status, joined_at);

-- ============ Hasta cuándo vale una plaza ofrecida ============
create or replace function public.offer_deadline(p_offered timestamptz, p_starts timestamptz) returns timestamptz
language sql immutable as $$
  select p_offered + least(interval '12 hours', greatest((p_starts - p_offered) / 2, interval '10 minutes'));
$$;

-- ============ Repartir las plazas libres entre la lista de espera ============
-- Primero los que nunca han tenido una plaza ofrecida, por orden de llegada; después los que la dejaron pasar.
create or replace function public.event_promote(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cap int; st timestamptz; taken int; nxt uuid;
begin
  select capacity, starts_at into cap, st from public.events where id = p_event for update;
  if not found or st < now() then return; end if;
  perform set_config('rg.sys', '1', true);
  if cap is null then
    update public.event_attendees set status = 'going' where event_id = p_event and status in ('waiting', 'offered');
  else
    loop
      select count(*) into taken from public.event_attendees where event_id = p_event and status in ('going', 'offered');
      exit when taken >= cap;
      select user_id into nxt from public.event_attendees where event_id = p_event and status = 'waiting'
        order by (offered_at is not null), coalesce(offered_at, joined_at), joined_at limit 1;
      exit when nxt is null;
      update public.event_attendees set status = 'offered', offered_at = now() where event_id = p_event and user_id = nxt;
    end loop;
  end if;
  perform set_config('rg.sys', '', true);
end $$;
revoke all on function public.event_promote(uuid) from public, anon, authenticated;

-- ============ Apuntarse: la base de datos decide si hay plaza ============
create or replace function public.att_place() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int; taken int;
begin
  if coalesce(current_setting('rg.sys', true), '') = '1' then return new; end if;
  if tg_op = 'UPDATE' then
    new.joined_at := old.joined_at; new.offered_at := old.offered_at;      -- el orden de la cola no lo toca nadie a mano
    if new.status = 'no' then return new; end if;
    if new.status = old.status then return new; end if;                    -- solo cambia el acompañante
    if old.status in ('going', 'offered') then                            -- confirmar la plaza ofrecida
      if new.status = 'going' then return new; end if;
      new.status := old.status; return new;
    end if;
    if old.status = 'no' then new.joined_at := now(); new.offered_at := null; end if;   -- vuelve a apuntarse: al final
  else
    new.joined_at := now(); new.offered_at := null;
    if new.status = 'no' then return new; end if;
  end if;
  new.status := 'going';
  select capacity into cap from public.events where id = new.event_id for update;   -- uno a uno: dos a la vez no se cuelan
  if cap is null then return new; end if;
  select count(*) into taken from public.event_attendees where event_id = new.event_id and status in ('going', 'offered') and user_id <> new.user_id;
  if taken >= cap then new.status := 'waiting'; end if;
  return new;
end $$;
drop trigger if exists t_att_place on public.event_attendees;
create trigger t_att_place before insert or update on public.event_attendees for each row execute function public.att_place();

-- ============ Alguien deja su plaza: se ofrece al siguiente ============
create or replace function public.att_freed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('rg.sys', true), '') = '1' then return null; end if;
  if old.status in ('going', 'offered') and (tg_op = 'DELETE' or new.status not in ('going', 'offered')) then
    perform public.event_promote(old.event_id);
  end if;
  return null;
end $$;
drop trigger if exists t_att_freed on public.event_attendees;
create trigger t_att_freed after update or delete on public.event_attendees for each row execute function public.att_freed();

-- ============ El administrador cambia el límite ============
create or replace function public.event_capacity_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.capacity is distinct from old.capacity then perform public.event_promote(new.id); end if;
  return null;
end $$;
drop trigger if exists t_event_capacity on public.events;
create trigger t_event_capacity after update on public.events for each row execute function public.event_capacity_changed();

-- ============ Mis eventos próximos (para los recordatorios y para avisar de una plaza ofrecida) ============
-- De paso caduca las plazas ofrecidas que nadie ha confirmado a tiempo, si hay alguien más esperando.
create or replace function public.event_inbox() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null then return jsonb_build_object('events', '[]'::jsonb); end if;
  for r in
    select a.event_id, a.user_id from public.event_attendees a join public.events e on e.id = a.event_id
    where a.status = 'offered' and e.starts_at > now() and public.is_member(e.community_id)
      and now() > public.offer_deadline(a.offered_at, e.starts_at)
      and exists (select 1 from public.event_attendees w where w.event_id = a.event_id and w.status = 'waiting')
  loop
    perform set_config('rg.sys', '1', true);
    update public.event_attendees set status = 'waiting' where event_id = r.event_id and user_id = r.user_id;
    perform set_config('rg.sys', '', true);
    perform public.event_promote(r.event_id);
  end loop;
  return jsonb_build_object('events', coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', (extract(epoch from e.starts_at) * 1000)::bigint,
        'meet_name', e.meet_name, 'meet_url', e.meet_url, 'meet_lat', e.meet_lat, 'meet_lon', e.meet_lon, 'has_route', e.route is not null,
        'community_id', e.community_id, 'community', c.name, 'status', a.status,
        'deadline', case when a.status = 'offered' then (extract(epoch from public.offer_deadline(a.offered_at, e.starts_at)) * 1000)::bigint end,
        'offered_at', case when a.offered_at is not null then (extract(epoch from a.offered_at) * 1000)::bigint end) order by e.starts_at)
    from public.event_attendees a join public.events e on e.id = a.event_id join public.communities c on c.id = e.community_id
    where a.user_id = auth.uid() and a.status in ('going', 'waiting', 'offered') and e.starts_at > now() - interval '2 hours'
      and public.is_member(e.community_id)), '[]'::jsonb));
end $$;
grant execute on function public.event_inbox() to authenticated;

-- «Empieza la ruta»: también se llama a quien tiene una plaza ofrecida sin confirmar.
create or replace function public.ride_calls() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'event_id', s.event_id, 'by', coalesce(nullif(pr.name, ''), 'El organizador'),
           'at', (extract(epoch from s.created_at) * 1000)::bigint)), '[]'::jsonb)
  from public.ride_sessions s join public.events e on e.id = s.event_id left join public.profiles pr on pr.id = s.owner_id
  where auth.uid() is not null and s.ended_at is null and s.created_at > now() - interval '12 hours'
    and not exists (select 1 from public.ride_positions p where p.session_id = s.id and p.user_id = auth.uid())
    and (exists (select 1 from public.event_attendees a where a.event_id = e.id and a.user_id = auth.uid() and a.status in ('going', 'offered'))
      or exists (select 1 from public.event_admins x where x.event_id = e.id and x.user_id = auth.uid()));
$$;
grant execute on function public.ride_calls() to authenticated;

notify pgrst, 'reload schema';
