-- =============================================================
-- 00023 — `notifications.actor_id`: quién dispara la notificación
--
-- Para mostrar el avatar de la persona que te manda la notificación
-- (estilo Instagram: avatar + badge del tipo). Se actualizan los triggers
-- que insertan notificaciones para que llenen `actor_id` donde hay una
-- persona clara (mensaje → quien escribió, oferta → quien ofertó, etc.).
--
-- IMPORTANTE — pujas de subasta (`bid`/`outbid`) son ANÓNIMAS por diseño:
-- `place_bid` queda SIN tocar, así esas notificaciones tienen actor_id NULL
-- y el front cae al ícono del tipo (no revela quién ofertó).
--
-- on delete set null: si el perfil del actor se borra, la notificación
-- sobrevive (cae al ícono). Idempotente.
--
-- OJO embeds: `notifications` ahora tiene DOS FKs a profiles (user_id y
-- actor_id) → el embed debe fijar la FK: actor:profiles!notifications_actor_id_fkey(...)
-- =============================================================

alter table public.notifications
  add column if not exists actor_id uuid references public.profiles (id) on delete set null;

-- Mensaje → actor = quien escribió.
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
  insert into public.notifications (user_id, type, title, body, link, actor_id)
  values (recipient, 'message', sender_name || ' te escribió', coalesce(left(new.body, 80), '📷 Foto'), '/chats/' || conv.id, new.sender_id);
  return null;
end;
$$;

-- Nueva oferta → actor = quien ofertó.
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
  insert into public.notifications (user_id, type, title, body, link, actor_id)
  values (seller, 'offer', 'Nueva oferta', 'Recibiste una oferta en "' || ltitle || '"', '/p/' || new.listing_id, new.buyer_id);
  return null;
end;
$$;

-- Oferta aceptada → actor = el vendedor (que la aceptó).
create or replace function public.notify_offer_accepted()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ltitle text;
  lseller uuid;
begin
  if new.status = 'accepted' and old.status is distinct from new.status then
    select title, seller_id into ltitle, lseller from public.listings where id = new.listing_id;
    insert into public.notifications (user_id, type, title, body, link, actor_id)
    values (new.buyer_id, 'offer_accepted', 'Aceptaron tu oferta', 'Tu oferta en "' || ltitle || '" fue aceptada', '/p/' || new.listing_id, lseller);
  end if;
  return null;
end;
$$;

-- Pregunta respondida → actor = el vendedor (que respondió).
create or replace function public.notify_question_answered()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ltitle text;
  lseller uuid;
begin
  if new.answer_body is not null and old.answer_body is distinct from new.answer_body then
    select title, seller_id into ltitle, lseller from public.listings where id = new.listing_id;
    insert into public.notifications (user_id, type, title, body, link, actor_id)
    values (new.asker_id, 'question_answered', 'Respondieron tu pregunta', 'En "' || ltitle || '"', '/p/' || new.listing_id, lseller);
  end if;
  return null;
end;
$$;

-- Venta confirmada → actor = el vendedor (que confirmó).
create or replace function public.notify_sale_confirmed()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conv_id uuid;
begin
  if new.status = 'sold' and new.sold_to is not null and new.sold_to is distinct from old.sold_to then
    select id into conv_id
    from public.conversations
    where listing_id = new.id and buyer_id = new.sold_to;
    insert into public.notifications (user_id, type, title, body, link, actor_id)
    values (
      new.sold_to,
      'sale_confirmed',
      'Calificá tu compra',
      'Confirmaron la venta de "' || new.title || '". Contanos cómo fue.',
      coalesce('/chats/' || conv_id, '/p/' || new.id),
      new.seller_id
    );
  end if;
  return null;
end;
$$;

-- Bajó de precio → actor = el vendedor (que bajó el precio).
create or replace function public.notify_price_drop()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link, actor_id)
  select f.user_id, 'price_drop', 'Bajó de precio',
         '"' || new.title || '" que guardaste ahora cuesta menos', '/p/' || new.id, new.seller_id
  from public.favorites f
  where f.listing_id = new.id and f.user_id <> new.seller_id;
  return null;
end;
$$;

-- Búsqueda guardada → actor = quien publicó.
create or replace function public.notify_saved_search_matches()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link, actor_id)
  select s.user_id, 'saved_search', 'Nueva publicación para tu búsqueda', new.title, '/p/' || new.id, new.seller_id
  from public.saved_searches s
  where s.user_id <> new.seller_id
    and (s.category_id is null or s.category_id = new.category_id)
    and (s.query is null or new.title ilike '%' || s.query || '%' or new.description ilike '%' || s.query || '%')
    and (s.currency is null or new.currency::text = s.currency)
    and (s.min_price is null or new.price >= s.min_price)
    and (s.max_price is null or new.price <= s.max_price)
    and (s.conditions is null or array_length(s.conditions, 1) is null or new.condition::text = any (s.conditions));
  return null;
end;
$$;

-- Cierre de subasta → al ganador le aparece el vendedor; al vendedor, el
-- ganador (identidades ya reveladas por el chat que se crea).
create or replace function public.close_auctions()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a public.listings%rowtype;
  winner uuid;
  conv uuid;
begin
  for a in select * from public.listings where is_auction and not auction_closed and auction_ends_at <= now() loop
    select bidder_id into winner from public.bids where listing_id = a.id order by amount desc, created_at asc limit 1;
    if winner is not null then
      update public.listings set auction_closed = true, status = 'sold', sold_to = winner where id = a.id;
      select id into conv from public.conversations where listing_id = a.id and buyer_id = winner;
      if conv is null then
        insert into public.conversations (listing_id, buyer_id, seller_id) values (a.id, winner, a.seller_id) returning id into conv;
      end if;
      insert into public.notifications (user_id, type, title, body, link, actor_id) values
        (winner, 'auction_won', 'Ganaste la subasta', 'Ganaste "' || a.title || '". Coordiná la entrega con el vendedor.', '/chats/' || conv, a.seller_id),
        (a.seller_id, 'auction_won', 'Tu subasta cerró', 'Se cerró "' || a.title || '" con una oferta ganadora. Coordiná con el comprador.', '/chats/' || conv, winner);
    else
      update public.listings set auction_closed = true, status = 'expired' where id = a.id;
    end if;
  end loop;
end;
$$;
grant execute on function public.close_auctions() to authenticated;

-- Reasignar al siguiente postor → actor = el vendedor (que lo ofreció).
create or replace function public.reassign_auction(p_listing uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  l public.listings%rowtype;
  prev_winner uuid;
  nxt record;
  conv uuid;
begin
  select * into l from public.listings where id = p_listing for update;
  if not found then return 'No existe'; end if;
  if auth.uid() <> l.seller_id then return 'Solo el vendedor'; end if;
  if not l.is_auction or not l.auction_closed then return 'La subasta no cerró todavía'; end if;
  if not l.auction_cascade then return 'La opción de ofrecer al siguiente no está activa'; end if;
  prev_winner := l.sold_to;
  select bidder_id, amount into nxt
  from public.bids
  where listing_id = p_listing
    and bidder_id <> all (l.auction_passed)
    and (prev_winner is null or bidder_id <> prev_winner)
  order by amount desc, created_at asc
  limit 1;
  if nxt.bidder_id is null then
    update public.listings set status = 'expired', sold_to = null where id = p_listing;
    return 'No quedan más postores';
  end if;
  update public.listings
  set sold_to = nxt.bidder_id,
      current_bid = nxt.amount,
      auction_passed = case when prev_winner is not null then array_append(l.auction_passed, prev_winner) else l.auction_passed end
  where id = p_listing;
  select id into conv from public.conversations where listing_id = p_listing and buyer_id = nxt.bidder_id;
  if conv is null then
    insert into public.conversations (listing_id, buyer_id, seller_id) values (p_listing, nxt.bidder_id, l.seller_id) returning id into conv;
  end if;
  insert into public.notifications (user_id, type, title, body, link, actor_id)
  values (nxt.bidder_id, 'auction_won', 'Quedó disponible para vos', '"' || l.title || '" quedó disponible a tu oferta. Coordiná con el vendedor.', '/chats/' || conv, l.seller_id);
  return null;
end;
$$;
grant execute on function public.reassign_auction(uuid) to authenticated;
