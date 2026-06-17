-- =============================================================
-- 00015 — Última actividad del usuario ("Activo hace…")
-- El cliente actualiza last_seen_at al abrir la app (RLS de update propio ya
-- existe). Sirve como señal de confianza en el perfil y el detalle.
-- =============================================================

alter table public.profiles
  add column if not exists last_seen_at timestamptz;
