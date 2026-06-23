-- =============================================================
-- 00022 — Filtros por rango + campos de auto en "Vehículos y Accesorios"
--
-- 1. Helper `num_from_text`: extrae el número de un texto del jsonb
--    (saca puntos, "km", "m²", etc.) para poder comparar como número.
-- 2. Columnas generadas e indexadas (veh_anio, veh_km, inmueble_sup) que
--    derivan ese número de `structured_fields`. El feed filtra por rango
--    contra estas columnas, no contra el jsonb (que compara como texto).
-- 3. Campos estilo MercadoLibre en "Vehículos y Accesorios" (marca, modelo,
--    año, km, combustible, transmisión, carrocería, puertas, color). Van
--    OPCIONALES para no romper publicaciones que no son autos (motos,
--    repuestos, accesorios). Año/Km/Superficie llevan `filterRange`.
-- 4. Alquileres: superficie con `filterRange` (rango estilo ZonaProp).
--
-- Idempotente: se puede re-correr sin romper.
-- =============================================================

-- 1. Número desde texto del jsonb (immutable → usable en columnas generadas).
create or replace function public.num_from_text(t text)
returns numeric
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), '')::numeric
$$;

-- 2. Columnas generadas (numéricas) + índices parciales para los rangos.
alter table public.listings
  add column if not exists veh_anio numeric
    generated always as (public.num_from_text(structured_fields ->> 'anio')) stored;
alter table public.listings
  add column if not exists veh_km numeric
    generated always as (public.num_from_text(structured_fields ->> 'kilometros')) stored;
alter table public.listings
  add column if not exists inmueble_sup numeric
    generated always as (public.num_from_text(structured_fields ->> 'superficie_m2')) stored;

create index if not exists idx_listings_veh_anio on public.listings (veh_anio) where veh_anio is not null;
create index if not exists idx_listings_veh_km on public.listings (veh_km) where veh_km is not null;
create index if not exists idx_listings_inmueble_sup on public.listings (inmueble_sup) where inmueble_sup is not null;

-- 3. Campos de auto en "Vehículos y Accesorios" (opcionales). El guard de
--    contención evita duplicarlos si se re-corre.
update public.categories
set required_fields = required_fields || '[
  {"key": "marca", "label": "Marca", "type": "select", "required": false, "options": ["Volkswagen", "Toyota", "Chevrolet", "Ford", "Fiat", "Renault", "Peugeot", "Citroën", "Honda", "Nissan", "Jeep", "Hyundai", "Kia", "Chery", "Suzuki", "Mercedes-Benz", "BMW", "Audi", "Otra"]},
  {"key": "modelo", "label": "Modelo", "type": "text", "required": false},
  {"key": "anio", "label": "Año", "type": "text", "required": false, "filterRange": {"column": "veh_anio"}},
  {"key": "kilometros", "label": "Kilómetros", "type": "text", "required": false, "filterRange": {"column": "veh_km", "unit": "km"}},
  {"key": "combustible", "label": "Combustible", "type": "select", "required": false, "options": ["Nafta", "Diésel", "GNC", "Híbrido", "Eléctrico"]},
  {"key": "transmision", "label": "Transmisión", "type": "select", "required": false, "options": ["Manual", "Automática"]},
  {"key": "tipo_carroceria", "label": "Carrocería", "type": "select", "required": false, "options": ["Sedán", "Hatchback", "SUV", "Pick-up", "Coupé", "Monovolumen", "Familiar", "Convertible", "Otra"]},
  {"key": "puertas", "label": "Puertas", "type": "select", "required": false, "options": ["2", "3", "4", "5"]},
  {"key": "color", "label": "Color", "type": "select", "required": false, "options": ["Blanco", "Negro", "Gris", "Plata", "Rojo", "Azul", "Verde", "Otro"]}
]'::jsonb
where slug = 'vehiculos-accesorios'
  and not (required_fields @> '[{"key": "marca"}]'::jsonb);

-- 4. Alquileres: superficie filtrable por rango (estilo ZonaProp). Se reescribe
--    el array completo a un valor conocido (idempotente).
update public.categories
set required_fields = '[
  {"key": "tipo_propiedad", "label": "Tipo de propiedad", "type": "select", "required": true, "options": ["Departamento", "Casa", "PH", "Local comercial", "Oficina", "Cochera", "Terreno"]},
  {"key": "modalidad", "label": "Modalidad", "type": "select", "required": true, "options": ["Alquiler mensual", "Alquiler temporario"]},
  {"key": "ambientes", "label": "Ambientes", "type": "select", "required": false, "options": ["Monoambiente", "2", "3", "4", "5 o más"]},
  {"key": "dormitorios", "label": "Dormitorios", "type": "select", "required": true, "options": ["0", "1", "2", "3", "4 o más"]},
  {"key": "banos", "label": "Baños", "type": "select", "required": true, "options": ["1", "2", "3", "4 o más"]},
  {"key": "superficie_m2", "label": "Superficie (m²)", "type": "text", "required": false, "filterRange": {"column": "inmueble_sup", "unit": "m²"}},
  {"key": "expensas", "label": "Expensas aprox. ($)", "type": "text", "required": false},
  {"key": "amoblado", "label": "Amoblado", "type": "boolean", "required": false},
  {"key": "balcon", "label": "Balcón", "type": "boolean", "required": false},
  {"key": "cochera", "label": "Cochera", "type": "boolean", "required": false},
  {"key": "patio_terraza", "label": "Patio o terraza", "type": "boolean", "required": false},
  {"key": "acepta_mascotas", "label": "Acepta mascotas", "type": "boolean", "required": false}
]'::jsonb
where slug = 'alquileres';
