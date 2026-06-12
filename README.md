# Dealr — Marketplace de usados en Córdoba

PWA mobile-first para comprar y vender usados con confianza. Las transacciones se cierran fuera de la plataforma (WhatsApp, en persona): Dealr conecta, no procesa pagos.

**Stack:** React + TypeScript + Vite + Tailwind · Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) · Vercel

## Qué resuelve (y cómo)

| Problema | Solución |
| --- | --- |
| Preguntas repetitivas sin intención real | Preguntas públicas solo al ser respondidas + respuestas rápidas en chat + ofertas con monto concreto |
| Inventario muerto (vendido sin actualizar) | Pausa automática a los 30 días + renovación de un toque ("Sigue disponible" / "Ya lo vendí") |
| Falta de confianza en vendedores | Calificaciones ciegas bidireccionales + verificación de identidad (Didit/RENAPER) + teléfono verificado |
| Spam y moderación cara | El vendedor es el primer moderador; 3+ reportes ocultan automáticamente |

## Desarrollo local

```bash
npm install
cp .env.example .env   # completar con las credenciales de Supabase
npm run dev
```

## Setup de Supabase

1. Crear proyecto en [supabase.com](https://supabase.com).
2. Ejecutar `supabase/migrations/00001_initial_schema.sql` en el SQL Editor (crea tablas, RLS, triggers, bucket de fotos y seed de categorías).
3. **Auth → Providers**: habilitar *Phone* (requiere proveedor SMS, ej. Twilio) y *Email* con OTP.
4. **pg_cron** (Database → Extensions): si se habilita *antes* de correr la migración, los jobs quedan programados automáticamente. Si no, programar `pause_stale_listings()`, `reveal_expired_ratings()` y `recalculate_scores()` con Scheduled Edge Functions.
5. **Realtime**: habilitar la replicación para la tabla `messages` (Database → Replication) para el chat en vivo.

### Webhook de Didit (verificación de identidad, opcional)

```bash
supabase secrets set DIDIT_WEBHOOK_SECRET=...
supabase functions deploy didit-webhook --no-verify-jwt
```

Apuntar el webhook de Didit a `https://<proyecto>.supabase.co/functions/v1/didit-webhook`. Dealr nunca almacena fotos del DNI ni datos del documento: solo el resultado (`profiles.identity_verified`).

## Deploy en Vercel

1. Importar el repo en Vercel (framework: Vite, detectado automáticamente).
2. Configurar las env vars `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
3. `vercel.json` ya incluye los rewrites de SPA.

## Estructura

```
supabase/
  migrations/00001_initial_schema.sql   # esquema completo + RLS + seed
  functions/didit-webhook/              # webhook de verificación de identidad
src/
  lib/        # cliente supabase, tipos, formato, compresión de imágenes
  hooks/      # useAuth (sesión + perfil)
  components/ # BottomNav, ListingCard, Modal, badges...
  pages/      # Home (feed), ListingDetail, Publish, Chats, ChatThread, Profile, Auth
```

## Reglas de producto clave (implementadas en la DB)

- **Preguntas**: `is_public` pasa a `true` solo cuando el vendedor responde (trigger). Las no respondidas solo las ven asker y vendedor (RLS).
- **Calificaciones ciegas**: invisibles hasta que ambas partes califican (trigger) o pasan 14 días (cron). Solo se habilitan con 4+ mensajes de ambas partes en la conversación.
- **Scores**: NULL hasta acumular 3 calificaciones; mientras tanto la UI muestra "Usuario nuevo" + insignias (teléfono/identidad verificada).
- **Pausa automática**: publicaciones sin renovar en 30 días salen del feed; reactivación de un toque.
- **Fotos**: compresión client-side (max 1200px, ~75% calidad, WebP), máximo 6 por publicación.
