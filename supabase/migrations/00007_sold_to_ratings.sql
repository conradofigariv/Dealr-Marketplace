-- =============================================================
-- Cierre del flujo "vendido -> califica"
-- Al marcar una venta, el vendedor indica a qué comprador (de un chat)
-- le vendió. Eso habilita la calificación mutua (sin exigir el mínimo de
-- mensajes: la venta confirmada ya es prueba de transacción real) y le
-- avisa al comprador para que califique.
-- =============================================================

-- A quién se le vendió (null = venta por fuera de Dealr / sin comprador en la app).
alter table public.listings
  add column sold_to uuid references public.profiles (id) on delete set null;

-- La venta está confirmada cuando el listing quedó 'sold' apuntando al
-- comprador de esa conversación.
create or replace function public.is_confirmed_sale(conv_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1
    from public.conversations c
    join public.listings l on l.id = c.listing_id
    where c.id = conv_id
      and l.status = 'sold'
      and l.sold_to = c.buyer_id
      and l.seller_id = c.seller_id
  );
$$;

-- Calificar requiere conversación con profundidad real O una venta confirmada.
drop policy "calificar requiere conversacion real" on public.ratings;
create policy "calificar tras venta o conversacion" on public.ratings
  for insert with check (
    auth.uid() = rater_id
    and rater_id <> rated_id
    and (
      public.can_rate_conversation(conversation_id, auth.uid())
      or public.is_confirmed_sale(conversation_id)
    )
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and rated_id in (c.buyer_id, c.seller_id)
    )
  );

-- Notificaciones: sumamos el aviso de venta confirmada al comprador.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('message', 'offer', 'offer_accepted', 'question_answered', 'sale_confirmed'));

create or replace function public.notify_sale_confirmed()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conv_id uuid;
begin
  if new.status = 'sold' and new.sold_to is not null and new.sold_to is distinct from old.sold_to then
    select id into conv_id
    from public.conversations
    where listing_id = new.id and buyer_id = new.sold_to;
    insert into public.notifications (user_id, type, title, body, link)
    values (
      new.sold_to,
      'sale_confirmed',
      'Calificá tu compra',
      'Confirmaron la venta de "' || new.title || '". Contanos cómo fue.',
      coalesce('/chats/' || conv_id, '/p/' || new.id)
    );
  end if;
  return null;
end;
$$;

create trigger on_sale_confirmed_notify
  after update on public.listings
  for each row execute function public.notify_sale_confirmed();
