-- ReGroupRide · comunidades, eventos, tablón y páginas
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar todo este archivo → Run.
-- Se puede ejecutar más de una vez. Necesita haber ejecutado antes schema.sql.

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  description text not null default '',
  join_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists community_members_user_idx on public.community_members(user_id);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists community_posts_idx on public.community_posts(community_id, created_at desc);

-- Páginas de la comunidad (normas, descuentos...). links: [{label, url, code}]
create table if not exists public.community_pages (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  body text not null default '',
  links jsonb not null default '[]',
  position integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists community_pages_idx on public.community_pages(community_id, position);

-- Eventos y rutas de la comunidad. route: {name, wps, coords, steps, dist, dur} (la ruta planificada, para cargarla en la app)
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  starts_at timestamptz not null,
  meet_name text not null default '',
  luma_url text,
  route jsonb,
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists events_idx on public.events(community_id, starts_at);

create table if not exists public.event_attendees (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  status text not null default 'going' check (status in ('going','no')),
  companion boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ¿Soy miembro / admin de esta comunidad? (security definer: evita reglas que se llaman a sí mismas)
create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_members where community_id = cid and user_id = auth.uid());
$$;
create or replace function public.is_community_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_members where community_id = cid and user_id = auth.uid() and role = 'admin');
$$;
create or replace function public.shares_community(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_members a join public.community_members b on a.community_id = b.community_id
                 where a.user_id = auth.uid() and b.user_id = uid);
$$;

-- Crear una comunidad: quien la crea es su administrador. Devuelve el id.
create or replace function public.create_community(p_name text, p_description text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; code text;
begin
  if auth.uid() is null then raise exception 'Hay que iniciar sesión'; end if;
  loop
    code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.communities where join_code = code);
  end loop;
  insert into public.communities (name, description, join_code, created_by) values (trim(p_name), coalesce(p_description, ''), code, auth.uid()) returning id into cid;
  insert into public.community_members (community_id, user_id, role) values (cid, auth.uid(), 'admin');
  return cid;
end; $$;

-- Unirse con el código de invitación. Devuelve el id de la comunidad.
create or replace function public.join_community(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Hay que iniciar sesión'; end if;
  select id into cid from public.communities where join_code = upper(trim(p_code));
  if cid is null then raise exception 'Código no válido'; end if;
  insert into public.community_members (community_id, user_id) values (cid, auth.uid()) on conflict do nothing;
  return cid;
end; $$;

grant execute on function public.create_community(text, text) to authenticated;
grant execute on function public.join_community(text) to authenticated;

-- updated_at
drop trigger if exists t_pages on public.community_pages;
create trigger t_pages before update on public.community_pages for each row execute function public.touch_updated_at();
drop trigger if exists t_events on public.events;
create trigger t_events before update on public.events for each row execute function public.touch_updated_at();
drop trigger if exists t_attendees on public.event_attendees;
create trigger t_attendees before update on public.event_attendees for each row execute function public.touch_updated_at();

-- ============ Seguridad (RLS) ============
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_pages enable row level security;
alter table public.events enable row level security;
alter table public.event_attendees enable row level security;

drop policy if exists "comunidad ver" on public.communities;
create policy "comunidad ver" on public.communities for select to authenticated using (public.is_member(id));
drop policy if exists "comunidad editar" on public.communities;
create policy "comunidad editar" on public.communities for update to authenticated using (public.is_community_admin(id)) with check (public.is_community_admin(id));
drop policy if exists "comunidad borrar" on public.communities;
create policy "comunidad borrar" on public.communities for delete to authenticated using (created_by = auth.uid());

drop policy if exists "miembros ver" on public.community_members;
create policy "miembros ver" on public.community_members for select to authenticated using (public.is_member(community_id));
drop policy if exists "miembros rol" on public.community_members;
create policy "miembros rol" on public.community_members for update to authenticated using (public.is_community_admin(community_id)) with check (public.is_community_admin(community_id));
drop policy if exists "miembros salir" on public.community_members;
create policy "miembros salir" on public.community_members for delete to authenticated using (user_id = auth.uid() or public.is_community_admin(community_id));

drop policy if exists "tablon ver" on public.community_posts;
create policy "tablon ver" on public.community_posts for select to authenticated using (public.is_member(community_id));
drop policy if exists "tablon publicar" on public.community_posts;
create policy "tablon publicar" on public.community_posts for insert to authenticated with check (public.is_community_admin(community_id) and author_id = auth.uid());
drop policy if exists "tablon borrar" on public.community_posts;
create policy "tablon borrar" on public.community_posts for delete to authenticated using (public.is_community_admin(community_id));

drop policy if exists "paginas ver" on public.community_pages;
create policy "paginas ver" on public.community_pages for select to authenticated using (public.is_member(community_id));
drop policy if exists "paginas admin" on public.community_pages;
create policy "paginas admin" on public.community_pages for all to authenticated using (public.is_community_admin(community_id)) with check (public.is_community_admin(community_id));

drop policy if exists "eventos ver" on public.events;
create policy "eventos ver" on public.events for select to authenticated using (public.is_member(community_id));
drop policy if exists "eventos admin" on public.events;
create policy "eventos admin" on public.events for all to authenticated using (public.is_community_admin(community_id)) with check (public.is_community_admin(community_id));

drop policy if exists "asistentes ver" on public.event_attendees;
create policy "asistentes ver" on public.event_attendees for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.is_member(e.community_id)));
drop policy if exists "asistentes apuntarse" on public.event_attendees;
create policy "asistentes apuntarse" on public.event_attendees for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.events e where e.id = event_id and public.is_member(e.community_id)));
drop policy if exists "asistentes cambiar" on public.event_attendees;
create policy "asistentes cambiar" on public.event_attendees for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Los compañeros de comunidad ven tu nombre y tu moto aunque el perfil sea privado.
drop policy if exists "perfiles visibles" on public.profiles;
create policy "perfiles visibles" on public.profiles for select to authenticated
  using (is_public or id = auth.uid() or public.is_app_admin() or public.shares_community(id));

-- La primera cuenta que entra es administradora de la app (panel de sugerencias), sin tocar SQL a mano.
insert into public.app_admins (user_id) select id from auth.users order by created_at limit 1 on conflict do nothing;
