// Edge Function pública: desuscribirse de mails de retención/remarketing sin
// necesitar login (el link va directo en el mail). NO afecta el digest
// transaccional de notificaciones (00051) — ese no es "marketing".
//
// El link se arma en lifecycle-emails con un token HMAC-SHA256 del user_id
// firmado con UNSUB_SECRET, así nadie puede desuscribir a otra persona
// adivinando su uuid.
//
// Requiere:
//   - UNSUB_SECRET (secret): compartido con la función lifecycle-emails.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
//
// Deploy: supabase functions deploy unsubscribe
// IMPORTANTE: desactivar "Verify JWT" en la config de esta función (la
// llama un link de mail, sin Authorization header).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UNSUB_SECRET = Deno.env.get('UNSUB_SECRET')

const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

async function sign(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(UNSUB_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function page(title: string, message: string): Response {
  const html = `<!doctype html><html><body style="margin:0;background:#0a0a0a;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
  <div style="max-width:420px;padding:32px 24px;text-align:center;">
    <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-1px;">Deal<span style="color:#ffb020;">r</span></div>
    <h1 style="color:#fff;font-size:18px;margin:24px 0 8px;">${title}</h1>
    <p style="color:#a3a3a3;font-size:14px;">${message}</p>
  </div></body></html>`
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

Deno.serve(async (req) => {
  if (!UNSUB_SECRET) return page('No disponible', 'La desuscripción no está configurada todavía.')

  const url = new URL(req.url)
  const userId = url.searchParams.get('u')
  const token = url.searchParams.get('t')
  if (!userId || !token) return page('Link inválido', 'Faltan datos en el link.')

  const expected = await sign(userId)
  if (token !== expected) return page('Link inválido', 'Este link no es válido.')

  const { error } = await admin.from('profiles').update({ email_marketing: false }).eq('id', userId)
  if (error) return page('Error', 'No pudimos procesar tu pedido. Probá de nuevo más tarde.')

  return page('Listo', 'No vas a recibir más mails de novedades de Dealr. Los avisos de tus chats y ofertas siguen llegando como siempre.')
})
