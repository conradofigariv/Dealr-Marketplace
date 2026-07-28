-- =============================================================
-- 00052 — Lifecycle emails (remarketing), arranque acotado por poco inventario.
--
-- Con pocos productos, mandar "recomendado para vos" por mail sería mostrar
-- una oferta pobre y quemar el canal. Este arranque NO recomienda productos:
--
--   1. search_logs: registra lo que la gente busca en el feed (término +
--      categoría + cuántos resultados dio). Sirve de a poco para dos cosas:
--      contenido futuro ("esta semana buscaron X y no había") y, sobre todo,
--      saber qué oferta conseguir con el concierge (admin-create-seller).
--   2. Mail de stats al vendedor (día ~3 de una publicación activa): "tu
--      publicación tuvo N vistas y M guardados". Es el único mail de
--      retención que hoy tenemos con contenido siempre real y verdadero, y
--      alimenta el lado de la oferta (vendedor motivado a mantener/ajustar
--      su publicación) en vez de fingir que hay más productos de los que hay.
--
-- Piezas nuevas:
--   - search_logs (tabla, RLS propia).
--   - email_sends: log de envíos por usuario+campaña (evita repetir/saturar);
--     solo la tocan las Edge Functions (service_role) — sin policies para
--     anon/authenticated, RLS la bloquea por completo salvo service_role.
--   - profiles.email_marketing: opt-out de mails de retención/remarketing
--     (el digest transaccional de 00051 no lo consulta — notificaciones que
--     ya generó el propio usuario no son "marketing").
--   - RPC seller_stats_queue(): publicaciones activas de hace 3-4 días, con
--     vistas/favoritos, que no recibieron ya el mail de stats, de vendedores
--     que no optaron por salir. Security definer (lee auth.users), gateada a
--     service_role (expone emails).
--
-- Idempotente.
-- =============================================================

-- Búsquedas del feed: qué se busca y si encontró algo. user_id null = anónimo.
create table if not exists public.search_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  term text not null,
  category_slug text,
  results_count int not null,
  created_at timestamptz not null default now()
);
create index if not exists search_logs_created_at_idx on public.search_logs (created_at desc);

alter table public.search_logs enable row level security;

drop policy if exists "insertar propia busqueda" on public.search_logs;
create policy "insertar propia busqueda" on public.search_logs
  for insert to authenticated, anon
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "admin lee busquedas" on public.search_logs;
create policy "admin lee busquedas" on public.search_logs
  for select using (is_admin());

-- Log de envíos de mails de ciclo de vida (idempotencia + no saturar). Solo
-- service_role la toca (Edge Functions) — sin policies, RLS bloquea al resto.
create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  campaign text not null,
  ref_id uuid,
  sent_at timestamptz not null default now(),
  unique (user_id, campaign, ref_id)
);
alter table public.email_sends enable row level security;

-- Opt-out de mails de retención/remarketing (no afecta al digest de 00051,
-- que son notificaciones que el propio usuario generó, no marketing).
alter table public.profiles
  add column if not exists email_marketing boolean not null default true;

-- Cola del mail de stats al vendedor: publicaciones activas de 3-4 días,
-- con email, sin opt-out, que no recibieron ya este mail para esa publicación.
-- La ventana de 1 día evita que el cron la vuelva a levantar de más; el
-- unique(email_sends) es la segunda barrera si igual se reintentara.
create or replace function public.seller_stats_queue()
returns table (
  listing_id uuid,
  user_id uuid,
  email text,
  title text,
  views_count int,
  favorites_count int
)
language sql
stable
security definer set search_path = public
as $$
  select l.id, l.seller_id, u.email::text, l.title, l.views_count, l.favorites_count
  from public.listings l
  join public.profiles p on p.id = l.seller_id
  join auth.users u on u.id = l.seller_id
  where l.status = 'active'
    and l.created_at < now() - interval '3 days'
    and l.created_at >= now() - interval '4 days'
    and u.email is not null
    and p.email_marketing = true
    and not exists (
      select 1 from public.email_sends es
      where es.user_id = l.seller_id and es.campaign = 'seller_stats_d3' and es.ref_id = l.id
    )
  order by l.created_at
  limit 500;
$$;

revoke execute on function public.seller_stats_queue() from public, anon, authenticated;
grant execute on function public.seller_stats_queue() to service_role;
