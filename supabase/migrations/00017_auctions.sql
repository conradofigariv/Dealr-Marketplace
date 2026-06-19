-- =============================================================
-- 00017 — Subastas
-- Una publicación puede ser subasta: precio inicial + fecha de cierre.
-- Los compradores ofertan (place_bid valida en la base). Las ofertas son
-- anónimas: el cliente nunca lee la tabla bids de otros — la UI usa
-- current_bid / bids_count denormalizados en listings. Al cerrar, el mejor
-- postor gana, se crea el chat con el vendedor y se notifica a ambos.
-- =============================================================

alter table public.listings
  add column if not exists is_auction boolean not null default false,
  add column if not exists auction_ends_at timestamptz,
  add column if not exists current_bid numeric,
  add column if not exists bids_count integer not null default 0,
  add column if not exists auction_closed boolean not null default false,
  -- "ofrecer al siguiente si el ganador no responde" (config del vendedor) +
  -- registro de postores que ya pasaron (no se les vuelve a ofrecer).
  add column if not exists auction_cascade boolean not null default false,
  add column if not exists auction_passed uuid[] not null default '{}';

create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  bidder_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists bids_listing_idx on public.bids (listing_id, amount desc);
alter table public.bids enable row level security;
-- Anonimato: solo ves TUS ofertas. El estado público (oferta actual, cantidad)
-- vive en listings. Las ofertas entran solo por place_bid (security definer).
drop policy if exists "ofertas propias legibles" on public.bids;
create policy "ofertas propias legibles" on public.bids for select using (auth.uid() = bidder_id);
grant select on public.bids to authenticated;

-- Tipos de notificación nuevos.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('message','offer','offer_accepted','question_answered','sale_confirmed','price_drop','saved_search','bid','outbid','auction_won'));

-- Ofertar: valida y registra de forma atómica. Devuelve null si OK, o el
-- mensaje de error.
create or replace function public.place_bid(p_listing uuid, p_amount numeric)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  l public.listings%rowtype;
  prev_top uuid;
begin
  if auth.uid() is null then return 'Iniciá sesión para ofertar'; end if;
  select * into l from public.listings where id = p_listing for update;
  if not found then return 'La publicación no existe'; end if;
  if not l.is_auction then return 'No es una subasta'; end if;
  if l.status <> 'active' or l.auction_closed then return 'La subasta no está disponible'; end if;
  if now() >= l.auction_ends_at then return 'La subasta terminó'; end if;
  if auth.uid() = l.seller_id then return 'No podés ofertar en tu propia subasta'; end if;
  if l.current_bid is null then
    if p_amount < l.price then return 'La oferta mínima es el precio inicial'; end if;
  elsif p_amount <= l.current_bid then
    return 'Tenés que superar la oferta actual';
  end if;
  select bidder_id into prev_top from public.bids where listing_id = p_listing order by amount desc limit 1;
  insert into public.bids (listing_id, bidder_id, amount) values (p_listing, auth.uid(), p_amount);
  update public.listings set current_bid = p_amount, bids_count = bids_count + 1 where id = p_listing;
  insert into public.notifications (user_id, type, title, body, link)
  values (l.seller_id, 'bid', 'Nueva oferta', 'Ofertaron en "' || l.title || '"', '/p/' || p_listing);
  if prev_top is not null and prev_top <> auth.uid() then
    insert into public.notifications (user_id, type, title, body, link)
    values (prev_top, 'outbid', 'Te superaron la oferta', 'Hay una oferta mayor en "' || l.title || '"', '/p/' || p_listing);
  end if;
  return null;
end;
$$;
grant execute on function public.place_bid(uuid, numeric) to authenticated;

-- Cierre: procesa las subastas vencidas. Crea el chat ganador<->vendedor y
-- notifica. Idempotente (solo toca las no cerradas). La puede llamar el cron
-- o el cliente al abrir una subasta vencida.
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
      insert into public.notifications (user_id, type, title, body, link) values
        (winner, 'auction_won', 'Ganaste la subasta', 'Ganaste "' || a.title || '". Coordiná la entrega con el vendedor.', '/chats/' || conv),
        (a.seller_id, 'auction_won', 'Tu subasta cerró', 'Se cerró "' || a.title || '" con una oferta ganadora. Coordiná con el comprador.', '/chats/' || conv);
    else
      update public.listings set auction_closed = true, status = 'expired' where id = a.id;
    end if;
  end loop;
end;
$$;
grant execute on function public.close_auctions() to authenticated;

-- Reasignar al siguiente postor (cuando el ganador no retira). Solo el
-- vendedor, solo si la subasta cerró y tiene la cascada activa. El nuevo
-- ganador queda a SU precio (su propia oferta). Devuelve null si OK o el error.
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
  -- siguiente mejor postor que no sea el ganador actual ni uno que ya pasó.
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
  insert into public.notifications (user_id, type, title, body, link)
  values (nxt.bidder_id, 'auction_won', 'Quedó disponible para vos', '"' || l.title || '" quedó disponible a tu oferta. Coordiná con el vendedor.', '/chats/' || conv);
  return null;
end;
$$;
grant execute on function public.reassign_auction(uuid) to authenticated;

-- Si hay pg_cron, cerrar subastas cada minuto. Si no, el cliente la cierra al
-- abrir una subasta vencida.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('close-auctions', '* * * * *', 'select public.close_auctions()');
  end if;
end $$;
