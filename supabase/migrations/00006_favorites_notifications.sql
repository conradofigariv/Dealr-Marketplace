-- =============================================================
-- Favoritos (guardados) + centro de notificaciones in-app
-- =============================================================

-- ---------- Favoritos ----------
-- Un usuario guarda publicaciones para volver a verlas. Privados.
create table public.favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index favorites_user_idx on public.favorites (user_id, created_at desc);

alter table public.favorites enable row level security;

create policy "favoritos propios legibles" on public.favorites
  for select using (auth.uid() = user_id);
create policy "guardar como uno mismo" on public.favorites
  for insert with check (auth.uid() = user_id);
create policy "quitar favorito propio" on public.favorites
  for delete using (auth.uid() = user_id);

grant select, insert, delete on public.favorites to authenticated;

-- ---------- Notificaciones ----------
-- Las crean los triggers (security definer, que omiten RLS por ser dueños
-- de la tabla). El cliente solo las lee y las marca como leídas.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('message', 'offer', 'offer_accepted', 'question_answered')),
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "notificaciones propias legibles" on public.notifications
  for select using (auth.uid() = user_id);
create policy "marcar leida la propia" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Sin policy de insert a propósito: solo entran por los triggers de abajo.
grant select, update on public.notifications to authenticated;

-- Nuevo mensaje -> avisa al otro participante de la conversación.
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
  values (recipient, 'message', sender_name || ' te escribió', left(new.body, 80), '/chats/' || conv.id);
  return null;
end;
$$;

create trigger on_message_notify
  after insert on public.messages
  for each row execute function public.notify_new_message();

-- Nueva oferta -> avisa al vendedor.
create or replace function public.notify_new_offer()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  seller uuid;
  ltitle text;
begin
  select seller_id, title into seller, ltitle from public.listings where id = new.listing_id;
  insert into public.notifications (user_id, type, title, body, link)
  values (seller, 'offer', 'Nueva oferta', 'Recibiste una oferta en "' || ltitle || '"', '/p/' || new.listing_id);
  return null;
end;
$$;

create trigger on_offer_notify
  after insert on public.offers
  for each row execute function public.notify_new_offer();

-- Oferta aceptada -> avisa al comprador.
create or replace function public.notify_offer_accepted()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ltitle text;
begin
  if new.status = 'accepted' and old.status is distinct from new.status then
    select title into ltitle from public.listings where id = new.listing_id;
    insert into public.notifications (user_id, type, title, body, link)
    values (new.buyer_id, 'offer_accepted', 'Aceptaron tu oferta', 'Tu oferta en "' || ltitle || '" fue aceptada', '/p/' || new.listing_id);
  end if;
  return null;
end;
$$;

create trigger on_offer_accepted_notify
  after update on public.offers
  for each row execute function public.notify_offer_accepted();

-- Pregunta respondida -> avisa a quien preguntó.
create or replace function public.notify_question_answered()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ltitle text;
begin
  if new.answer_body is not null and old.answer_body is distinct from new.answer_body then
    select title into ltitle from public.listings where id = new.listing_id;
    insert into public.notifications (user_id, type, title, body, link)
    values (new.asker_id, 'question_answered', 'Respondieron tu pregunta', 'En "' || ltitle || '"', '/p/' || new.listing_id);
  end if;
  return null;
end;
$$;

-- Corre después del trigger BEFORE que setea answer_body/is_public.
create trigger on_question_answered_notify
  after update on public.questions
  for each row execute function public.notify_question_answered();

-- Realtime: el badge de la campana se actualiza en vivo.
-- Solo agregamos la tabla si la publicación existe y no es FOR ALL TABLES
-- (en ese caso ya incluye todo y un ADD TABLE fallaría).
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
