-- ReGroupRide · copia de las rutas en la cuenta (planificadas y grabadas), para no depender del teléfono.
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar todo este archivo → Run. Se puede ejecutar más de una vez.
-- Necesita haber ejecutado antes schema.sql y 04_rutas_niveles.sql.

-- ============ Rutas planificadas: todas se guardan en la cuenta (privadas, salvo las que se publiquen) ============
-- local_id = identificador de la ruta en el móvil: permite subirla dos veces sin duplicarla.
alter table public.routes add column if not exists local_id bigint;
create unique index if not exists routes_owner_local_idx on public.routes(owner_id, local_id);

-- ============ Rutas grabadas ============
-- El resumen (nombre, km, tiempos, inclinaciones, curvas…) va en esta tabla; el trazado punto a punto, comprimido,
-- en el almacén «rides», en una carpeta por usuario. Cada uno solo ve y toca lo suyo.
create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  local_id bigint not null,                 -- identificador de la ruta en el móvil donde se grabó
  started_at timestamptz,
  km real,
  meta jsonb not null,                      -- la ficha de la ruta tal como la guarda la app
  track text,                               -- ruta del archivo del trazado en el almacén (null si no tiene)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, local_id)
);
create index if not exists rides_owner_idx on public.rides(owner_id, started_at desc);
drop trigger if exists t_rides on public.rides;
create trigger t_rides before update on public.rides for each row execute function public.touch_updated_at();

alter table public.rides enable row level security;
drop policy if exists "grabadas leer" on public.rides;
create policy "grabadas leer" on public.rides for select to authenticated using (owner_id = auth.uid());
drop policy if exists "grabadas crear" on public.rides;
create policy "grabadas crear" on public.rides for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "grabadas editar" on public.rides;
create policy "grabadas editar" on public.rides for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "grabadas borrar" on public.rides;
create policy "grabadas borrar" on public.rides for delete to authenticated using (owner_id = auth.uid());

-- Almacén privado para los trazados: <id de usuario>/<id de la ruta>.json.gz
insert into storage.buckets (id, name, public) values ('rides', 'rides', false) on conflict (id) do nothing;
drop policy if exists "trazados leer" on storage.objects;
create policy "trazados leer" on storage.objects for select to authenticated
  using (bucket_id = 'rides' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "trazados subir" on storage.objects;
create policy "trazados subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'rides' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "trazados cambiar" on storage.objects;
create policy "trazados cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'rides' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'rides' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "trazados borrar" on storage.objects;
create policy "trazados borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'rides' and (storage.foldername(name))[1] = auth.uid()::text);
