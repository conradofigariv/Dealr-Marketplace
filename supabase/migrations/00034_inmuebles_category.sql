-- =============================================================
-- 00034 — "Alquileres" → "Inmuebles" (vertical de propiedades estilo ZonaProp)
--
-- Unifica venta + alquiler + temporario en UNA categoría con un campo
-- "Operación". Reemplaza los campos de la 00020 por el set completo:
-- operación, tipo, distribución (ambientes/dormitorios/baños/cocheras),
-- superficie (cubierta + total), expensas, antigüedad, orientación,
-- disposición, apto crédito, pisos del edificio y un multiselect de
-- características (amenities + edificio).
--
-- Mantiene el slug 'alquileres' (no romper imágenes de categoría ni listings
-- existentes). Idempotente.
-- =============================================================

-- 1) Renombra la categoría (el slug queda igual).
update public.categories set name = 'Inmuebles' where slug = 'alquileres';

-- 2) Columnas generadas e indexadas para los filtros por rango numérico.
--    (la superficie total reusa `inmueble_sup` de la 00022).
alter table public.listings
  add column if not exists inm_ambientes numeric
    generated always as (public.num_from_text(structured_fields ->> 'ambientes')) stored;
alter table public.listings
  add column if not exists inm_dormitorios numeric
    generated always as (public.num_from_text(structured_fields ->> 'dormitorios')) stored;
alter table public.listings
  add column if not exists inm_banos numeric
    generated always as (public.num_from_text(structured_fields ->> 'banos')) stored;
alter table public.listings
  add column if not exists inm_cocheras numeric
    generated always as (public.num_from_text(structured_fields ->> 'cocheras')) stored;
alter table public.listings
  add column if not exists inm_sup_cubierta numeric
    generated always as (public.num_from_text(structured_fields ->> 'superficie_cubierta_m2')) stored;
alter table public.listings
  add column if not exists inm_expensas numeric
    generated always as (public.num_from_text(structured_fields ->> 'expensas')) stored;
alter table public.listings
  add column if not exists inm_pisos numeric
    generated always as (public.num_from_text(structured_fields ->> 'pisos_edificio')) stored;

create index if not exists idx_listings_inm_ambientes on public.listings (inm_ambientes) where inm_ambientes is not null;
create index if not exists idx_listings_inm_dormitorios on public.listings (inm_dormitorios) where inm_dormitorios is not null;
create index if not exists idx_listings_inm_banos on public.listings (inm_banos) where inm_banos is not null;
create index if not exists idx_listings_inm_cocheras on public.listings (inm_cocheras) where inm_cocheras is not null;
create index if not exists idx_listings_inm_sup_cubierta on public.listings (inm_sup_cubierta) where inm_sup_cubierta is not null;
create index if not exists idx_listings_inm_expensas on public.listings (inm_expensas) where inm_expensas is not null;
create index if not exists idx_listings_inm_pisos on public.listings (inm_pisos) where inm_pisos is not null;

-- Índice GIN para el filtro multiselect (jsonb @> sobre características).
create index if not exists idx_listings_structured_fields_gin on public.listings using gin (structured_fields);

-- 3) Set completo de campos. `filterRange` → filtro por rango (columna generada).
--    Solo operación y tipo son obligatorios (terrenos/cocheras no tienen
--    dormitorios/baños). El multiselect `caracteristicas` agrupa los amenities.
update public.categories set required_fields = '[
  {"key": "operacion", "label": "Operación", "type": "select", "required": true, "options": ["Comprar", "Alquilar", "Alquiler temporario"]},
  {"key": "tipo_propiedad", "label": "Tipo de propiedad", "type": "select", "required": true, "options": ["Departamento", "Casa", "PH", "Terreno", "Oficina", "Local comercial", "Cochera"]},
  {"key": "ambientes", "label": "Ambientes", "type": "select", "required": false, "options": ["1", "2", "3", "4", "5 o más"], "filterRange": {"column": "inm_ambientes"}},
  {"key": "dormitorios", "label": "Dormitorios", "type": "select", "required": false, "options": ["0", "1", "2", "3", "4 o más"], "filterRange": {"column": "inm_dormitorios"}},
  {"key": "banos", "label": "Baños", "type": "select", "required": false, "options": ["1", "2", "3", "4 o más"], "filterRange": {"column": "inm_banos"}},
  {"key": "cocheras", "label": "Cocheras", "type": "select", "required": false, "options": ["0", "1", "2", "3 o más"], "filterRange": {"column": "inm_cocheras"}},
  {"key": "superficie_cubierta_m2", "label": "Superficie cubierta (m²)", "type": "text", "required": false, "filterRange": {"column": "inm_sup_cubierta", "unit": "m²"}},
  {"key": "superficie_m2", "label": "Superficie total (m²)", "type": "text", "required": false, "filterRange": {"column": "inmueble_sup", "unit": "m²"}},
  {"key": "antiguedad", "label": "Antigüedad", "type": "select", "required": false, "options": ["A estrenar", "En construcción (pozo)", "Hasta 5 años", "Entre 5 y 10 años", "Entre 10 y 20 años", "Entre 20 y 50 años", "Más de 50 años"]},
  {"key": "expensas", "label": "Expensas aprox. ($)", "type": "text", "required": false, "filterRange": {"column": "inm_expensas", "unit": "$"}},
  {"key": "apto_credito", "label": "Apto crédito hipotecario", "type": "boolean", "required": false},
  {"key": "orientacion", "label": "Orientación", "type": "select", "required": false, "options": ["Norte", "Sur", "Este", "Oeste", "Noreste", "Noroeste", "Sureste", "Suroeste"]},
  {"key": "disposicion", "label": "Disposición", "type": "select", "required": false, "options": ["Frente", "Contrafrente", "Interno", "Lateral"]},
  {"key": "pisos_edificio", "label": "Pisos del edificio", "type": "text", "required": false, "filterRange": {"column": "inm_pisos"}},
  {"key": "caracteristicas", "label": "Características", "type": "multiselect", "required": false, "options": ["Pileta", "Balcón", "Patio", "Jardín", "Parrilla", "Ascensor", "Baulera", "Gimnasio", "SUM", "Lavadero", "Aire acondicionado", "Amoblado", "Seguridad 24h", "Accesibilidad", "Acepta mascotas"]}
]'::jsonb
where slug = 'alquileres';

-- 4) Backfill: los avisos existentes (eran todos alquileres) toman una Operación
--    derivada de la vieja "modalidad", para que no queden sin ese campo nuevo.
update public.listings l
set structured_fields = l.structured_fields
  || jsonb_build_object('operacion',
       case when l.structured_fields ->> 'modalidad' = 'Alquiler temporario'
            then 'Alquiler temporario' else 'Alquilar' end)
where l.category_id = (select id from public.categories where slug = 'alquileres')
  and (l.structured_fields ->> 'operacion') is null;
