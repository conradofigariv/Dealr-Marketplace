-- =============================================================
-- 00025 — Castigo a ganadores de subasta que no retiran (doble comprobación)
--
-- Flujo: al cerrar una subasta, ambas partes confirman el retiro.
--   comprador (sold_to) → "Retiré"      → buyer_confirmed_pickup
--   vendedor (seller_id) → "Retiró"      → seller_confirmed_pickup
--   vendedor → "No retiró"               → report_auction_no_show
--
-- Castigo: si el vendedor marca "no retiró" Y el comprador NO había confirmado
-- que retiró, el comprador recibe un strike y queda baneado de subastas, con
-- escala 1 mes → 3 → 6 → 12. Si el comprador SÍ había confirmado, es disputa
-- (no hay strike automático; se avisa al admin).
--
-- place_bid rechaza ofertas de usuarios baneados.
-- Idempotente.
-- =============================================================

-- Strikes + ban del comprador.
alter table public.profiles
  add column if not exists auction_strikes int not null default 0,
  add column if not exists auction_banned_until timestamptz;

-- Confirmaciones de retiro de la subasta ganada (viven en el listing porque
-- hay un único ganador por subasta).
alter table public.listings
  add column if not exists buyer_confirmed_pickup boolean not null default false,
  add column if not exists seller_confirmed_pickup boolean not null default false,
  add column if not exists seller_reported_no_show boolean not null default false,
  add column if not exists pickup_disputed boolean not null default false;

-- Confirmar retiro: lo llama el comprador o el vendedor; setea su lado.
create or replace function public.confirm_auction_pickup(p_listing uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  l public.listings%rowtype;
begin
  if auth.uid() is null then return 'Iniciá sesión'; end if;
  select * into l from public.listings where id = p_listing for update;
  if not found then return 'No existe'; end if;
  if not l.is_auction then return 'No es una subasta'; end if;
  if l.sold_to is null then return 'La subasta no tiene ganador'; end if;
  if auth.uid() = l.sold_to then
    update public.listings set buyer_confirmed_pickup = true where id = p_listing;
  elsif auth.uid() = l.seller_id then
    update public.listings set seller_confirmed_pickup = true where id = p_listing;
  else
    return 'No participás de esta operación';
  end if;
  return null;
end;
$$;
grant execute on function public.confirm_auction_pickup(uuid) to authenticated;

-- Reportar que el ganador no retiró: solo el vendedor. Strike con protección.
create or replace function public.report_auction_no_show(p_listing uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  l public.listings%rowtype;
  s int;
  ban_until timestamptz;
begin
  select * into l from public.listings where id = p_listing for update;
  if not found then return 'No existe'; end if;
  if auth.uid() <> l.seller_id then return 'Solo el vendedor'; end if;
  if not l.is_auction then return 'No es una subasta'; end if;
  if l.sold_to is null then return 'La subasta no tiene ganador'; end if;
  if l.seller_reported_no_show then return 'Ya lo reportaste'; end if;

  -- Protección: si el comprador ya confirmó que retiró → disputa, sin strike.
  if l.buyer_confirmed_pickup then
    update public.listings set seller_reported_no_show = true, pickup_disputed = true where id = p_listing;
    insert into public.notifications (user_id, type, title, body, link, actor_id)
    select p.id, 'report', 'Disputa de subasta',
           'Vendedor y comprador no coinciden sobre el retiro de "' || l.title || '"', '/admin', l.seller_id
    from public.profiles p where p.is_admin;
    return null;
  end if;

  -- Strike + ban escalado al comprador.
  update public.profiles
  set auction_strikes = auction_strikes + 1
  where id = l.sold_to
  returning auction_strikes into s;

  ban_until := now() + case
    when s <= 1 then interval '1 month'
    when s = 2 then interval '3 months'
    when s = 3 then interval '6 months'
    else interval '12 months'
  end;

  update public.profiles set auction_banned_until = ban_until where id = l.sold_to;
  update public.listings set seller_reported_no_show = true where id = p_listing;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    l.sold_to, 'auction_won', 'Quedaste sin subastas por un tiempo',
    'Se reportó que no retiraste "' || l.title || '". No podés ofertar en subastas hasta el ' || to_char(ban_until, 'DD/MM/YYYY') || '.',
    '/p/' || p_listing
  );
  return null;
end;
$$;
grant execute on function public.report_auction_no_show(uuid) to authenticated;

-- place_bid: rechaza a usuarios baneados de subastas (+ todo lo anterior).
create or replace function public.place_bid(p_listing uuid, p_amount numeric)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  l public.listings%rowtype;
  prev_top uuid;
  banned timestamptz;
begin
  if auth.uid() is null then return 'Iniciá sesión para ofertar'; end if;
  select auction_banned_until into banned from public.profiles where id = auth.uid();
  if banned is not null and banned > now() then
    return 'No podés ofertar en subastas hasta el ' || to_char(banned, 'DD/MM/YYYY') || ' (no retiraste una compra anterior).';
  end if;
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
