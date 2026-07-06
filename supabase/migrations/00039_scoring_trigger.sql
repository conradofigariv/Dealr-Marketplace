-- 00039 — Scores por TRIGGER (no dependen de pg_cron).
--
-- Problema: recalculate_scores() (00001) solo corría por el cron diario
-- `recalculate-scores`, envuelto en `if pg_cron`. Sin pg_cron, los scores NUNCA
-- se calculan → todos quedan "Usuario nuevo" → el diferenciador (reputación) no
-- existe. Y aun con cron, se actualizan 1 vez por día.
--
-- Solución: recalcular el score de un usuario EN EL MOMENTO en que una
-- calificación suya se vuelve visible (trigger). El cron sigue existiendo como
-- respaldo (y para el revelado a 14 días), pero ya no es imprescindible.
--
-- Detalle fino: recalculate_scores() corría sin auth.uid() (cron) → el trigger
-- protect_profile_columns (00001) dejaba pasar el update. Desde un trigger de
-- calificación, auth.uid() es el usuario que califica → protect pisaría el
-- score. Se resuelve con un flag de sesión `dealr.scoring` que protect respeta.

-- 1) protect_profile_columns: dejar pasar el recálculo interno de scores.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  -- Recálculo interno de scores (marcado con el flag de sesión): permitido.
  if current_setting('dealr.scoring', true) = '1' then
    return new;
  end if;
  if auth.uid() is not null then
    new.phone_verified := old.phone_verified;
    new.identity_verified := old.identity_verified;
    new.identity_verified_at := old.identity_verified_at;
    new.didit_session_id := old.didit_session_id;
    new.seller_score := old.seller_score;
    new.buyer_score := old.buyer_score;
    new.seller_ratings_count := old.seller_ratings_count;
    new.buyer_ratings_count := old.buyer_ratings_count;
  end if;
  return new;
end;
$$;

-- 2) Recalcular el score de UN usuario (misma fórmula que recalculate_scores).
create or replace function public.recalculate_scores_for(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  s_cnt int;
  s_avg numeric;
  s_rate numeric;
  b_cnt int;
  b_avg numeric;
begin
  perform set_config('dealr.scoring', '1', true); -- permite tocar los scores

  select count(*), avg(stars) into s_cnt, s_avg
  from public.ratings
  where rated_id = p_user and role = 'rated_as_seller' and visible;

  select count(*) filter (where q.answer_body is not null)::numeric / nullif(count(*), 0)
  into s_rate
  from public.questions q
  join public.listings l on l.id = q.listing_id
  where l.seller_id = p_user;

  update public.profiles p
  set seller_ratings_count = coalesce(s_cnt, 0),
      seller_score = case
        when coalesce(s_cnt, 0) >= 3 then round(least(5, s_avg * (0.85 + 0.15 * coalesce(s_rate, 1))), 2)
        else null
      end
  where p.id = p_user;

  select count(*), avg(stars) into b_cnt, b_avg
  from public.ratings
  where rated_id = p_user and role = 'rated_as_buyer' and visible;

  update public.profiles p
  set buyer_ratings_count = coalesce(b_cnt, 0),
      buyer_score = case when coalesce(b_cnt, 0) >= 3 then round(b_avg, 2) else null end
  where p.id = p_user;
end;
$$;

-- 3) Trigger: al volverse visible una calificación, recalcular al calificado.
create or replace function public.on_rating_visible()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.visible and (tg_op = 'INSERT' or old.visible is distinct from new.visible) then
    perform public.recalculate_scores_for(new.rated_id);
  end if;
  return new;
end;
$$;

drop trigger if exists on_rating_visible_recalc on public.ratings;
create trigger on_rating_visible_recalc
  after insert or update on public.ratings
  for each row execute function public.on_rating_visible();
