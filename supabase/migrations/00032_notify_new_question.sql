-- 00032 — Avisar al vendedor cuando le hacen una PREGUNTA nueva.
--
-- Faltaba: existía notify_question_answered (00006/00023, avisa a quien
-- preguntó cuando el vendedor responde) pero NO el inverso, así que el
-- vendedor nunca recibía notificación (ni in-app ni push) de una pregunta
-- nueva. Esto agrega el tipo 'question' al CHECK + el trigger que falta.
--
-- Idempotente: se puede re-correr sin romper.

-- 1) Extiende el CHECK de tipos (el último estado venía de la 00024).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'message', 'offer', 'offer_accepted', 'question_answered', 'sale_confirmed',
    'price_drop', 'saved_search', 'bid', 'outbid', 'auction_won', 'report', 'question'
  ));

-- 2) Trigger: al insertarse una pregunta, notifica al vendedor.
--    actor = quien pregunta (igual que el resto de las notifs con persona).
create or replace function public.notify_new_question()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ltitle text;
  lseller uuid;
begin
  select title, seller_id into ltitle, lseller from public.listings where id = new.listing_id;
  -- No auto-notificar si alguien pregunta en su propia publicación.
  if lseller is not null and lseller <> new.asker_id then
    insert into public.notifications (user_id, type, title, body, link, actor_id)
    values (lseller, 'question', 'Nueva pregunta', 'En "' || ltitle || '"', '/p/' || new.listing_id, new.asker_id);
  end if;
  return null;
end;
$$;

drop trigger if exists on_question_notify on public.questions;
create trigger on_question_notify
  after insert on public.questions
  for each row execute function public.notify_new_question();
