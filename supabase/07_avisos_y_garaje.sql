-- ReGroupRide · responder a los avisos sin abrir la app, y copia del garaje en la cuenta.
-- Se ejecuta DESPUÉS del 06, en el SQL Editor de Supabase. Se puede ejecutar más de una vez.
--
-- 1) Botones de las notificaciones («No puedo ir», «Sí, voy», «No puedo»)
--    Para que el botón actúe sin abrir la app, el teléfono guarda una clave secreta por cada evento al que estás
--    apuntado. Con esa clave (y solo con ella) puede desapuntarte o confirmar tu plaza. La clave es un número
--    aleatorio imposible de adivinar, no se enseña a nadie más y solo vale para ese evento y esa persona.
-- 2) Garaje: los vehículos y su mantenimiento se copian a la cuenta, igual que las rutas.

-- ============ Claves de acción por evento y persona ============
create table if not exists public.event_keys (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  key uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create unique index if not exists event_keys_key_idx on public.event_keys(key);
alter table public.event_keys enable row level security;      -- sin políticas: nadie la lee directamente, solo las funciones de abajo
revoke all on public.event_keys from anon, authenticated;

-- Responder con la clave: 'leave' / 'no' = no voy (la plaza pasa al siguiente) · 'yes' = confirmo la plaza ofrecida.
create or replace function public.event_action(p_key uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k public.event_keys; ttl text; cur text;
begin
  if p_key is null then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  select * into k from public.event_keys where key = p_key;
  if k.event_id is null then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  select title into ttl from public.events where id = k.event_id;
  select status into cur from public.event_attendees where event_id = k.event_id and user_id = k.user_id;
  if cur is null then return jsonb_build_object('ok', false, 'error', 'no apuntado', 'title', ttl); end if;
  if p_action in ('leave', 'no') then
    update public.event_attendees set status = 'no' where event_id = k.event_id and user_id = k.user_id and status <> 'no';
  elsif p_action = 'yes' then
    update public.event_attendees set status = 'going' where event_id = k.event_id and user_id = k.user_id and status = 'offered';
  else
    return jsonb_build_object('ok', false, 'error', 'accion', 'title', ttl);
  end if;
  select status into cur from public.event_attendees where event_id = k.event_id and user_id = k.user_id;
  return jsonb_build_object('ok', true, 'status', cur, 'title', ttl);
end $$;
revoke all on function public.event_action(uuid, text) from public;
grant execute on function public.event_action(uuid, text) to anon, authenticated;   -- el teléfono la llama sin sesión, solo con la clave

-- Mis eventos próximos, ahora con la clave de cada uno (se crea la primera vez).
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
  insert into public.event_keys (event_id, user_id)
    select a.event_id, a.user_id from public.event_attendees a join public.events e on e.id = a.event_id
    where a.user_id = auth.uid() and a.status in ('going', 'waiting', 'offered') and e.starts_at > now() - interval '2 hours'
  on conflict do nothing;
  return jsonb_build_object('events', coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', (extract(epoch from e.starts_at) * 1000)::bigint,
        'meet_name', e.meet_name, 'meet_url', e.meet_url, 'meet_lat', e.meet_lat, 'meet_lon', e.meet_lon, 'has_route', e.route is not null,
        'community_id', e.community_id, 'community', c.name, 'status', a.status, 'key', k.key,
        'deadline', case when a.status = 'offered' then (extract(epoch from public.offer_deadline(a.offered_at, e.starts_at)) * 1000)::bigint end,
        'offered_at', case when a.offered_at is not null then (extract(epoch from a.offered_at) * 1000)::bigint end) order by e.starts_at)
    from public.event_attendees a join public.events e on e.id = a.event_id join public.communities c on c.id = e.community_id
      left join public.event_keys k on k.event_id = a.event_id and k.user_id = a.user_id
    where a.user_id = auth.uid() and a.status in ('going', 'waiting', 'offered') and e.starts_at > now() - interval '2 hours'
      and public.is_member(e.community_id)), '[]'::jsonb));
end $$;
grant execute on function public.event_inbox() to authenticated;

-- ============ Copia del garaje ============
create table if not exists public.user_backup (
  owner_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  garage jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_backup enable row level security;
drop policy if exists "copia propia ver" on public.user_backup;
create policy "copia propia ver" on public.user_backup for select to authenticated using (owner_id = auth.uid());
drop policy if exists "copia propia crear" on public.user_backup;
create policy "copia propia crear" on public.user_backup for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "copia propia cambiar" on public.user_backup;
create policy "copia propia cambiar" on public.user_backup for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update on public.user_backup to authenticated;

notify pgrst, 'reload schema';
