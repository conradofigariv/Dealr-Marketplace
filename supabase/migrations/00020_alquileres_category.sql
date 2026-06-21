-- =============================================================
-- 00020 — Categoría nueva: Alquileres (estilo ZonaProp)
-- Campos estructurados propios de inmuebles: tipo, ambientes, dormitorios,
-- baños, superficie, expensas y amenities (balcón, cochera, amoblado,
-- mascotas, patio/terraza). El precio del listing = alquiler (por mes).
-- Idempotente: si el slug ya existe, no hace nada.
-- =============================================================

insert into public.categories (name, slug, required_fields) values
  ('Alquileres', 'alquileres', '[
    {"key": "tipo_propiedad", "label": "Tipo de propiedad", "type": "select", "required": true, "options": ["Departamento", "Casa", "PH", "Local comercial", "Oficina", "Cochera", "Terreno"]},
    {"key": "modalidad", "label": "Modalidad", "type": "select", "required": true, "options": ["Alquiler mensual", "Alquiler temporario"]},
    {"key": "ambientes", "label": "Ambientes", "type": "select", "required": false, "options": ["Monoambiente", "2", "3", "4", "5 o más"]},
    {"key": "dormitorios", "label": "Dormitorios", "type": "select", "required": true, "options": ["0", "1", "2", "3", "4 o más"]},
    {"key": "banos", "label": "Baños", "type": "select", "required": true, "options": ["1", "2", "3", "4 o más"]},
    {"key": "superficie_m2", "label": "Superficie (m²)", "type": "text", "required": false},
    {"key": "expensas", "label": "Expensas aprox. ($)", "type": "text", "required": false},
    {"key": "amoblado", "label": "Amoblado", "type": "boolean", "required": false},
    {"key": "balcon", "label": "Balcón", "type": "boolean", "required": false},
    {"key": "cochera", "label": "Cochera", "type": "boolean", "required": false},
    {"key": "patio_terraza", "label": "Patio o terraza", "type": "boolean", "required": false},
    {"key": "acepta_mascotas", "label": "Acepta mascotas", "type": "boolean", "required": false}
  ]'::jsonb)
on conflict (slug) do nothing;
