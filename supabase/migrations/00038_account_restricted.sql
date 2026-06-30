-- 00038 — Cuentas restringidas (verificación de edad por Didit).
--
-- Didit NO aprueba la verificación a menores de 18 (la edad la valida Didit, no
-- guardamos fecha de nacimiento → privacidad). Si un usuario intenta verificarse
-- y Didit lo rechaza por edad, el webhook marca la cuenta como restringida: puede
-- registrarse y navegar, pero NO puede publicar, ofertar ni iniciar compras.
--
-- account_restricted lo lee el front para bloquear esas acciones. is_minor queda
-- como marca informativa. No guardamos birth_date.

alter table public.profiles add column if not exists is_minor boolean not null default false;
alter table public.profiles add column if not exists account_restricted boolean not null default false;
