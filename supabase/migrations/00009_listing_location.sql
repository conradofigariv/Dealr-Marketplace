-- =============================================================
-- Ubicación de la publicación (estilo Facebook Marketplace)
-- Se guardan lat/lng exactas + una etiqueta legible del barrio/zona.
-- En la UI NUNCA se muestra el punto exacto: el detalle dibuja un
-- círculo aproximado (centro corrido de forma determinística), igual
-- que FB ("Aproximadamente en …"). Las coordenadas habilitan además
-- el orden "cerca tuyo" del feed (distancia calculada en el cliente).
-- =============================================================

alter table public.listings
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists location_label text check (char_length(location_label) <= 120);

-- Ubicación por defecto del vendedor: precarga el formulario de publicar
-- la primera vez. lat/lng quedan disponibles como respaldo de cercanía.
alter table public.profiles
  add column if not exists lat double precision,
  add column if not exists lng double precision;
