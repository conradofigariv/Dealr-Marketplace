-- 00037 — Aceptación de Términos y Condiciones.
-- profiles.terms_accepted_at: cuándo el usuario aceptó los T&C. Mientras sea
-- null, la app muestra el modal de T&C bloqueante en el primer ingreso.
-- (Usamos `profiles`, la tabla de usuario de la app — no `users`.)

alter table public.profiles add column if not exists terms_accepted_at timestamptz;
