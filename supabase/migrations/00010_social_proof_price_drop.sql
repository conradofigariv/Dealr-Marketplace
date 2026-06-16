-- =============================================================
-- Prueba social + señales de precio (estilo Marketplace)
--   · favorites_count: cuántos guardaron la publicación. Contador
--     denormalizado porque la RLS de favorites no deja contar los ajenos.
--   · previous_price / price_dropped_at: insignia "Bajó de precio" y aviso
--     a quienes la tienen guardada.
-- =============================================================

-- ---------- Contador de guardados ----------
alter table public.listings
  add column if not exists favorites_count integer not null default 0;

-- Backfill con los favoritos que ya existen.
update public.listings l
set favorites_count = (select count(*) from public.favorites f where f.listing_id = l.id);

create or replace function public.sync_favorites_count()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.listings set favorites_count = favorites_count + 1 where id = new.listing_id;
  elsif tg_op = 'DELETE' then
    update public.listings set favorites_count = greatest(favorites_count - 1, 0) where id = old.listing_id;
  end if;
  return null;
end;
$$;

drop trigger if exists on_favorite_change on public.favorites;
create trigger on_favorite_change
  after insert or delete on public.favorites
  for each row execute function public.sync_favorites_count();

-- ---------- Señal de baja de precio ----------
alter table public.listings
  add column if not exists previous_price numeric,
  add column if not exists price_dropped_at timestamptz;

-- Antes de guardar: si bajó el precio (misma moneda) recordamos el anterior
-- y la fecha; si subió o cambió de moneda, limpiamos la señal.
create or replace function public.track_price_drop()
returns trigger
language plpgsql
as $$
begin
  if new.currency is distinct from old.currency then
    new.previous_price := null;
    new.price_dropped_at := null;
  elsif new.price < old.price then
    new.previous_price := old.price;
    new.price_dropped_at := now();
  elsif new.price > old.price then
    new.previous_price := null;
    new.price_dropped_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists on_price_change on public.listings;
create trigger on_price_change
  before update on public.listings
  for each row
  when (new.price is distinct from old.price)
  execute function public.track_price_drop();

-- ---------- Aviso a quienes la guardaron ----------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('message', 'offer', 'offer_accepted', 'question_answered', 'sale_confirmed', 'price_drop'));

create or replace function public.notify_price_drop()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select f.user_id, 'price_drop', 'Bajó de precio',
         '"' || new.title || '" que guardaste ahora cuesta menos', '/p/' || new.id
  from public.favorites f
  where f.listing_id = new.id and f.user_id <> new.seller_id;
  return null;
end;
$$;

drop trigger if exists on_price_drop_notify on public.listings;
create trigger on_price_drop_notify
  after update on public.listings
  for each row
  when (new.price < old.price and new.currency is not distinct from old.currency)
  execute function public.notify_price_drop();
