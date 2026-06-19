-- =============================================================
-- Dealr — Script único e idempotente (migraciones 00008 → 00014)
--
-- Pegá TODO esto en Supabase → SQL Editor y ejecutá. Es seguro correrlo
-- entero las veces que quieras: cada sentencia usa "if not exists" /
-- "create or replace" / "drop ... if exists", así que no importa cuáles ya
-- aplicaste a mano ni en qué orden. Reemplaza tener que trackear migración
-- por migración.
--
-- (Las migraciones 00001–00007 son el esquema base; se asumen ya aplicadas.)
-- =============================================================

-- ---------- 00008: talle opcional en Ropa y Accesorios ----------
update public.categories
set required_fields = (
  select jsonb_agg(
    case when elem->>'key' = 'talle' then jsonb_set(elem, '{required}', 'false'::jsonb) else elem end
  )
  from jsonb_array_elements(required_fields) elem
)
where slug = 'ropa-accesorios';

-- ---------- 00016: sacar campos que sobran (zona, motivo_venta) ----------
update public.categories
set required_fields = (
  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  from jsonb_array_elements(required_fields) elem
  where elem->>'key' not in ('zona', 'motivo_venta')
);

-- ---------- 00009 + 00015: ubicación y última actividad ----------
alter table public.listings
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists location_label text;
alter table public.profiles
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists last_seen_at timestamptz;

-- ---------- 00012 (enum): estado "reservado" ----------
-- ADD VALUE IF NOT EXISTS es seguro de re-correr. En PG 12+ puede ir dentro
-- de la transacción del editor mientras no se USE 'reserved' en este script.
alter type listing_status add value if not exists 'reserved';

-- ---------- 00010 + 00012 + 00014 + 00017: columnas de listings ----------
alter table public.listings
  add column if not exists favorites_count integer not null default 0,
  add column if not exists previous_price numeric,
  add column if not exists price_dropped_at timestamptz,
  add column if not exists views_count integer not null default 0,
  add column if not exists is_auction boolean not null default false,
  add column if not exists auction_ends_at timestamptz,
  add column if not exists current_bid numeric,
  add column if not exists bids_count integer not null default 0,
  add column if not exists auction_closed boolean not null default false,
  add column if not exists auction_cascade boolean not null default false,
  add column if not exists auction_passed uuid[] not null default '{}';

-- Backfill del contador de guardados.
update public.listings l
set favorites_count = (select count(*) from public.favorites f where f.listing_id = l.id);

-- ---------- 00013: fotos en el chat ----------
alter table public.messages add column if not exists image_path text;
alter table public.messages alter column body drop not null;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check
  check ((body is not null and char_length(body) between 1 and 2000) or image_path is not null);

-- ---------- Tipos de notificación (estado final, una sola vez) ----------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('message','offer','offer_accepted','question_answered','sale_confirmed','price_drop','saved_search','bid','outbid','auction_won'));

-- ---------- 00011: búsquedas guardadas ----------
create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  query text,
  category_id integer references public.categories (id),
  min_price numeric,
  max_price numeric,
  currency text check (currency in ('ARS','USD')),
  conditions text[],
  created_at timestamptz not null default now()
);
create index if not exists saved_searches_user_idx on public.saved_searches (user_id, created_at desc);
alter table public.saved_searches enable row level security;
drop policy if exists "búsquedas propias legibles" on public.saved_searches;
create policy "búsquedas propias legibles" on public.saved_searches for select using (auth.uid() = user_id);
drop policy if exists "guardar búsqueda propia" on public.saved_searches;
create policy "guardar búsqueda propia" on public.saved_searches for insert with check (auth.uid() = user_id);
drop policy if exists "borrar búsqueda propia" on public.saved_searches;
create policy "borrar búsqueda propia" on public.saved_searches for delete using (auth.uid() = user_id);
grant select, insert, delete on public.saved_searches to authenticated;

-- ---------- 00014: vistas únicas por usuario ----------
create table if not exists public.listing_views (
  listing_id uuid not null references public.listings (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, viewer_id)
);
alter table public.listing_views enable row level security;

-- ============================ FUNCIONES + TRIGGERS ============================

-- Guardados: contador denormalizado.
create or replace function public.sync_favorites_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.listings set favorites_count = favorites_count + 1 where id = new.listing_id;
  elsif tg_op = 'DELETE' then
    update public.listings set favorites_count = greatest(favorites_count - 1, 0) where id = old.listing_id;
  end if;
  return null;
end; $$;
drop trigger if exists on_favorite_change on public.favorites;
create trigger on_favorite_change after insert or delete on public.favorites
  for each row execute function public.sync_favorites_count();

-- Precio: registra la baja.
create or replace function public.track_price_drop()
returns trigger language plpgsql as $$
begin
  if new.currency is distinct from old.currency then
    new.previous_price := null; new.price_dropped_at := null;
  elsif new.price < old.price then
    new.previous_price := old.price; new.price_dropped_at := now();
  elsif new.price > old.price then
    new.previous_price := null; new.price_dropped_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists on_price_change on public.listings;
create trigger on_price_change before update on public.listings
  for each row when (new.price is distinct from old.price)
  execute function public.track_price_drop();

-- Precio: avisa a quienes la guardaron.
create or replace function public.notify_price_drop()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select f.user_id, 'price_drop', 'Bajó de precio',
         '"' || new.title || '" que guardaste ahora cuesta menos', '/p/' || new.id
  from public.favorites f
  where f.listing_id = new.id and f.user_id <> new.seller_id;
  return null;
end; $$;
drop trigger if exists on_price_drop_notify on public.listings;
create trigger on_price_drop_notify after update on public.listings
  for each row when (new.price < old.price and new.currency is not distinct from old.currency)
  execute function public.notify_price_drop();

-- Búsquedas guardadas: avisa cuando se publica algo que matchea.
create or replace function public.notify_saved_search_matches()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select s.user_id, 'saved_search', 'Nueva publicación para tu búsqueda', new.title, '/p/' || new.id
  from public.saved_searches s
  where s.user_id <> new.seller_id
    and (s.category_id is null or s.category_id = new.category_id)
    and (s.query is null or new.title ilike '%' || s.query || '%' or new.description ilike '%' || s.query || '%')
    and (s.currency is null or new.currency::text = s.currency)
    and (s.min_price is null or new.price >= s.min_price)
    and (s.max_price is null or new.price <= s.max_price)
    and (s.conditions is null or array_length(s.conditions, 1) is null or new.condition::text = any (s.conditions));
  return null;
end; $$;
drop trigger if exists on_listing_saved_search_notify on public.listings;
create trigger on_listing_saved_search_notify after insert on public.listings
  for each row execute function public.notify_saved_search_matches();

-- Mensaje nuevo: notifica (muestra "Foto" si no hay texto).
create or replace function public.notify_new_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare conv public.conversations%rowtype; recipient uuid; sender_name text;
begin
  select * into conv from public.conversations where id = new.conversation_id;
  recipient := case when new.sender_id = conv.buyer_id then conv.seller_id else conv.buyer_id end;
  select username into sender_name from public.profiles where id = new.sender_id;
  insert into public.notifications (user_id, type, title, body, link)
  values (recipient, 'message', sender_name || ' te escribió', coalesce(left(new.body, 80), '📷 Foto'), '/chats/' || conv.id);
  return null;
end; $$;

-- Vistas: una por usuario logueado.
create or replace function public.increment_listing_views(listing_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rows integer;
begin
  if auth.uid() is null then return; end if;
  insert into public.listing_views (listing_id, viewer_id)
  values (increment_listing_views.listing_id, auth.uid()) on conflict do nothing;
  get diagnostics rows = row_count;
  if rows > 0 then
    update public.listings set views_count = views_count + 1 where id = increment_listing_views.listing_id;
  end if;
end; $$;
grant execute on function public.increment_listing_views(uuid) to authenticated;

-- Preview de chats: último mensaje + no leídos por conversación.
create or replace function public.conversation_previews()
returns table (conversation_id uuid, last_body text, last_image boolean, last_sender uuid, last_at timestamptz, unread integer)
language sql security definer set search_path = public as $$
  with mine as (
    select id from public.conversations where buyer_id = auth.uid() or seller_id = auth.uid()
  ), last_msg as (
    select distinct on (m.conversation_id) m.conversation_id, m.body, m.image_path, m.sender_id, m.created_at
    from public.messages m join mine on mine.id = m.conversation_id
    order by m.conversation_id, m.created_at desc
  )
  select mine.id, lm.body, (lm.image_path is not null), lm.sender_id, lm.created_at,
    coalesce((select count(*)::int from public.messages u
      where u.conversation_id = mine.id and u.sender_id <> auth.uid() and u.read_at is null), 0)
  from mine left join last_msg lm on lm.conversation_id = mine.id;
$$;
grant execute on function public.conversation_previews() to authenticated;

-- ============================ 00017: SUBASTAS ============================
create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  bidder_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists bids_listing_idx on public.bids (listing_id, amount desc);
alter table public.bids enable row level security;
drop policy if exists "ofertas propias legibles" on public.bids;
create policy "ofertas propias legibles" on public.bids for select using (auth.uid() = bidder_id);
grant select on public.bids to authenticated;

create or replace function public.place_bid(p_listing uuid, p_amount numeric)
returns text language plpgsql security definer set search_path = public as $$
declare l public.listings%rowtype; prev_top uuid;
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
end; $$;
grant execute on function public.place_bid(uuid, numeric) to authenticated;

create or replace function public.close_auctions()
returns void language plpgsql security definer set search_path = public as $$
declare a public.listings%rowtype; winner uuid; conv uuid;
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
end; $$;
grant execute on function public.close_auctions() to authenticated;

create or replace function public.reassign_auction(p_listing uuid)
returns text language plpgsql security definer set search_path = public as $$
declare l public.listings%rowtype; prev_winner uuid; nxt record; conv uuid;
begin
  select * into l from public.listings where id = p_listing for update;
  if not found then return 'No existe'; end if;
  if auth.uid() <> l.seller_id then return 'Solo el vendedor'; end if;
  if not l.is_auction or not l.auction_closed then return 'La subasta no cerró todavía'; end if;
  if not l.auction_cascade then return 'La opción de ofrecer al siguiente no está activa'; end if;
  prev_winner := l.sold_to;
  select bidder_id, amount into nxt
  from public.bids
  where listing_id = p_listing and bidder_id <> all (l.auction_passed)
    and (prev_winner is null or bidder_id <> prev_winner)
  order by amount desc, created_at asc limit 1;
  if nxt.bidder_id is null then
    update public.listings set status = 'expired', sold_to = null where id = p_listing;
    return 'No quedan más postores';
  end if;
  update public.listings
  set sold_to = nxt.bidder_id, current_bid = nxt.amount,
      auction_passed = case when prev_winner is not null then array_append(l.auction_passed, prev_winner) else l.auction_passed end
  where id = p_listing;
  select id into conv from public.conversations where listing_id = p_listing and buyer_id = nxt.bidder_id;
  if conv is null then
    insert into public.conversations (listing_id, buyer_id, seller_id) values (p_listing, nxt.bidder_id, l.seller_id) returning id into conv;
  end if;
  insert into public.notifications (user_id, type, title, body, link)
  values (nxt.bidder_id, 'auction_won', 'Quedó disponible para vos', '"' || l.title || '" quedó disponible a tu oferta. Coordiná con el vendedor.', '/chats/' || conv);
  return null;
end; $$;
grant execute on function public.reassign_auction(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('close-auctions', '* * * * *', 'select public.close_auctions()');
  end if;
end $$;
