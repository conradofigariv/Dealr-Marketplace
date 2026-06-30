-- 00036 — Medios de pago: opciones → Efectivo / Transferencia / Tarjeta.
--
-- El campo `formas_de_pago` (multiselect) está en los required_fields de (casi)
-- todas las categorías (seed 00001 + 00018). Reemplaza sus opciones en cada
-- categoría que lo tenga, sin tocar los demás campos. Idempotente.
--
-- Nota: las publicaciones ya creadas conservan el valor que guardaron (ej.
-- "Mercado Pago"); el cambio aplica a las nuevas y a los chips del filtro.

update public.categories
set required_fields = (
  select jsonb_agg(
    case
      when elem->>'key' = 'formas_de_pago'
      then jsonb_set(elem, '{options}', '["Efectivo", "Transferencia", "Tarjeta"]'::jsonb)
      else elem
    end
  )
  from jsonb_array_elements(required_fields) elem
)
where required_fields @> '[{"key": "formas_de_pago"}]';
