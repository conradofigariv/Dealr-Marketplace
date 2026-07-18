-- =============================================================
-- 00048 — Quien pujó en una subasta puede ver la publicación siempre.
--
-- La policy de lectura de listings (00001) solo muestra las activas, las
-- propias, o aquellas con un chat del que participás. Efecto colateral en
-- "Mis ofertas" (Perfil): cuando una subasta que PERDISTE se vende, dejás de
-- cumplir las tres condiciones → tu puja desaparece de la lista y el detalle
-- no carga (el ganador sí la ve porque el cierre le crea el chat).
--
-- Fix: quien tiene una puja en la publicación también puede leerla. No rompe
-- la anonimidad (las bids ajenas siguen ilegibles por su propia RLS; esto
-- solo deja ver la PUBLICACIÓN, que ya era pública mientras estaba activa).
-- Idempotente.
-- =============================================================

drop policy if exists "listings activas legibles por todos" on public.listings;
create policy "listings activas legibles por todos" on public.listings
  for select using (
    status = 'active'
    or seller_id = auth.uid()
    or exists (
      select 1 from public.conversations c
      where c.listing_id = id and auth.uid() in (c.buyer_id, c.seller_id)
    )
    or exists (
      select 1 from public.bids b
      where b.listing_id = id and b.bidder_id = auth.uid()
    )
  );
