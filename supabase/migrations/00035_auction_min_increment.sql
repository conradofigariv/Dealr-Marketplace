-- 00035 — Subastas: salto mínimo de oferta configurable.
--
-- El vendedor elige al publicar de cuánto en cuánto se puede subir la oferta
-- (ej. de $1.000 en $1.000, de $5.000 en $5.000). `place_bid` valida que cada
-- oferta supere a la actual por AL MENOS ese salto.
--
-- Reescribe place_bid (última versión: 00033, anti-snipe) sumando la validación
-- del salto. Idempotente.

alter table public.listings
  add column if not exists auction_min_increment numeric not null default 1000;

create or replace function public.place_bid(p_listing uuid, p_amount numeric)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  l public.listings%rowtype;
  prev_top uuid;
  banned timestamptz;
  min_next numeric;
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
    -- Primera oferta: alcanza con el precio inicial.
    if p_amount < l.price then return 'La oferta mínima es el precio inicial'; end if;
  else
    -- Ofertas siguientes: superar la actual por al menos el salto mínimo.
    min_next := l.current_bid + greatest(coalesce(l.auction_min_increment, 0), 1);
    if p_amount < min_next then
      return 'Tenés que ofertar al menos $' || floor(min_next)::text;
    end if;
  end if;
  select bidder_id into prev_top from public.bids where listing_id = p_listing order by amount desc limit 1;
  insert into public.bids (listing_id, bidder_id, amount) values (p_listing, auth.uid(), p_amount);
  -- Anti-snipe (00033): si faltan menos de 30s, el cierre se corre a now()+30s.
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
