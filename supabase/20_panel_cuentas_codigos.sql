-- ReGroupRide · 20 — códigos de ventaja y panel del creador con cuentas, comunidades y códigos.
-- Ejecutar una vez en Supabase → SQL Editor, después de 19_chat_silenciar.sql. Se puede ejecutar más de una vez.

-- ============ Códigos ============
create table if not exists public.promo_codes (
  code text primary key check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,24}$'),
  label text not null default '',
  benefit text not null check (benefit in ('sin_anuncios', 'premium', 'todo_gratis')),
  max_uses int check (max_uses is null or max_uses > 0),
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.promo_redemptions (
  code text not null references public.promo_codes(code) on update cascade on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (code, user_id)
);
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
revoke all on public.promo_codes, public.promo_redemptions from anon, authenticated;

-- Canjear un código (cada cuenta, una vez por código).
create or replace function public.promo_redeem(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.promo_codes; n int; k text := upper(btrim(coalesce(p_code, '')));
begin
  if auth.uid() is null then raise exception 'Entra en tu cuenta para usar un código'; end if;
  select * into c from public.promo_codes where code = k for update;
  if not found or not c.active then raise exception 'Ese código no existe o ya no está activo'; end if;
  if c.expires_at is not null and c.expires_at < now() then raise exception 'Ese código ha caducado'; end if;
  if exists (select 1 from public.promo_redemptions r where r.code = k and r.user_id = auth.uid()) then
    return jsonb_build_object('ok', true, 'again', true, 'benefit', c.benefit, 'label', c.label);
  end if;
  select count(*) into n from public.promo_redemptions r where r.code = k;
  if c.max_uses is not null and n >= c.max_uses then raise exception 'Ese código ya se ha usado todas las veces posibles'; end if;
  insert into public.promo_redemptions (code, user_id) values (k, auth.uid());
  return jsonb_build_object('ok', true, 'benefit', c.benefit, 'label', c.label);
end $$;
revoke all on function public.promo_redeem(text) from public, anon;
grant execute on function public.promo_redeem(text) to authenticated;

-- Las ventajas que tengo ahora mismo.
create or replace function public.my_benefits() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'benefit', c.benefit, 'label', c.label, 'at', (extract(epoch from r.created_at) * 1000)::bigint) order by r.created_at), '[]'::jsonb)
  from public.promo_redemptions r join public.promo_codes c on c.code = r.code
  where r.user_id = auth.uid() and c.active and (c.expires_at is null or c.expires_at > now());
$$;
revoke all on function public.my_benefits() from public, anon;
grant execute on function public.my_benefits() to authenticated;

-- ============ Panel del creador ============
create or replace function public.dev_users() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede ver esto'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'name', coalesce(nullif(btrim(p.name), ''), u.raw_user_meta_data->>'name', ''),
      'phone', coalesce(pp.ride_phone, u.raw_user_meta_data->>'phone', ''),
      'bike', btrim(coalesce(p.bike_brand, '') || ' ' || coalesce(p.bike_model, '')),
      'created_at', (extract(epoch from u.created_at) * 1000)::bigint,
      'last_at', case when u.last_sign_in_at is not null then (extract(epoch from u.last_sign_in_at) * 1000)::bigint end,
      'seen_at', (select (extract(epoch from max(d.last_seen)) * 1000)::bigint from public.app_devices d where d.user_id = u.id),
      'confirmed', u.email_confirmed_at is not null,
      'admin', exists (select 1 from public.app_admins a where a.user_id = u.id),
      'communities', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'role', m.role) order by c.name) from public.community_members m join public.communities c on c.id = m.community_id where m.user_id = u.id), '[]'::jsonb),
      'owns', (select count(*) from public.communities c where c.created_by = u.id),
      'codes', coalesce((select jsonb_agg(r.code order by r.created_at) from public.promo_redemptions r where r.user_id = u.id), '[]'::jsonb),
      'rides', coalesce(rs.rides, 0), 'km', round(coalesce(rs.km, 0)),
      'signups', (select count(*) from public.event_attendees a where a.user_id = u.id and a.status in ('going', 'waiting', 'offered'))
    ) order by u.created_at desc)
    from auth.users u left join public.profiles p on p.id = u.id left join public.profile_private pp on pp.id = u.id left join public.rider_stats rs on rs.user_id = u.id), '[]'::jsonb);
end $$;

create or replace function public.dev_communities() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede ver esto'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'description', coalesce(c.description, ''), 'web_public', coalesce(c.web_public, false),
      'created_at', (extract(epoch from c.created_at) * 1000)::bigint,
      'owner', coalesce(nullif(btrim(p.name), ''), u.email, '—'), 'owner_email', u.email,
      'members', (select count(*) from public.community_members m where m.community_id = c.id),
      'admins', (select count(*) from public.community_members m where m.community_id = c.id and m.role = 'admin'),
      'events', (select count(*) from public.events e where e.community_id = c.id),
      'events_next', (select count(*) from public.events e where e.community_id = c.id and e.starts_at > now()),
      'last_event', (select (extract(epoch from max(e.starts_at)) * 1000)::bigint from public.events e where e.community_id = c.id),
      'people', coalesce((select jsonb_agg(coalesce(nullif(btrim(mp.name), ''), 'Sin nombre') || case when m.role = 'admin' then ' (admin)' else '' end order by m.role, mp.name)
                          from public.community_members m left join public.profiles mp on mp.id = m.user_id where m.community_id = c.id), '[]'::jsonb)
    ) order by c.created_at desc)
    from public.communities c left join auth.users u on u.id = c.created_by left join public.profiles p on p.id = c.created_by), '[]'::jsonb);
end $$;

create or replace function public.dev_codes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede ver esto'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'code', c.code, 'label', c.label, 'benefit', c.benefit, 'max_uses', c.max_uses, 'active', c.active,
      'expires_at', case when c.expires_at is not null then (extract(epoch from c.expires_at) * 1000)::bigint end,
      'created_at', (extract(epoch from c.created_at) * 1000)::bigint,
      'uses', (select count(*) from public.promo_redemptions r where r.code = c.code),
      'who', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(nullif(btrim(p.name), ''), 'Sin nombre'), 'email', u.email, 'at', (extract(epoch from r.created_at) * 1000)::bigint) order by r.created_at desc)
                       from public.promo_redemptions r left join public.profiles p on p.id = r.user_id left join auth.users u on u.id = r.user_id where r.code = c.code), '[]'::jsonb)
    ) order by c.created_at desc) from public.promo_codes c), '[]'::jsonb);
end $$;

create or replace function public.dev_code_save(p_code text, p_label text, p_benefit text, p_max int, p_expires timestamptz, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede hacer esto'; end if;
  insert into public.promo_codes (code, label, benefit, max_uses, expires_at, active)
    values (upper(btrim(p_code)), coalesce(btrim(p_label), ''), p_benefit, p_max, p_expires, coalesce(p_active, true))
  on conflict (code) do update set label = excluded.label, benefit = excluded.benefit, max_uses = excluded.max_uses, expires_at = excluded.expires_at, active = excluded.active;
end $$;

create or replace function public.dev_code_remove(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede hacer esto'; end if;
  delete from public.promo_codes where code = upper(btrim(p_code));
end $$;

create or replace function public.dev_community_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede hacer esto'; end if;
  delete from public.communities where id = p_id;
end $$;

-- Borrar una cuenta entera (perfil, rutas, inscripciones…). No deja borrar al creador ni a quien tenga una comunidad con más gente.
create or replace function public.dev_user_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_app_admin() then raise exception 'Solo el creador puede hacer esto'; end if;
  if p_id = auth.uid() or exists (select 1 from public.app_admins a where a.user_id = p_id) then raise exception 'Esa cuenta es del creador: no se puede borrar desde aquí'; end if;
  if exists (select 1 from public.communities c where c.created_by = p_id and exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id <> p_id)) then
    raise exception 'Esa cuenta creó una comunidad con más miembros. Borra antes la comunidad (o se borraría con ella).';
  end if;
  delete from auth.users where id = p_id;
end $$;

revoke all on function public.dev_users(), public.dev_communities(), public.dev_codes(), public.dev_code_save(text, text, text, int, timestamptz, boolean), public.dev_code_remove(text), public.dev_community_remove(uuid), public.dev_user_remove(uuid) from public, anon;
grant execute on function public.dev_users(), public.dev_communities(), public.dev_codes(), public.dev_code_save(text, text, text, int, timestamptz, boolean), public.dev_code_remove(text), public.dev_community_remove(uuid), public.dev_user_remove(uuid) to authenticated;

notify pgrst, 'reload schema';
