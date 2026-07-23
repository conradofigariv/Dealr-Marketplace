-- =============================================================
-- 00050 — Métricas del admin con período seleccionable + día en hora
-- argentina.
--
-- Dos cambios sobre 00044/00049:
-- 1) `admin_metrics` pasa a recibir `p_days` (1=hoy, 7, 15, 30=mes) y devuelve
--    las métricas de esa ventana (+ los totales, que no dependen del período).
--    Antes tenía ventanas fijas (hoy/7d/total).
-- 2) El corte del "día" es MEDIANOCHE ARGENTINA (America/Argentina/Buenos_Aires,
--    UTC-3), no UTC. Antes `current_date`/`now()-interval` cortaban en UTC, así
--    que "hoy" cambiaba a las 21:00 hora argentina.
--
-- La ventana arranca en la medianoche argentina de hace (p_days-1) días y va
-- hasta ahora: p_days=1 → desde la medianoche de hoy; p_days=7 → desde la
-- medianoche de hace 6 días (7 días de calendario), etc.
--
-- `track_visit` también pasa a datar la visita con la fecha argentina, para que
-- el conteo de visitantes por día coincida con las ventanas de acá.
-- Idempotente.
-- =============================================================

-- Visitas datadas por día ARGENTINO (antes UTC vía current_date).
create or replace function public.track_visit(p_key uuid)
returns void
language sql
security definer set search_path = public
as $$
  insert into public.site_visits (visitor_key, day)
  values (p_key::text, (now() at time zone 'America/Argentina/Buenos_Aires')::date)
  on conflict do nothing;
$$;
grant execute on function public.track_visit(uuid) to anon, authenticated;

-- La versión vieja (sin parámetros) se reemplaza por una con p_days. Hay que
-- dropearla: una función con todos los args default se puede llamar como
-- admin_metrics() igual, así que dejar las dos daría ambigüedad.
drop function if exists public.admin_metrics();

create or replace function public.admin_metrics(p_days int default 7)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  tz constant text := 'America/Argentina/Buenos_Aires';
  d int := greatest(1, coalesce(p_days, 7));
  -- Medianoche argentina de hace (d-1) días, como instante absoluto.
  win_start timestamptz := (date_trunc('day', now() at time zone tz) - make_interval(days => d - 1)) at time zone tz;
  -- Su equivalente como fecha (para site_visits.day, que es date).
  win_start_date date := (now() at time zone tz)::date - (d - 1);
begin
  if not public.is_admin() then
    raise exception 'Solo para administradores';
  end if;

  return jsonb_build_object(
    'days', d,
    -- Ventana seleccionada
    'visitors', (select count(distinct visitor_key) from public.site_visits where day >= win_start_date),
    'users',    (select count(*) from public.profiles where created_at >= win_start),
    'viewers',  (select count(distinct viewer_id) from public.listing_views where created_at >= win_start),
    'buyers',   (select count(distinct buyer_id) from public.conversations where created_at >= win_start and kind is distinct from 'welcome'),
    'sellers',  (select count(distinct seller_id) from public.listings where created_at >= win_start),
    'deletions',(select count(*) from public.account_deletions where created_at >= win_start),
    -- Totales (no dependen del período)
    'visitors_total', (select count(distinct visitor_key) from public.site_visits),
    'users_total',    (select count(*) from public.profiles),
    'viewers_total',  (select count(distinct viewer_id) from public.listing_views),
    'buyers_total',   (select count(distinct buyer_id) from public.conversations where kind is distinct from 'welcome'),
    'sellers_total',  (select count(distinct seller_id) from public.listings),
    'deletions_total',(select count(*) from public.account_deletions),
    -- Inventario
    'listings_active', (select count(*) from public.listings where status = 'active'),
    'listings_total',  (select count(*) from public.listings)
  );
end;
$$;
grant execute on function public.admin_metrics(int) to authenticated;
