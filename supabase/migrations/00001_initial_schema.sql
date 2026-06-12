-- =============================================================
-- Dealr — esquema inicial
-- Marketplace de usados (Córdoba, AR). Transacciones fuera de la
-- plataforma; Dealr conecta, no procesa pagos.
-- =============================================================

-- ---------- Enums ----------
create type listing_condition as enum ('nuevo', 'como_nuevo', 'buen_estado', 'con_detalles');
create type listing_status as enum ('active', 'paused', 'sold', 'expired');
create type listing_currency as enum ('ARS', 'USD');
create type offer_status as enum ('pending', 'accepted', 'rejected', 'expired');
create type rating_role as enum ('rated_as_seller', 'rated_as_buyer');
create type report_target as enum ('question', 'listing', 'user');

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 30),
  avatar_url text,
  phone_verified boolean not null default false,
  identity_verified boolean not null default false,
  identity_verified_at timestamptz,
  didit_session_id text,
  seller_score numeric(3, 2),
  buyer_score numeric(3, 2),
  seller_ratings_count integer not null default 0,
  buyer_ratings_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- Crea el perfil al registrarse. Username provisorio derivado del id;
-- el usuario lo edita después.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, phone_verified)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      'usuario_' || substr(new.id::text, 1, 8)
    ),
    new.phone_confirmed_at is not null
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mantiene phone_verified en sync con la confirmación de Supabase Auth.
create or replace function public.sync_phone_verified()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.phone_confirmed_at is not null and old.phone_confirmed_at is null then
    update public.profiles set phone_verified = true where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_phone_confirmed
  after update on auth.users
  for each row execute function public.sync_phone_verified();

-- ---------- categories ----------
create table public.categories (
  id serial primary key,
  name text not null,
  slug text not null unique,
  parent_id integer references public.categories (id),
  -- Definición de campos estructurados obligatorios al publicar:
  -- [{ "key", "label", "type": "text|boolean|select|multiselect", "required", "options"? }]
  required_fields jsonb not null default '[]'::jsonb
);

-- ---------- listings ----------
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 4 and 80),
  description text not null default '',
  price numeric(12, 2) not null check (price >= 0),
  currency listing_currency not null default 'ARS',
  category_id integer not null references public.categories (id),
  condition listing_condition not null,
  structured_fields jsonb not null default '{}'::jsonb,
  status listing_status not null default 'active',
  verified boolean not null default false, -- verificación de producto (fase 2)
  photos text[] not null default '{}' check (array_length(photos, 1) is null or array_length(photos, 1) <= 6),
  created_at timestamptz not null default now(),
  last_renewed_at timestamptz not null default now()
);

create index listings_feed_idx on public.listings (status, last_renewed_at desc);
create index listings_category_idx on public.listings (category_id) where status = 'active';
create index listings_seller_idx on public.listings (seller_id);

-- Pausa automática: 30 días sin renovar saca la publicación del feed.
-- Programar con pg_cron (ver bloque al final) o Edge Function con cron.
create or replace function public.pause_stale_listings()
returns void
language sql
security definer set search_path = public
as $$
  update public.listings
  set status = 'paused'
  where status = 'active'
    and last_renewed_at < now() - interval '30 days';
$$;

-- ---------- questions ----------
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  asker_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  answer_body text,
  answered_at timestamptz,
  -- REGLA CLAVE: solo se hace pública cuando el vendedor responde.
  is_public boolean not null default false,
  reports_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index questions_listing_idx on public.questions (listing_id, created_at desc);

-- Al responder, la pregunta se publica automáticamente.
create or replace function public.publish_answered_question()
returns trigger
language plpgsql
as $$
begin
  if new.answer_body is not null and old.answer_body is distinct from new.answer_body then
    new.answered_at := now();
    new.is_public := true;
  end if;
  return new;
end;
$$;

create trigger on_question_answered
  before update on public.questions
  for each row execute function public.publish_answered_question();

-- ---------- conversations / messages ----------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (listing_id, buyer_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger on_message_sent
  after insert on public.messages
  for each row execute function public.touch_conversation();

-- ---------- offers ----------
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  status offer_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index offers_listing_idx on public.offers (listing_id, created_at desc);

-- ---------- ratings (bidireccionales y ciegas) ----------
create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  rater_id uuid not null references public.profiles (id) on delete cascade,
  rated_id uuid not null references public.profiles (id) on delete cascade,
  role rating_role not null,
  stars integer not null check (stars between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  visible boolean not null default false,
  created_at timestamptz not null default now(),
  unique (conversation_id, rater_id)
);

-- Solo se puede calificar si la conversación tuvo profundidad mínima:
-- 4+ mensajes en total y al menos uno de cada parte. Mitiga gaming.
create or replace function public.can_rate_conversation(conv_id uuid, rater uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = conv_id
      and rater in (c.buyer_id, c.seller_id)
      and (select count(*) from public.messages m where m.conversation_id = conv_id) >= 4
      and (select count(distinct m.sender_id) from public.messages m where m.conversation_id = conv_id) >= 2
  );
$$;

-- Calificación ciega: se revela cuando ambas partes calificaron.
-- El vencimiento a 14 días lo cubre reveal_expired_ratings() (cron).
create or replace function public.reveal_mutual_ratings()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.ratings r
    where r.conversation_id = new.conversation_id and r.rater_id = new.rated_id
  ) then
    update public.ratings
    set visible = true
    where conversation_id = new.conversation_id;
  end if;
  return new;
end;
$$;

create trigger on_rating_created
  after insert on public.ratings
  for each row execute function public.reveal_mutual_ratings();

create or replace function public.reveal_expired_ratings()
returns void
language sql
security definer set search_path = public
as $$
  update public.ratings
  set visible = true
  where visible = false
    and created_at < now() - interval '14 days';
$$;

-- ---------- reports ----------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type report_target not null,
  target_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 500),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);

-- 3+ reportes ocultan la pregunta pública automáticamente
-- (queda en cola de revisión manual: reports.resolved = false).
create or replace function public.handle_question_report()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.target_type = 'question' then
    update public.questions
    set reports_count = reports_count + 1,
        is_public = case when reports_count + 1 >= 3 then false else is_public end
    where id = new.target_id;
  end if;
  return new;
end;
$$;

create trigger on_report_created
  after insert on public.reports
  for each row execute function public.handle_question_report();

-- ---------- Cálculo de scores ----------
-- Job periódico. Señal principal: promedio de ratings visibles.
-- seller_score ajusta por tasa de respuesta a preguntas.
-- Los scores quedan NULL hasta acumular 3 calificaciones (arranque en frío).
create or replace function public.recalculate_scores()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  with seller_ratings as (
    select rated_id, avg(stars)::numeric as avg_stars, count(*) as cnt
    from public.ratings
    where role = 'rated_as_seller' and visible
    group by rated_id
  ),
  answer_rate as (
    select l.seller_id,
           count(*) filter (where q.answer_body is not null)::numeric / nullif(count(*), 0) as rate
    from public.questions q
    join public.listings l on l.id = q.listing_id
    group by l.seller_id
  )
  update public.profiles p
  set seller_ratings_count = coalesce(sr.cnt, 0),
      seller_score = case
        when coalesce(sr.cnt, 0) >= 3 then
          round(least(5, sr.avg_stars * (0.85 + 0.15 * coalesce(ar.rate, 1))), 2)
        else null
      end
  from seller_ratings sr
  left join answer_rate ar on ar.seller_id = sr.rated_id
  where p.id = sr.rated_id;

  with buyer_ratings as (
    select rated_id, avg(stars)::numeric as avg_stars, count(*) as cnt
    from public.ratings
    where role = 'rated_as_buyer' and visible
    group by rated_id
  )
  update public.profiles p
  set buyer_ratings_count = br.cnt,
      buyer_score = case when br.cnt >= 3 then round(br.avg_stars, 2) else null end
  from buyer_ratings br
  where p.id = br.rated_id;
end;
$$;

-- =============================================================
-- RLS
-- =============================================================
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.listings enable row level security;
alter table public.questions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.offers enable row level security;
alter table public.ratings enable row level security;
alter table public.reports enable row level security;

-- profiles: datos públicos legibles, edición solo propia
create policy "profiles legibles por todos" on public.profiles
  for select using (true);
create policy "perfil editable por el dueño" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Los campos de verificación y scores los escribe solo el backend
-- (service role, sin auth.uid()). Un usuario editando su perfil no
-- puede tocarlos: el trigger los pisa con el valor anterior.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
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

create trigger on_profile_updated
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- categories: lectura pública
create policy "categorias legibles por todos" on public.categories
  for select using (true);

-- listings: lectura pública de activas; el resto solo dueño o
-- participantes de una conversación sobre esa publicación.
create policy "listings activas legibles por todos" on public.listings
  for select using (
    status = 'active'
    or seller_id = auth.uid()
    or exists (
      select 1 from public.conversations c
      where c.listing_id = id and auth.uid() in (c.buyer_id, c.seller_id)
    )
  );
create policy "publicar requiere sesion" on public.listings
  for insert with check (auth.uid() = seller_id);
create policy "listing editable por el dueño" on public.listings
  for update using (auth.uid() = seller_id) with check (auth.uid() = seller_id);
create policy "listing borrable por el dueño" on public.listings
  for delete using (auth.uid() = seller_id);

-- questions: las no públicas solo las ven asker y seller
create policy "preguntas publicas o propias" on public.questions
  for select using (
    (is_public and reports_count < 3)
    or asker_id = auth.uid()
    or exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
  );
create policy "preguntar requiere sesion" on public.questions
  for insert with check (
    auth.uid() = asker_id
    and not exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
  );
create policy "responde solo el vendedor" on public.questions
  for update using (
    exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
  );

-- conversations: solo participantes
create policy "conversaciones de participantes" on public.conversations
  for select using (auth.uid() in (buyer_id, seller_id));
create policy "inicia el comprador" on public.conversations
  for insert with check (
    auth.uid() = buyer_id
    and buyer_id <> seller_id
    and exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = seller_id)
  );

-- messages: solo participantes de la conversación
create policy "mensajes de participantes" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
    )
  );
create policy "enviar como participante" on public.messages
  for insert with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
    )
  );
create policy "marcar leido el receptor" on public.messages
  for update using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
    )
  );

-- offers: comprador ve las suyas, vendedor las de sus publicaciones
create policy "ofertas visibles para las partes" on public.offers
  for select using (
    buyer_id = auth.uid()
    or exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
  );
create policy "ofertar requiere sesion" on public.offers
  for insert with check (
    auth.uid() = buyer_id
    and exists (select 1 from public.listings l where l.id = listing_id and l.status = 'active' and l.seller_id <> auth.uid())
  );
create policy "responde la oferta el vendedor" on public.offers
  for update using (
    exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
  );

-- ratings: invisibles hasta doble calificación o vencimiento;
-- el autor siempre ve la propia.
create policy "ratings visibles o propios" on public.ratings
  for select using (visible or rater_id = auth.uid());
create policy "calificar requiere conversacion real" on public.ratings
  for insert with check (
    auth.uid() = rater_id
    and rater_id <> rated_id
    and public.can_rate_conversation(conversation_id, auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and rated_id in (c.buyer_id, c.seller_id)
    )
  );

-- reports: solo crea el reportante; la revisión es por dashboard/service role
create policy "reportar requiere sesion" on public.reports
  for insert with check (auth.uid() = reporter_id);
create policy "reporter ve sus reportes" on public.reports
  for select using (auth.uid() = reporter_id);

-- =============================================================
-- Storage: bucket público para fotos de publicaciones
-- =============================================================
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

create policy "fotos legibles por todos" on storage.objects
  for select using (bucket_id = 'listing-photos');
create policy "subir fotos a carpeta propia" on storage.objects
  for insert with check (
    bucket_id = 'listing-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "borrar fotos propias" on storage.objects
  for delete using (
    bucket_id = 'listing-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- =============================================================
-- Seed: categorías con campos estructurados obligatorios
-- =============================================================
-- Campos comunes a todas las categorías (se definen por categoría para
-- poder ajustarlos individualmente):
-- zona, formas_de_pago, acepta_envio, motivo_venta
do $$
declare
  common jsonb := '[
    {"key": "zona", "label": "Zona", "type": "text", "required": true},
    {"key": "formas_de_pago", "label": "Formas de pago", "type": "multiselect", "required": true, "options": ["Efectivo", "Transferencia", "Mercado Pago"]},
    {"key": "acepta_envio", "label": "Acepta envío", "type": "boolean", "required": true},
    {"key": "motivo_venta", "label": "Motivo de venta", "type": "text", "required": false}
  ]'::jsonb;
begin
  insert into public.categories (name, slug, required_fields) values
    ('Celulares y Teléfonos', 'celulares', common || '[
      {"key": "marca", "label": "Marca", "type": "text", "required": true},
      {"key": "modelo", "label": "Modelo", "type": "text", "required": true},
      {"key": "almacenamiento", "label": "Almacenamiento", "type": "select", "required": true, "options": ["32 GB", "64 GB", "128 GB", "256 GB", "512 GB", "1 TB"]},
      {"key": "salud_bateria", "label": "Salud de batería (%)", "type": "text", "required": false}
    ]'::jsonb),
    ('Computación', 'computacion', common || '[
      {"key": "marca", "label": "Marca", "type": "text", "required": true},
      {"key": "modelo", "label": "Modelo", "type": "text", "required": true}
    ]'::jsonb),
    ('Electrónica, Audio y Video', 'electronica', common),
    ('Consolas y Videojuegos', 'consolas-videojuegos', common),
    ('Hogar y Muebles', 'hogar-muebles', common),
    ('Electrodomésticos', 'electrodomesticos', common),
    ('Ropa y Accesorios', 'ropa-accesorios', common || '[
      {"key": "talle", "label": "Talle", "type": "text", "required": true}
    ]'::jsonb),
    ('Deportes y Fitness', 'deportes-fitness', common),
    ('Bicicletas', 'bicicletas', common || '[
      {"key": "rodado", "label": "Rodado", "type": "text", "required": true}
    ]'::jsonb),
    ('Vehículos y Accesorios', 'vehiculos-accesorios', common),
    ('Bebés y Niños', 'bebes-ninos', common),
    ('Herramientas', 'herramientas', common),
    ('Instrumentos Musicales', 'instrumentos', common),
    ('Libros, Música y Películas', 'libros-musica', common),
    ('Otros', 'otros', common);
end $$;

-- =============================================================
-- Cron (requiere extensión pg_cron habilitada en el proyecto).
-- Si pg_cron no está disponible, programar estas funciones desde una
-- Edge Function con Scheduled Functions de Supabase.
-- =============================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('pause-stale-listings', '0 3 * * *', 'select public.pause_stale_listings()');
    perform cron.schedule('reveal-expired-ratings', '15 3 * * *', 'select public.reveal_expired_ratings()');
    perform cron.schedule('recalculate-scores', '30 3 * * *', 'select public.recalculate_scores()');
  end if;
end $$;
