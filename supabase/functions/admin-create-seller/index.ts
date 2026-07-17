// Edge Function: crea (o reusa) una cuenta de vendedor REAL para el flujo
// concierge del admin ("publicar en nombre de un vendedor"). Devuelve el
// user_id + username para que el front publique atribuido a esa persona.
//
// Por qué una Edge Function: crear cuentas de auth requiere service role
// (el cliente, aunque sea admin, no puede). La cuenta se crea con el EMAIL
// REAL del vendedor y email_confirm=true (sin mandar mail): así es reclamable
// —cuando el vendedor entre con magic link a ese email, encuentra su
// publicación y sus mensajes esperándolo—. Nada de cuentas fantasma.
//
// Seguridad: se identifica a quien llama por su JWT y se exige is_admin().
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY los inyecta
// Supabase. Deploy:  supabase functions deploy admin-create-seller

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// Nombre → username válido (3-30 chars). Recorta y rellena si hace falta.
function toUsername(name: string): string {
  let u = name.trim().replace(/\s+/g, ' ').slice(0, 30)
  if (u.length < 3) u = (u + '___').slice(0, 3)
  return u
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // 1) Identificar a quien llama y exigir admin.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'No autenticado' }, 401)
  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: me } } = await caller.auth.getUser()
  if (!me) return json({ error: 'Sesión inválida' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
  const { data: myProfile } = await admin.from('profiles').select('is_admin').eq('id', me.id).maybeSingle()
  if (!myProfile?.is_admin) return json({ error: 'Solo para administradores' }, 403)

  // 2) Leer input.
  let email = ''
  let name = ''
  let appUrl: string | undefined
  try {
    const body = await req.json()
    email = String(body.email ?? '').trim().toLowerCase()
    name = String(body.name ?? '').trim()
    appUrl = String(body.appUrl ?? '').replace(/\/+$/, '') || undefined
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Email inválido' }, 400)
  if (name.length < 2) return json({ error: 'Falta el nombre del vendedor' }, 400)

  // 3) Username único (el trigger handle_new_user lo toma de user_metadata).
  let username = toUsername(name)
  const { data: clash } = await admin.from('profiles').select('id').eq('username', username).maybeSingle()
  if (clash) username = toUsername(username.slice(0, 24) + '-' + Math.floor(Math.random() * 9000 + 1000))

  // Reusar cuenta si el email ya existe (paginado; la app es chica).
  async function findExisting(): Promise<{ user_id: string; username: string } | null> {
    for (let page = 1; page <= 20; page++) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      const found = list?.users?.find((u) => u.email?.toLowerCase() === email)
      if (found) {
        const { data: prof } = await admin.from('profiles').select('username').eq('id', found.id).maybeSingle()
        return { user_id: found.id, username: prof?.username ?? username }
      }
      if (!list || list.users.length < 200) break
    }
    return null
  }

  // 4) Preferimos INVITAR: crea la cuenta Y manda el mail de acceso (usa el
  // SMTP configurado en Supabase). El vendedor recibe un link para entrar.
  const invite = await admin.auth.admin.inviteUserByEmail(email, {
    data: { username, full_name: name },
    redirectTo: appUrl,
  })
  if (invite.data?.user && !invite.error) {
    return json({ user_id: invite.data.user.id, username, reused: false, emailed: true })
  }
  if (invite.error?.message?.toLowerCase().includes('already') || invite.error?.status === 422) {
    const existing = await findExisting()
    if (existing) return json({ ...existing, reused: true, emailed: false })
  }

  // El invite falló (típicamente porque no hay SMTP configurado): creamos la
  // cuenta igual, sin mail, para no bloquear el flujo. El admin le pasa el
  // acceso por WhatsApp; emailed:false se lo avisa.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { username, full_name: name },
  })
  if (created?.user) {
    return json({ user_id: created.user.id, username, reused: false, emailed: false })
  }
  if (createErr?.message?.toLowerCase().includes('already') || createErr?.status === 422) {
    const existing = await findExisting()
    if (existing) return json({ ...existing, reused: true, emailed: false })
  }

  return json({ error: createErr?.message ?? invite.error?.message ?? 'No se pudo crear la cuenta' }, 500)
})
