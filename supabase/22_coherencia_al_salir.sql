-- ReGroupRide · 22 — coherencia al salir de una comunidad, al expulsar y al borrar cuentas.
-- Ejecutar una vez en Supabase → SQL Editor. No borra ningún dato.

-- 1) Borrar una cuenta ya no se lleva por delante las comunidades, eventos y avisos que creó.
alter table public.communities alter column created_by drop not null;
alter table public.events alter column created_by drop not null;
alter table public.community_posts alter column author_id drop not null;
alter table public.communities drop constraint communities_created_by_fkey, add constraint communities_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.events drop constraint events_created_by_fkey, add constraint events_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.community_posts drop constraint community_posts_author_id_fkey, add constraint community_posts_author_id_fkey foreign key (author_id) references auth.users(id) on delete set null;
alter policy "comunidad borrar" on public.communities using (created_by = auth.uid() or (created_by is null and public.is_community_admin(id)));

-- 2) Al salir (o ser expulsado, o borrarse la cuenta) de una comunidad se limpia lo que colgaba de ella.
create or replace function public.member_left() returns trigger
language plpgsql security definer set search_path = public as $$
declare heir uuid;
begin
  if not exists (select 1 from public.communities where id = old.community_id) then return null; end if;   -- se está borrando la comunidad entera
  delete from public.event_attendees a using public.events e
    where e.id = a.event_id and e.community_id = old.community_id and a.user_id = old.user_id and e.starts_at > now() - interval '2 hours';
  delete from public.event_admins x using public.events e where e.id = x.event_id and e.community_id = old.community_id and x.user_id = old.user_id;
  delete from public.event_chat_mutes x using public.events e where e.id = x.event_id and e.community_id = old.community_id and x.user_id = old.user_id;
  delete from public.event_keys k using public.events e where e.id = k.event_id and e.community_id = old.community_id and k.user_id = old.user_id;
  delete from public.ride_positions p using public.ride_sessions s, public.events e
    where p.session_id = s.id and s.event_id = e.id and e.community_id = old.community_id and p.user_id = old.user_id and s.ended_at is null;
  delete from public.community_join_requests where community_id = old.community_id and user_id = old.user_id;
  if not exists (select 1 from public.community_members where community_id = old.community_id) then
    delete from public.communities where id = old.community_id;            -- no queda nadie: la comunidad se borra
  elsif not exists (select 1 from public.community_members where community_id = old.community_id and role = 'admin') then
    select user_id into heir from public.community_members where community_id = old.community_id order by joined_at limit 1;
    update public.community_members set role = 'admin' where community_id = old.community_id and user_id = heir;   -- sin administrador: pasa al miembro más antiguo
    begin perform public.push_send(array[heir], 'role'); exception when others then null; end;
  end if;
  return null;
end $$;
create or replace trigger t_member_left after delete on public.community_members for each row execute function public.member_left();

-- 3) No se puede quitar el cargo al último administrador.
create or replace function public.member_keep_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and new.role <> 'admin'
     and not exists (select 1 from public.community_members where community_id = old.community_id and role = 'admin' and user_id <> old.user_id) then
    raise exception 'Tiene que quedar al menos un administrador en la comunidad';
  end if;
  return new;
end $$;
create or replace trigger t_member_keep_admin before update on public.community_members for each row execute function public.member_keep_admin();

-- 4) Al entrar se borra la solicitud pendiente.
create or replace function public.member_joined() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.community_join_requests where community_id = new.community_id and user_id = new.user_id and status = 'pending';
  return null;
end $$;
create or replace trigger t_member_joined after insert on public.community_members for each row execute function public.member_joined();

-- 5) El chat de un evento y los permisos de «administrador de la ruta» exigen seguir siendo miembro.
create or replace function public.event_chat_user_ok(p_event uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from public.events e join public.community_members m on m.community_id = e.community_id and m.user_id = p_user
    where e.id = p_event and (m.role = 'admin'
      or exists (select 1 from public.event_attendees a where a.event_id = p_event and a.user_id = p_user and a.status in ('going', 'waiting', 'offered'))
      or exists (select 1 from public.event_admins x where x.event_id = p_event and x.user_id = p_user)));
$$;
create or replace function public.can_run_event(eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.events e where e.id = eid and public.is_community_admin(e.community_id))
      or exists (select 1 from public.event_admins a join public.events e on e.id = a.event_id where a.event_id = eid and a.user_id = auth.uid() and public.is_member(e.community_id));
$$;

-- 6) El panel del creador ya puede borrar la cuenta de quien creó una comunidad: la comunidad sigue con sus miembros.
create or replace function public.dev_user_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede hacer esto'; end if;
  if p_id = auth.uid() or exists (select 1 from public.app_admins a where a.user_id = p_id) then raise exception 'Esa cuenta es del creador: no se puede borrar desde aquí'; end if;
  delete from auth.users where id = p_id;
end $$;
notify pgrst, 'reload schema';
