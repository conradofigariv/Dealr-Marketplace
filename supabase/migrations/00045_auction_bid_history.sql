-- =============================================================
-- 00045 — Historial de ofertas de una subasta (anonimizado).
--
-- Las `bids` son anónimas por RLS (cada uno ve solo las suyas). Para mostrar
-- el historial mientras la subasta está activa —al dueño y a cualquiera que
-- mire la publicación— este RPC (security definer) devuelve las ofertas SIN
-- identidad: cada postor recibe un alias estable ("Postor N", numerado por
-- orden de primera oferta) y el que consulta ve marcadas las propias (is_me).
-- Idempotente.
-- =============================================================

create or replace function public.auction_bid_history(p_listing uuid)
returns table (amount numeric, created_at timestamptz, bidder_num int, is_me boolean)
language sql
stable
security definer set search_path = public
as $$
  with firsts as (
    select bidder_id, min(created_at) as first_at
    from public.bids
    where listing_id = p_listing
    group by bidder_id
  ),
  aliases as (
    select bidder_id, row_number() over (order by first_at) as n
    from firsts
  )
  select b.amount,
         b.created_at,
         a.n::int as bidder_num,
         (auth.uid() is not null and b.bidder_id = auth.uid()) as is_me
  from public.bids b
  join aliases a on a.bidder_id = b.bidder_id
  where b.listing_id = p_listing
    -- Solo subastas: para publicaciones comunes no hay nada que revelar.
    and exists (select 1 from public.listings l where l.id = p_listing and l.is_auction)
  order by b.amount desc, b.created_at desc
  limit 100;
$$;
grant execute on function public.auction_bid_history(uuid) to anon, authenticated;
