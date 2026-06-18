-- =============================================================
-- 00016 — Limpieza de campos comunes + base para filtros por categoría
-- Saca de TODAS las categorías dos campos que sobran:
--   · zona: redundante con la ubicación del mapa (location_label).
--   · motivo_venta: ruido, no aporta ni filtra.
-- (Los datos viejos en structured_fields quedan, solo dejan de pedirse/mostrarse.)
-- =============================================================

update public.categories
set required_fields = (
  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  from jsonb_array_elements(required_fields) elem
  where elem->>'key' not in ('zona', 'motivo_venta')
);
