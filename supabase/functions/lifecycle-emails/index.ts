// Edge Function: mails de ciclo de vida / remarketing (distinto del digest
// transaccional de `email-notifications`, 00051). Arranca con UNA sola
// campaña: stats al vendedor a los ~3 días de publicar ("tu publicación tuvo
// N vistas"). A propósito NO recomienda productos — con poco inventario,
// mostrar oferta pobre por mail quema el canal; esto en cambio siempre tiene
// contenido real (los números de SU publicación).
//
// Flujo: RPC seller_stats_queue() (00052) → un mail por publicación elegible
// → registra el envío en email_sends (no repetir) → incluye link de
// desuscripción (Edge Function `unsubscribe`).
//
// Requiere:
//   - RESEND_API_KEY (secret, compartido con email-notifications).
//   - CRON_SECRET (secret, compartido con email-notifications).
//   - UNSUB_SECRET (secret, compartido con la función unsubscribe).
//   - EMAIL_FROM / APP_URL (secrets, opcionales, mismos defaults).
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
//
// Deploy:  supabase functions deploy lifecycle-emails
// Cron:    Supabase → Cron → invocar cada 1-2 horas con ?secret=<CRON_SECRET>
//          (alcanza: la ventana de seller_stats_queue es de 1 día).
// IMPORTANTE: desactivar "Verify JWT" (igual que email-notifications).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET')
const UNSUB_SECRET = Deno.env.get('UNSUB_SECRET')
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'Dealr <hola@dealr.com.ar>'
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://dealr.com.ar').replace(/\/+$/, '')
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`

const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

interface StatsRow {
  listing_id: string
  user_id: string
  email: string
  title: string
  views_count: number
  favorites_count: number
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function unsubscribeToken(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(UNSUB_SECRET ?? ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function unsubscribeLink(userId: string): Promise<string> {
  if (!UNSUB_SECRET) return `${APP_URL}/perfil`
  const token = await unsubscribeToken(userId)
  return `${FUNCTIONS_URL}/unsubscribe?u=${userId}&t=${token}`
}

// Mail de stats: siempre tiene contenido real (los números de la propia
// publicación), nunca inventario ajeno — no hace falta fingir que hay más
// oferta de la que hay.
function statsHtml(row: StatsRow, unsubUrl: string): string {
  const savedLine =
    row.favorites_count > 0
      ? `<p style="color:#e5e5e5;font-size:15px;margin:4px 0;"><strong>${row.favorites_count}</strong> persona${row.favorites_count === 1 ? '' : 's'} la guardó${row.favorites_count === 1 ? '' : 'n'} como favorita</p>`
      : ''
  return `<!doctype html><html><body style="margin:0;background:#0a0a0a;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
    <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-1px;">Deal<span style="color:#ffb020;">r</span></div>
    <h1 style="color:#fff;font-size:20px;margin:24px 0 8px;">Así le fue a "${esc(row.title)}"</h1>
    <p style="color:#a3a3a3;font-size:14px;margin:0 0 16px;">Van 3 días desde que la publicaste:</p>
    <p style="color:#e5e5e5;font-size:15px;margin:4px 0;"><strong>${row.views_count}</strong> persona${row.views_count === 1 ? '' : 's'} la vio</p>
    ${savedLine}
    <a href="${APP_URL}/p/${row.listing_id}" style="display:inline-block;margin-top:24px;background:#ffb020;color:#0a0a0a;font-weight:700;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:999px;">Ver mi publicación</a>
    <p style="color:#666;font-size:12px;margin-top:32px;">Recibís este mail porque publicaste en Dealr. <a href="${unsubUrl}" style="color:#666;">Dejar de recibir novedades</a>.</p>
  </div></body></html>`
}

async function sendStatsEmail(row: StatsRow): Promise<boolean> {
  const unsubUrl = await unsubscribeLink(row.user_id)
  const subject = `Así le fue a "${row.title}" en Dealr`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: row.email, subject, html: statsHtml(row, unsubUrl) }),
  })
  return res.ok
}

Deno.serve(async (req) => {
  // Modo TEST: mismo patrón que email-notifications — un admin logueado desde
  // /admin manda un mail de MUESTRA a su propio correo, sin tocar la cola real.
  let body: { test?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    /* sin body (llamada del cron): sigue el flujo normal de abajo */
  }
  if (body.test) {
    if (!RESEND_API_KEY) return new Response('RESEND_API_KEY no configurado', { status: 200 })
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response('no autenticado', { status: 401 })
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return new Response('sesión inválida', { status: 401 })
    const { data: profile } = await admin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
    if (!profile?.is_admin) return new Response('solo para administradores', { status: 403 })
    if (!user.email) return new Response('tu cuenta no tiene email', { status: 400 })

    const sample: StatsRow = {
      listing_id: '00000000-0000-0000-0000-000000000000',
      user_id: user.id,
      email: user.email,
      title: 'Bicicleta rodado 26',
      views_count: 14,
      favorites_count: 2,
    }
    const ok = await sendStatsEmail(sample).catch(() => false)
    return new Response(JSON.stringify({ ok }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  // Verificar que lo llame el cron (secret) — evita envíos masivos por randoms.
  const url = new URL(req.url)
  if (CRON_SECRET && url.searchParams.get('secret') !== CRON_SECRET) {
    return new Response('no autorizado', { status: 401 })
  }
  if (!RESEND_API_KEY) {
    return new Response('RESEND_API_KEY no configurado', { status: 200 })
  }

  const { data, error } = await admin.rpc('seller_stats_queue')
  if (error) return new Response(error.message, { status: 500 })
  const rows = (data ?? []) as StatsRow[]
  if (rows.length === 0) return new Response('sin pendientes', { status: 200 })

  let sent = 0
  for (const row of rows) {
    const ok = await sendStatsEmail(row).catch(() => false)
    if (ok) {
      // Marca el envío YA (antes del próximo, no al final): si el cron se
      // interrumpe a mitad de la corrida, lo ya enviado no se reintenta.
      const { error: sendErr } = await admin
        .from('email_sends')
        .insert({ user_id: row.user_id, campaign: 'seller_stats_d3', ref_id: row.listing_id })
      if (!sendErr) sent++
    }
  }

  return new Response(JSON.stringify({ candidates: rows.length, sent }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
