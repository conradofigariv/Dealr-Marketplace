-- =============================================================
-- Fotos en el chat
-- Un mensaje puede ser texto, foto, o ambos. La imagen va al bucket
-- listing-photos (público) bajo el prefijo chat/. body deja de ser
-- obligatorio (puede haber mensaje de solo foto).
-- =============================================================

alter table public.messages add column if not exists image_path text;
alter table public.messages alter column body drop not null;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_content_check
  check (
    (body is not null and char_length(body) between 1 and 2000)
    or image_path is not null
  );

-- La notificación de mensaje muestra "Foto" cuando el mensaje no tiene texto.
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conv public.conversations%rowtype;
  recipient uuid;
  sender_name text;
begin
  select * into conv from public.conversations where id = new.conversation_id;
  recipient := case when new.sender_id = conv.buyer_id then conv.seller_id else conv.buyer_id end;
  select username into sender_name from public.profiles where id = new.sender_id;
  insert into public.notifications (user_id, type, title, body, link)
  values (recipient, 'message', sender_name || ' te escribió', coalesce(left(new.body, 80), '📷 Foto'), '/chats/' || conv.id);
  return null;
end;
$$;
