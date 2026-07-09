-- =============================================================
-- 00041 — Hardening de seguridad pre-lanzamiento (QA P0).
--
-- Cierra 5 agujeros encontrados en la revisión de seguridad:
--
-- 1) `is_admin` era auto-editable: cualquier usuario podía hacerse admin con
--    `update profiles set is_admin=true` (la columna quedó fuera de
--    protect_profile_columns) y con eso leer/borrar contenido de todos vía las
--    policies "admin modera" (00024). Ídem `is_minor`/`account_restricted`
--    (00038) y `auction_strikes`/`auction_banned_until` (00025).
--
-- 2) El gate de menores (+18) vivía solo en el front: un restringido podía
--    publicar/ofertar/chatear llamando a la API directo. Ahora `is_restricted()`
--    se chequea en las policies de insert de listings/offers/conversations y en
--    `place_bid`.
--
-- 3) La policy "marcar leido el receptor" permitía UPDATE de CUALQUIER columna
--    de los mensajes del otro (body incluido): un participante podía reescribir
--    o "borrar" lo que dijo la contraparte. Se restringe con GRANT a nivel de
--    columna: authenticated solo puede updatear `read_at` (editar/borrar lo
--    propio sigue vía RPCs edit_message/delete_message, security definer).
--
-- 4) El dueño de una publicación podía falsificar columnas de confianza con un
--    update directo (bids_count=99, verified=true, mover auction_ends_at...).
--    Nuevo trigger `protect_listing_columns` que las pinnea salvo cuando el
--    update viene de un RPC interno (flag de sesión `dealr.internal`, mismo
--    patrón que `dealr.scoring` de 00039). Se reescriben los RPCs/triggers
--    legítimos que las tocan para que seteen el flag: place_bid,
--    close_auctions, reassign_auction, increment_listing_views,
--    sync_favorites_count. El relanzado de subastas (que el front hacía con
--    update directo) pasa a un RPC nuevo `relaunch_auction`.
--
-- 5) `report_auction_no_show` baneaba al comprador automáticamente (strike +
--    1/3/6/12 meses) con la sola palabra del vendedor → vía de represalia.
--    Ahora SIEMPRE es disputa: marca el listing y avisa a los admins, que
--    deciden. (El chequeo de ban en place_bid queda: un admin puede banear a
--    mano seteando auction_banned_until con service role.)
--
-- Idempotente. OJO: aplicar DESPUÉS de 00025/00033/00035 (reescribe place_bid
-- por encima de la versión de 00035, que es la vigente).
-- =============================================================

-- ─── 1) profiles: pinnear TODAS las columnas sensibles ──────────────────────
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  -- Recálculo interno de scores (00039): permitido.
  if current_setting('dealr.scoring', true) = '1' then
    return new;
  end if;
  if auth.uid() is not null then
    new.phone_verified := old.phone_verified;
    new.identity_verified := old.identity_verified;
    new.identity_verified_at := old.identity_verified_at;
    new.didit_session_id := old.didit_session_id;
    new.seller_score := old.seller_score;
    new.buyer_score := old.buyer_score;
    new.seller_ratings_count := old.seller_ratings_count;
    new.buyer_ratings_count := old.buyer_ratings_count;
    -- Nuevas (00041): moderación y castigos no se auto-editan.
    new.is_admin := old.is_admin;
    new.is_minor := old.is_minor;
    new.account_restricted := old.account_restricted;
    new.auction_strikes := old.auction_strikes;
    new.auction_banned_until := old.auction_banned_until;
  end if;
  return new;
end;
$$;

-- ─── 2) Gate de cuenta restringida, respaldado en la DB ─────────────────────
-- security definer → no recursiona con la RLS de profiles (mismo patrón que
-- is_admin() de 00024).
create or replace function public.is_restricted()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select account_restricted from public.profiles where id = auth.uid()),
    false
  );
$$;
grant execute on function public.is_restricted() to anon, authenticated;

-- Publicar, ofertar e iniciar chats de compra: no para cuentas restringidas.
drop policy if exists "publicar requiere sesion" on public.listings;
create policy "publicar requiere sesion" on public.listings
  for insert with check (auth.uid() = seller_id and not public.is_restricted());

drop policy if exists "ofertar requiere sesion" on public.offers;
create policy "ofertar requiere sesion" on public.offers
  for insert with check (
    auth.uid() = buyer_id
    and not public.is_restricted()
    and exists (select 1 from public.listings l where l.id = listing_id and l.status = 'active' and l.seller_id <> auth.uid())
  );

drop policy if exists "inicia el comprador" on public.conversations;
create policy "inicia el comprador" on public.conversations
  for insert with check (
    auth.uid() = buyer_id
    and buyer_id <> seller_id
    and not public.is_restricted()
    and exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = seller_id)
  );

-- ─── 3) messages: el receptor solo puede tocar read_at ──────────────────────
-- GRANT a nivel de columna: aunque la policy de UPDATE matchee la fila, un
-- update que incluya body/image_path/edited_at/deleted_at falla con permission
-- denied. Editar/borrar mensajes PROPIOS sigue funcionando: los RPCs
-- edit_message/delete_message (00021) son security definer (corren como owner).
revoke update on table public.messages from authenticated;
grant update (read_at) on table public.messages to authenticated;

-- La policy queda igual pero con with check explícito (no cambia filas de lugar).
drop policy if exists "marcar leido el receptor" on public.messages;
create policy "marcar leido el receptor" on public.messages
  for update using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
    )
  ) with check (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
    )
  );

-- ─── 4) listings: columnas de confianza solo por vía interna ────────────────
-- Pinnea las columnas que fabrican prueba social / estado de subasta. Los
-- updates sin sesión (cron, service role, webhooks) pasan; los RPCs internos
-- setean `dealr.internal` (transaction-local) antes de tocar la tabla.
create or replace function public.protect_listing_columns()
returns trigger
language plpgsql
as $$
begin
  if current_setting('dealr.internal', true) = '1' then
    return new;
  end if;
  if auth.uid() is not null then
    new.verified := old.verified;
    new.current_bid := old.current_bid;
    new.bids_count := old.bids_count;
    new.auction_closed := old.auction_closed;
    new.auction_ends_at := old.auction_ends_at;
    new.views_count := old.views_count;
    new.favorites_count := old.favorites_count;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_listing_columns_tg on public.listings;
create trigger protect_listing_columns_tg
  before update on public.listings
  for each row execute function public.protect_listing_columns();

-- ─── 4a) place_bid (versión 00035 + restricción + flag interno) ─────────────
create or replace function public.place_bid(p_listing uuid, p_amount numeric)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  l public.listings%rowtype;
  prev_top uuid;
  banned timestamptz;
  restricted boolean;
  min_next numeric;
begin
  if auth.uid() is null then return 'Iniciá sesión para ofertar'; end if;
  select auction_banned_until, account_restricted into banned, restricted
  from public.profiles where id = auth.uid();
  if coalesce(restricted, false) then
    return 'Tu cuenta no puede participar de compras ni subastas.';
  end if;
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
  else
    min_next := l.current_bid + greatest(coalesce(l.auction_min_increment, 0), 1);
    if p_amount < min_next then
      return 'Tenés que ofertar al menos $' || floor(min_next)::text;
    end if;
  end if;
  select bidder_id into prev_top from public.bids where listing_id = p_listing order by amount desc limit 1;
  insert into public.bids (listing_id, bidder_id, amount) values (p_listing, auth.uid(), p_amount);
  perform set_config('dealr.internal', '1', true);
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

-- ─── 4b) close_auctions (00017, + flag; el cliente la llama con sesión) ─────
create or replace function public.close_auctions()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a public.listings%rowtype;
  winner uuid;
  conv uuid;
begin
  perform set_config('dealr.internal', '1', true);
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

-- ─── 4c) reassign_auction (00017, + flag) ───────────────────────────────────
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
  perform set_config('dealr.internal', '1', true);
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

-- ─── 4d) increment_listing_views (00014, + flag) ────────────────────────────
create or replace function public.increment_listing_views(listing_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  rows integer;
begin
  if auth.uid() is null then
    return;
  end if;
  insert into public.listing_views (listing_id, viewer_id)
  values (increment_listing_views.listing_id, auth.uid())
  on conflict do nothing;
  get diagnostics rows = row_count;
  if rows > 0 then
    perform set_config('dealr.internal', '1', true);
    update public.listings
    set views_count = views_count + 1
    where id = increment_listing_views.listing_id;
  end if;
end;
$$;

-- ─── 4e) sync_favorites_count (00010, + flag) ───────────────────────────────
create or replace function public.sync_favorites_count()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform set_config('dealr.internal', '1', true);
  if tg_op = 'INSERT' then
    update public.listings set favorites_count = favorites_count + 1 where id = new.listing_id;
  elsif tg_op = 'DELETE' then
    update public.listings set favorites_count = greatest(favorites_count - 1, 0) where id = old.listing_id;
  end if;
  return null;
end;
$$;

-- ─── 4f) relaunch_auction: relanzar una subasta terminada (reemplaza el
--         update directo del front, que el trigger nuevo bloquearía) ─────────
create or replace function public.relaunch_auction(p_listing uuid, p_days int)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  l public.listings%rowtype;
begin
  if auth.uid() is null then return 'Iniciá sesión'; end if;
  if p_days is null or p_days < 1 or p_days > 30 then return 'Duración inválida'; end if;
  select * into l from public.listings where id = p_listing for update;
  if not found then return 'No existe'; end if;
  if auth.uid() <> l.seller_id then return 'Solo el vendedor'; end if;
  if not l.is_auction then return 'No es una subasta'; end if;
  if l.status = 'active' and not l.auction_closed and l.auction_ends_at > now() then
    return 'La subasta sigue en curso';
  end if;
  perform set_config('dealr.internal', '1', true);
  update public.listings
  set status = 'active',
      last_renewed_at = now(),
      sold_to = null,
      auction_closed = false,
      auction_ends_at = now() + make_interval(days => p_days),
      current_bid = null,
      bids_count = 0,
      auction_passed = '{}',
      buyer_confirmed_pickup = false,
      seller_confirmed_pickup = false,
      seller_reported_no_show = false,
      pickup_disputed = false
  where id = p_listing;
  -- Las pujas viejas no deben contar como "mejor postor" de la subasta nueva.
  delete from public.bids where listing_id = p_listing;
  return null;
end;
$$;
grant execute on function public.relaunch_auction(uuid, int) to authenticated;

-- ─── 5) No-show de subastas: SIEMPRE disputa al admin (sin ban automático) ──
create or replace function public.report_auction_no_show(p_listing uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  l public.listings%rowtype;
begin
  select * into l from public.listings where id = p_listing for update;
  if not found then return 'No existe'; end if;
  if auth.uid() <> l.seller_id then return 'Solo el vendedor'; end if;
  if not l.is_auction then return 'No es una subasta'; end if;
  if l.sold_to is null then return 'La subasta no tiene ganador'; end if;
  if l.seller_reported_no_show then return 'Ya lo reportaste'; end if;

  -- Sin castigo automático: queda como disputa y deciden los admins (que
  -- pueden banear a mano seteando auction_banned_until si corresponde).
  update public.listings set seller_reported_no_show = true, pickup_disputed = true where id = p_listing;

  insert into public.notifications (user_id, type, title, body, link, actor_id)
  select p.id, 'report', 'Reporte de no-retiro',
         'El vendedor reporta que no retiraron "' || l.title || '". Revisá el caso.', '/admin', l.seller_id
  from public.profiles p where p.is_admin;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    l.sold_to, 'report', 'Reportaron un problema con tu compra',
    'El vendedor indica que no retiraste "' || l.title || '". Si ya coordinaste o hay un malentendido, respondé por el chat.',
    '/p/' || p_listing
  );
  return null;
end;
$$;
grant execute on function public.report_auction_no_show(uuid) to authenticated;
