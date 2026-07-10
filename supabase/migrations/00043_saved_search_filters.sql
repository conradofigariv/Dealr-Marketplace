-- =============================================================
-- 00043 — Búsquedas guardadas: persistir los filtros de categoría.
--
-- Antes, "Guardar búsqueda con alerta" solo guardaba término/categoría/precio/
-- condición: los filtros finos (campos select/boolean, rangos numéricos y
-- multiselect de amenities) se DESCARTABAN en silencio, y la alerta de
-- publicación nueva tampoco los consideraba. Ahora se guardan y el trigger de
-- matching los aplica con la misma semántica que el feed:
--   fields       {key: valor}                  → igualdad sobre structured_fields->>key
--   field_ranges {key: {column, min, max}}     → rango numérico (num_from_text
--                                                 sobre la key, la MISMA función
--                                                 de las columnas generadas)
--   multi        {key: [opciones]}             → contención (todas las elegidas)
--
-- El radio de distancia NO se persiste: es relativo a la ubicación del
-- comprador en el momento (client-side), no un atributo de la búsqueda.
--
-- Requiere 00022 (num_from_text). Idempotente.
-- =============================================================

alter table public.saved_searches
  add column if not exists fields jsonb,
  add column if not exists field_ranges jsonb,
  add column if not exists multi jsonb;

create or replace function public.notify_saved_search_matches()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select s.user_id, 'saved_search', 'Nueva publicación para tu búsqueda', new.title, '/p/' || new.id
  from public.saved_searches s
  where s.user_id <> new.seller_id
    and (s.category_id is null or s.category_id = new.category_id)
    and (s.query is null or new.title ilike '%' || s.query || '%' or new.description ilike '%' || s.query || '%')
    -- currency y condition son enums: hay que castear a text para comparar
    -- contra las columnas de texto de saved_searches.
    and (s.currency is null or new.currency::text = s.currency)
    and (s.min_price is null or new.price >= s.min_price)
    and (s.max_price is null or new.price <= s.max_price)
    and (s.conditions is null or array_length(s.conditions, 1) is null or new.condition::text = any (s.conditions))
    -- Campos por igualdad: TODOS los pares guardados tienen que coincidir.
    and (s.fields is null or not exists (
      select 1 from jsonb_each_text(s.fields) f(k, v)
      where new.structured_fields->>f.k is distinct from f.v
    ))
    -- Rangos numéricos: el valor del aviso (parseado con num_from_text, igual
    -- que las columnas generadas) tiene que caer dentro de todos los rangos.
    -- Un aviso SIN el campo no matchea un rango (igual que el feed).
    and (s.field_ranges is null or not exists (
      select 1 from jsonb_each(s.field_ranges) r(k, spec)
      where (
        nullif(spec->>'min', '') is not null
        and coalesce(public.num_from_text(new.structured_fields->>r.k), -1) < (spec->>'min')::numeric
      ) or (
        nullif(spec->>'max', '') is not null
        and (
          public.num_from_text(new.structured_fields->>r.k) is null
          or public.num_from_text(new.structured_fields->>r.k) > (spec->>'max')::numeric
        )
      )
    ))
    -- Multiselect: el aviso tiene que contener TODAS las opciones elegidas
    -- (misma contención @> que usa el feed, aprovecha el GIN de 00034).
    and (s.multi is null or not exists (
      select 1 from jsonb_each(s.multi) m(k, opts)
      where jsonb_array_length(opts) > 0
        and not (new.structured_fields @> jsonb_build_object(m.k, opts))
    ));
  return null;
end;
$$;
