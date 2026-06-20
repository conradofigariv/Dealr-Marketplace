// Edge Function: envía Web Push cuando se inserta una fila en `notifications`.
//
// Se dispara por un Database Webhook de Supabase (Database → Webhooks):
//   Evento: INSERT en la tabla `public.notifications`
//   URL:    https://<proyecto>.supabase.co/functions/v1/send-push
//   Header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>  (o el anon)
//
// Secrets de la función (generar las VAPID con: npx web-push generate-vapid-keys):
//   supabase secrets set VAPID_PUBLIC_KEY=...
//   supabase secrets set VAPID_PRIVATE_KEY=...
//   supabase secrets set VAPID_SUBJECT=mailto:hola@dealr.app
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
//
// La VITE_VAPID_PUBLIC_KEY del front debe ser la MISMA VAPID_PUBLIC_KEY.
//
// Deploy:
//   supabase functions deploy send-push

import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hola@dealr.app'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

interface NotificationRow {
  user_id: string
  title: string
  body: string | null
  link: string | null
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json()
    const record: NotificationRow | undefined = payload.record ?? payload
    if (!record?.user_id) {
      return new Response('sin record', { status: 200 })
    }

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', record.user_id)

    if (!subs || subs.length === 0) {
      return new Response('sin suscripciones', { status: 200 })
    }

    const body = JSON.stringify({
      title: record.title,
      body: record.body ?? '',
      link: record.link ?? '/',
      tag: record.link ?? undefined,
    })

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
          )
        } catch (err) {
          // 404/410 = suscripción muerta: la limpiamos.
          const status = (err as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) {
            await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
          } else {
            console.error('push fallido:', status, (err as Error).message)
          }
        }
      }),
    )

    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error(err)
    return new Response('error', { status: 500 })
  }
})
