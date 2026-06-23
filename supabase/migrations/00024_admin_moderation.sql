-- =============================================================
-- 00024 — Administración / moderación
--
-- OJO: la tabla `reports` y el enum `report_target` YA EXISTEN (00001), con
-- el trigger handle_question_report (oculta preguntas con 3+ reportes) y RLS
-- donde el reportante ve los suyos. Acá NO se recrea la tabla: se EXTIENDE.
--
-- 1. Extiende el enum report_target con message/review/suggestion.
-- 2. profiles.is_admin + función is_admin() (security definer, sin recursión).
-- 3. Policies de moderación: el admin ve/borra contenido de cualquiera.
-- 4. Policies de admin sobre `reports` (ver todos, resolver, borrar) +
--    notificación in-app/push al admin por cada reporte nuevo.
-- 5. Marca de admin para el dueño (ajustar el email si hace falta).
--
-- Idempotente.
-- =============================================================

-- 1. Nuevos destinos de reporte (PG12+ permite ADD VALUE en transacción
--    mientras no se USE el valor en el mismo script; acá no se usa).
alter type public.report_target add value if not exists 'message';
alter type public.report_target add value if not exists 'review';
alter type public.report_target add value if not exists 'suggestion';

-- 2. Flag + helper -------------------------------------------------
alter table public.profiles add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 3. Policies de moderación (RLS es OR → no pisan las de los usuarios).
do $$
declare t text;
begin
  foreach t in array array[
    'listings', 'questions', 'ratings', 'messages', 'conversations', 'app_reviews', 'feature_suggestions'
  ] loop
    execute format('drop policy if exists "admin modera" on public.%I', t);
    execute format(
      'create policy "admin modera" on public.%I for all using (public.is_admin()) with check (public.is_admin())',
      t
    );
  end loop;
end $$;

-- 4. Reportes: el admin ve todos / resuelve / borra (se suman a las policies
--    existentes de insert del reportante).
drop policy if exists "admin ve todos los reportes" on public.reports;
create policy "admin ve todos los reportes" on public.reports
  for select using (public.is_admin());
drop policy if exists "admin resuelve reportes" on public.reports;
create policy "admin resuelve reportes" on public.reports
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin borra reportes" on public.reports;
create policy "admin borra reportes" on public.reports
  for delete using (public.is_admin());

grant select, insert, update, delete on public.reports to authenticated;

-- Tipo de notificación nuevo: 'report'.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'message', 'offer', 'offer_accepted', 'question_answered', 'sale_confirmed',
    'price_drop', 'saved_search', 'bid', 'outbid', 'auction_won', 'report'
  ));

-- Reporte nuevo → notifica a todos los admins (actor = quien reporta).
-- Trigger separado del handle_question_report existente (ambos conviven).
create or replace function public.notify_report()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link, actor_id)
  select p.id, 'report', 'Nuevo reporte', left(new.reason, 80), '/admin', new.reporter_id
  from public.profiles p
  where p.is_admin and p.id <> new.reporter_id;
  return null;
end;
$$;

drop trigger if exists on_report_notify on public.reports;
create trigger on_report_notify
  after insert on public.reports
  for each row execute function public.notify_report();

-- 5. Marca al dueño como admin (ajustar el email si es otro).
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'conradofigari.v@gmail.com');
