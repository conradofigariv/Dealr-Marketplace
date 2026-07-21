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
