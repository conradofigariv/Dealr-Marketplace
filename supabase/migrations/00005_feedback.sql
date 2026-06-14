-- =============================================================
-- Feedback de la app: opiniones públicas + tablero de ideas votables
-- =============================================================

-- ---------- Opiniones de la app (estrellas + comentario) ----------
-- Una por usuario (editable). Públicas: sirven de prueba social.
create table public.app_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  body text check (char_length(body) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Ideas / mejoras propuestas por usuarios ----------
create table public.feature_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 4 and 80),
  body text check (char_length(body) <= 500),
  -- El equipo mueve el estado; los usuarios solo crean y votan.
  status text not null default 'open' check (status in ('open', 'planned', 'in_progress', 'done', 'declined')),
  vote_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index on public.feature_suggestions (vote_count desc, created_at desc);

-- ---------- Votos a las ideas (uno por usuario por idea) ----------
create table public.feature_votes (
  suggestion_id uuid not null references public.feature_suggestions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (suggestion_id, user_id)
);

-- Mantiene vote_count denormalizado para ordenar por popularidad sin contar.
create or replace function public.bump_suggestion_votes()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.feature_suggestions set vote_count = vote_count + 1 where id = new.suggestion_id;
  elsif tg_op = 'DELETE' then
    update public.feature_suggestions set vote_count = vote_count - 1 where id = old.suggestion_id;
  end if;
  return null;
end;
$$;

create trigger on_feature_vote
  after insert or delete on public.feature_votes
  for each row execute function public.bump_suggestion_votes();

-- ---------- RLS ----------
alter table public.app_reviews enable row level security;
alter table public.feature_suggestions enable row level security;
alter table public.feature_votes enable row level security;

create policy "opiniones legibles por todos" on public.app_reviews
  for select using (true);
create policy "opinión propia editable" on public.app_reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "ideas legibles por todas" on public.feature_suggestions
  for select using (true);
create policy "crear idea propia" on public.feature_suggestions
  for insert with check (auth.uid() = user_id);

create policy "votos legibles por todos" on public.feature_votes
  for select using (true);
create policy "votar como uno mismo" on public.feature_votes
  for insert with check (auth.uid() = user_id);
create policy "quitar el voto propio" on public.feature_votes
  for delete using (auth.uid() = user_id);

-- ---------- Grants (por si el schema public perdió los defaults) ----------
grant select, insert, update, delete on public.app_reviews to anon, authenticated;
grant select, insert, update, delete on public.feature_suggestions to anon, authenticated;
grant select, insert, delete on public.feature_votes to anon, authenticated;
