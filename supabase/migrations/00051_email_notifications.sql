-- =============================================================
-- 00051 — Notificaciones por email (retención).
--
-- Si alguien recibe un mensaje/oferta/aviso de subasta y NO abre la app,
-- nunca se entera → se pierde. El Web Push (00019) solo llega a quien instaló
-- la PWA y dio permiso; el email llega a todos.
--
-- Enfoque CON DEMORA (el elegido): un cron corre cada pocos minutos y avisa
-- por mail SOLO si, pasados ~10 min, la notif sigue SIN LEER y el usuario NO
-- abrió la app desde que llegó (last_seen_at < created_at). Así no molesta a
-- quien ya la vio en la app.
--
-- Piezas:
--   - notifications.email_sent_at: marca las ya avisadas por mail (no repetir).
--   - RPC email_queue(): devuelve las notifs elegibles con el email del
--     destinatario (lee auth.users; solo service_role la ejecuta).
--   El envío real (Resend) + marcar email_sent_at lo hace la Edge Function
--   `email-notifications`, disparada por un cron cada 5 min.
-- Idempotente.
-- =============================================================

alter table public.notifications
  add column if not exists email_sent_at timestamptz;

-- Índice para que el cron encuentre rápido las pendientes.
create index if not exists notifications_email_pending_idx
  on public.notifications (created_at)
  where read_at is null and email_sent_at is null;

-- Cola de emails a enviar. Solo tipos que valen la pena (chat, ofertas,
-- preguntas, subasta), sin leer, con >10 min, no avisadas aún, y donde el
-- usuario NO abrió la app desde que llegó la notif. Security definer para leer
-- auth.users; se restringe a service_role (expone emails → no authenticated).
create or replace function public.email_queue()
returns table (notif_id uuid, user_id uuid, email text, type text, title text, body text)
language sql
stable
security definer set search_path = public
as $$
  select n.id, n.user_id, u.email::text, n.type, n.title, n.body
  from public.notifications n
  join public.profiles p on p.id = n.user_id
  join auth.users u on u.id = n.user_id
  where n.read_at is null
    and n.email_sent_at is null
    and n.created_at < now() - interval '10 minutes'
    and n.type in ('message', 'offer', 'offer_accepted', 'question', 'question_answered', 'outbid', 'auction_won')
    and (p.last_seen_at is null or p.last_seen_at < n.created_at)
    and u.email is not null
  order by n.user_id, n.created_at
  limit 500;
$$;

revoke execute on function public.email_queue() from public, anon, authenticated;
grant execute on function public.email_queue() to service_role;
