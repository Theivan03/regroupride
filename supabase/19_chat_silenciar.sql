-- ReGroupRide · 19 — cada uno decide si quiere avisos del chat de un evento.
-- Ejecutar una vez en Supabase → SQL Editor, después de 18_chat_de_evento.sql. Se puede ejecutar más de una vez.
create table if not exists public.event_chat_mutes (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.event_chat_mutes enable row level security;
grant select, insert, delete on public.event_chat_mutes to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'event_chat_mutes' and policyname = 'silencio ver') then
    create policy "silencio ver" on public.event_chat_mutes for select to authenticated using (user_id = auth.uid());
    create policy "silencio poner" on public.event_chat_mutes for insert to authenticated with check (user_id = auth.uid());
    create policy "silencio quitar" on public.event_chat_mutes for delete to authenticated using (user_id = auth.uid());
  end if;
end $$;
-- event_message_notify() y community_news() dejan fuera a quien lo tiene silenciado: su definición vigente está en la
-- migración «chat_silenciar» aplicada en producción (igual que en 18, añadiendo «not exists (… event_chat_mutes …)»).
