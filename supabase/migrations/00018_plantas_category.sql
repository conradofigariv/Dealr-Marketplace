-- =============================================================
-- 00018 — Categoría nueva: Plantas y Jardinería
-- Se agrega con los campos comunes ya limpios (formas_de_pago, acepta_envio;
-- sin zona ni motivo_venta, igual que el resto tras la 00016).
-- Idempotente: si el slug ya existe, no hace nada.
-- =============================================================

insert into public.categories (name, slug, required_fields) values
  ('Plantas y Jardinería', 'plantas-jardineria', '[
    {"key": "formas_de_pago", "label": "Formas de pago", "type": "multiselect", "required": true, "options": ["Efectivo", "Transferencia", "Tarjeta"]},
    {"key": "acepta_envio", "label": "Acepta envío", "type": "boolean", "required": true}
  ]'::jsonb)
on conflict (slug) do nothing;
