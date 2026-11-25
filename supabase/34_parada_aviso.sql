-- 34 · «Parada · paro un momento» como aviso al grupo (además de SOS, avería, gasolina y la parada inesperada).
-- Ya aplicado en el proyecto. Vuelve a definir ride_alert aceptando también el tipo 'pausa'.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.ride_alert(uuid,text,double precision,double precision)'::regprocedure);
  if position('''pausa''' in d) = 0 then
    d := replace(d, 'p_kind not in (''sos'', ''averia'', ''gasolina'', ''parada'')', 'p_kind not in (''sos'', ''averia'', ''gasolina'', ''parada'', ''pausa'')');
    execute d;
  end if;
end $$;
