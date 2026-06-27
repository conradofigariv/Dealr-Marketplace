-- 00033 — Anti-snipe: extender el reloj de la subasta en pujas de último momento.
--
-- Si entra una oferta cuando faltan menos de 30s, el cierre se corre a now()+30s.
-- Así una subasta reñida no termina de golpe: se alarga sola mientras haya
-- pelea (es la mecánica que mantiene a la gente pegada al final). El front (que
-- ya escucha el UPDATE de `listings` por Realtime) detecta que auction_ends_at
-- creció y muestra "⏱ +30s".
--
-- Reescribe place_bid (última versión: 00025) sumando SOLO la extensión en el
-- UPDATE. Idempotente (create or replace).

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
  -- Anti-snipe: si faltan menos de 30s, el cierre se corre a now()+30s.
  update public.listings
  set current_bid = p_amount,
      bids_count = bids_count + 1,
      auction_ends_at = case
        when auction_ends_at - now() < interval '30 seconds' then now() + interval '30 seconds'
        else auction_ends_at
      end
  where id = p_listing;
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
