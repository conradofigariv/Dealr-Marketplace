// Edge Function: webhook de resultado de verificación de identidad (Didit).
//
// Configuración (secrets de la función):
//   supabase secrets set DIDIT_WEBHOOK_SECRET=...
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
//
// En Didit, apuntar el webhook a:
//   https://<proyecto>.supabase.co/functions/v1/didit-webhook
// y desplegar con --no-verify-jwt (el webhook se autentica por firma HMAC):
//   supabase functions deploy didit-webhook --no-verify-jwt
//
// IMPORTANTE: Dealr no almacena fotos del DNI, selfies ni datos del
// documento. Solo se guarda el resultado (identity_verified) y el
// session_id de Didit para auditoría y soporte.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const encoder = new TextEncoder()

async function verifySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  // Comparación de longitud constante
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const secret = Deno.env.get('DIDIT_WEBHOOK_SECRET')
  if (!secret) return new Response('Webhook secret not configured', { status: 500 })

  const rawBody = await req.text()
  const signature = req.headers.get('x-signature')
  if (!(await verifySignature(rawBody, signature, secret))) {
    return new Response('Invalid signature', { status: 401 })
  }

  const payload = JSON.parse(rawBody)
  // vendor_data lleva el uuid del usuario de Dealr, seteado al crear la sesión
  // de verificación desde el cliente.
  const userId: string | undefined = payload.vendor_data
  const sessionId: string | undefined = payload.session_id
  const status: string | undefined = payload.status

  if (!userId || !sessionId) return new Response('Missing vendor_data or session_id', { status: 400 })

  // Solo el estado final aprobado otorga el badge. Si falla o queda en
  // revisión, el perfil simplemente no lo muestra: no se bloquea nada.
  if (status === 'Approved') {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { error } = await supabase
      .from('profiles')
      .update({
        identity_verified: true,
        identity_verified_at: new Date().toISOString(),
        didit_session_id: sessionId,
      })
      .eq('id', userId)
    if (error) return new Response(`DB error: ${error.message}`, { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
