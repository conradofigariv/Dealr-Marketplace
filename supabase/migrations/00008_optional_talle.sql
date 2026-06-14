-- =============================================================
-- Talle opcional en "Ropa y Accesorios"
-- El talle deja de ser obligatorio: sigue apareciendo en el formulario
-- pero marcado como (opcional) y sin bloquear la publicación.
-- =============================================================

update public.categories
set required_fields = (
  select jsonb_agg(
    case
      when elem->>'key' = 'talle' then jsonb_set(elem, '{required}', 'false'::jsonb)
      else elem
    end
  )
  from jsonb_array_elements(required_fields) elem
)
where slug = 'ropa-accesorios';
