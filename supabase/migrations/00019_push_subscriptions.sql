-- =============================================================
-- 00019 — Web Push: suscripciones del navegador
-- Cada navegador/dispositivo guarda su endpoint + claves. La Edge Function
-- `send-push` (service role, omite RLS) las lee para enviar el push cuando
-- se inserta una notificación. El cliente solo administra las propias.
-- =============================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "suscripciones propias legibles" on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy "suscribirse como uno mismo" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy "actualizar suscripcion propia" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "borrar suscripcion propia" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
