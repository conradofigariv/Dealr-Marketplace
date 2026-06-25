-- 00031: encuesta rápida "¿Cómo nos conociste?" en el onboarding.
--
-- Una fila por usuario (PK = user_id → responde una sola vez). `source` es la
-- opción elegida (Instagram, TikTok, etc.) y `detail` el texto libre opcional
-- cuando elige "Otro". El front (Onboarding.tsx) la inserta al elegir el nombre.
-- El admin puede leer todas para ver la atribución (de dónde llegan los users).

create table if not exists public.signup_surveys (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  source text not null,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.signup_surveys enable row level security;

-- El usuario ve y crea solo la suya.
drop policy if exists "encuesta propia select" on public.signup_surveys;
create policy "encuesta propia select" on public.signup_surveys
  for select using (auth.uid() = user_id);

drop policy if exists "encuesta propia insert" on public.signup_surveys;
create policy "encuesta propia insert" on public.signup_surveys
  for insert with check (auth.uid() = user_id);

-- El admin ve todas (analytics de atribución). is_admin() viene de 00024.
drop policy if exists "admin ve encuestas" on public.signup_surveys;
create policy "admin ve encuestas" on public.signup_surveys
  for select using (public.is_admin());

grant select, insert on public.signup_surveys to authenticated;
