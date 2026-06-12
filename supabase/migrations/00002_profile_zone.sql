-- Zona/barrio del usuario: contexto de confianza y cercanía para el comprador.
alter table public.profiles
  add column if not exists zone text check (char_length(zone) <= 60);
