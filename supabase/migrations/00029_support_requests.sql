-- 00029: "Ayuda y soporte" → entra a la bandeja de reportes del admin.
--
-- Reusamos la infraestructura de `reports` (00001/00024): un nuevo valor de
-- enum `support` permite que una consulta de soporte caiga en /admin junto a
-- los reportes. El trigger `notify_report` (00024) ya notifica a los admins
-- por CUALQUIER fila nueva de `reports`, y la policy de insert ya deja crear
-- reportes a cualquier usuario logueado → no hace falta tocar nada más.
--
-- No tiene "target" real (no se reporta una publicación/usuario/etc.): el front
-- manda un `target_id` aleatorio (crypto.randomUUID) para satisfacer el
-- not-null y el unique (reporter_id, target_type, target_id), así un mismo
-- usuario puede mandar varias consultas.
--
-- NOTA (igual que 00024): `alter type ... add value` no puede USARSE en la
-- misma transacción donde se agrega. Acá solo se agrega (no se inserta el
-- valor en este script), así que es seguro.

alter type public.report_target add value if not exists 'support';
