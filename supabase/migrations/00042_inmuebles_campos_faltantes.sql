-- =============================================================
-- 00042 — Inmuebles: campos faltantes (auditoría final de categorías)
--
-- 1) "Superficie total (m²)": la columna generada `inmueble_sup` existe desde
--    00022 (lee structured_fields->>'superficie_m2'), pero la reescritura de
--    00034 dejó solo "superficie cubierta" y la key `superficie_m2` desapareció
--    → columna huérfana y sin filtro de superficie total. Se agrega el campo
--    (con slider que usa esa columna), insertado justo después de la cubierta.
--
-- 2) "Formas de pago": Inmuebles quedó como la ÚNICA categoría sin el campo
--    común (la reescritura de 00034 no lo incluyó y 00036 solo actualizaba a
--    quien ya lo tenía). Se agrega al final, igual que en el resto (multiselect
--    Efectivo/Transferencia/Tarjeta). "Acepta envío" NO se agrega a propósito:
--    no tiene sentido para una propiedad.
--
-- Idempotente (chequea contención por key antes de tocar).
-- =============================================================

-- 1) Superficie total, insertada después de superficie_cubierta_m2 (posición
--    calculada dinámicamente para no depender del orden exacto del array).
do $$
declare
  rf jsonb;
  pos int;
  nuevo jsonb := '{
    "key": "superficie_m2",
    "label": "Superficie total (m²)",
    "type": "text",
    "required": false,
    "filterSlider": {"column": "inmueble_sup", "min": 0, "max": 1000, "step": 25, "unit": "m²", "bound": "min"}
  }'::jsonb;
begin
  select required_fields into rf from public.categories where slug = 'alquileres';
  if rf is null or rf @> '[{"key": "superficie_m2"}]'::jsonb then
    return; -- no existe la categoría o el campo ya está
  end if;

  -- índice (0-based) del campo superficie_cubierta_m2; insertar después.
  select t.ord into pos
  from jsonb_array_elements(rf) with ordinality as t(el, ord)
  where t.el->>'key' = 'superficie_cubierta_m2';

  if pos is not null then
    -- ordinality es 1-based → el índice jsonb del siguiente elemento es `pos`.
    update public.categories
    set required_fields = jsonb_insert(required_fields, array[pos::text], nuevo)
    where slug = 'alquileres';
  else
    update public.categories
    set required_fields = required_fields || jsonb_build_array(nuevo)
    where slug = 'alquileres';
  end if;
end;
$$;

-- 2) Formas de pago (mismo shape que el común de 00001), al final del array.
update public.categories
set required_fields = required_fields || '[{
  "key": "formas_de_pago",
  "label": "Formas de pago",
  "type": "multiselect",
  "required": true,
  "options": ["Efectivo", "Transferencia", "Tarjeta"]
}]'::jsonb
where slug = 'alquileres'
  and not required_fields @> '[{"key": "formas_de_pago"}]'::jsonb;
