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

-- =============================================================
-- 00018 — Categoría nueva: Plantas y Jardinería
-- =============================================================
insert into public.categories (name, slug, required_fields) values
  ('Plantas y Jardinería', 'plantas-jardineria', '[
    {"key": "formas_de_pago", "label": "Formas de pago", "type": "multiselect", "required": true, "options": ["Efectivo", "Transferencia", "Mercado Pago"]},
    {"key": "acepta_envio", "label": "Acepta envío", "type": "boolean", "required": true}
  ]'::jsonb)
on conflict (slug) do nothing;

-- =============================================================
-- 00019 — Web Push: suscripciones del navegador
-- =============================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
do $$ begin
  create policy "suscripciones propias legibles" on public.push_subscriptions
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "suscribirse como uno mismo" on public.push_subscriptions
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "actualizar suscripcion propia" on public.push_subscriptions
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "borrar suscripcion propia" on public.push_subscriptions
    for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- 00020 — Categoría Alquileres (idempotente)
insert into public.categories (name, slug, required_fields) values
  ('Alquileres', 'alquileres', '[
    {"key": "tipo_propiedad", "label": "Tipo de propiedad", "type": "select", "required": true, "options": ["Departamento", "Casa", "PH", "Local comercial", "Oficina", "Cochera", "Terreno"]},
    {"key": "modalidad", "label": "Modalidad", "type": "select", "required": true, "options": ["Alquiler mensual", "Alquiler temporario"]},
    {"key": "ambientes", "label": "Ambientes", "type": "select", "required": false, "options": ["Monoambiente", "2", "3", "4", "5 o más"]},
    {"key": "dormitorios", "label": "Dormitorios", "type": "select", "required": true, "options": ["0", "1", "2", "3", "4 o más"]},
    {"key": "banos", "label": "Baños", "type": "select", "required": true, "options": ["1", "2", "3", "4 o más"]},
    {"key": "superficie_m2", "label": "Superficie (m²)", "type": "text", "required": false},
    {"key": "expensas", "label": "Expensas aprox. ($)", "type": "text", "required": false},
    {"key": "amoblado", "label": "Amoblado", "type": "boolean", "required": false},
    {"key": "balcon", "label": "Balcón", "type": "boolean", "required": false},
    {"key": "cochera", "label": "Cochera", "type": "boolean", "required": false},
    {"key": "patio_terraza", "label": "Patio o terraza", "type": "boolean", "required": false},
    {"key": "acepta_mascotas", "label": "Acepta mascotas", "type": "boolean", "required": false}
  ]'::jsonb)
on conflict (slug) do nothing;

-- 00021 — Editar y borrar mensajes del chat (idempotente)
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  deleted_at is not null
  or (body is not null and char_length(body) between 1 and 2000)
  or image_path is not null
);

create or replace function public.edit_message(p_message_id uuid, p_body text)
returns public.messages
language plpgsql
security definer set search_path = public
as $$
declare
  result public.messages;
begin
  if p_body is null or char_length(trim(p_body)) = 0 then
    raise exception 'El mensaje no puede estar vacío';
  end if;

  update public.messages
  set body = trim(p_body), edited_at = now()
  where id = p_message_id
    and sender_id = auth.uid()
    and deleted_at is null
    and image_path is null
  returning * into result;

  if result.id is null then
    raise exception 'No se puede editar este mensaje';
  end if;
  return result;
end;
$$;

create or replace function public.delete_message(p_message_id uuid)
returns public.messages
language plpgsql
security definer set search_path = public
as $$
declare
  result public.messages;
begin
  update public.messages
  set deleted_at = now(), body = null, image_path = null
  where id = p_message_id
    and sender_id = auth.uid()
    and deleted_at is null
  returning * into result;

  if result.id is null then
    raise exception 'No se puede borrar este mensaje';
  end if;
  return result;
end;
$$;

grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
-- =============================================================
-- 00022 — Filtros por rango + campos de auto en "Vehículos y Accesorios"
--
-- 1. Helper `num_from_text`: extrae el número de un texto del jsonb
--    (saca puntos, "km", "m²", etc.) para poder comparar como número.
-- 2. Columnas generadas e indexadas (veh_anio, veh_km, inmueble_sup) que
--    derivan ese número de `structured_fields`. El feed filtra por rango
--    contra estas columnas, no contra el jsonb (que compara como texto).
-- 3. Campos estilo MercadoLibre en "Vehículos y Accesorios" (marca, modelo,
--    año, km, combustible, transmisión, carrocería, puertas, color). Van
--    OPCIONALES para no romper publicaciones que no son autos (motos,
--    repuestos, accesorios). Año/Km/Superficie llevan `filterRange`.
-- 4. Alquileres: superficie con `filterRange` (rango estilo ZonaProp).
--
-- Idempotente: se puede re-correr sin romper.
-- =============================================================

-- 1. Número desde texto del jsonb (immutable → usable en columnas generadas).
create or replace function public.num_from_text(t text)
returns numeric
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), '')::numeric
$$;

-- 2. Columnas generadas (numéricas) + índices parciales para los rangos.
alter table public.listings
  add column if not exists veh_anio numeric
    generated always as (public.num_from_text(structured_fields ->> 'anio')) stored;
alter table public.listings
  add column if not exists veh_km numeric
    generated always as (public.num_from_text(structured_fields ->> 'kilometros')) stored;
alter table public.listings
  add column if not exists inmueble_sup numeric
    generated always as (public.num_from_text(structured_fields ->> 'superficie_m2')) stored;

create index if not exists idx_listings_veh_anio on public.listings (veh_anio) where veh_anio is not null;
create index if not exists idx_listings_veh_km on public.listings (veh_km) where veh_km is not null;
create index if not exists idx_listings_inmueble_sup on public.listings (inmueble_sup) where inmueble_sup is not null;

-- 3. Campos de auto en "Vehículos y Accesorios" (opcionales). El guard de
--    contención evita duplicarlos si se re-corre.
update public.categories
set required_fields = required_fields || '[
  {"key": "marca", "label": "Marca", "type": "select", "required": false, "options": ["Volkswagen", "Toyota", "Chevrolet", "Ford", "Fiat", "Renault", "Peugeot", "Citroën", "Honda", "Nissan", "Jeep", "Hyundai", "Kia", "Chery", "Suzuki", "Mercedes-Benz", "BMW", "Audi", "Otra"]},
  {"key": "modelo", "label": "Modelo", "type": "text", "required": false},
  {"key": "anio", "label": "Año", "type": "text", "required": false, "filterRange": {"column": "veh_anio"}},
  {"key": "kilometros", "label": "Kilómetros", "type": "text", "required": false, "filterRange": {"column": "veh_km", "unit": "km"}},
  {"key": "combustible", "label": "Combustible", "type": "select", "required": false, "options": ["Nafta", "Diésel", "GNC", "Híbrido", "Eléctrico"]},
  {"key": "transmision", "label": "Transmisión", "type": "select", "required": false, "options": ["Manual", "Automática"]},
  {"key": "tipo_carroceria", "label": "Carrocería", "type": "select", "required": false, "options": ["Sedán", "Hatchback", "SUV", "Pick-up", "Coupé", "Monovolumen", "Familiar", "Convertible", "Otra"]},
  {"key": "puertas", "label": "Puertas", "type": "select", "required": false, "options": ["2", "3", "4", "5"]},
  {"key": "color", "label": "Color", "type": "select", "required": false, "options": ["Blanco", "Negro", "Gris", "Plata", "Rojo", "Azul", "Verde", "Otro"]}
]'::jsonb
where slug = 'vehiculos-accesorios'
  and not (required_fields @> '[{"key": "marca"}]'::jsonb);

-- 4. Alquileres: superficie filtrable por rango (estilo ZonaProp). Se reescribe
--    el array completo a un valor conocido (idempotente).
update public.categories
set required_fields = '[
  {"key": "tipo_propiedad", "label": "Tipo de propiedad", "type": "select", "required": true, "options": ["Departamento", "Casa", "PH", "Local comercial", "Oficina", "Cochera", "Terreno"]},
  {"key": "modalidad", "label": "Modalidad", "type": "select", "required": true, "options": ["Alquiler mensual", "Alquiler temporario"]},
  {"key": "ambientes", "label": "Ambientes", "type": "select", "required": false, "options": ["Monoambiente", "2", "3", "4", "5 o más"]},
  {"key": "dormitorios", "label": "Dormitorios", "type": "select", "required": true, "options": ["0", "1", "2", "3", "4 o más"]},
  {"key": "banos", "label": "Baños", "type": "select", "required": true, "options": ["1", "2", "3", "4 o más"]},
  {"key": "superficie_m2", "label": "Superficie (m²)", "type": "text", "required": false, "filterRange": {"column": "inmueble_sup", "unit": "m²"}},
  {"key": "expensas", "label": "Expensas aprox. ($)", "type": "text", "required": false},
  {"key": "amoblado", "label": "Amoblado", "type": "boolean", "required": false},
  {"key": "balcon", "label": "Balcón", "type": "boolean", "required": false},
  {"key": "cochera", "label": "Cochera", "type": "boolean", "required": false},
  {"key": "patio_terraza", "label": "Patio o terraza", "type": "boolean", "required": false},
  {"key": "acepta_mascotas", "label": "Acepta mascotas", "type": "boolean", "required": false}
]'::jsonb
where slug = 'alquileres';

-- =============================================================
-- 00023 — actor_id en notifications (avatar de quien la envía)
-- =============================================================

alter table public.notifications
  add column if not exists actor_id uuid references public.profiles (id) on delete set null;

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

-- =============================================================
-- 00024 — Administración / moderación
-- OJO: la tabla `reports` y el enum `report_target` ya existen (00001).
-- =============================================================

alter type public.report_target add value if not exists 'message';
alter type public.report_target add value if not exists 'review';
alter type public.report_target add value if not exists 'suggestion';

alter table public.profiles add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.is_admin() to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'listings', 'questions', 'ratings', 'messages', 'conversations', 'app_reviews', 'feature_suggestions'
  ] loop
    execute format('drop policy if exists "admin modera" on public.%I', t);
    execute format(
      'create policy "admin modera" on public.%I for all using (public.is_admin()) with check (public.is_admin())',
      t
    );
  end loop;
end $$;

drop policy if exists "admin ve todos los reportes" on public.reports;
create policy "admin ve todos los reportes" on public.reports
  for select using (public.is_admin());
drop policy if exists "admin resuelve reportes" on public.reports;
create policy "admin resuelve reportes" on public.reports
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin borra reportes" on public.reports;
create policy "admin borra reportes" on public.reports
  for delete using (public.is_admin());

grant select, insert, update, delete on public.reports to authenticated;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'message', 'offer', 'offer_accepted', 'question_answered', 'sale_confirmed',
    'price_drop', 'saved_search', 'bid', 'outbid', 'auction_won', 'report'
  ));

create or replace function public.notify_report()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link, actor_id)
  select p.id, 'report', 'Nuevo reporte', left(new.reason, 80), '/admin', new.reporter_id
  from public.profiles p
  where p.is_admin and p.id <> new.reporter_id;
  return null;
end;
$$;

drop trigger if exists on_report_notify on public.reports;
create trigger on_report_notify
  after insert on public.reports
  for each row execute function public.notify_report();

update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'conradofigari.v@gmail.com');

-- =============================================================
-- 00025 — Castigo a ganadores de subasta que no retiran (doble comprobación)
-- =============================================================

alter table public.profiles
  add column if not exists auction_strikes int not null default 0,
  add column if not exists auction_banned_until timestamptz;

alter table public.listings
  add column if not exists buyer_confirmed_pickup boolean not null default false,
  add column if not exists seller_confirmed_pickup boolean not null default false,
  add column if not exists seller_reported_no_show boolean not null default false,
  add column if not exists pickup_disputed boolean not null default false;

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
  if l.buyer_confirmed_pickup then
    update public.listings set seller_reported_no_show = true, pickup_disputed = true where id = p_listing;
    insert into public.notifications (user_id, type, title, body, link, actor_id)
    select p.id, 'report', 'Disputa de subasta',
           'Vendedor y comprador no coinciden sobre el retiro de "' || l.title || '"', '/admin', l.seller_id
    from public.profiles p where p.is_admin;
    return null;
  end if;
  update public.profiles set auction_strikes = auction_strikes + 1 where id = l.sold_to returning auction_strikes into s;
  ban_until := now() + case
    when s <= 1 then interval '1 month'
    when s = 2 then interval '3 months'
    when s = 3 then interval '6 months'
    else interval '12 months'
  end;
  update public.profiles set auction_banned_until = ban_until where id = l.sold_to;
  update public.listings set seller_reported_no_show = true where id = p_listing;
  insert into public.notifications (user_id, type, title, body, link)
  values (l.sold_to, 'auction_won', 'Quedaste sin subastas por un tiempo',
    'Se reportó que no retiraste "' || l.title || '". No podés ofertar en subastas hasta el ' || to_char(ban_until, 'DD/MM/YYYY') || '.',
    '/p/' || p_listing);
  return null;
end;
$$;
grant execute on function public.report_auction_no_show(uuid) to authenticated;

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

-- =============================================================
-- 00026 — Recomendaciones del feed ("Recomendado para vos")
-- =============================================================
-- Ranking personalizado sin tabla de eventos nueva: afinidad por categoría
-- derivada de favorites + listing_views, más prueba social, recencia y
-- cercanía. Devuelve setof listings (el front la consume con el mismo embed).
create index if not exists listing_views_viewer_idx on public.listing_views (viewer_id);

create or replace function public.recommended_listings(
  p_lat double precision default null,
  p_lng double precision default null,
  p_limit integer default 24,
  p_offset integer default 0
)
returns setof public.listings
language sql
stable
security definer
set search_path = public
as $$
  with uid as (select auth.uid() as id),
  cat_affinity as (
    select category_id, sum(w) as affinity
    from (
      select l.category_id,
             3.0 * exp(-extract(epoch from now() - f.created_at) / (86400 * 30)) as w
      from public.favorites f
      join public.listings l on l.id = f.listing_id
      where f.user_id = (select id from uid)
      union all
      select l.category_id,
             1.0 * exp(-extract(epoch from now() - v.created_at) / (86400 * 30)) as w
      from public.listing_views v
      join public.listings l on l.id = v.listing_id
      where v.viewer_id = (select id from uid)
    ) s
    group by category_id
  ),
  max_aff as (select coalesce(max(affinity), 0) as m from cat_affinity)
  select l.*
  from public.listings l
  left join cat_affinity ca on ca.category_id = l.category_id
  cross join max_aff
  where l.status = 'active'
    and ((select id from uid) is null or l.seller_id <> (select id from uid))
  order by (
    coalesce(ca.affinity / nullif(max_aff.m, 0), 0) * 3.0
    + ln(1 + l.favorites_count) * 0.6
    + ln(1 + l.views_count) * 0.2
    + (1.0 / (1 + extract(epoch from now() - l.last_renewed_at) / (86400 * 7))) * 1.5
    + (case
         when p_lat is null or l.lat is null then 0
         else 1.0 / (1 + (
           6371 * acos(least(1, greatest(-1,
             cos(radians(p_lat)) * cos(radians(l.lat)) * cos(radians(l.lng) - radians(p_lng))
             + sin(radians(p_lat)) * sin(radians(l.lat))
           ))) / 10.0)
         )
       end) * 1.0
    - (case when (select id from uid) is not null
              and exists (select 1 from public.listing_views v
                          where v.listing_id = l.id and v.viewer_id = (select id from uid))
            then 1.0 else 0 end)
    - (case when (select id from uid) is not null
              and exists (select 1 from public.favorites f
                          where f.listing_id = l.id and f.user_id = (select id from uid))
            then 2.0 else 0 end)
  ) desc, l.last_renewed_at desc, l.id desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

grant execute on function public.recommended_listings(double precision, double precision, integer, integer) to anon, authenticated;


-- ============================================================
-- 00027: la conversación sobrevive al borrado de la publicación.
-- FK conversations.listing_id: cascade → set null (+ nullable).
-- ============================================================

alter table public.conversations
  drop constraint conversations_listing_id_fkey;

alter table public.conversations
  alter column listing_id drop not null;

alter table public.conversations
  add constraint conversations_listing_id_fkey
  foreign key (listing_id) references public.listings (id) on delete set null;


-- ============================================================
-- 00028: Celulares — "Tipo" (Teléfono/Accesorio) con campos condicionales.
-- marca/modelo/almacenamiento/salud_bateria pasan a `showIf` tipo=Teléfono.
-- ============================================================

update public.categories
set required_fields = (
  select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
  from jsonb_array_elements(required_fields) with ordinality as t(elem, ord)
  where elem->>'key' not in ('tipo', 'marca', 'modelo', 'almacenamiento', 'salud_bateria')
)
|| '[
  {"key": "tipo", "label": "Tipo", "type": "select", "required": true, "options": ["Teléfono", "Accesorio"]},
  {"key": "marca", "label": "Marca", "type": "text", "required": true, "showIf": {"key": "tipo", "in": ["Teléfono"]}},
  {"key": "modelo", "label": "Modelo", "type": "text", "required": true, "showIf": {"key": "tipo", "in": ["Teléfono"]}},
  {"key": "almacenamiento", "label": "Almacenamiento", "type": "select", "required": true, "options": ["32 GB", "64 GB", "128 GB", "256 GB", "512 GB", "1 TB"], "showIf": {"key": "tipo", "in": ["Teléfono"]}},
  {"key": "salud_bateria", "label": "Salud de batería (%)", "type": "text", "required": false, "showIf": {"key": "tipo", "in": ["Teléfono"]}}
]'::jsonb
where slug = 'celulares';

update public.listings
set structured_fields = coalesce(structured_fields, '{}'::jsonb) || '{"tipo": "Teléfono"}'::jsonb
where category_id = (select id from public.categories where slug = 'celulares')
  and not (coalesce(structured_fields, '{}'::jsonb) ? 'tipo');
