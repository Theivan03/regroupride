-- ReGroupRide · 0.17 — «Hay una plaza para ti» aunque la app esté cerrada.
-- Ejecutar una vez en Supabase → SQL Editor, después de 07_avisos_y_garaje.sql. Se puede ejecutar más de una vez.
--
-- Qué añade: a event_action (la función que contesta con la clave de cada evento, sin sesión) se le añade la acción
-- 'status'. Con ella el teléfono pregunta cada pocos minutos si a su dueño, que está en lista de espera, le han ofrecido
-- la plaza; si es así, pone la notificación con «Sí, voy» y «No puedo». No cambia nada de lo que ya había.
-- De paso, esa consulta hace avanzar la cola: si una plaza ofrecida ha caducado sin respuesta, pasa al siguiente.

create or replace function public.event_action(p_key uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k public.event_keys; ttl text; cur text; st timestamptz; oat timestamptz; r record;
begin
  if p_key is null then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  select * into k from public.event_keys where key = p_key;
  if k.event_id is null then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  select title, starts_at into ttl, st from public.events where id = k.event_id;
  select status into cur from public.event_attendees where event_id = k.event_id and user_id = k.user_id;
  if cur is null then return jsonb_build_object('ok', false, 'error', 'no apuntado', 'title', ttl); end if;
  if p_action in ('leave', 'no') then
    update public.event_attendees set status = 'no' where event_id = k.event_id and user_id = k.user_id and status <> 'no';
  elsif p_action = 'yes' then
    update public.event_attendees set status = 'going' where event_id = k.event_id and user_id = k.user_id and status = 'offered';
  elsif p_action = 'status' then
    -- plazas ofrecidas de este evento que han caducado: vuelven a la lista y la plaza pasa al siguiente
    for r in
      select a.user_id from public.event_attendees a
      where a.event_id = k.event_id and a.status = 'offered' and st > now()
        and now() > public.offer_deadline(a.offered_at, st)
        and exists (select 1 from public.event_attendees w where w.event_id = a.event_id and w.status = 'waiting')
    loop
      perform set_config('rg.sys', '1', true);
      update public.event_attendees set status = 'waiting' where event_id = k.event_id and user_id = r.user_id;
      perform set_config('rg.sys', '', true);
      perform public.event_promote(k.event_id);
    end loop;
  else
    return jsonb_build_object('ok', false, 'error', 'accion', 'title', ttl);
  end if;
  select status, offered_at into cur, oat from public.event_attendees where event_id = k.event_id and user_id = k.user_id;
  return jsonb_build_object('ok', true, 'status', cur, 'title', ttl,
    'starts_at', (extract(epoch from st) * 1000)::bigint,
    'offered_at', case when oat is not null then (extract(epoch from oat) * 1000)::bigint end,
    'deadline', case when cur = 'offered' and oat is not null then (extract(epoch from public.offer_deadline(oat, st)) * 1000)::bigint end);
end $$;
revoke all on function public.event_action(uuid, text) from public;
grant execute on function public.event_action(uuid, text) to anon, authenticated;   -- el teléfono la llama sin sesión, solo con la clave
