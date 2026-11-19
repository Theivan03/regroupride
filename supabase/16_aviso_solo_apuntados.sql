-- ReGroupRide · 16 — el aviso de «empieza la ruta» llega solo a quien está apuntado.
-- Ejecutar una vez en Supabase → SQL Editor, después de 15_moto_y_telefono.sql. Se puede ejecutar más de una vez.
-- Antes también les llegaba a los administradores de esa ruta aunque no estuvieran apuntados. Se quita esa parte de las
-- tres funciones que deciden a quién se avisa (el push, las novedades con la app cerrada y la pregunta «¿Vienes?»).
do $$
declare d text; n text;
begin
  for n in select unnest(array['community_news', 'ride_calls']) loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n;
    d := regexp_replace(d, '\s+or exists \(select 1 from public\.event_admins x where x\.event_id = e\.id and x\.user_id = (u|auth\.uid\(\))\)', '', 'g');
    execute d;
  end loop;
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'push_on_ride';
  d := regexp_replace(d, '\s+union select x\.user_id from public\.event_admins x where x\.event_id = new\.event_id and x\.user_id <> new\.owner_id', '', 'g');
  execute d;
end $$;
notify pgrst, 'reload schema';
