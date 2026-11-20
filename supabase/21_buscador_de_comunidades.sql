-- ReGroupRide · 21 — ficha de la comunidad (zona, estilo), buscador de comunidades y solicitudes para unirse.
-- Aplicado en producción como migración «buscador_de_comunidades» (ahí está el texto completo de las funciones
-- community_search, community_ask, community_request_answer y la versión vigente de community_news).
alter table public.communities add column if not exists zone text not null default '';
alter table public.communities add column if not exists ride_style text not null default '';
alter table public.communities add column if not exists listed boolean not null default false;
alter table public.communities add column if not exists join_mode text not null default 'code';   -- 'open' | 'request' | 'code'
create table if not exists public.community_join_requests (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  primary key (community_id, user_id)
);
