-- 00026: Recomendaciones del feed ("Recomendado para vos").
--
-- Ranking personalizado SIN tabla de eventos nueva: la afinidad por categoría
-- se deriva de las interacciones que ya registramos —`favorites` (00006) y
-- `listing_views` (00014)— combinada con prueba social (favorites_count /
-- views_count, ya denormalizados en `listings`), recencia (last_renewed_at) y
-- cercanía (lat/lng del comprador, opcional).
--
-- La RPC devuelve `setof listings`, así que el front la consume igual que la
-- query del feed (con el mismo embed de `seller:profiles`). Para usuarios
-- anónimos (sin auth.uid()) cae a un ranking global: prueba social + recencia
-- + cercanía, sin personalización.

-- `listing_views` tiene PK (listing_id, viewer_id): la afinidad consulta por
-- viewer_id, que no es la columna líder → índice dedicado.
create index if not exists listing_views_viewer_idx on public.listing_views (viewer_id);

create or replace function public.recommended_listings(
  p_lat double precision default null,
  p_lng double precision default null,
  p_limit integer default 24,
  p_offset integer default 0
)
returns setof public.listings
language sql
stable
security definer
set search_path = public
as $$
  with uid as (select auth.uid() as id),
  -- Afinidad por categoría: un favorito pesa más que una vista, con caída
  -- exponencial (~30 días de vida media) para que lo reciente domine.
  cat_affinity as (
    select category_id, sum(w) as affinity
    from (
      select l.category_id,
             3.0 * exp(-extract(epoch from now() - f.created_at) / (86400 * 30)) as w
      from public.favorites f
      join public.listings l on l.id = f.listing_id
      where f.user_id = (select id from uid)
      union all
      select l.category_id,
             1.0 * exp(-extract(epoch from now() - v.created_at) / (86400 * 30)) as w
      from public.listing_views v
      join public.listings l on l.id = v.listing_id
      where v.viewer_id = (select id from uid)
    ) s
    group by category_id
  ),
  max_aff as (select coalesce(max(affinity), 0) as m from cat_affinity)
  select l.*
  from public.listings l
  left join cat_affinity ca on ca.category_id = l.category_id
  cross join max_aff
  where l.status = 'active'
    and ((select id from uid) is null or l.seller_id <> (select id from uid))
  order by (
    -- Personalización: afinidad de la categoría normalizada a 0..1.
    coalesce(ca.affinity / nullif(max_aff.m, 0), 0) * 3.0
    -- Prueba social (log: que un outlier no domine el feed).
    + ln(1 + l.favorites_count) * 0.6
    + ln(1 + l.views_count) * 0.2
    -- Recencia: fuerte la primera semana, decae suave.
    + (1.0 / (1 + extract(epoch from now() - l.last_renewed_at) / (86400 * 7))) * 1.5
    -- Cercanía (solo si hay ubicación del comprador y la publicación tiene punto).
    + (case
         when p_lat is null or l.lat is null then 0
         else 1.0 / (1 + (
           6371 * acos(least(1, greatest(-1,
             cos(radians(p_lat)) * cos(radians(l.lat)) * cos(radians(l.lng) - radians(p_lng))
             + sin(radians(p_lat)) * sin(radians(l.lat))
           ))) / 10.0)
         )
       end) * 1.0
    -- Ya la vio: bajala para mostrar cosas nuevas.
    - (case when (select id from uid) is not null
              and exists (select 1 from public.listing_views v
                          where v.listing_id = l.id and v.viewer_id = (select id from uid))
            then 1.0 else 0 end)
    -- Ya la guardó: ya la conoce, bajala más.
    - (case when (select id from uid) is not null
              and exists (select 1 from public.favorites f
                          where f.listing_id = l.id and f.user_id = (select id from uid))
            then 2.0 else 0 end)
  ) desc, l.last_renewed_at desc, l.id desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

grant execute on function public.recommended_listings(double precision, double precision, integer, integer) to anon, authenticated;
