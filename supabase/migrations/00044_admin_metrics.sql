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
