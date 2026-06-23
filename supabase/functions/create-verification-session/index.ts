// Edge Function: crea una sesión de verificación de identidad en Didit y
// devuelve la URL a la que mandar al usuario. El RESULTADO lo recibe aparte la
// función `didit-webhook` (que marca identity_verified al aprobarse).
//
// Se autentica con el JWT del usuario (NO usar --no-verify-jwt acá): así el
// `vendor_data` = id del usuario es de confianza y no se puede falsear.
//
// Secrets de la función:
//   supabase secrets set DIDIT_API_KEY=...
//   supabase secrets set DIDIT_WORKFLOW_ID=...
//   (opcional) supabase secrets set DIDIT_BASE_URL=https://verification.didit.me
// SUPABASE_URL y SUPABASE_ANON_KEY los inyecta Supabase.
//
// Deploy (con verificación de JWT, default):
//   supabase functions deploy create-verification-session

import { createClient } from 'jsr:@supabase/supabase-js@2'

const DIDIT_API_KEY = Deno.env.get('DIDIT_API_KEY')
const DIDIT_WORKFLOW_ID = Deno.env.get('DIDIT_WORKFLOW_ID')
const DIDIT_BASE_URL = Deno.env.get('DIDIT_BASE_URL') ?? 'https://verification.didit.me'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!DIDIT_API_KEY || !DIDIT_WORKFLOW_ID) {
    return json({ error: 'Didit no está configurado todavía.' }, 503)
  }

  // Identificar al usuario por su JWT (viene en el header Authorization).
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'No autenticado' }, 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return json({ error: 'Sesión inválida' }, 401)

  // A dónde vuelve el usuario tras verificar (la pasa el cliente).
  let redirectUrl: string | undefined
  try {
    redirectUrl = (await req.json())?.redirectUrl
  } catch {
    /* body opcional */
  }

  // Crear la sesión en Didit. vendor_data = id del usuario → el webhook lo usa
  // para marcar el perfil correcto.
  const res = await fetch(`${DIDIT_BASE_URL}/v2/session/`, {
    method: 'POST',
    headers: { 'x-api-key': DIDIT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_id: DIDIT_WORKFLOW_ID,
      vendor_data: user.id,
      callback: redirectUrl,
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    console.error('Didit error', res.status, detail)
    return json({ error: 'No se pudo iniciar la verificación. Probá más tarde.' }, 502)
  }

  const data = await res.json()
  // La URL a la que mandar al usuario (Didit la nombra `url` o `verification_url`).
  const url = data.url ?? data.verification_url ?? data.session_url
  if (!url) return json({ error: 'Respuesta de Didit sin URL' }, 502)

  return json({ url })
})
