-- =============================================================
-- 00014 — Preview de chats eficiente + vistas únicas por usuario
-- Requiere 00012 (views_count) y 00013 (messages.image_path) aplicadas.
-- =============================================================

-- ---------- Preview de conversaciones (un solo round trip) ----------
-- Devuelve, por cada conversación del usuario actual, el último mensaje
-- (texto o foto) y cuántos hay sin leer. Evita traer 1000 mensajes al cliente.
create or replace function public.conversation_previews()
returns table (
  conversation_id uuid,
  last_body text,
  last_image boolean,
  last_sender uuid,
  last_at timestamptz,
  unread integer
)
language sql
security definer
set search_path = public
as $$
  with mine as (
    select id from public.conversations
    where buyer_id = auth.uid() or seller_id = auth.uid()
  ),
  last_msg as (
    select distinct on (m.conversation_id)
      m.conversation_id, m.body, m.image_path, m.sender_id, m.created_at
    from public.messages m
    join mine on mine.id = m.conversation_id
    order by m.conversation_id, m.created_at desc
  )
  select
    mine.id,
    lm.body,
    (lm.image_path is not null) as last_image,
    lm.sender_id,
    lm.created_at,
    coalesce((
      select count(*)::int
      from public.messages u
      where u.conversation_id = mine.id
        and u.sender_id <> auth.uid()
        and u.read_at is null
    ), 0)
  from mine
  left join last_msg lm on lm.conversation_id = mine.id;
$$;

grant execute on function public.conversation_previews() to authenticated;

-- ---------- Vistas únicas por usuario ----------
-- Una fila por (publicación, usuario que la vio): el contador sube una sola
-- vez por usuario logueado. Sin esto cualquiera podía inflar views_count.
create table if not exists public.listing_views (
  listing_id uuid not null references public.listings (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, viewer_id)
);

alter table public.listing_views enable row level security;
-- Sin policies para el cliente: solo entra por la función de abajo.

create or replace function public.increment_listing_views(listing_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  rows integer;
begin
  -- Solo contamos usuarios logueados, y una vez cada uno.
  if auth.uid() is null then
    return;
  end if;
  insert into public.listing_views (listing_id, viewer_id)
  values (increment_listing_views.listing_id, auth.uid())
  on conflict do nothing;
  get diagnostics rows = row_count;
  if rows > 0 then
    update public.listings
    set views_count = views_count + 1
    where id = increment_listing_views.listing_id;
  end if;
end;
$$;

grant execute on function public.increment_listing_views(uuid) to authenticated;
