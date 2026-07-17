-- =============================================================
-- 00046 — Moderación de disputas de subasta (no-retiro) desde /admin.
--
-- Contexto: 00025 castigaba al ganador que no retira; 00041 SACÓ el castigo
-- automático (un vendedor mentiroso podía banear a un comprador honesto) y
-- dejó el caso como "disputa" (listings.pickup_disputed) avisando a los
-- admins por notificación. Pero no quedó NINGUNA herramienta para actuar:
-- la notif apunta a /admin pero ahí solo vive la bandeja de `reports`, y
-- auction_banned_until/auction_strikes están pinneados por
-- protect_profile_columns (ni el admin los puede tocar desde el cliente).
--
-- Esta migración cierra el hueco con 3 RPCs (todos `is_admin()`):
--   admin_auction_disputes()          → lista los casos pendientes (con el
--                                        comprador, vendedor, strikes, si el
--                                        comprador había confirmado el retiro
--                                        —señal de vendedor mentiroso— y el
--                                        chat para revisar antes de decidir)
--   admin_ban_auction(listing, meses) → banea al ganador (sold_to) N meses,
--                                        +1 strike, y cierra la disputa
--   admin_dismiss_dispute(listing)    → cierra la disputa sin castigo
--                                        (fue un malentendido)
--
-- protect_profile_columns gana un bypass por flag `dealr.moderation` (mismo
-- patrón que `dealr.scoring` de 00039) para que el RPC de admin pueda setear
-- el ban sin que el trigger lo revierta. Idempotente.
-- =============================================================

-- ── 1) Bypass de moderación en el trigger de protección ──────────────────
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  -- Recálculo interno de scores (00039): permitido.
  if current_setting('dealr.scoring', true) = '1' then
    return new;
  end if;
  -- Moderación de admin (00046): permitido tocar castigos.
  if current_setting('dealr.moderation', true) = '1' then
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
    -- Moderación y castigos no se auto-editan (00041).
    new.is_admin := old.is_admin;
    new.is_minor := old.is_minor;
    new.account_restricted := old.account_restricted;
    new.auction_strikes := old.auction_strikes;
    new.auction_banned_until := old.auction_banned_until;
  end if;
  return new;
end;
$$;

-- ── 2) Listar disputas pendientes (solo admin) ───────────────────────────
create or replace function public.admin_auction_disputes()
returns table (
  listing_id uuid,
  title text,
  created_at timestamptz,
  buyer_id uuid,
  buyer_username text,
  buyer_avatar text,
  buyer_strikes int,
  buyer_banned_until timestamptz,
  buyer_confirmed boolean,
  seller_id uuid,
  seller_username text,
  conversation_id uuid
)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo para administradores';
  end if;
  return query
  select l.id, l.title, l.created_at,
         b.id, b.username, b.avatar_url, b.auction_strikes, b.auction_banned_until,
         l.buyer_confirmed_pickup,
         s.id, s.username,
         (select c.id from public.conversations c
           where c.listing_id = l.id and c.buyer_id = l.sold_to
           order by c.created_at limit 1)
  from public.listings l
  join public.profiles b on b.id = l.sold_to
  join public.profiles s on s.id = l.seller_id
  where l.seller_reported_no_show = true and l.pickup_disputed = true
  order by l.created_at desc;
end;
$$;
grant execute on function public.admin_auction_disputes() to authenticated;

-- ── 3) Banear al ganador de una subasta (solo admin) ─────────────────────
create or replace function public.admin_ban_auction(p_listing uuid, p_months int)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  l public.listings%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Solo para administradores';
  end if;
  if p_months is null or p_months < 1 then return 'Duración inválida'; end if;
  select * into l from public.listings where id = p_listing for update;
  if not found then return 'La publicación no existe'; end if;
  if l.sold_to is null then return 'La subasta no tiene ganador'; end if;

  perform set_config('dealr.moderation', '1', true);
  update public.profiles
  set auction_strikes = auction_strikes + 1,
      auction_banned_until = now() + make_interval(months => p_months)
  where id = l.sold_to;

  -- La disputa queda resuelta.
  update public.listings set pickup_disputed = false where id = p_listing;

  -- Aviso al comprador baneado.
  insert into public.notifications (user_id, type, title, body, link)
  values (
    l.sold_to, 'report', 'Suspensión temporal en subastas',
    'No podés participar de subastas por ' || p_months || ' mes(es) por no retirar una compra ganada.',
    '/perfil'
  );
  return null;
end;
$$;
grant execute on function public.admin_ban_auction(uuid, int) to authenticated;

-- ── 4) Descartar la disputa sin castigo (solo admin) ─────────────────────
create or replace function public.admin_dismiss_dispute(p_listing uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo para administradores';
  end if;
  update public.listings set pickup_disputed = false where id = p_listing;
  if not found then return 'La publicación no existe'; end if;
  return null;
end;
$$;
grant execute on function public.admin_dismiss_dispute(uuid) to authenticated;
