-- ==============================================================
-- apply_pending.sql — TODAS las migraciones pendientes en orden.
-- Pegar entero en Supabase → SQL Editor y correr. Idempotente.
-- Incluye lo que NO está en apply_all.sql (00008–00029).
-- Después correr supabase/health_check.sql para confirmar OK.
-- OJO: 00025 debe ir antes que 00033/00035 (reescriben place_bid) — ya ordenado.
-- ==============================================================


-- ============================================================
-- 00025_auction_no_show_penalty
-- ============================================================
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


-- ============================================================
-- 00030_welcome_dm
-- ============================================================
-- 00030: mensaje de bienvenida por chat (DM de admin a usuarios nuevos).
--
-- Permite que un admin le mande un chat de bienvenida a un usuario (agradecer +
-- dar info útil). Reusa la infra de chat que ya existe (conversations +
-- messages): el trigger notify_new_message (00023) ya le avisa al destinatario
-- (push incluido si lo tiene configurado), así que no hay que tocar nada más.
--
-- La conversación queda con listing_id = null (no hay publicación de por medio).
-- El front (ChatThread/Chats, 00027) tolera el listing null, pero MUESTRA
-- "Publicación eliminada" en el encabezado del chat y un círculo sin foto en la
-- lista. Es esperado: es un DM sin publicación.
--
-- El usuario nuevo entra como buyer_id y el admin como seller_id, así
-- notify_new_message calcula recipient = el usuario nuevo (le llega a él).
--
-- conversations.kind marca el tipo de chat: 'welcome' para estos DMs. Sirve
-- para que el front muestre "Mensaje de bienvenida" en vez de "Publicación
-- eliminada" (que es lo que muestra para un listing_id null cualquiera) y para
-- no confundirlo con un chat cuya publicación fue borrada.

alter table public.conversations add column if not exists kind text;

create or replace function public.send_welcome_dm(p_to uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  v_conv uuid;
  v_msg uuid;
begin
  -- Emisor = un admin. Con sesión (RPC) usa auth.uid(); desde el SQL Editor
  -- (sin sesión) cae al admin más antiguo. El guard de abajo impide que un
  -- no-admin la use vía RPC (ahí auth.uid() es él y no pasa is_admin).
  v_admin := coalesce(
    auth.uid(),
    (select id from public.profiles where is_admin order by created_at limit 1)
  );

  if v_admin is null or not exists (
    select 1 from public.profiles where id = v_admin and is_admin
  ) then
    raise exception 'Solo un admin puede enviar el mensaje de bienvenida';
  end if;

  if p_to is null or not exists (select 1 from public.profiles where id = p_to) then
    raise exception 'El usuario destino no existe';
  end if;

  if p_to = v_admin then
    raise exception 'No te podés escribir a vos mismo';
  end if;

  -- Reusar el chat de bienvenida admin->usuario si ya existe, para no duplicar.
  -- Matchea por kind='welcome' (no por listing_id null a secas) para no agarrar
  -- por error un chat real cuya publicación fue borrada.
  select id into v_conv
  from public.conversations
  where buyer_id = p_to and seller_id = v_admin and kind = 'welcome'
  order by created_at
  limit 1;

  if v_conv is null then
    insert into public.conversations (listing_id, buyer_id, seller_id, kind)
    values (null, p_to, v_admin, 'welcome')
    returning id into v_conv;
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (v_conv, v_admin, p_body)
  returning id into v_msg;

  return v_msg;
end;
$$;

revoke all on function public.send_welcome_dm(uuid, text) from public, anon;
grant execute on function public.send_welcome_dm(uuid, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- USO MANUAL (desde Supabase → SQL Editor)
--
-- Por email (lo más práctico para un registro reciente con Google):
--
--   select public.send_welcome_dm(
--     (select id from auth.users where email = 'persona@gmail.com'),
--     '¡Hola! Gracias por sumarte a Dealr 👋 ...'
--   );
--
-- Por username:
--
--   select public.send_welcome_dm(
--     (select id from public.profiles where username = 'usuario_xxxxxxxx'),
--     '¡Hola! ...'
--   );
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- Bienvenida AUTOMÁTICA a cada usuario nuevo.
--
-- Cada perfil nuevo recibe el DM de bienvenida solo. Va envuelto en un
-- exception handler que traga cualquier error: si algo falla (ej. todavía no
-- hay admin), NO rompe el alta del usuario.
--
-- Para DESACTIVARlo: drop trigger on_profile_welcome on public.profiles;
-- Para cambiar el texto: editá el mensaje de abajo y re-corré este bloque.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.auto_welcome_dm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.send_welcome_dm(
      new.id,
      '¡Bienvenido a Dealr 🙌!

El lugar para comprar y vender cosas usadas en Córdoba, con gente real y verificada ✅

🔨 Participá en subastas en vivo y 📍 descubrí lo que hay cerca tuyo en el mapa. Vos cerrás el trato como quieras, sin comisiones.

Nos ayuda un montón que seas parte 💪 Si ves un error o algo que no funciona, reportalo 🐛 Y si se te ocurre una función nueva, proponela desde tu perfil 💡'
    );
  exception when others then
    null; -- nunca bloquear el alta por el saludo
  end;
  return new;
end;
$$;

drop trigger if exists on_profile_welcome on public.profiles;
create trigger on_profile_welcome
  after insert on public.profiles
  for each row execute function public.auto_welcome_dm();


-- ============================================================
-- 00031_signup_survey
-- ============================================================
-- 00031: encuesta rápida "¿Cómo nos conociste?" en el onboarding.
--
-- Una fila por usuario (PK = user_id → responde una sola vez). `source` es la
-- opción elegida (Instagram, TikTok, etc.) y `detail` el texto libre opcional
-- cuando elige "Otro". El front (Onboarding.tsx) la inserta al elegir el nombre.
-- El admin puede leer todas para ver la atribución (de dónde llegan los users).

create table if not exists public.signup_surveys (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  source text not null,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.signup_surveys enable row level security;

-- El usuario ve y crea solo la suya.
drop policy if exists "encuesta propia select" on public.signup_surveys;
create policy "encuesta propia select" on public.signup_surveys
  for select using (auth.uid() = user_id);

drop policy if exists "encuesta propia insert" on public.signup_surveys;
create policy "encuesta propia insert" on public.signup_surveys
  for insert with check (auth.uid() = user_id);

-- El admin ve todas (analytics de atribución). is_admin() viene de 00024.
drop policy if exists "admin ve encuestas" on public.signup_surveys;
create policy "admin ve encuestas" on public.signup_surveys
  for select using (public.is_admin());

grant select, insert on public.signup_surveys to authenticated;


-- ============================================================
-- 00032_notify_new_question
-- ============================================================
-- 00032 — Avisar al vendedor cuando le hacen una PREGUNTA nueva.
--
-- Faltaba: existía notify_question_answered (00006/00023, avisa a quien
-- preguntó cuando el vendedor responde) pero NO el inverso, así que el
-- vendedor nunca recibía notificación (ni in-app ni push) de una pregunta
-- nueva. Esto agrega el tipo 'question' al CHECK + el trigger que falta.
--
-- Idempotente: se puede re-correr sin romper.

-- 1) Extiende el CHECK de tipos (el último estado venía de la 00024).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'message', 'offer', 'offer_accepted', 'question_answered', 'sale_confirmed',
    'price_drop', 'saved_search', 'bid', 'outbid', 'auction_won', 'report', 'question'
  ));

-- 2) Trigger: al insertarse una pregunta, notifica al vendedor.
--    actor = quien pregunta (igual que el resto de las notifs con persona).
create or replace function public.notify_new_question()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ltitle text;
  lseller uuid;
begin
  select title, seller_id into ltitle, lseller from public.listings where id = new.listing_id;
  -- No auto-notificar si alguien pregunta en su propia publicación.
  if lseller is not null and lseller <> new.asker_id then
    insert into public.notifications (user_id, type, title, body, link, actor_id)
    values (lseller, 'question', 'Nueva pregunta', 'En "' || ltitle || '"', '/p/' || new.listing_id, new.asker_id);
  end if;
  return null;
end;
$$;

drop trigger if exists on_question_notify on public.questions;
create trigger on_question_notify
  after insert on public.questions
  for each row execute function public.notify_new_question();


-- ============================================================
-- 00033_auction_antisnipe
-- ============================================================
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


-- ============================================================
-- 00034_inmuebles_category
-- ============================================================
-- =============================================================
-- 00034 — "Alquileres" → "Inmuebles" (vertical de propiedades estilo ZonaProp)
--
-- Unifica venta + alquiler + temporario en UNA categoría con un campo
-- "Operación". Reemplaza los campos de la 00020 por el set completo:
-- operación, tipo, distribución (ambientes/dormitorios/baños/cocheras),
-- superficie (cubierta + total), expensas, antigüedad, orientación,
-- disposición, apto crédito, pisos del edificio y un multiselect de
-- características (amenities + edificio).
--
-- Mantiene el slug 'alquileres' (no romper imágenes de categoría ni listings
-- existentes). Idempotente.
-- =============================================================

-- 1) Renombra la categoría (el slug queda igual).
update public.categories set name = 'Inmuebles' where slug = 'alquileres';

-- 2) Columnas generadas e indexadas para los filtros por rango numérico.
--    (la superficie total reusa `inmueble_sup` de la 00022).
alter table public.listings
  add column if not exists inm_ambientes numeric
    generated always as (public.num_from_text(structured_fields ->> 'ambientes')) stored;
alter table public.listings
  add column if not exists inm_dormitorios numeric
    generated always as (public.num_from_text(structured_fields ->> 'dormitorios')) stored;
alter table public.listings
  add column if not exists inm_banos numeric
    generated always as (public.num_from_text(structured_fields ->> 'banos')) stored;
alter table public.listings
  add column if not exists inm_cocheras numeric
    generated always as (public.num_from_text(structured_fields ->> 'cocheras')) stored;
alter table public.listings
  add column if not exists inm_sup_cubierta numeric
    generated always as (public.num_from_text(structured_fields ->> 'superficie_cubierta_m2')) stored;
alter table public.listings
  add column if not exists inm_expensas numeric
    generated always as (public.num_from_text(structured_fields ->> 'expensas')) stored;
alter table public.listings
  add column if not exists inm_pisos numeric
    generated always as (public.num_from_text(structured_fields ->> 'pisos_edificio')) stored;

create index if not exists idx_listings_inm_ambientes on public.listings (inm_ambientes) where inm_ambientes is not null;
create index if not exists idx_listings_inm_dormitorios on public.listings (inm_dormitorios) where inm_dormitorios is not null;
create index if not exists idx_listings_inm_banos on public.listings (inm_banos) where inm_banos is not null;
create index if not exists idx_listings_inm_cocheras on public.listings (inm_cocheras) where inm_cocheras is not null;
create index if not exists idx_listings_inm_sup_cubierta on public.listings (inm_sup_cubierta) where inm_sup_cubierta is not null;
create index if not exists idx_listings_inm_expensas on public.listings (inm_expensas) where inm_expensas is not null;
create index if not exists idx_listings_inm_pisos on public.listings (inm_pisos) where inm_pisos is not null;

-- Índice GIN para el filtro multiselect (jsonb @> sobre características).
create index if not exists idx_listings_structured_fields_gin on public.listings using gin (structured_fields);

-- 3) Set completo de campos. `filterRange` → filtro por rango (columna generada).
--    Solo operación y tipo son obligatorios (terrenos/cocheras no tienen
--    dormitorios/baños). El multiselect `caracteristicas` agrupa los amenities.
update public.categories set required_fields = '[
  {"key": "operacion", "label": "Operación", "type": "select", "required": true, "options": ["Comprar", "Alquilar", "Alquiler temporario"]},
  {"key": "tipo_propiedad", "label": "Tipo de propiedad", "type": "select", "required": true, "options": ["Departamento", "Casa", "PH", "Terreno", "Oficina", "Local comercial", "Cochera"]},
  {"key": "ambientes", "label": "Ambientes", "type": "select", "required": false, "options": ["1", "2", "3", "4 o más"]},
  {"key": "dormitorios", "label": "Dormitorios", "type": "select", "required": false, "options": ["1", "2", "3", "4 o más"]},
  {"key": "banos", "label": "Baños", "type": "select", "required": false, "options": ["1", "2", "3", "4 o más"]},
  {"key": "cocheras", "label": "Cocheras", "type": "select", "required": false, "options": ["1", "2", "3", "4 o más"]},
  {"key": "superficie_cubierta_m2", "label": "Superficie cubierta (m²)", "type": "text", "required": false, "filterSlider": {"column": "inm_sup_cubierta", "min": 0, "max": 500, "step": 10, "unit": "m²", "bound": "min"}},
  {"key": "antiguedad", "label": "Antigüedad", "type": "select", "required": false, "options": ["A estrenar", "En construcción (pozo)", "Hasta 5 años", "Entre 5 y 10 años", "Entre 10 y 20 años", "Entre 20 y 50 años", "Más de 50 años"]},
  {"key": "expensas", "label": "Expensas aprox. ($)", "type": "text", "required": false, "filterMaxChips": {"column": "inm_expensas", "options": [{"label": "100 mil", "value": 100000}, {"label": "200 mil", "value": 200000}, {"label": "300 mil", "value": 300000}, {"label": "400 mil", "value": 400000}, {"label": "500 mil", "value": 500000}]}},
  {"key": "apto_credito", "label": "Apto crédito hipotecario", "type": "boolean", "required": false},
  {"key": "disposicion", "label": "Disposición", "type": "select", "required": false, "options": ["Frente", "Contrafrente", "Interno", "Lateral"]},
  {"key": "caracteristicas", "label": "Características", "type": "multiselect", "required": false, "options": ["Pileta", "Balcón", "Patio", "Jardín", "Parrilla", "Ascensor", "Baulera", "Gimnasio", "SUM", "Lavadero", "Aire acondicionado", "Amoblado", "Seguridad 24h", "Accesibilidad", "Acepta mascotas"]}
]'::jsonb
where slug = 'alquileres';

-- 4) Backfill: los avisos existentes (eran todos alquileres) toman una Operación
--    derivada de la vieja "modalidad", para que no queden sin ese campo nuevo.
update public.listings l
set structured_fields = l.structured_fields
  || jsonb_build_object('operacion',
       case when l.structured_fields ->> 'modalidad' = 'Alquiler temporario'
            then 'Alquiler temporario' else 'Alquilar' end)
where l.category_id = (select id from public.categories where slug = 'alquileres')
  and (l.structured_fields ->> 'operacion') is null;


-- ============================================================
-- 00035_auction_min_increment
-- ============================================================
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


-- ============================================================
-- 00036_payment_methods
-- ============================================================
-- 00036 — Medios de pago: opciones → Efectivo / Transferencia / Tarjeta.
--
-- El campo `formas_de_pago` (multiselect) está en los required_fields de (casi)
-- todas las categorías (seed 00001 + 00018). Reemplaza sus opciones en cada
-- categoría que lo tenga, sin tocar los demás campos. Idempotente.
--
-- Nota: las publicaciones ya creadas conservan el valor que guardaron (ej.
-- "Mercado Pago"); el cambio aplica a las nuevas y a los chips del filtro.

update public.categories
set required_fields = (
  select jsonb_agg(
    case
      when elem->>'key' = 'formas_de_pago'
      then jsonb_set(elem, '{options}', '["Efectivo", "Transferencia", "Tarjeta"]'::jsonb)
      else elem
    end
  )
  from jsonb_array_elements(required_fields) elem
)
where required_fields @> '[{"key": "formas_de_pago"}]';


-- ============================================================
-- 00037_terms_accepted
-- ============================================================
-- 00037 — Aceptación de Términos y Condiciones.
-- profiles.terms_accepted_at: cuándo el usuario aceptó los T&C. Mientras sea
-- null, la app muestra el modal de T&C bloqueante en el primer ingreso.
-- (Usamos `profiles`, la tabla de usuario de la app — no `users`.)

alter table public.profiles add column if not exists terms_accepted_at timestamptz;


-- ============================================================
-- 00038_account_restricted
-- ============================================================
-- 00038 — Cuentas restringidas (verificación de edad por Didit).
--
-- Didit NO aprueba la verificación a menores de 18 (la edad la valida Didit, no
-- guardamos fecha de nacimiento → privacidad). Si un usuario intenta verificarse
-- y Didit lo rechaza por edad, el webhook marca la cuenta como restringida: puede
-- registrarse y navegar, pero NO puede publicar, ofertar ni iniciar compras.
--
-- account_restricted lo lee el front para bloquear esas acciones. is_minor queda
-- como marca informativa. No guardamos birth_date.

alter table public.profiles add column if not exists is_minor boolean not null default false;
alter table public.profiles add column if not exists account_restricted boolean not null default false;


-- ============================================================
-- 00039_scoring_trigger
-- ============================================================
-- 00039 — Scores por TRIGGER (no dependen de pg_cron).
--
-- Problema: recalculate_scores() (00001) solo corría por el cron diario
-- `recalculate-scores`, envuelto en `if pg_cron`. Sin pg_cron, los scores NUNCA
-- se calculan → todos quedan "Usuario nuevo" → el diferenciador (reputación) no
-- existe. Y aun con cron, se actualizan 1 vez por día.
--
-- Solución: recalcular el score de un usuario EN EL MOMENTO en que una
-- calificación suya se vuelve visible (trigger). El cron sigue existiendo como
-- respaldo (y para el revelado a 14 días), pero ya no es imprescindible.
--
-- Detalle fino: recalculate_scores() corría sin auth.uid() (cron) → el trigger
-- protect_profile_columns (00001) dejaba pasar el update. Desde un trigger de
-- calificación, auth.uid() es el usuario que califica → protect pisaría el
-- score. Se resuelve con un flag de sesión `dealr.scoring` que protect respeta.

-- 1) protect_profile_columns: dejar pasar el recálculo interno de scores.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  -- Recálculo interno de scores (marcado con el flag de sesión): permitido.
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
  end if;
  return new;
end;
$$;

-- 2) Recalcular el score de UN usuario (misma fórmula que recalculate_scores).
create or replace function public.recalculate_scores_for(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  s_cnt int;
  s_avg numeric;
  s_rate numeric;
  b_cnt int;
  b_avg numeric;
begin
  perform set_config('dealr.scoring', '1', true); -- permite tocar los scores

  select count(*), avg(stars) into s_cnt, s_avg
  from public.ratings
  where rated_id = p_user and role = 'rated_as_seller' and visible;

  select count(*) filter (where q.answer_body is not null)::numeric / nullif(count(*), 0)
  into s_rate
  from public.questions q
  join public.listings l on l.id = q.listing_id
  where l.seller_id = p_user;

  update public.profiles p
  set seller_ratings_count = coalesce(s_cnt, 0),
      seller_score = case
        when coalesce(s_cnt, 0) >= 3 then round(least(5, s_avg * (0.85 + 0.15 * coalesce(s_rate, 1))), 2)
        else null
      end
  where p.id = p_user;

  select count(*), avg(stars) into b_cnt, b_avg
  from public.ratings
  where rated_id = p_user and role = 'rated_as_buyer' and visible;

  update public.profiles p
  set buyer_ratings_count = coalesce(b_cnt, 0),
      buyer_score = case when coalesce(b_cnt, 0) >= 3 then round(b_avg, 2) else null end
  where p.id = p_user;
end;
$$;

-- 3) Trigger: al volverse visible una calificación, recalcular al calificado.
create or replace function public.on_rating_visible()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.visible and (tg_op = 'INSERT' or old.visible is distinct from new.visible) then
    perform public.recalculate_scores_for(new.rated_id);
  end if;
  return new;
end;
$$;

drop trigger if exists on_rating_visible_recalc on public.ratings;
create trigger on_rating_visible_recalc
  after insert or update on public.ratings
  for each row execute function public.on_rating_visible();


-- ============================================================
-- 00040_geo_index
-- ============================================================
-- 00040 — Índice geoespacial para el descubrimiento por cercanía.
--
-- Hoy el ranking por distancia (recommended_listings, 00026) hace Haversine por
-- fila sin índice, y el filtro "Cerca" es client-side sobre la 1ª página. Esto
-- deja lista la infraestructura para consultas por radio aceleradas por índice:
-- extensiones cube + earthdistance y un índice GiST sobre la ubicación.
--
-- Con esto, una consulta por radio puede podar con earth_box(...) usando el
-- índice, en vez de escanear todas las publicaciones activas.

create extension if not exists cube;
create extension if not exists earthdistance;

-- Índice GiST sobre el punto (ll_to_earth es immutable → indexable). Solo filas
-- con coordenadas.
create index if not exists idx_listings_earth
  on public.listings using gist (ll_to_earth(lat, lng))
  where lat is not null and lng is not null;

-- RPC opcional: publicaciones activas dentro de un radio (km), ordenadas por
-- cercanía, aceleradas por el índice (earth_box poda; earth_distance ordena).
-- Devuelve setof listings para poder consumirla con el mismo embed del feed.
create or replace function public.listings_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision,
  p_limit int default 24,
  p_offset int default 0
)
returns setof public.listings
language sql stable security definer set search_path = public
as $$
  select l.*
  from public.listings l
  where l.status = 'active'
    and l.lat is not null
    and l.lng is not null
    and earth_box(ll_to_earth(p_lat, p_lng), p_radius_km * 1000) @> ll_to_earth(l.lat, l.lng)
    and earth_distance(ll_to_earth(p_lat, p_lng), ll_to_earth(l.lat, l.lng)) <= p_radius_km * 1000
  order by earth_distance(ll_to_earth(p_lat, p_lng), ll_to_earth(l.lat, l.lng)) asc
  limit p_limit offset p_offset;
$$;
grant execute on function public.listings_near(double precision, double precision, double precision, int, int) to anon, authenticated;

