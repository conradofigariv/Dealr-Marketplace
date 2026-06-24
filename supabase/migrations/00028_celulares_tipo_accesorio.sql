-- 00028: Celulares — separar "Teléfono" de "Accesorio" con campos condicionales.
--
-- Problema: la categoría "Celulares y Teléfonos" obliga marca/modelo/
-- almacenamiento, pero un accesorio (funda, cargador, auriculares) no tiene
-- esos datos. Agregamos un campo "Tipo" (Teléfono / Accesorio) y marcamos los
-- campos de teléfono con `showIf` para que SOLO se pidan/muestren cuando el
-- Tipo es "Teléfono". El front (Publish) resuelve el `showIf`: oculta esos
-- campos, no los valida y no los guarda cuando no aplican.
--
-- Idempotente: reconstruye la cola de campos de teléfono cada vez (filtra
-- tipo + los 4 campos y los vuelve a anexar), así re-correrla no duplica nada.

update public.categories
set required_fields = (
  -- Campos comunes (formas_de_pago, acepta_envio, etc.) tal como están,
  -- en su orden original; sacamos tipo + los de teléfono para re-anexarlos.
  select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
  from jsonb_array_elements(required_fields) with ordinality as t(elem, ord)
  where elem->>'key' not in ('tipo', 'marca', 'modelo', 'almacenamiento', 'salud_bateria')
)
|| '[
  {"key": "tipo", "label": "Tipo", "type": "select", "required": true, "options": ["Teléfono", "Accesorio"]},
  {"key": "marca", "label": "Marca", "type": "text", "required": true, "showIf": {"key": "tipo", "in": ["Teléfono"]}},
  {"key": "modelo", "label": "Modelo", "type": "text", "required": true, "showIf": {"key": "tipo", "in": ["Teléfono"]}},
  {"key": "almacenamiento", "label": "Almacenamiento", "type": "select", "required": true, "options": ["32 GB", "64 GB", "128 GB", "256 GB", "512 GB", "1 TB"], "showIf": {"key": "tipo", "in": ["Teléfono"]}},
  {"key": "salud_bateria", "label": "Salud de batería (%)", "type": "text", "required": false, "showIf": {"key": "tipo", "in": ["Teléfono"]}}
]'::jsonb
where slug = 'celulares';

-- Backfill: las publicaciones de celulares que ya existen son todas teléfonos
-- (antes marca/modelo/almacenamiento eran obligatorios). Les seteamos
-- tipo = "Teléfono" para que al editarlas esos campos sigan visibles y no se
-- borren por la poda de campos ocultos del front.
update public.listings
set structured_fields = coalesce(structured_fields, '{}'::jsonb) || '{"tipo": "Teléfono"}'::jsonb
where category_id = (select id from public.categories where slug = 'celulares')
  and not (coalesce(structured_fields, '{}'::jsonb) ? 'tipo');
