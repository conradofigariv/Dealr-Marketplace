// Edge Function: manda por email las notificaciones pendientes (chat, ofertas,
// preguntas, subasta) a quien no abrió la app. La dispara un CRON cada 5 min.
//
// Flujo: llama al RPC email_queue() (notifs sin leer, >10 min, no avisadas, con
// el usuario offline), agrupa por usuario, manda UN mail-resumen por persona
// (no spam) vía Resend, y marca email_sent_at para no repetir.
//
// Requiere:
//   - RESEND_API_KEY (secret): la API key de Resend. Sin ella, no-op (queda
//     inerte hasta configurar Resend).
//   - CRON_SECRET (secret): el cron debe llamar con ?secret=<CRON_SECRET> para
//     que randoms no puedan gatillar envíos masivos.
//   - EMAIL_FROM (secret, opcional): remitente. Default "Dealr
//     <hola@dealr.com.ar>" (el dominio debe estar verificado en Resend).
//   - APP_URL (secret, opcional): default https://dealr.com.ar
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
//
// Deploy:  supabase functions deploy email-notifications
// Cron:    Supabase → Cron → invocar esta función cada 5 min con ?secret=...

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET')
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'Dealr <hola@dealr.com.ar>'
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://dealr.com.ar').replace(/\/+$/, '')

const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

interface QueueRow {
  notif_id: string
  user_id: string
  email: string
  type: string
  title: string
  body: string | null
}

// Etiqueta legible por tipo, para el resumen.
function label(type: string): string {
  switch (type) {
    case 'message': return 'mensaje nuevo'
    case 'offer': return 'oferta'
    case 'offer_accepted': return 'oferta aceptada'
    case 'question': return 'pregunta'
    case 'question_answered': return 'respuesta a tu pregunta'
    case 'outbid': return 'te superaron una oferta'
    case 'auction_won': return 'ganaste una subasta'
    default: return 'novedad'
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Email HTML simple y branded (ámbar Dealr).
function emailHtml(rows: QueueRow[]): string {
  const items = rows
    .slice(0, 6)
    .map((r) => `<tr><td style="padding:6px 0;color:#e5e5e5;font-size:14px;">• <strong>${esc(r.title)}</strong>${r.body ? ` — ${esc(r.body)}` : ''}</td></tr>`)
    .join('')
  const more = rows.length > 6 ? `<p style="color:#a3a3a3;font-size:13px;">…y ${rows.length - 6} más.</p>` : ''
  return `<!doctype html><html><body style="margin:0;background:#0a0a0a;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
    <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-1px;">Deal<span style="color:#ffb020;">r</span></div>
    <h1 style="color:#fff;font-size:20px;margin:24px 0 8px;">Tenés novedades en Dealr</h1>
    <p style="color:#a3a3a3;font-size:14px;margin:0 0 16px;">Alguien te escribió o hay movimiento en tus publicaciones mientras no estabas:</p>
    <table style="width:100%;border-collapse:collapse;">${items}</table>
    ${more}
    <a href="${APP_URL}/notificaciones" style="display:inline-block;margin-top:24px;background:#ffb020;color:#0a0a0a;font-weight:700;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:999px;">Ver en Dealr</a>
    <p style="color:#666;font-size:12px;margin-top:32px;">Recibís este mail porque tenés notificaciones sin leer en Dealr. Entrá a la app para gestionarlas.</p>
  </div></body></html>`
}

async function sendEmail(to: string, rows: QueueRow[]): Promise<boolean> {
  const n = rows.length
  const subject = n === 1 ? `Tenés un ${label(rows[0].type)} en Dealr` : `Tenés ${n} novedades en Dealr`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html: emailHtml(rows) }),
  })
  return res.ok
}

Deno.serve(async (req) => {
  // Verificar que lo llame el cron (secret) — evita envíos masivos por randoms.
  const url = new URL(req.url)
  if (CRON_SECRET && url.searchParams.get('secret') !== CRON_SECRET) {
    return new Response('no autorizado', { status: 401 })
  }
  // Sin Resend configurado: no-op (queda inerte, no marca nada).
  if (!RESEND_API_KEY) {
    return new Response('RESEND_API_KEY no configurado', { status: 200 })
  }

  const { data, error } = await admin.rpc('email_queue')
  if (error) return new Response(error.message, { status: 500 })
  const rows = (data ?? []) as QueueRow[]
  if (rows.length === 0) return new Response('sin pendientes', { status: 200 })

  // Agrupar por usuario → un mail-resumen por persona.
  const byUser = new Map<string, QueueRow[]>()
  for (const r of rows) {
    const arr = byUser.get(r.user_id) ?? []
    arr.push(r)
    byUser.set(r.user_id, arr)
  }

  const sentIds: string[] = []
  for (const [, userRows] of byUser) {
    const ok = await sendEmail(userRows[0].email, userRows).catch(() => false)
    // Marcamos como enviadas solo si el mail salió OK (si falla, se reintenta
    // en la próxima corrida del cron).
    if (ok) sentIds.push(...userRows.map((r) => r.notif_id))
  }

  if (sentIds.length > 0) {
    await admin.from('notifications').update({ email_sent_at: new Date().toISOString() }).in('id', sentIds)
  }

  return new Response(JSON.stringify({ users: byUser.size, sent: sentIds.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
