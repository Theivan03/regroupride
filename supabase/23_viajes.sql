-- ReGroupRide · 23 — viajes de varios días. Aplicado en producción como migración «viajes» (texto completo allí).
--  · events.trip (jsonb): { days:[{title,start,km,from,route_url,stops:[{name,time,url,note}],stay:{name,kind,address,url,price,checkin,parking,note}}],
--                           budget:[{label,amount,per:'p'|'g'}], deposit, checklist }
--  · communities.kind: 'club' (normal) o 'trip' (grupo oculto de un viaje entre amigos).
--  · trip_paid (lo que cada uno ha pagado al organizador) y trip_expenses (gastos compartidos), con sus políticas.
--  · trip_create_private(), trip_join(), my_trips(); event_public() y community_public() devuelven también el viaje.
alter table public.events add column if not exists trip jsonb;
alter table public.communities add column if not exists kind text not null default 'club';
