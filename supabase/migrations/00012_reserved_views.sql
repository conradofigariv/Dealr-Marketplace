-- =============================================================
-- Estado "Reservado" + contador de vistas (estilo Marketplace)
-- =============================================================

-- "reserved": pausa la publicación mientras se cierra una venta (sale del
-- feed como paused). OJO: ALTER TYPE ... ADD VALUE no puede correr dentro de
-- una transacción ni usarse en la misma; si el editor agrupa todo, corré esta
-- línea sola primero y después el resto.
alter type listing_status add value if not exists 'reserved';

-- Contador de vistas: el dueño ve cuánto interés tiene la publicación.
alter table public.listings
  add column if not exists views_count integer not null default 0;

-- Lo incrementa el cliente vía RPC (security definer: la RLS no deja a un
-- visitante actualizar la publicación de otro).
create or replace function public.increment_listing_views(listing_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.listings set views_count = views_count + 1 where id = listing_id;
$$;

grant execute on function public.increment_listing_views(uuid) to anon, authenticated;
