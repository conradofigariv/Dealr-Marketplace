-- 00040 — Índice geoespacial para el descubrimiento por cercanía.
--
-- Hoy el ranking por distancia (recommended_listings, 00026) hace Haversine por
-- fila sin índice, y el filtro "Cerca" es client-side sobre la 1ª página. Esto
-- deja lista la infraestructura para consultas por radio aceleradas por índice:
-- extensiones cube + earthdistance y un índice GiST sobre la ubicación.
--
-- Con esto, una consulta por radio puede podar con earth_box(...) usando el
-- índice, en vez de escanear todas las publicaciones activas.

create extension if not exists cube;
create extension if not exists earthdistance;

-- Índice GiST sobre el punto (ll_to_earth es immutable → indexable). Solo filas
-- con coordenadas.
create index if not exists idx_listings_earth
  on public.listings using gist (ll_to_earth(lat, lng))
  where lat is not null and lng is not null;

-- RPC opcional: publicaciones activas dentro de un radio (km), ordenadas por
-- cercanía, aceleradas por el índice (earth_box poda; earth_distance ordena).
-- Devuelve setof listings para poder consumirla con el mismo embed del feed.
create or replace function public.listings_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision,
  p_limit int default 24,
  p_offset int default 0
)
returns setof public.listings
language sql stable security definer set search_path = public
as $$
  select l.*
  from public.listings l
  where l.status = 'active'
    and l.lat is not null
    and l.lng is not null
    and earth_box(ll_to_earth(p_lat, p_lng), p_radius_km * 1000) @> ll_to_earth(l.lat, l.lng)
    and earth_distance(ll_to_earth(p_lat, p_lng), ll_to_earth(l.lat, l.lng)) <= p_radius_km * 1000
  order by earth_distance(ll_to_earth(p_lat, p_lng), ll_to_earth(l.lat, l.lng)) asc
  limit p_limit offset p_offset;
$$;
grant execute on function public.listings_near(double precision, double precision, double precision, int, int) to anon, authenticated;
