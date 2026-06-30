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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Solo el estado final aprobado otorga el badge.
  if (status === 'Approved') {
    const { error } = await supabase
      .from('profiles')
      .update({
        identity_verified: true,
        identity_verified_at: new Date().toISOString(),
        didit_session_id: sessionId,
      })
      .eq('id', userId)
    if (error) return new Response(`DB error: ${error.message}`, { status: 500 })
  } else {
    // Rechazo / no aprobado. Didit NO aprueba a menores de 18 (valida la edad él
    // mismo; nosotros NO guardamos la fecha de nacimiento → privacidad). Si el
    // rechazo es por EDAD, restringimos la cuenta. Logueamos el payload para
    // afinar la detección con un rechazo real (los nombres de campo dependen de
    // la config de Didit).
    console.log('Didit no-approved payload:', rawBody)
    const blob = rawBody.toLowerCase()
    const ageDecline =
      blob.includes('underage') ||
      blob.includes('under age') ||
      blob.includes('under_age') ||
      blob.includes('menor de edad') ||
      blob.includes('age_not_met') ||
      blob.includes('below_minimum_age') ||
      blob.includes('minimum age') ||
      blob.includes('age requirement') ||
      blob.includes('requisito de edad')
    if (ageDecline) {
      const { error } = await supabase
        .from('profiles')
        .update({ is_minor: true, account_restricted: true })
        .eq('id', userId)
      if (error) return new Response(`DB error: ${error.message}`, { status: 500 })
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
