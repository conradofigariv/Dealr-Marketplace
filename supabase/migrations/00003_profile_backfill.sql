-- Cuentas creadas antes de que existiera el trigger handle_new_user
-- quedaron sin fila en profiles y la app no puede operar.

-- 1. Permitir que cada usuario cree su propia fila (auto-reparación
--    desde el cliente si el trigger no corrió).
create policy "crear el propio perfil" on public.profiles
  for insert with check (auth.uid() = id);

-- 2. Reparar las cuentas existentes que quedaron sin perfil.
insert into public.profiles (id, username)
select id, 'usuario_' || substr(id::text, 1, 8)
from auth.users
on conflict (id) do nothing;
