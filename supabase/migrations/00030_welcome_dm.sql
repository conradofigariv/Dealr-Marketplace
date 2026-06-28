-- 00030: mensaje de bienvenida por chat (DM de admin a usuarios nuevos).
--
-- Permite que un admin le mande un chat de bienvenida a un usuario (agradecer +
-- dar info útil). Reusa la infra de chat que ya existe (conversations +
-- messages): el trigger notify_new_message (00023) ya le avisa al destinatario
-- (push incluido si lo tiene configurado), así que no hay que tocar nada más.
--
-- La conversación queda con listing_id = null (no hay publicación de por medio).
-- El front (ChatThread/Chats, 00027) tolera el listing null, pero MUESTRA
-- "Publicación eliminada" en el encabezado del chat y un círculo sin foto en la
-- lista. Es esperado: es un DM sin publicación.
--
-- El usuario nuevo entra como buyer_id y el admin como seller_id, así
-- notify_new_message calcula recipient = el usuario nuevo (le llega a él).
--
-- conversations.kind marca el tipo de chat: 'welcome' para estos DMs. Sirve
-- para que el front muestre "Mensaje de bienvenida" en vez de "Publicación
-- eliminada" (que es lo que muestra para un listing_id null cualquiera) y para
-- no confundirlo con un chat cuya publicación fue borrada.

alter table public.conversations add column if not exists kind text;

create or replace function public.send_welcome_dm(p_to uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  v_conv uuid;
  v_msg uuid;
begin
  -- Emisor = un admin. Con sesión (RPC) usa auth.uid(); desde el SQL Editor
  -- (sin sesión) cae al admin más antiguo. El guard de abajo impide que un
  -- no-admin la use vía RPC (ahí auth.uid() es él y no pasa is_admin).
  v_admin := coalesce(
    auth.uid(),
    (select id from public.profiles where is_admin order by created_at limit 1)
  );

  if v_admin is null or not exists (
    select 1 from public.profiles where id = v_admin and is_admin
  ) then
    raise exception 'Solo un admin puede enviar el mensaje de bienvenida';
  end if;

  if p_to is null or not exists (select 1 from public.profiles where id = p_to) then
    raise exception 'El usuario destino no existe';
  end if;

  if p_to = v_admin then
    raise exception 'No te podés escribir a vos mismo';
  end if;

  -- Reusar el chat de bienvenida admin->usuario si ya existe, para no duplicar.
  -- Matchea por kind='welcome' (no por listing_id null a secas) para no agarrar
  -- por error un chat real cuya publicación fue borrada.
  select id into v_conv
  from public.conversations
  where buyer_id = p_to and seller_id = v_admin and kind = 'welcome'
  order by created_at
  limit 1;

  if v_conv is null then
    insert into public.conversations (listing_id, buyer_id, seller_id, kind)
    values (null, p_to, v_admin, 'welcome')
    returning id into v_conv;
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (v_conv, v_admin, p_body)
  returning id into v_msg;

  return v_msg;
end;
$$;

revoke all on function public.send_welcome_dm(uuid, text) from public, anon;
grant execute on function public.send_welcome_dm(uuid, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- USO MANUAL (desde Supabase → SQL Editor)
--
-- Por email (lo más práctico para un registro reciente con Google):
--
--   select public.send_welcome_dm(
--     (select id from auth.users where email = 'persona@gmail.com'),
--     '¡Hola! Gracias por sumarte a Dealr 👋 ...'
--   );
--
-- Por username:
--
--   select public.send_welcome_dm(
--     (select id from public.profiles where username = 'usuario_xxxxxxxx'),
--     '¡Hola! ...'
--   );
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- Bienvenida AUTOMÁTICA a cada usuario nuevo.
--
-- Cada perfil nuevo recibe el DM de bienvenida solo. Va envuelto en un
-- exception handler que traga cualquier error: si algo falla (ej. todavía no
-- hay admin), NO rompe el alta del usuario.
--
-- Para DESACTIVARlo: drop trigger on_profile_welcome on public.profiles;
-- Para cambiar el texto: editá el mensaje de abajo y re-corré este bloque.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.auto_welcome_dm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.send_welcome_dm(
      new.id,
      '¡Hola! Te damos la bienvenida a Dealr 👋

El lugar para comprar y vender cosas usadas en Córdoba, con gente real y verificada ✅

Algunas cosas que podés hacer:
🔨 Sumarte a subastas, hacer ofertas o cerrar por chat directo con el dueño.
📍 Ver lo que hay cerca tuyo en el mapa.
✅ Usuarios verificados por DNI para evitar estafas.

💡 Consejo: instalá Dealr en tu teléfono (en el menú del navegador, "Agregar a la pantalla de inicio") para una mejor experiencia: más rápida y con notificaciones.

Cualquier duda, respondé este mismo chat. ¡Que andes bien!'
    );
  exception when others then
    null; -- nunca bloquear el alta por el saludo
  end;
  return new;
end;
$$;

drop trigger if exists on_profile_welcome on public.profiles;
create trigger on_profile_welcome
  after insert on public.profiles
  for each row execute function public.auto_welcome_dm();
