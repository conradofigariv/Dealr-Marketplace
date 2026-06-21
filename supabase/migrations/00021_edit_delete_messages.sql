-- =============================================================
-- 00021 — Editar y borrar mensajes del chat (estilo WhatsApp)
-- Agrega edited_at/deleted_at a messages. Borrar es lógico: limpia
-- body/image_path y marca deleted_at (el front muestra "Mensaje eliminado").
-- Las dos operaciones van por RPC security definer: validan que el que
-- llama sea el sender_id del mensaje, sin abrir un UPDATE de RLS más amplio.
-- =============================================================

alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  deleted_at is not null
  or (body is not null and char_length(body) between 1 and 2000)
  or image_path is not null
);

create or replace function public.edit_message(p_message_id uuid, p_body text)
returns public.messages
language plpgsql
security definer set search_path = public
as $$
declare
  result public.messages;
begin
  if p_body is null or char_length(trim(p_body)) = 0 then
    raise exception 'El mensaje no puede estar vacío';
  end if;

  update public.messages
  set body = trim(p_body), edited_at = now()
  where id = p_message_id
    and sender_id = auth.uid()
    and deleted_at is null
    and image_path is null
  returning * into result;

  if result.id is null then
    raise exception 'No se puede editar este mensaje';
  end if;
  return result;
end;
$$;

create or replace function public.delete_message(p_message_id uuid)
returns public.messages
language plpgsql
security definer set search_path = public
as $$
declare
  result public.messages;
begin
  update public.messages
  set deleted_at = now(), body = null, image_path = null
  where id = p_message_id
    and sender_id = auth.uid()
    and deleted_at is null
  returning * into result;

  if result.id is null then
    raise exception 'No se puede borrar este mensaje';
  end if;
  return result;
end;
$$;

grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
