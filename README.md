# Dealr

**Marketplace PWA mobile-first para comprar y vender usados con confianza.**
Pensado para Córdoba (Argentina), donde las operaciones se cierran por WhatsApp o en persona: Dealr **conecta a las partes y genera confianza, no procesa pagos**.

`React + TypeScript + Vite + Tailwind` · `Supabase (Postgres · Auth · Storage · Realtime)` · `PWA` · `Vercel`

> Proyecto full-stack de producto end-to-end: diseño de producto, modelo de datos con seguridad a nivel de fila, realtime, PWA instalable y analítica — construido para sentirse como una app nativa.

---

## El problema

Los marketplaces de usados se llenan de fricción: preguntas vacías ("¿sigue disponible?"), inventario muerto que nunca se da de baja, y cero señales de confianza sobre con quién estás tratando. Dealr ataca cada uno de esos puntos con decisiones de producto concretas, casi todas implementadas en la base de datos para que las reglas no se puedan saltear desde el cliente.

| Problema | Cómo lo resuelve Dealr |
| --- | --- |
| Preguntas repetitivas sin intención real | Las preguntas se hacen públicas **solo cuando el vendedor responde** · respuestas rápidas con intención en el chat · ofertas con monto concreto |
| Inventario muerto (vendido pero nunca actualizado) | **Pausa automática a los 30 días** sin renovar · renovación y cierre de venta de un toque ("Sigue disponible" / "Ya lo vendí") |
| Falta de confianza entre desconocidos | **Calificaciones ciegas bidireccionales** · verificación de identidad (RENAPER vía Didit) · teléfono verificado · insignias y reputación |
| Spam y moderación cara | El vendedor es el primer moderador · **3+ reportes ocultan automáticamente** una pregunta |
| Cerrar la venta sin perder la reputación | Flujo **"vendido → califica"**: el vendedor marca a qué comprador le vendió y ambos se califican; al comprador le llega una notificación para hacerlo |

---

## Funcionalidades

- **Feed estilo Savee** — grilla masonry edge-to-edge, búsqueda, filtros por categoría / verificados, orden por precio, con **caché en memoria + restauración de scroll** para que volver de un producto se sienta instantáneo.
- **Publicar** — wizard con campos estructurados por categoría, hasta 6 fotos con **compresión client-side** (WebP) antes de subir.
- **Chat en vivo** — mensajería realtime con tildes de **enviado / leído**, contador de no leídos en la barra y respuestas rápidas.
- **Ofertas y preguntas** — ofertas con monto; preguntas que se publican recién cuando el vendedor contesta.
- **Reputación** — scores ciegos de comprador y vendedor, insignias de verificación, perfil público.
- **Favoritos y notificaciones** — guardados privados y centro de notificaciones in-app en tiempo real (mensajes, ofertas, respuestas, venta confirmada).
- **PWA instalable** — manifest, service worker con auto-update, safe-area insets, se comporta como app nativa en el teléfono.
- **Previews ricas al compartir** — endpoint serverless de Open Graph que sirve HTML con foto/título/precio a los crawlers (WhatsApp, Instagram, etc.), que no ejecutan JS.
- **Analítica de producto** — eventos clave con PostHog (carga diferida; no-op sin API key).

---

## Decisiones de ingeniería

Lo que hace interesante al proyecto no es la lista de features, sino dónde viven las reglas:

- **La lógica de producto vive en Postgres, no en el cliente.** Triggers y políticas RLS garantizan las invariantes pase lo que pase desde el front:
  - Una pregunta solo se vuelve pública (`is_public`) cuando el vendedor la responde (trigger). Las demás solo las ven el que pregunta y el vendedor (RLS).
  - Las calificaciones son **ciegas**: invisibles hasta que ambas partes califican (trigger) o pasan 14 días (cron). Se habilitan con una conversación real (4+ mensajes de ambos lados) **o** una venta confirmada.
  - Los scores quedan en `NULL` hasta acumular 3 calificaciones; mientras tanto la UI muestra "Usuario nuevo" + insignias, evitando promedios engañosos con pocos datos.
- **Realtime de verdad** — chat, notificaciones y el badge de no leídos se sincronizan con suscripciones a `postgres_changes` de Supabase.
- **Seguridad por defecto** — Row Level Security en todas las tablas; el cliente usa solo la `anon key` y nunca puede leer/escribir fuera de lo que las políticas permiten.
- **Resiliencia del cliente** — `ErrorBoundary` que se recupera de chunks viejos tras un deploy, validación y normalización de la config de Supabase con pantalla de setup explicativa, y manejo de errores visible en las mutaciones.
- **Performance** — code-splitting por ruta (el feed carga al instante, el resto bajo demanda), compresión de imágenes en el navegador, e índices pensados para las queries del feed.

---

## Arquitectura

```
src/
  lib/          cliente Supabase + validación de env, tipos, formato,
                compresión de imágenes, analytics (PostHog)
  hooks/        useAuth (sesión + perfil) · useFavorites · useNotifications ·
                useUnreadChats  (Context + suscripciones realtime)
  components/   BottomNav, ListingCard, Modal, RatingForm, SellFlowModal, badges…
  pages/        Home (feed), ListingDetail, Publish, Chats, ChatThread, Profile,
                PublicProfile, Auth, Onboarding, Saved, Notifications, Feedback
api/og.ts       endpoint serverless de Open Graph para crawlers
supabase/
  migrations/   esquema completo + RLS + triggers + seed (00001) y evoluciones
  functions/    didit-webhook (verificación de identidad, opcional)
```

**Stack:** React 18 · TypeScript · Vite 6 · Tailwind 4 · react-router v6 · `vite-plugin-pwa` · Supabase JS · PostHog · Vercel.

---

## Correr en local

```bash
npm install
cp .env.example .env   # completar con las credenciales de Supabase
npm run dev
```

`npm run build` compila y verifica tipos (`tsc -b && vite build`).

### Setup de Supabase

1. Crear un proyecto en [supabase.com](https://supabase.com).
2. En el **SQL Editor**, correr en orden las migraciones de `supabase/migrations/` (empezando por `00001_initial_schema.sql`: crea tablas, RLS, triggers, bucket de fotos y seed de categorías).
3. **Auth → Providers:** habilitar *Email* (OTP) y, opcionalmente, *Phone* (requiere proveedor SMS como Twilio).
4. **Realtime:** habilitar replicación para `messages`, `notifications` y `favorites` (Database → Replication).
5. **pg_cron:** programa `pause_stale_listings()`, `reveal_expired_ratings()` y `recalculate_scores()` (automático si la extensión está activa antes de correr la migración; si no, usar Scheduled Edge Functions).

### Verificación de identidad (opcional, Didit/RENAPER)

```bash
supabase secrets set DIDIT_WEBHOOK_SECRET=...
supabase functions deploy didit-webhook --no-verify-jwt
```

Apuntar el webhook de Didit a `https://<proyecto>.supabase.co/functions/v1/didit-webhook`. Dealr **nunca almacena** fotos del DNI ni datos del documento: solo el resultado (`profiles.identity_verified`).

## Deploy en Vercel

1. Importar el repo (framework Vite, detectado automáticamente).
2. Configurar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (y opcionalmente `VITE_POSTHOG_KEY`).
3. `vercel.json` ya incluye los rewrites de SPA y el ruteo de Open Graph para crawlers.

> Las migraciones de la base **no se aplican solas**: al evolucionar el esquema hay que correr la migración correspondiente en el SQL Editor de Supabase.
