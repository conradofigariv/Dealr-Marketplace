-- ==============================================================
-- apply_pending.sql — TODAS las migraciones pendientes en orden.
-- Pegar entero en Supabase → SQL Editor y correr. Idempotente.
-- Incluye lo que NO está en apply_all.sql (00008–00029): 00025 + 00030→00049.
-- Después correr supabase/health_check.sql para confirmar OK.
-- OJO: 00025 debe ir antes que 00033/00035, y 00041 después de ambas
-- (todas reescriben place_bid) — ya ordenado así.
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



-- ============================================================
-- 00041_security_hardening
-- ============================================================
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


-- ============================================================
-- 00042_inmuebles_campos_faltantes
-- ============================================================
-- =============================================================
-- 00042 — Inmuebles: campos faltantes (auditoría final de categorías)
--
-- 1) "Superficie total (m²)": la columna generada `inmueble_sup` existe desde
--    00022 (lee structured_fields->>'superficie_m2'), pero la reescritura de
--    00034 dejó solo "superficie cubierta" y la key `superficie_m2` desapareció
--    → columna huérfana y sin filtro de superficie total. Se agrega el campo
--    (con slider que usa esa columna), insertado justo después de la cubierta.
--
-- 2) "Formas de pago": Inmuebles quedó como la ÚNICA categoría sin el campo
--    común (la reescritura de 00034 no lo incluyó y 00036 solo actualizaba a
--    quien ya lo tenía). Se agrega al final, igual que en el resto (multiselect
--    Efectivo/Transferencia/Tarjeta). "Acepta envío" NO se agrega a propósito:
--    no tiene sentido para una propiedad.
--
-- Idempotente (chequea contención por key antes de tocar).
-- =============================================================

-- 1) Superficie total, insertada después de superficie_cubierta_m2 (posición
--    calculada dinámicamente para no depender del orden exacto del array).
do $$
declare
  rf jsonb;
  pos int;
  nuevo jsonb := '{
    "key": "superficie_m2",
    "label": "Superficie total (m²)",
    "type": "text",
    "required": false,
    "filterSlider": {"column": "inmueble_sup", "min": 0, "max": 1000, "step": 25, "unit": "m²", "bound": "min"}
  }'::jsonb;
begin
  select required_fields into rf from public.categories where slug = 'alquileres';
  if rf is null or rf @> '[{"key": "superficie_m2"}]'::jsonb then
    return; -- no existe la categoría o el campo ya está
  end if;

  -- índice (0-based) del campo superficie_cubierta_m2; insertar después.
  select t.ord into pos
  from jsonb_array_elements(rf) with ordinality as t(el, ord)
  where t.el->>'key' = 'superficie_cubierta_m2';

  if pos is not null then
    -- ordinality es 1-based → el índice jsonb del siguiente elemento es `pos`.
    update public.categories
    set required_fields = jsonb_insert(required_fields, array[pos::text], nuevo)
    where slug = 'alquileres';
  else
    update public.categories
    set required_fields = required_fields || jsonb_build_array(nuevo)
    where slug = 'alquileres';
  end if;
end;
$$;

-- 2) Formas de pago (mismo shape que el común de 00001), al final del array.
update public.categories
set required_fields = required_fields || '[{
  "key": "formas_de_pago",
  "label": "Formas de pago",
  "type": "multiselect",
  "required": true,
  "options": ["Efectivo", "Transferencia", "Tarjeta"]
}]'::jsonb
where slug = 'alquileres'
  and not required_fields @> '[{"key": "formas_de_pago"}]'::jsonb;


-- ============================================================
-- 00043_saved_search_filters
-- ============================================================
-- =============================================================
-- 00043 — Búsquedas guardadas: persistir los filtros de categoría.
--
-- Antes, "Guardar búsqueda con alerta" solo guardaba término/categoría/precio/
-- condición: los filtros finos (campos select/boolean, rangos numéricos y
-- multiselect de amenities) se DESCARTABAN en silencio, y la alerta de
-- publicación nueva tampoco los consideraba. Ahora se guardan y el trigger de
-- matching los aplica con la misma semántica que el feed:
--   fields       {key: valor}                  → igualdad sobre structured_fields->>key
--   field_ranges {key: {column, min, max}}     → rango numérico (num_from_text
--                                                 sobre la key, la MISMA función
--                                                 de las columnas generadas)
--   multi        {key: [opciones]}             → contención (todas las elegidas)
--
-- El radio de distancia NO se persiste: es relativo a la ubicación del
-- comprador en el momento (client-side), no un atributo de la búsqueda.
--
-- Requiere 00022 (num_from_text). Idempotente.
-- =============================================================

alter table public.saved_searches
  add column if not exists fields jsonb,
  add column if not exists field_ranges jsonb,
  add column if not exists multi jsonb;

create or replace function public.notify_saved_search_matches()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select s.user_id, 'saved_search', 'Nueva publicación para tu búsqueda', new.title, '/p/' || new.id
  from public.saved_searches s
  where s.user_id <> new.seller_id
    and (s.category_id is null or s.category_id = new.category_id)
    and (s.query is null or new.title ilike '%' || s.query || '%' or new.description ilike '%' || s.query || '%')
    -- currency y condition son enums: hay que castear a text para comparar
    -- contra las columnas de texto de saved_searches.
    and (s.currency is null or new.currency::text = s.currency)
    and (s.min_price is null or new.price >= s.min_price)
    and (s.max_price is null or new.price <= s.max_price)
    and (s.conditions is null or array_length(s.conditions, 1) is null or new.condition::text = any (s.conditions))
    -- Campos por igualdad: TODOS los pares guardados tienen que coincidir.
    and (s.fields is null or not exists (
      select 1 from jsonb_each_text(s.fields) f(k, v)
      where new.structured_fields->>f.k is distinct from f.v
    ))
    -- Rangos numéricos: el valor del aviso (parseado con num_from_text, igual
    -- que las columnas generadas) tiene que caer dentro de todos los rangos.
    -- Un aviso SIN el campo no matchea un rango (igual que el feed).
    and (s.field_ranges is null or not exists (
      select 1 from jsonb_each(s.field_ranges) r(k, spec)
      where (
        nullif(spec->>'min', '') is not null
        and coalesce(public.num_from_text(new.structured_fields->>r.k), -1) < (spec->>'min')::numeric
      ) or (
        nullif(spec->>'max', '') is not null
        and (
          public.num_from_text(new.structured_fields->>r.k) is null
          or public.num_from_text(new.structured_fields->>r.k) > (spec->>'max')::numeric
        )
      )
    ))
    -- Multiselect: el aviso tiene que contener TODAS las opciones elegidas
    -- (misma contención @> que usa el feed, aprovecha el GIN de 00034).
    and (s.multi is null or not exists (
      select 1 from jsonb_each(s.multi) m(k, opts)
      where jsonb_array_length(opts) > 0
        and not (new.structured_fields @> jsonb_build_object(m.k, opts))
    ));
  return null;
end;
$$;


-- ============================================================
-- 00044_admin_metrics
-- ============================================================
-- =============================================================
-- 00044 — Panel de métricas del admin (funnel de adquisición).
--
-- 1) `site_visits`: visitas ANÓNIMAS a la app. La DB no se enteraba de los
--    visitantes sin cuenta (eso vivía solo en PostHog); esta tabla registra
--    un visitante por día con una clave aleatoria de localStorage (uuid, sin
--    ningún dato personal). El front llama `track_visit` al abrir la app
--    (una vez por día por dispositivo; el PK dedupea igual).
--
-- 2) RPC `admin_metrics()`: agregados para el panel /admin, solo para admins
--    (guard is_admin() de 00024). Funnel: visitas → registros → vieron
--    producto → iniciaron chat → publicaron.
--
-- Nota: como toda métrica client-side, un malicioso podría inflar visitas
-- llamando al RPC con claves inventadas. Para un panel interno alcanza; si
-- algún día importa, se filtra por IP/rate en un edge.
-- Idempotente.
-- =============================================================

create table if not exists public.site_visits (
  visitor_key text not null,
  day date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (visitor_key, day)
);

alter table public.site_visits enable row level security;

-- Nadie lee la tabla directo salvo el admin (los agregados van por RPC).
drop policy if exists "solo admin lee visitas" on public.site_visits;
create policy "solo admin lee visitas" on public.site_visits
  for select using (public.is_admin());

-- El insert va SOLO por el RPC (security definer); sin policy de insert.
revoke all on table public.site_visits from anon, authenticated;
grant select on table public.site_visits to authenticated;

-- Registrar visita: anónimo o logueado. p_key es un uuid generado por el
-- cliente (localStorage) — el tipo uuid valida el formato solo.
create or replace function public.track_visit(p_key uuid)
returns void
language sql
security definer set search_path = public
as $$
  insert into public.site_visits (visitor_key, day)
  values (p_key::text, current_date)
  on conflict do nothing;
$$;
grant execute on function public.track_visit(uuid) to anon, authenticated;

-- Métricas agregadas para el panel (solo admins).
create or replace function public.admin_metrics()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo para administradores';
  end if;

  return jsonb_build_object(
    -- Visitas (dispositivos únicos)
    'visitors_today', (select count(*) from public.site_visits where day = current_date),
    'visitors_7d',    (select count(distinct visitor_key) from public.site_visits where day > current_date - 7),
    'visitors_total', (select count(distinct visitor_key) from public.site_visits),
    -- Registros
    'users_today', (select count(*) from public.profiles where created_at >= current_date),
    'users_7d',    (select count(*) from public.profiles where created_at >= current_date - 7),
    'users_total', (select count(*) from public.profiles),
    -- Vieron al menos un producto (solo logueados: listing_views los registra así)
    'viewers_7d',    (select count(distinct viewer_id) from public.listing_views where created_at >= now() - interval '7 days'),
    'viewers_total', (select count(distinct viewer_id) from public.listing_views),
    -- Iniciaron un chat de compra
    'buyers_7d',    (select count(distinct buyer_id) from public.conversations where created_at >= now() - interval '7 days' and kind is distinct from 'welcome'),
    'buyers_total', (select count(distinct buyer_id) from public.conversations where kind is distinct from 'welcome'),
    -- Publicaron algo
    'sellers_7d',    (select count(distinct seller_id) from public.listings where created_at >= now() - interval '7 days'),
    'sellers_total', (select count(distinct seller_id) from public.listings),
    -- Inventario
    'listings_active', (select count(*) from public.listings where status = 'active'),
    'listings_total',  (select count(*) from public.listings)
  );
end;
$$;
grant execute on function public.admin_metrics() to authenticated;


-- ============================================================
-- 00045_auction_bid_history
-- ============================================================
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


-- ============================================================
-- 00046_admin_auction_disputes
-- ============================================================
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


-- ============================================================
-- 00047_google_avatar
-- ============================================================
-- =============================================================
-- 00047 — Avatar por defecto de Google al registrarse.
--
-- Cuando alguien entra con Google, Supabase guarda la foto de su cuenta en
-- `raw_user_meta_data` (`avatar_url` o `picture`). `handle_new_user` no la
-- usaba → los usuarios de Google quedaban con la inicial gris. Ahora el
-- trigger la copia a `profiles.avatar_url` al crear la cuenta.
--
-- OJO: `avatar_url` normalmente guarda una RUTA de Storage (la foto subida a
-- mano); acá guarda una URL absoluta de Google. El front (`photoUrl`) deja
-- pasar las URLs absolutas tal cual y solo resuelve al bucket las rutas — así
-- conviven ambos casos. Si el usuario sube su propia foto después, pisa la de
-- Google con una ruta de Storage normal. Idempotente.
-- =============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, phone_verified, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      'usuario_' || substr(new.id::text, 1, 8)
    ),
    new.phone_confirmed_at is not null,
    -- Foto de Google (avatar_url o picture); null si no vino de un proveedor.
    nullif(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'), '')
  );
  return new;
end;
$$;

-- Backfill: usuarios de Google ya registrados que quedaron sin avatar.
update public.profiles p
set avatar_url = nullif(coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'), '')
from auth.users u
where u.id = p.id
  and p.avatar_url is null
  and coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') is not null;


-- ============================================================
-- 00048_bidder_sees_listing
-- ============================================================
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


-- ============================================================
-- 00049_account_deletion
-- ============================================================
-- =============================================================
-- 00049 — Eliminar cuenta (anonimizar, no borrado destructivo).
--
-- Los Términos ya prometían esto ("baja de cuenta desde la configuración del
-- perfil") pero no existía. Se ANONIMIZA en vez de borrar de verdad: un
-- borrado real de auth.users dispara cascadas que se llevan puesto el
-- historial de OTROS usuarios (mensajes propios en cualquier chat,
-- calificaciones del par, etc. — el mismo motivo por el que 00027 cambió el
-- borrado de listings a `set null` en vez de cascade). Acá: se scrubea la
-- info personal del perfil, se pausan sus publicaciones activas, se lo banea
-- de auth (no puede volver a entrar) y el resto de su historial (chats,
-- calificaciones, ventas) queda intacto para la otra parte.
--
-- El baneo real (auth.users.banned_until) y la limpieza se hacen desde la
-- Edge Function `delete-account` (service role: auth.admin.updateUserById
-- para banear + el resto de las escrituras vía el cliente admin, que
-- bypasea RLS y protect_profile_columns porque auth.uid() es null en ese
-- contexto). Esta migración solo prepara la tabla de motivos + las métricas
-- de admin. Idempotente.
-- =============================================================

create table if not exists public.account_deletions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  reason text not null,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.account_deletions enable row level security;

-- Solo el admin lee (los inserts van por la Edge Function, service role,
-- que bypasea RLS — sin policy de insert a propósito).
drop policy if exists "solo admin lee bajas" on public.account_deletions;
create policy "solo admin lee bajas" on public.account_deletions
  for select using (public.is_admin());

revoke all on table public.account_deletions from anon, authenticated;
grant select on table public.account_deletions to authenticated;

-- Métricas: suma bajas de cuenta al panel existente (00044).
create or replace function public.admin_metrics()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo para administradores';
  end if;

  return jsonb_build_object(
    -- Visitas (dispositivos únicos)
    'visitors_today', (select count(*) from public.site_visits where day = current_date),
    'visitors_7d',    (select count(distinct visitor_key) from public.site_visits where day > current_date - 7),
    'visitors_total', (select count(distinct visitor_key) from public.site_visits),
    -- Registros
    'users_today', (select count(*) from public.profiles where created_at >= current_date),
    'users_7d',    (select count(*) from public.profiles where created_at >= current_date - 7),
    'users_total', (select count(*) from public.profiles),
    -- Vieron al menos un producto (solo logueados: listing_views los registra así)
    'viewers_7d',    (select count(distinct viewer_id) from public.listing_views where created_at >= now() - interval '7 days'),
    'viewers_total', (select count(distinct viewer_id) from public.listing_views),
    -- Iniciaron un chat de compra
    'buyers_7d',    (select count(distinct buyer_id) from public.conversations where created_at >= now() - interval '7 days' and kind is distinct from 'welcome'),
    'buyers_total', (select count(distinct buyer_id) from public.conversations where kind is distinct from 'welcome'),
    -- Publicaron algo
    'sellers_7d',    (select count(distinct seller_id) from public.listings where created_at >= now() - interval '7 days'),
    'sellers_total', (select count(distinct seller_id) from public.listings),
    -- Inventario
    'listings_active', (select count(*) from public.listings where status = 'active'),
    'listings_total',  (select count(*) from public.listings),
    -- Bajas de cuenta (00049)
    'deletions_7d',    (select count(*) from public.account_deletions where created_at >= now() - interval '7 days'),
    'deletions_total',  (select count(*) from public.account_deletions)
  );
end;
$$;

-- Desglose de motivos de baja (solo admin), para ver de un vistazo por qué
-- se va la gente.
create or replace function public.admin_deletion_reasons()
returns table (reason text, total bigint)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo para administradores';
  end if;
  return query
  select d.reason, count(*) as total
  from public.account_deletions d
  group by d.reason
  order by total desc;
end;
$$;
grant execute on function public.admin_deletion_reasons() to authenticated;
