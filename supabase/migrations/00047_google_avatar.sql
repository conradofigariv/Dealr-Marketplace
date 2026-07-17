-- =============================================================
-- 00047 — Avatar por defecto de Google al registrarse.
--
-- Cuando alguien entra con Google, Supabase guarda la foto de su cuenta en
-- `raw_user_meta_data` (`avatar_url` o `picture`). `handle_new_user` no la
-- usaba → los usuarios de Google quedaban con la inicial gris. Ahora el
-- trigger la copia a `profiles.avatar_url` al crear la cuenta.
--
-- OJO: `avatar_url` normalmente guarda una RUTA de Storage (la foto subida a
-- mano); acá guarda una URL absoluta de Google. El front (`photoUrl`) deja
-- pasar las URLs absolutas tal cual y solo resuelve al bucket las rutas — así
-- conviven ambos casos. Si el usuario sube su propia foto después, pisa la de
-- Google con una ruta de Storage normal. Idempotente.
-- =============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, phone_verified, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      'usuario_' || substr(new.id::text, 1, 8)
    ),
    new.phone_confirmed_at is not null,
    -- Foto de Google (avatar_url o picture); null si no vino de un proveedor.
    nullif(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'), '')
  );
  return new;
end;
$$;

-- Backfill: usuarios de Google ya registrados que quedaron sin avatar.
update public.profiles p
set avatar_url = nullif(coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'), '')
from auth.users u
where u.id = p.id
  and p.avatar_url is null
  and coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') is not null;
