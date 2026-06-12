-- Restaura los permisos base que Supabase otorga por defecto sobre el
-- schema public y que se pierden si el schema fue recreado. Sin esto,
-- toda consulta de la app falla con "permission denied" aunque las
-- políticas RLS estén bien (los GRANT habilitan el verbo, RLS las filas).
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- Que las tablas que se creen en el futuro nazcan con los mismos permisos.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
