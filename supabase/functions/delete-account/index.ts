// Edge Function: elimina (anonimiza) la cuenta del usuario que la invoca.
//
// NO es un borrado destructivo: banear en auth.users requiere el Admin API
// (service role), así que se hace todo acá en vez de un RPC de Postgres.
// Como el cliente admin usa la service_role key, auth.uid() es NULL en esas
// consultas — bypasea RLS y el trigger protect_profile_columns (que solo
// pinea columnas cuando auth.uid() no es null), sin necesitar el flag
// dealr.moderation.
//
// Flujo: valida obligaciones activas de subasta → si hay, bloquea con un
// mensaje claro. Si no hay, registra el motivo, pausa sus publicaciones
// activas, borra su avatar del storage (si era una foto subida, no una URL
// de Google), scrubea los datos personales del perfil, y banea la cuenta
// (auth.admin.updateUserById con una duración larga: GoTrue no tiene "ban
// permanente" nativo, así que se usa un valor gigante).
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY los inyecta
// Supabase. Deploy:  supabase functions deploy delete-account

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // 1) Identificar a quien llama (cualquier usuario logueado, no solo admin).
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'No autenticado' }, 401)
  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: me } } = await caller.auth.getUser()
  if (!me) return json({ error: 'Sesión inválida' }, 401)

  let reason = ''
  let detail = ''
  try {
    const body = await req.json()
    reason = String(body.reason ?? '').trim()
    detail = String(body.detail ?? '').trim().slice(0, 500)
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  if (!reason) return json({ error: 'Falta el motivo' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // 2) Los admins no se eliminan por acá (evita que alguien se auto-bloquee
  // el acceso a /admin sin querer; la baja de un admin se gestiona a mano).
  const { data: profile } = await admin
    .from('profiles')
    .select('username, avatar_url, is_admin')
    .eq('id', me.id)
    .maybeSingle()
  if (!profile) return json({ error: 'Perfil no encontrado' }, 404)
  if (profile.is_admin) {
    return json({ error: 'Las cuentas de administrador no se eliminan desde acá. Escribinos por soporte.' }, 403)
  }

  // 3) Obligaciones de subasta activas: bloquear con un mensaje claro.
  const nowIso = new Date().toISOString()

  const { count: sellingNow } = await admin
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', me.id)
    .eq('is_auction', true)
    .eq('status', 'active')
    .eq('auction_closed', false)
    .gt('auction_ends_at', nowIso)
  if ((sellingNow ?? 0) > 0) {
    return json({ error: 'Tenés una subasta activa como vendedor. Esperá a que termine antes de eliminar tu cuenta.' }, 409)
  }

  const { data: myBidListingIds } = await admin.from('bids').select('listing_id').eq('bidder_id', me.id)
  const listingIds = [...new Set((myBidListingIds ?? []).map((b) => b.listing_id))]
  if (listingIds.length > 0) {
    const { count: biddingNow } = await admin
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .in('id', listingIds)
      .eq('is_auction', true)
      .eq('status', 'active')
      .eq('auction_closed', false)
      .gt('auction_ends_at', nowIso)
    if ((biddingNow ?? 0) > 0) {
      return json({ error: 'Tenés una oferta activa en una subasta en curso. Esperá a que termine antes de eliminar tu cuenta.' }, 409)
    }
  }

  const { count: pendingPickup } = await admin
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .or(`seller_id.eq.${me.id},sold_to.eq.${me.id}`)
    .eq('is_auction', true)
    .eq('status', 'sold')
    .or('buyer_confirmed_pickup.eq.false,seller_confirmed_pickup.eq.false')
  if ((pendingPickup ?? 0) > 0) {
    return json({ error: 'Tenés una entrega de subasta pendiente de confirmar. Resolvé eso antes de eliminar tu cuenta.' }, 409)
  }

  // 4) Sin obligaciones pendientes: procedemos.

  // Borrar el avatar del storage si era una foto subida (no una URL externa
  // de Google, que no vive en nuestro bucket).
  if (profile.avatar_url && !/^https?:\/\//i.test(profile.avatar_url)) {
    await admin.storage.from('listing-photos').remove([profile.avatar_url]).catch(() => {})
  }

  // Pausar sus publicaciones activas: no hay quien responda mensajes.
  await admin.from('listings').update({ status: 'paused' }).eq('seller_id', me.id).eq('status', 'active')

  // Registrar el motivo (sin más dato personal que el user_id, para métricas).
  await admin.from('account_deletions').insert({ user_id: me.id, reason, detail: detail || null })

  // Scrub de datos personales. El username se mantiene único (sufijo del id).
  const { error: updErr } = await admin
    .from('profiles')
    .update({
      username: `usuario_eliminado_${me.id.slice(0, 8)}`,
      avatar_url: null,
      zone: null,
      lat: null,
      lng: null,
      phone_verified: false,
      identity_verified: false,
      identity_verified_at: null,
      didit_session_id: null,
      account_restricted: true,
    })
    .eq('id', me.id)
  if (updErr) return json({ error: updErr.message }, 500)

  // Banear la cuenta: GoTrue no tiene "permanente" nativo, se usa un valor
  // enorme (~100 años). Ya no puede volver a entrar (magic link ni Google).
  const { error: banErr } = await admin.auth.admin.updateUserById(me.id, { ban_duration: '876000h' })
  if (banErr) return json({ error: banErr.message }, 500)

  return json({ ok: true })
})
