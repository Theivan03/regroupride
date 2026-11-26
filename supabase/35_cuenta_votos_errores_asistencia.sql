-- 35 · Respuestas de los miembros al apuntarse, borrar la propia cuenta, votos en las mejoras,
--      registro de errores de la app e historial de asistencia. Se puede ejecutar varias veces.

-- ---------- 1) Los miembros también contestan las preguntas del organizador ----------
alter table public.event_attendees add column if not exists answers jsonb not null default '{}'::jsonb;
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'event_manage';
  if d is not null and position('''answers'', a.answers' in d) = 0 then
    d := replace(d, '''status'', a.status, ''companion'', a.companion, ''checked_in'', a.checked_in_at is not null',
                    '''status'', a.status, ''companion'', a.companion, ''answers'', a.answers, ''checked_in'', a.checked_in_at is not null');
    execute d;
  end if;
end $$;

-- ---------- 2) Borrar mi cuenta ----------
-- Si administras tú solo una comunidad con más gente, antes hay que nombrar a otro administrador (o borrarla).
-- Las comunidades donde estás solo se borran contigo. Los viajes privados pasan al miembro más antiguo.
create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare u uuid := auth.uid(); blocked jsonb; r record;
begin
  if u is null then raise exception 'Entra en tu cuenta'; end if;
  select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb) into blocked
    from public.communities c join public.community_members me on me.community_id = c.id and me.user_id = u and me.role = 'admin'
   where coalesce(c.kind, '') <> 'trip'
     and not exists (select 1 from public.community_members a where a.community_id = c.id and a.user_id <> u and a.role = 'admin')
     and exists (select 1 from public.community_members o where o.community_id = c.id and o.user_id <> u);
  if jsonb_array_length(blocked) > 0 then return jsonb_build_object('ok', false, 'blocked', blocked); end if;
  -- viajes privados que llevo yo solo: pasan al miembro más antiguo
  for r in select c.id from public.communities c join public.community_members me on me.community_id = c.id and me.user_id = u and me.role = 'admin'
            where c.kind = 'trip' and not exists (select 1 from public.community_members a where a.community_id = c.id and a.user_id <> u and a.role = 'admin')
              and exists (select 1 from public.community_members o where o.community_id = c.id and o.user_id <> u) loop
    update public.community_members set role = 'admin' where community_id = r.id and user_id = (select user_id from public.community_members where community_id = r.id and user_id <> u order by joined_at limit 1);
  end loop;
  -- comunidades (y viajes) donde no queda nadie más
  delete from public.communities c where exists (select 1 from public.community_members me where me.community_id = c.id and me.user_id = u)
     and not exists (select 1 from public.community_members o where o.community_id = c.id and o.user_id <> u);
  delete from auth.users where id = u;
  return jsonb_build_object('ok', true);
end $$;
-- Antes de borrar: ¿hay comunidades donde soy el único administrador y queda más gente? (la app vacía el almacén solo si no las hay)
create or replace function public.delete_my_account_blocked() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb)
    from public.communities c join public.community_members me on me.community_id = c.id and me.user_id = auth.uid() and me.role = 'admin'
   where coalesce(c.kind, '') <> 'trip'
     and not exists (select 1 from public.community_members a where a.community_id = c.id and a.user_id <> auth.uid() and a.role = 'admin')
     and exists (select 1 from public.community_members o where o.community_id = c.id and o.user_id <> auth.uid());
$$;
revoke all on function public.delete_my_account_blocked() from public, anon;
grant execute on function public.delete_my_account_blocked() to authenticated;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- 3) Votos en las mejoras ----------
alter table public.feedback add column if not exists public boolean not null default false;
create table if not exists public.feedback_votes (
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (feedback_id, user_id));
alter table public.feedback_votes enable row level security;
-- (sin políticas: solo se toca con las funciones de abajo)
create or replace function public.feedback_board() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'votes')::int desc, (x->>'at')::bigint desc), '[]'::jsonb) from (
    select jsonb_build_object('id', f.id, 'text', left(f.message, 400), 'status', f.status, 'note', coalesce(f.admin_note, ''),
             'votes', (select count(*) from public.feedback_votes v where v.feedback_id = f.id),
             'mine', exists (select 1 from public.feedback_votes v where v.feedback_id = f.id and v.user_id = auth.uid()),
             'own', f.user_id = auth.uid(), 'at', (extract(epoch from f.created_at) * 1000)::bigint) as x
      from public.feedback f
     where auth.uid() is not null and f.public and f.kind = 'mejora' and coalesce(f.status, '') not in ('descartado', 'rejected')
     order by f.created_at desc limit 80) z;
$$;
create or replace function public.feedback_vote(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); n int; mine boolean;
begin
  if u is null then raise exception 'Entra en tu cuenta'; end if;
  if not exists (select 1 from public.feedback f where f.id = p_id and f.public and f.kind = 'mejora') then raise exception 'Esa propuesta ya no está'; end if;
  if exists (select 1 from public.feedback_votes where feedback_id = p_id and user_id = u) then delete from public.feedback_votes where feedback_id = p_id and user_id = u; mine := false;
  else insert into public.feedback_votes (feedback_id, user_id) values (p_id, u) on conflict do nothing; mine := true; end if;
  select count(*) into n from public.feedback_votes where feedback_id = p_id;
  return jsonb_build_object('votes', n, 'mine', mine);
end $$;
revoke all on function public.feedback_board() from public, anon;
revoke all on function public.feedback_vote(uuid) from public, anon;
grant execute on function public.feedback_board() to authenticated;
grant execute on function public.feedback_vote(uuid) to authenticated;
-- el creador decide desde el panel si una mejora antigua se enseña o se retira
create or replace function public.dev_feedback_public(p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede hacer esto'; end if;
  update public.feedback set public = p_on where id = p_id;
end $$;
revoke all on function public.dev_feedback_public(uuid, boolean) from public, anon;
grant execute on function public.dev_feedback_public(uuid, boolean) to authenticated;

-- ---------- 4) Registro de errores de la app ----------
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  message text not null, source text, stack text, view text, app_version text, platform text, device text,
  hits int not null default 1, first_at timestamptz not null default now(), last_at timestamptz not null default now());
create index if not exists client_errors_last on public.client_errors (last_at desc);
alter table public.client_errors enable row level security;
-- Un mismo error (mensaje + sitio + versión) se cuenta, no se repite. Tope por persona para que un bucle no llene la tabla.
create or replace function public.log_client_error(p_message text, p_source text, p_stack text, p_view text, p_version text, p_platform text, p_device text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); k bigint;
begin
  if coalesce(btrim(p_message), '') = '' then return; end if;
  if (select count(*) from public.client_errors where last_at > now() - interval '1 hour' and user_id is not distinct from u) > 60 then return; end if;
  select id into k from public.client_errors where message = left(p_message, 300) and coalesce(source, '') = coalesce(left(p_source, 200), '') and coalesce(app_version, '') = coalesce(left(p_version, 20), '') order by last_at desc limit 1;
  if k is not null then update public.client_errors set hits = hits + 1, last_at = now(), user_id = coalesce(u, user_id), device = coalesce(left(p_device, 120), device), view = coalesce(left(p_view, 40), view) where id = k;
  else insert into public.client_errors (user_id, message, source, stack, view, app_version, platform, device)
       values (u, left(p_message, 300), left(p_source, 200), left(p_stack, 1500), left(p_view, 40), left(p_version, 20), left(p_platform, 20), left(p_device, 120)); end if;
  delete from public.client_errors where last_at < now() - interval '60 days';
end $$;
revoke all on function public.log_client_error(text, text, text, text, text, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text, text, text, text) to anon, authenticated;
create or replace function public.dev_errors() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede ver esto'; end if;
  return coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', e.id, 'message', e.message, 'source', e.source, 'stack', e.stack, 'view', e.view, 'version', e.app_version,
      'platform', e.platform, 'device', e.device, 'hits', e.hits, 'last', (extract(epoch from e.last_at) * 1000)::bigint, 'first', (extract(epoch from e.first_at) * 1000)::bigint,
      'who', (select coalesce(nullif(btrim(p.name), ''), 'Sin nombre') from public.profiles p where p.id = e.user_id)) as x
      from public.client_errors e order by e.last_at desc limit 100) z), '[]'::jsonb);
end $$;
create or replace function public.dev_errors_clear() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede hacer esto'; end if;
  delete from public.client_errors where true;
end $$;
revoke all on function public.dev_errors() from public, anon;
revoke all on function public.dev_errors_clear() from public, anon;
grant execute on function public.dev_errors() to authenticated;
grant execute on function public.dev_errors_clear() to authenticated;

-- ---------- 5) Historial de asistencia (para los administradores de la comunidad) ----------
create or replace function public.community_attendance(p_community uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_community_admin(p_community) then raise exception 'Solo un administrador puede ver esto'; end if;
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(x order by (x->>'at')::bigint desc) from (
      select jsonb_build_object('id', e.id, 'title', e.title, 'at', (extract(epoch from e.starts_at) * 1000)::bigint,
        'going', (select count(*) from public.event_attendees a where a.event_id = e.id and a.status = 'going') + (select count(*) from public.event_guests g where g.event_id = e.id and g.status = 'going'),
        'came', (select count(*) from public.event_attendees a where a.event_id = e.id and a.checked_in_at is not null) + (select count(*) from public.event_guests g where g.event_id = e.id and g.checked_in_at is not null)) as x
        from public.events e where e.community_id = p_community and e.starts_at < now() and e.starts_at > now() - interval '12 months'
       order by e.starts_at desc limit 40) z), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(x order by (x->>'going')::int desc, x->>'name') from (
      select jsonb_build_object('id', m.user_id, 'name', coalesce(nullif(btrim(p.name), ''), 'Sin nombre'), 'avatar', p.avatar_url,
        'going', count(a.event_id) filter (where a.status = 'going'),
        'came', count(a.event_id) filter (where a.checked_in_at is not null),
        'missed', count(a.event_id) filter (where a.status = 'going' and a.checked_in_at is null and exists (select 1 from public.event_attendees o where o.event_id = a.event_id and o.checked_in_at is not null)),
        'last', (extract(epoch from max(e.starts_at) filter (where a.status = 'going')) * 1000)::bigint) as x
        from public.community_members m left join public.profiles p on p.id = m.user_id
        left join public.events e on e.community_id = m.community_id and e.starts_at < now() and e.starts_at > now() - interval '12 months'
        left join public.event_attendees a on a.event_id = e.id and a.user_id = m.user_id
       where m.community_id = p_community group by m.user_id, p.name, p.avatar_url) z), '[]'::jsonb));
end $$;
revoke all on function public.community_attendance(uuid) from public, anon;
grant execute on function public.community_attendance(uuid) to authenticated;

-- ---------- 6) Una salida de la comunidad se inicia para los apuntados aunque no tenga ruta puesta ----------
do $$
declare d text;
begin
  d := pg_get_functiondef('public.event_start(uuid)'::regprocedure);
  d := replace(d, 'if e.route is null then raise exception ''Este evento no tiene ruta''; end if;', '');
  execute d;
end $$;

-- ---------- 7) Quien crea una salida va a ella: apuntado y con la llegada puesta desde el principio ----------
create or replace function public.event_creator_goes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is null then return new; end if;
  perform set_config('rg.sys', '1', true);   -- el organizador siempre tiene plaza
  insert into public.event_attendees (event_id, user_id, status, checked_in_at) values (new.id, new.created_by, 'going', now())
    on conflict (event_id, user_id) do nothing;
  perform set_config('rg.sys', '', true);
  return new;
end $$;
drop trigger if exists t_event_creator on public.events;
create trigger t_event_creator after insert on public.events for each row execute function public.event_creator_goes();
do $$
begin
  perform set_config('rg.sys', '1', true);
  insert into public.event_attendees (event_id, user_id, status, checked_in_at)
    select e.id, e.created_by, 'going', now() from public.events e
     where e.created_by is not null and exists (select 1 from auth.users u where u.id = e.created_by)
    on conflict (event_id, user_id) do nothing;
  update public.event_attendees a set checked_in_at = now() from public.events e
   where e.id = a.event_id and a.user_id = e.created_by and a.status = 'going' and a.checked_in_at is null;
  perform set_config('rg.sys', '', true);
end $$;
