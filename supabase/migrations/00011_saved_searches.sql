-- =============================================================
-- Búsquedas guardadas con alerta (estilo Marketplace)
-- El usuario guarda una búsqueda (término + filtros). Cuando se publica
-- algo que matchea, un trigger le inserta una notificación. La data del
-- producto vive en la DB: el matcheo también.
-- =============================================================

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  query text,                                   -- término libre (nullable)
  category_id integer references public.categories (id),
  min_price numeric,
  max_price numeric,
  currency text check (currency in ('ARS', 'USD')),
  conditions text[],                            -- vacío/null = cualquier condición
  created_at timestamptz not null default now()
);

create index saved_searches_user_idx on public.saved_searches (user_id, created_at desc);

alter table public.saved_searches enable row level security;

create policy "búsquedas propias legibles" on public.saved_searches
  for select using (auth.uid() = user_id);
create policy "guardar búsqueda propia" on public.saved_searches
  for insert with check (auth.uid() = user_id);
create policy "borrar búsqueda propia" on public.saved_searches
  for delete using (auth.uid() = user_id);

grant select, insert, delete on public.saved_searches to authenticated;

-- Nuevo tipo de notificación.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('message', 'offer', 'offer_accepted', 'question_answered', 'sale_confirmed', 'price_drop', 'saved_search'));

-- Publicación nueva -> avisa a cada búsqueda guardada que matchee.
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
    and (s.currency is null or new.currency = s.currency)
    and (s.min_price is null or new.price >= s.min_price)
    and (s.max_price is null or new.price <= s.max_price)
    and (s.conditions is null or array_length(s.conditions, 1) is null or new.condition = any (s.conditions));
  return null;
end;
$$;

create trigger on_listing_saved_search_notify
  after insert on public.listings
  for each row execute function public.notify_saved_search_matches();
