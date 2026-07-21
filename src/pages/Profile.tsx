import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useAuthGate } from '../hooks/useAuthGate'
import { formatPrice, timeAgo } from '../lib/format'
import { compressAvatar } from '../lib/images'
import type { Listing } from '../lib/types'
import Avatar from '../components/Avatar'
import SellerBadges from '../components/SellerBadges'
import StarRating from '../components/StarRating'
import Modal from '../components/Modal'
import SellFlowModal from '../components/SellFlowModal'
import NotificationSettings from '../components/NotificationSettings'
import InstallButton from '../components/InstallButton'
import SupportModal from '../components/SupportModal'
import TermsModal from '../components/TermsModal'
import DeleteAccountModal from '../components/DeleteAccountModal'
import { useToast } from '../components/Toast'
import { canUseCotillon, sendCotillon } from '../lib/cotillon'
import { checkForUpdate } from '../lib/swUpdate'
import { replayIntro } from '../lib/intro'
import { invalidateFeedCache } from './Home'

const statusLabels: Record<Listing['status'], string> = {
  active: 'Activa',
  paused: 'Pausada',
  sold: 'Vendida',
  expired: 'Vencida',
  reserved: 'Reservada',
}

export default function Profile() {
  const navigate = useNavigate()
  const { session, profile, profileError, loading, refreshProfile } = useAuth()
  const [listings, setListings] = useState<Listing[]>([])
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameError, setNameError] = useState('')
  const [editingZone, setEditingZone] = useState(false)
  const [zoneDraft, setZoneDraft] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')

  // Inicia la verificación de identidad: crea la sesión en Didit (Edge Function)
  // y manda al usuario a la URL. El resultado lo recibe el webhook didit-webhook.
  async function startVerification() {
    setVerifying(true)
    setVerifyError('')
    const { data, error } = await supabase.functions.invoke('create-verification-session', {
      body: { redirectUrl: `${window.location.origin}/perfil` },
    })
    setVerifying(false)
    if (error || !data?.url) {
      setVerifyError('La verificación todavía no está disponible. Te avisamos cuando puedas hacerla.')
      return
    }
    window.location.href = data.url as string
  }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [myListingsOpen, setMyListingsOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Listing | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [sellTarget, setSellTarget] = useState<Listing | null>(null)
  // Reactivar una subasta finalizada = relanzarla: hay que volver a elegir la
  // duración (y se resetean las ofertas). Este target abre el picker de duración.
  const [reactivateAuctionTarget, setReactivateAuctionTarget] = useState<Listing | null>(null)
  const [reactivateDays, setReactivateDays] = useState(3)
  const [reactivating, setReactivating] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [sendingCotillon, setSendingCotillon] = useState(false)
  // "Mis ofertas": subastas donde pujé (bids, RLS deja leer las propias) y
  // publicaciones donde hice una oferta (offers). Agrupadas por publicación.
  const [myOffers, setMyOffers] = useState<
    {
      listing: Listing
      myMax: number
      latest: string
      kind: 'bid' | 'offer'
      offerStatus?: string
    }[]
  >([])
  const [myOffersOpen, setMyOffersOpen] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)
  const toast = useToast()

  // Easter egg del cotillón (solo para los dueños; ver lib/cotillon.ts).
  async function throwCotillon() {
    setSendingCotillon(true)
    try {
      await sendCotillon(profile?.username || 'Alguien')
      toast('🎉 ¡Cotillón enviado!')
    } catch {
      toast('No se pudo enviar. ¿Está online del otro lado?')
    } finally {
      setSendingCotillon(false)
    }
  }

  // Chequeo manual de versión nueva. Si la encuentra, UpdatePrompt muestra el
  // aviso para actualizar; si no, avisamos que ya está al día.
  async function checkUpdate() {
    setCheckingUpdate(true)
    // Mínimo 2s de spinner aunque el chequeo sea instantáneo (se siente que
    // "hizo algo" en vez de un parpadeo).
    const [result] = await Promise.all([checkForUpdate(), new Promise((r) => setTimeout(r, 2000))])
    setCheckingUpdate(false)
    if (result === true) {
      setSettingsOpen(false)
      toast('Hay una versión nueva. Tocá "Actualizar" para aplicarla.')
    } else if (result === false) {
      toast('Ya tenés la última versión.')
    } else {
      toast('No se pudo chequear (la app todavía no está instalada como PWA).')
    }
  }

  // Guardia tolerante al resume de la PWA (ver useAuthGate).
  useAuthGate('/perfil')

  async function loadListings() {
    if (!session) return
    const { data } = await supabase
      .from('listings')
      .select('*')
      .eq('seller_id', session.user.id)
      .order('created_at', { ascending: false })
    setListings(data ?? [])
  }

  // Cargar "Mis ofertas": pujas de subasta propias + ofertas en precio fijo.
  // Se agrupan por publicación quedándose con el monto máximo y la fecha más
  // reciente. Best-effort: cualquier error deja la sección vacía.
  useEffect(() => {
    if (!session) return
    const uid = session.user.id
    const LISTING_COLS = 'id, title, photos, price, currency, status, is_auction, current_bid, auction_closed, auction_ends_at, sold_to'
    Promise.all([
      supabase.from('bids').select(`amount, created_at, listing:listings(${LISTING_COLS})`).eq('bidder_id', uid),
      supabase.from('offers').select(`amount, created_at, status, listing:listings(${LISTING_COLS})`).eq('buyer_id', uid),
    ]).then(([bidsRes, offersRes]) => {
      const map = new Map<string, (typeof myOffers)[number]>()
      const add = (row: { amount: number; created_at: string; status?: string; listing: Listing | null }, kind: 'bid' | 'offer') => {
        const l = row.listing
        if (!l) return
        const prev = map.get(`${kind}-${l.id}`)
        if (prev) {
          prev.myMax = Math.max(prev.myMax, row.amount)
          if (row.created_at > prev.latest) {
            prev.latest = row.created_at
            if (kind === 'offer') prev.offerStatus = row.status
          }
        } else {
          map.set(`${kind}-${l.id}`, { listing: l, myMax: row.amount, latest: row.created_at, kind, offerStatus: row.status })
        }
      }
      for (const r of (bidsRes.data as never[]) ?? []) add(r, 'bid')
      for (const r of (offersRes.data as never[]) ?? []) add(r, 'offer')
      setMyOffers([...map.values()].sort((a, b) => (a.latest < b.latest ? 1 : -1)))
    })
  }, [session])

  // Chip de estado de cada oferta mía.
  function offerChip(o: (typeof myOffers)[number]): { label: string; cls: string } {
    const l = o.listing
    if (o.kind === 'bid') {
      const ended = l.auction_closed || l.status !== 'active' || (l.auction_ends_at != null && new Date(l.auction_ends_at).getTime() <= Date.now())
      if (ended) {
        return l.sold_to === session?.user.id
          ? { label: '🏆 Ganaste', cls: 'bg-emerald-500/15 text-emerald-400' }
          : { label: 'Finalizada', cls: 'bg-neutral-800 text-neutral-500' }
      }
      return l.current_bid != null && l.current_bid <= o.myMax
        ? { label: 'Ganando', cls: 'bg-emerald-500/15 text-emerald-400' }
        : { label: 'Superado', cls: 'bg-red-500/15 text-red-400' }
    }
    if (o.offerStatus === 'accepted') return { label: 'Aceptada', cls: 'bg-emerald-500/15 text-emerald-400' }
    if (o.offerStatus === 'rejected') return { label: 'Rechazada', cls: 'bg-neutral-800 text-neutral-500' }
    if (o.offerStatus === 'expired') return { label: 'Vencida', cls: 'bg-neutral-800 text-neutral-500' }
    return { label: 'Pendiente', cls: 'bg-amber-500/15 text-amber-400' }
  }

  useEffect(() => {
    loadListings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function saveName() {
    setNameError('')
    const { error } = await supabase
      .from('profiles')
      .update({ username: nameDraft.trim() })
      .eq('id', session!.user.id)
    if (error) {
      setNameError(error.message.includes('unique') ? 'Ese nombre ya está en uso' : error.message)
      return
    }
    setEditingName(false)
    refreshProfile()
  }

  async function changeAvatar(file: File) {
    if (!session || !profile) return
    setUploadingAvatar(true)
    setNameError('')
    try {
      const compressed = await compressAvatar(file)
      const path = `${session.user.id}/avatar-${Date.now()}.webp`
      const { error: upErr } = await supabase.storage.from('listing-photos').upload(path, compressed)
      if (upErr) throw upErr
      const old = profile.avatar_url
      const { error: dbErr } = await supabase.from('profiles').update({ avatar_url: path }).eq('id', session.user.id)
      if (dbErr) throw dbErr
      // Borrar el avatar viejo del storage — salvo que fuera una URL de Google
      // (no vive en el bucket, no hay nada que borrar).
      if (old && !/^https?:\/\//i.test(old)) await supabase.storage.from('listing-photos').remove([old])
      await refreshProfile()
    } catch {
      setNameError('No pudimos subir la foto. Probá de nuevo.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function saveZone() {
    setNameError('')
    const zone = zoneDraft.trim().slice(0, 60)
    const { error } = await supabase
      .from('profiles')
      .update({ zone: zone || null })
      .eq('id', session!.user.id)
    if (error) {
      setNameError('No pudimos guardar la zona. Probá de nuevo.')
      return
    }
    setEditingZone(false)
    refreshProfile()
  }

  async function setStatus(listingId: string, status: Listing['status'], renew = false) {
    const patch: Record<string, unknown> = { status }
    if (renew) patch.last_renewed_at = new Date().toISOString()
    // Volver a 'active' (reactivar/renovar) borra la marca de venta: la
    // publicación vuelve a estar realmente disponible.
    if (status === 'active') patch.sold_to = null
    setNameError('')
    const { error } = await supabase.from('listings').update(patch).eq('id', listingId)
    if (error) {
      setNameError('No pudimos actualizar la publicación. Probá de nuevo.')
      return
    }
    invalidateFeedCache()
    loadListings()
  }

  // Relanza una subasta finalizada: status→active, ofertas a cero y un nuevo
  // auction_ends_at según la duración elegida. Va por el RPC `relaunch_auction`
  // (00041): las columnas de subasta ya no se pueden tocar con update directo
  // (trigger protect_listing_columns). Si la migración todavía no está aplicada
  // (el RPC no existe), cae al update directo de antes.
  async function reactivateAuction(listing: Listing, days: number) {
    setReactivating(true)
    let failed = false
    const { data, error } = await supabase.rpc('relaunch_auction', { p_listing: listing.id, p_days: days })
    if (error && /function|schema cache/i.test(error.message)) {
      // Fallback pre-00041: update directo (el trigger aún no existe, funciona).
      const { error: updErr } = await supabase
        .from('listings')
        .update({
          status: 'active',
          last_renewed_at: new Date().toISOString(),
          sold_to: null,
          auction_closed: false,
          auction_ends_at: new Date(Date.now() + days * 86400000).toISOString(),
          current_bid: null,
          bids_count: 0,
        })
        .eq('id', listing.id)
      failed = Boolean(updErr)
    } else {
      // El RPC devuelve null en éxito o un mensaje de error en texto.
      failed = Boolean(error) || Boolean(data)
    }
    setReactivating(false)
    if (failed) {
      setNameError('No pudimos reactivar la subasta. Probá de nuevo.')
      return
    }
    setReactivateAuctionTarget(null)
    invalidateFeedCache()
    loadListings()
  }

  async function deleteListing(listing: Listing) {
    setDeleting(true)
    // Primero la fila, después las fotos (best-effort): si el delete falla, la
    // publicación sigue viva CON sus fotos (el orden inverso dejaba avisos con
    // imágenes rotas). Preguntas y ofertas caen por el cascade del FK; los
    // chats NO: su FK es `on delete set null` (00027), así que la conversación
    // sobrevive con la publicación marcada como eliminada.
    const { error } = await supabase.from('listings').delete().eq('id', listing.id)
    if (error) {
      setDeleting(false)
      setNameError('No pudimos eliminar la publicación. Probá de nuevo.')
      return
    }
    if (listing.photos.length) {
      await supabase.storage.from('listing-photos').remove(listing.photos)
    }
    setDeleting(false)
    setDeleteTarget(null)
    setListings((prev) => prev.filter((l) => l.id !== listing.id))
  }

  async function logout() {
    await supabase.auth.signOut()
    navigate('/')
  }

  // Sesión sin perfil cargado: mostrar estado en vez de pantalla negra.
  if (!profile) {
    if (loading || !session) return <div className="min-h-dvh bg-black" />
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-10 text-center">
        <p className="text-base text-neutral-400">No pudimos cargar tu perfil.</p>
        {profileError && <p className="break-words text-sm text-neutral-600">{profileError}</p>}
        <button
          onClick={() => refreshProfile()}
          className="rounded-full bg-white px-6 py-2.5 text-base font-semibold text-black"
        >
          Reintentar
        </button>
        <button onClick={logout} className="text-base text-neutral-500">
          Cerrar sesión
        </button>
      </div>
    )
  }

  return (
    <div className="pb-28">
      <header className="relative px-5 pb-6 pt-[max(2rem,env(safe-area-inset-top))] text-center">
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Configuración"
          className="absolute right-4 top-[max(1.5rem,calc(env(safe-area-inset-top)+0.5rem))] rounded-full p-2 text-neutral-400 transition hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button
          onClick={() => avatarInput.current?.click()}
          disabled={uploadingAvatar}
          aria-label="Cambiar foto de perfil"
          className="relative mx-auto mb-4 block disabled:opacity-60"
        >
          <Avatar profile={profile} size="lg" />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-white text-black ring-2 ring-black">
            {uploadingAvatar ? (
              <span className="h-3 w-3 animate-pulse rounded-full bg-black" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
            )}
          </span>
        </button>
        <input
          ref={avatarInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) changeAvatar(file)
            e.target.value = ''
          }}
        />
        {editingName ? (
          <div className="mx-auto flex max-w-xs items-end gap-3">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              minLength={3}
              maxLength={30}
              className="input-line text-center text-xl font-semibold"
            />
            <button onClick={saveName} className="shrink-0 rounded-full bg-white px-3.5 py-1.5 text-sm font-semibold text-black">
              OK
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setNameDraft(profile.username)
              setEditingName(true)
            }}
            className="text-2xl font-bold text-white"
          >
            {profile.username}
            <span className="-m-2 ml-0 inline-block p-2 text-base font-normal text-neutral-400">editar</span>
          </button>
        )}
        <p className="mt-1 text-sm text-neutral-500">
          En Dealr desde {new Date(profile.created_at).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
        </p>
        {editingZone ? (
          <div className="mx-auto mt-2 flex max-w-xs items-end gap-3">
            <input
              autoFocus
              value={zoneDraft}
              onChange={(e) => setZoneDraft(e.target.value)}
              maxLength={60}
              placeholder="Ej: Palermo, CABA"
              className="input-line text-center text-base"
            />
            <button onClick={saveZone} className="shrink-0 rounded-full bg-white px-3.5 py-1.5 text-sm font-semibold text-black">
              OK
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setZoneDraft(profile.zone ?? '')
              setEditingZone(true)
            }}
            className="mt-1 text-sm text-neutral-500"
          >
            {profile.zone ? (
              <>
                <span className="text-neutral-300">{profile.zone}</span>
                <span className="-m-2 ml-0 inline-block p-2 text-neutral-400">editar</span>
              </>
            ) : (
              '+ Agregar tu zona'
            )}
          </button>
        )}
        {nameError && <p className="mt-2 text-sm text-red-400">{nameError}</p>}
        <div className="mt-4 flex justify-center">
          {profile.account_restricted ? (
            <span className="rounded-full bg-red-500/15 px-3 py-1 text-sm font-bold text-red-400 ring-1 ring-red-500/30">
              Cuenta restringida
            </span>
          ) : (
            <SellerBadges profile={profile} />
          )}
        </div>
      </header>

      <div className="space-y-6 px-5">
        {profile.account_restricted && (
          <div className="rounded-2xl bg-red-500/10 px-4 py-3 ring-1 ring-red-500/30">
            <p className="text-base font-semibold text-red-400">Tu cuenta tiene funciones restringidas.</p>
            <p className="mt-0.5 text-sm text-red-400/80">
              Dealr es para mayores de 18 años. No podés publicar, ofertar ni iniciar compras.
            </p>
          </div>
        )}
        {/* Reputación */}
        <div className="surface p-5">
          <h2 className="mb-4 text-base font-semibold text-white">Reputación</h2>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              {profile.seller_score != null ? (
                <div className="flex justify-center"><StarRating value={profile.seller_score} /></div>
              ) : (
                <p className="text-base text-neutral-600">Sin datos aún</p>
              )}
              <p className="mt-1 text-sm text-neutral-500">Vendedor ({profile.seller_ratings_count})</p>
            </div>
            <div>
              {profile.buyer_score != null ? (
                <div className="flex justify-center"><StarRating value={profile.buyer_score} /></div>
              ) : (
                <p className="text-base text-neutral-600">Sin datos aún</p>
              )}
              <p className="mt-1 text-sm text-neutral-500">Comprador ({profile.buyer_ratings_count})</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-neutral-600">
            Los puntajes aparecen al acumular 3 calificaciones. Mientras tanto, tus insignias hablan por vos.
          </p>
          {!profile.identity_verified && (
            <button onClick={() => setVerifyOpen(true)} className="btn-outline mt-4 py-2.5 text-base">
              Verificar mi identidad
            </button>
          )}
        </div>

        <div className="space-y-2">
          <InstallButton />
          <Link
            to="/guardados"
            className="flex items-center justify-between rounded-2xl bg-neutral-900 px-4 py-3.5 ring-1 ring-neutral-800"
          >
            <span className="flex items-center gap-2.5 text-base font-medium text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.6 1-1.1a5.5 5.5 0 0 0 0-7.7z" />
              </svg>
              Guardados
            </span>
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
          <Link
            to="/busquedas"
            className="flex items-center justify-between rounded-2xl bg-neutral-900 px-4 py-3.5 ring-1 ring-neutral-800"
          >
            <span className="flex items-center gap-2.5 text-base font-medium text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              Búsquedas guardadas
            </span>
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
          <div className="overflow-hidden rounded-2xl bg-neutral-900 ring-1 ring-neutral-800">
            <button
              onClick={() => setMyListingsOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3.5"
            >
              <span className="flex items-center gap-2.5 text-base font-medium text-white">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                  <circle cx="7" cy="7" r="1" fill="currentColor" stroke="none" />
                </svg>
                Mis publicaciones
                {listings.length > 0 && (
                  <span className="text-sm font-normal text-neutral-500">({listings.length})</span>
                )}
              </span>
              <svg viewBox="0 0 24 24" className={`h-5 w-5 text-neutral-500 transition ${myListingsOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
            {myListingsOpen && (
              <div className="sheet-in border-t border-neutral-800 px-4 py-4">
                <div className="mb-3 flex items-center justify-end">
                  <Link to="/publicar" className="text-sm font-semibold text-neutral-400">+ Vender algo</Link>
                </div>
                {listings.length === 0 ? (
                  <p className="py-2 text-base text-neutral-600">Todavía no publicaste nada.</p>
                ) : (
                  <ul className="space-y-4">
                    {listings.map((l) => (
                      <li key={l.id} className="flex gap-4">
                        <Link to={`/p/${l.id}`} className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-neutral-800">
                          {l.photos[0] && <img src={photoUrl(l.photos[0])} alt="" className="h-full w-full object-cover" />}
                        </Link>
                        <div className="min-w-0 flex-1">
                          <Link to={`/p/${l.id}`} className="block truncate text-base font-semibold text-white">{l.title}</Link>
                          <p className="text-sm text-neutral-500">
                            {formatPrice(l.price, l.currency)} ·{' '}
                            <span className={l.status === 'active' ? 'text-white' : ''}>{statusLabels[l.status]}</span>
                            {l.status === 'active' && ` · renovada ${timeAgo(l.last_renewed_at)}`}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {l.status === 'active' ? (
                              <>
                                <button onClick={() => setStatus(l.id, 'active', true)} className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black">
                                  Sigue disponible
                                </button>
                                {/* Una subasta EN CURSO no se marca vendida a mano: la vende
                                    el cierre (o quedaría un ganador robado y auction_closed
                                    inconsistente). El botón solo aparece en precio fijo. */}
                                {!l.is_auction && (
                                  <button onClick={() => setSellTarget(l)} className="rounded-full px-3 py-1 text-[11px] font-semibold text-neutral-400 ring-1 ring-neutral-700">
                                    Ya lo vendí
                                  </button>
                                )}
                              </>
                            ) : l.is_auction ? (
                              <button
                                onClick={() => {
                                  setReactivateDays(3)
                                  setReactivateAuctionTarget(l)
                                }}
                                className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black"
                              >
                                Relanzar subasta
                              </button>
                            ) : (
                              <button onClick={() => setStatus(l.id, 'active', true)} className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black">
                                Reactivar
                              </button>
                            )}
                            <button onClick={() => setDeleteTarget(l)} className="rounded-full px-3 py-1 text-[11px] font-semibold text-red-400/90 ring-1 ring-red-500/30">
                              Eliminar
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          {/* Mis ofertas: subastas donde pujé y publicaciones donde oferté.
              Solo aparece si hay alguna. */}
          {myOffers.length > 0 && (
            <div className="overflow-hidden rounded-2xl bg-neutral-900 ring-1 ring-neutral-800">
              <button
                onClick={() => setMyOffersOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3.5"
              >
                <span className="flex items-center gap-2.5 text-base font-medium text-white">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m14 13-8.5 8.5a2.12 2.12 0 1 1-3-3L11 10" />
                    <path d="m16 16 6-6" />
                    <path d="m8 8 6-6" />
                    <path d="m9 7 8 8" />
                    <path d="m21 11-8-8" />
                  </svg>
                  Mis ofertas
                  <span className="text-sm font-normal text-neutral-500">({myOffers.length})</span>
                </span>
                <svg viewBox="0 0 24 24" className={`h-5 w-5 text-neutral-500 transition ${myOffersOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
              {myOffersOpen && (
                <ul className="sheet-in space-y-4 border-t border-neutral-800 px-4 py-4">
                  {myOffers.map((o) => {
                    const chip = offerChip(o)
                    return (
                      <li key={`${o.kind}-${o.listing.id}`} className="flex gap-4">
                        <Link to={`/p/${o.listing.id}`} className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-neutral-800">
                          {o.listing.photos?.[0] && (
                            <img src={photoUrl(o.listing.photos[0])} alt="" className="h-full w-full object-cover" />
                          )}
                        </Link>
                        <div className="min-w-0 flex-1">
                          <Link to={`/p/${o.listing.id}`} className="block truncate text-base font-semibold text-white">
                            {o.listing.title}
                          </Link>
                          <p className="mt-0.5 text-sm text-neutral-500">
                            {o.kind === 'bid' ? 'Tu puja' : 'Tu oferta'}:{' '}
                            <span className="font-semibold text-white">{formatPrice(o.myMax, o.listing.currency)}</span>
                            {o.kind === 'bid' && o.listing.current_bid != null && (
                              <> · actual {formatPrice(o.listing.current_bid, o.listing.currency)}</>
                            )}
                          </p>
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.cls}`}>{chip.label}</span>
                            <span className="text-[11px] text-neutral-600">{timeAgo(o.latest)}</span>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
          <Link
            to="/opiniones"
            className="flex items-center justify-between rounded-2xl bg-neutral-900 px-4 py-3.5 ring-1 ring-neutral-800"
          >
            <span className="flex items-center gap-2.5 text-base font-medium text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              Opiniones y mejoras
            </span>
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
          {profile?.is_admin && (
            <Link
              to="/admin"
              state={{ openConcierge: true }}
              className="flex items-center justify-between rounded-2xl bg-neutral-900 px-4 py-3.5 ring-1 ring-amber-500/30"
            >
              <span className="flex items-center gap-2.5 text-base font-medium text-white">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M19 8v6M22 11h-6" />
                </svg>
                Crear vendedor y publicar
              </span>
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </Link>
          )}
          {profile?.is_admin && (
            <Link
              to="/admin"
              className="flex items-center justify-between rounded-2xl bg-neutral-900 px-4 py-3.5 ring-1 ring-red-900/50"
            >
              <span className="flex items-center gap-2.5 text-base font-medium text-white">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                Moderación · Reportes
              </span>
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </Link>
          )}
        </div>

        <button onClick={logout} className="w-full py-3 text-center text-base text-neutral-500">
          Cerrar sesión
        </button>
      </div>

      {verifyOpen && (
        <Modal title="Verificar identidad" onClose={() => setVerifyOpen(false)}>
          <div className="space-y-4 text-base text-neutral-400">
            <p>
              La verificación valida tu DNI contra RENAPER con una foto del documento y una selfie.
              Es opcional y gratuita, y te da la insignia{' '}
              <strong className="text-white">✓ Identidad verificada</strong> en tu perfil y en todas
              tus publicaciones.
            </p>
            <p>
              Tus fotos y datos del documento <strong className="text-white">no se guardan en Dealr</strong>;
              solo el resultado de la verificación.
            </p>
            {verifyError && (
              <p className="rounded-xl bg-neutral-900 p-3.5 text-sm text-neutral-400 ring-1 ring-neutral-800">
                {verifyError}
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setVerifyOpen(false)}
                className="flex-1 rounded-full py-3 text-base font-semibold text-neutral-300 ring-1 ring-neutral-700"
              >
                Ahora no
              </button>
              <button onClick={startVerification} disabled={verifying} className="btn-primary flex-1 disabled:opacity-60">
                {verifying ? 'Abriendo…' : 'Verificar ahora'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Eliminar publicación" onClose={() => !deleting && setDeleteTarget(null)}>
          <div className="space-y-5 text-base text-neutral-400">
            <p>
              Vas a eliminar <strong className="text-white">{deleteTarget.title}</strong> de forma
              permanente. También se borran sus preguntas y ofertas. Los chats se conservan (sin la
              publicación). Esta acción no se puede deshacer.
            </p>
            <p className="text-sm text-neutral-600">
              Si solo querés que deje de aparecer, mejor usá <strong className="text-neutral-400">Pausar</strong> o <strong className="text-neutral-400">Ya lo vendí</strong>.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 rounded-full py-3 text-base font-semibold text-neutral-300 ring-1 ring-neutral-700 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteListing(deleteTarget)}
                disabled={deleting}
                className="flex-1 rounded-full bg-red-500 py-3 text-base font-semibold text-white disabled:opacity-50"
              >
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {sellTarget && (
        <SellFlowModal
          listingId={sellTarget.id}
          sellerId={sellTarget.seller_id}
          onClose={() => setSellTarget(null)}
          onSold={loadListings}
        />
      )}

      {reactivateAuctionTarget && (
        <Modal title="Relanzar subasta" onClose={() => !reactivating && setReactivateAuctionTarget(null)}>
          <div className="space-y-5 text-base text-neutral-400">
            <p>
              Vas a volver a publicar <strong className="text-white">{reactivateAuctionTarget.title}</strong> como
              una subasta nueva. Las ofertas anteriores se reinician. Elegí cuánto va a durar:
            </p>
            <div>
              <span className="mb-2 block text-sm font-semibold uppercase tracking-wide text-neutral-500">Duración</span>
              <div className="flex gap-1.5">
                {[1, 3, 7].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setReactivateDays(d)}
                    className={`flex-1 rounded-full py-2.5 text-base font-semibold transition ${
                      reactivateDays === d ? 'bg-white text-black' : 'text-neutral-300 ring-1 ring-neutral-700'
                    }`}
                  >
                    {d} {d === 1 ? 'día' : 'días'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setReactivateAuctionTarget(null)}
                disabled={reactivating}
                className="flex-1 rounded-full py-3 text-base font-semibold text-neutral-300 ring-1 ring-neutral-700 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => reactivateAuction(reactivateAuctionTarget, reactivateDays)}
                disabled={reactivating}
                className="flex-1 rounded-full bg-white py-3 text-base font-semibold text-black disabled:opacity-50"
              >
                {reactivating ? 'Publicando…' : 'Relanzar'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {settingsOpen && (
        <Modal title="Configuración" onClose={() => setSettingsOpen(false)}>
          <div className="space-y-2 text-base">
            <NotificationSettings />
            {/* Antes: "Privacidad y datos · Próximamente" (fila muerta). Ahora
                abre los Términos ya aceptados, en modo lectura. */}
            <button
              onClick={() => setTermsOpen(true)}
              className="flex w-full items-center justify-between rounded-xl bg-neutral-900 px-4 py-3.5 text-left ring-1 ring-neutral-800 transition hover:ring-neutral-700"
            >
              <span className="text-neutral-300">Términos y Condiciones</span>
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
            {canUseCotillon(session?.user?.email) && (
              <button
                onClick={throwCotillon}
                disabled={sendingCotillon}
                className="flex w-full items-center justify-between rounded-xl bg-gradient-to-r from-amber-500/15 to-pink-500/15 px-4 py-3.5 text-left ring-1 ring-amber-500/30 transition hover:ring-amber-500/50 disabled:opacity-60"
              >
                <span className="font-medium text-amber-300">🎉 Mandar cotillón</span>
                {sendingCotillon ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500/40 border-t-amber-300" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-400/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12 7-7 7 7" />
                    <path d="M12 19V5" />
                  </svg>
                )}
              </button>
            )}
            <button
              onClick={checkUpdate}
              disabled={checkingUpdate}
              className="flex w-full items-center justify-between rounded-xl bg-neutral-900 px-4 py-3.5 text-left ring-1 ring-neutral-800 transition hover:ring-neutral-700 disabled:opacity-60"
            >
              <span className="text-neutral-300">Chequear actualización</span>
              {checkingUpdate ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-neutral-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
              )}
            </button>
            {profile.is_admin && (
              <button
                onClick={() => {
                  setSettingsOpen(false)
                  replayIntro()
                }}
                className="flex w-full items-center justify-between rounded-xl bg-neutral-900 px-4 py-3.5 text-left ring-1 ring-amber-500/30 transition hover:ring-amber-500/50"
              >
                <span className="text-amber-400">Ver onboarding (moderador)</span>
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-400/70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            )}
            <button
              onClick={() => {
                setSettingsOpen(false)
                setSupportOpen(true)
              }}
              className="flex w-full items-center justify-between rounded-xl bg-neutral-900 px-4 py-3.5 text-left ring-1 ring-neutral-800 transition hover:ring-neutral-700"
            >
              <span className="text-neutral-300">Ayuda y soporte</span>
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-neutral-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
            <button
              onClick={() => {
                setSettingsOpen(false)
                logout()
              }}
              className="mt-2 w-full rounded-xl px-4 py-3.5 text-left text-base font-medium text-red-400/90 ring-1 ring-neutral-800 transition hover:ring-neutral-700"
            >
              Cerrar sesión
            </button>
            {/* Zona de peligro: separada del resto, no compite visualmente con
                las acciones normales. */}
            <button
              onClick={() => {
                setSettingsOpen(false)
                setDeleteAccountOpen(true)
              }}
              className="mt-4 w-full rounded-xl px-4 py-3 text-left text-sm font-medium text-neutral-600 transition hover:text-red-400"
            >
              Eliminar cuenta
            </button>
          </div>
        </Modal>
      )}

      {supportOpen && <SupportModal onClose={() => setSupportOpen(false)} />}
      {termsOpen && <TermsModal viewOnly onReject={() => setTermsOpen(false)} />}
      {deleteAccountOpen && <DeleteAccountModal onClose={() => setDeleteAccountOpen(false)} />}
    </div>
  )
}
