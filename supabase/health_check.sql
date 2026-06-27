-- =============================================================
-- CHEQUEO INTEGRAL de la base de Dealr (solo lectura, no modifica nada).
-- Pegar entero en Supabase → SQL Editor y correr. Devuelve filas agrupadas por
-- categoría con estado OK / FALTA / REVISAR. Es más completo que
-- verify_migrations.sql: además de migraciones chequea Realtime, RLS y que el
-- contenido de place_bid tenga el anti-snipe y el ban.
-- =============================================================

with checks(categoria, item, ok) as (
  values
    -- ---------- Migraciones (objetos clave) ----------
    ('Migración', '00009 listings.lat',
      (exists (select 1 from information_schema.columns where table_schema='public' and table_name='listings' and column_name='lat'))),
    ('Migración', '00010 listings.favorites_count',
      (exists (select 1 from information_schema.columns where table_schema='public' and table_name='listings' and column_name='favorites_count'))),
    ('Migración', '00011 tabla saved_searches',
      (to_regclass('public.saved_searches') is not null)),
    ('Migración', '00012 listing_status=reserved',
      (exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='listing_status' and e.enumlabel='reserved'))),
    ('Migración', '00014 RPC conversation_previews',
      (exists (select 1 from pg_proc where proname='conversation_previews'))),
    ('Migración', '00017 listings.is_auction',
      (exists (select 1 from information_schema.columns where table_schema='public' and table_name='listings' and column_name='is_auction'))),
    ('Migración', '00017 tabla bids',
      (to_regclass('public.bids') is not null)),
    ('Migración', '00019 tabla push_subscriptions',
      (to_regclass('public.push_subscriptions') is not null)),
    ('Migración', '00022 listings.veh_anio (generada)',
      (exists (select 1 from information_schema.columns where table_schema='public' and table_name='listings' and column_name='veh_anio'))),
    ('Migración', '00023 notifications.actor_id',
      (exists (select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='actor_id'))),
    ('Migración', '00024 profiles.is_admin',
      (exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_admin'))),
    ('Migración', '00024 función is_admin()',
      (exists (select 1 from pg_proc where proname='is_admin'))),
    ('Migración', '00025 profiles.auction_strikes',
      (exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='auction_strikes'))),
    ('Migración', '00025 listings.buyer_confirmed_pickup',
      (exists (select 1 from information_schema.columns where table_schema='public' and table_name='listings' and column_name='buyer_confirmed_pickup'))),
    ('Migración', '00025 RPC confirm_auction_pickup',
      (exists (select 1 from pg_proc where proname='confirm_auction_pickup'))),
    ('Migración', '00025 RPC report_auction_no_show',
      (exists (select 1 from pg_proc where proname='report_auction_no_show'))),
    ('Migración', '00026 RPC recommended_listings',
      (exists (select 1 from pg_proc where proname='recommended_listings'))),
    ('Migración', '00027 conversations.listing_id nullable',
      (exists (select 1 from information_schema.columns where table_schema='public' and table_name='conversations' and column_name='listing_id' and is_nullable='YES'))),
    ('Migración', '00029 report_target=support',
      (exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='report_target' and e.enumlabel='support'))),
    ('Migración', '00030 conversations.kind',
      (exists (select 1 from information_schema.columns where table_schema='public' and table_name='conversations' and column_name='kind'))),
    ('Migración', '00030 RPC send_welcome_dm',
      (exists (select 1 from pg_proc where proname='send_welcome_dm'))),
    ('Migración', '00031 tabla signup_surveys',
      (to_regclass('public.signup_surveys') is not null)),
    ('Migración', '00032 trigger on_question_notify',
      (exists (select 1 from pg_trigger where tgname='on_question_notify'))),
    ('Migración', '00032 función notify_new_question',
      (exists (select 1 from pg_proc where proname='notify_new_question'))),

    -- ---------- Contenido de funciones (confirma 00025/00033 aplicadas) ----------
    ('Subastas', '00025 place_bid chequea ban',
      (exists (select 1 from pg_proc where proname='place_bid' and pg_get_functiondef(oid) like '%auction_banned_until%'))),
    ('Subastas', '00033 place_bid tiene anti-snipe (+30s)',
      (exists (select 1 from pg_proc where proname='place_bid' and pg_get_functiondef(oid) like '%30 seconds%'))),

    -- ---------- Realtime: tablas en la publicación supabase_realtime ----------
    ('Realtime', 'replicación: messages',
      (exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages'))),
    ('Realtime', 'replicación: notifications',
      (exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications'))),
    ('Realtime', 'replicación: listings (subastas en vivo)',
      (exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='listings'))),

    -- ---------- RLS habilitado en tablas sensibles ----------
    ('RLS', 'listings',
      (select coalesce(bool_or(relrowsecurity), false) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='listings')),
    ('RLS', 'profiles',
      (select coalesce(bool_or(relrowsecurity), false) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='profiles')),
    ('RLS', 'messages',
      (select coalesce(bool_or(relrowsecurity), false) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='messages')),
    ('RLS', 'conversations',
      (select coalesce(bool_or(relrowsecurity), false) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='conversations')),
    ('RLS', 'bids',
      (select coalesce(bool_or(relrowsecurity), false) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='bids')),
    ('RLS', 'notifications',
      (select coalesce(bool_or(relrowsecurity), false) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='notifications')),
    ('RLS', 'favorites',
      (select coalesce(bool_or(relrowsecurity), false) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='favorites')),
    ('RLS', 'reports',
      (select coalesce(bool_or(relrowsecurity), false) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='reports'))
)
select categoria,
       item,
       case when ok then 'OK' else 'FALTA' end as estado
from checks
order by
  case categoria
    when 'Migración' then 1 when 'Subastas' then 2
    when 'Realtime' then 3 when 'RLS' then 4 else 5
  end,
  item;
