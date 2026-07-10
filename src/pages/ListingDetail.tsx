import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { FieldDef, Listing, Question } from '../lib/types'
import { formatPrice, conditionLabels, timeAgo, priceDropPct, lastSeenLabel, timeLeftLabel } from '../lib/format'
import { capture } from '../lib/analytics'
import { useFavorites } from '../hooks/useFavorites'
import Avatar from '../components/Avatar'
import StarRating from '../components/StarRating'
import SellerBadges from '../components/SellerBadges'
import VerifiedSeal from '../components/VerifiedSeal'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import SellFlowModal from '../components/SellFlowModal'
import LocationMap from '../components/LocationMap'
import ListingRail from '../components/ListingRail'
import PhotoViewer from '../components/PhotoViewer'
import SmartImage from '../components/SmartImage'
import ReportButton from '../components/ReportButton'
import LongPressActions from '../components/LongPressActions'
import type { MenuAction } from '../components/ActionMenu'
import { useToast } from '../components/Toast'
import { getCachedBuyerLocation, haversineKm, formatDistance, pushRecentlyViewed } from '../lib/geo'
import { haptic, playSound } from '../lib/notify'
import { burstConfetti } from '../lib/confetti'
import { invalidateFeedCache } from './Home'

// Mi última puja por subasta, guardada en localStorage para que la detección de
// "me superaron" sobreviva a recargar/reabrir (las pujas son anónimas, no hay
// forma server-side de saber si soy el mejor postor).
// Se guarda también bids_count al momento de pujar: si el listing tiene MENOS
// ofertas que eso, la subasta se relanzó (las pujas se borran) y la guardada es
// de la instancia anterior — se descarta en vez de mostrarme como "mejor postor"
// de una subasta en la que no oferté.
function readMyBid(listingId: string): { amount: number; count: number } | null {
  try {
    const v = localStorage.getItem(`dealr_mybid_${listingId}`)
    if (v == null) return null
    const parsed: unknown = JSON.parse(v)
    if (typeof parsed === 'number') return { amount: parsed, count: 0 } // formato viejo
    const obj = parsed as { amount?: number; count?: number }
    return typeof obj?.amount === 'number' ? { amount: obj.amount, count: obj.count ?? 0 } : null
  } catch {
    // Formato viejo sin JSON ("50000") o storage bloqueado.
    const v = localStorage.getItem(`dealr_mybid_${listingId}`)
    const n = v == null ? NaN : Number(v)
    return Number.isNaN(n) ? null : { amount: n, count: 0 }
  }
}

function persistMyBid(listingId: string, amount: number, count: number) {
  try {
    localStorage.setItem(`dealr_mybid_${listingId}`, JSON.stringify({ amount, count }))
  } catch {
    /* ignorar */
  }
}

function clearMyBid(listingId: string) {
  try {
    localStorage.removeItem(`dealr_mybid_${listingId}`)
  } catch {
    /* ignorar */
  }
}

function auctionEndedNow(l: Listing): boolean {
  return l.auction_ends_at ? new Date(l.auction_ends_at).getTime() <= Date.now() : false
}

export default function ListingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session, profile } = useAuth()
  const { isFavorite, toggle } = useFavorites()
  const toast = useToast()

  const [listing, setListing] = useState<Listing | null>(null)
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [notFound, setNotFound] = useState(false)
  const [questionBody, setQuestionBody] = useState('')
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({})
  const [offerOpen, setOfferOpen] = useState(false)
  const [offerAmount, setOfferAmount] = useState('')
  const [offerSent, setOfferSent] = useState(false)
  const [offerError, setOfferError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmNoShow, setConfirmNoShow] = useState(false)
  const [confirmDeleteQuestion, setConfirmDeleteQuestion] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [sellOpen, setSellOpen] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [sellerItems, setSellerItems] = useState<Listing[]>([])
  const [similar, setSimilar] = useState<Listing[]>([])
  const [viewerAt, setViewerAt] = useState<number | null>(null)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [bidAmount, setBidAmount] = useState('')
  const [bidBusy, setBidBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [outbid, setOutbid] = useState(false) // me superaron la oferta (en vivo)
  const [extended, setExtended] = useState(false) // el reloj se extendió (anti-snipe)
  const [watchers, setWatchers] = useState(0) // cuántos miran la subasta ahora
  const countedView = useRef(false)
  const closedOnce = useRef(false)
  // Estado de la subasta para detectar cambios en vivo:
  const myBidRef = useRef<number | null>(null) // mi última oferta
  const iWasWinningRef = useRef(false) // yo era el mejor postor
  const prevEndsRef = useRef<number | null>(null) // auction_ends_at previo
  const celebratedWin = useRef(false) // ya festejé esta victoria
  const rehydratedBid = useRef(false) // ya rehidraté mi puja guardada
  const lastTickRef = useRef(0) // último segundo que tickeó (evita doble tick)
  // Clave estable para presencia (no expone identidad: id de sesión o aleatoria).
  const viewerKey = useRef(session?.user.id ?? `anon-${Math.random().toString(36).slice(2)}`)

  const isOwner = session?.user.id === listing?.seller_id
  const isAdmin = Boolean(profile?.is_admin)
  // Moderación del admin sobre la publicación, vía long-press (estilo chat).
  const adminListingActions: MenuAction[] =
    isAdmin && !isOwner
      ? [
          { label: 'Editar', onClick: () => navigate(`/publicar/${listing!.id}`) },
          { label: 'Borrar', destructive: true, onClick: () => setDeleteOpen(true) },
        ]
      : []

  async function load() {
    const { data } = await supabase
      .from('listings')
      // FK explícita: listings referencia a profiles por seller_id y sold_to.
      .select('*, seller:profiles!listings_seller_id_fkey(*)')
      .eq('id', id!)
      .maybeSingle()
    if (!data) {
      setNotFound(true)
      return
    }
    setListing(data as Listing)
    const { data: cat } = await supabase
      .from('categories')
      .select('required_fields')
      .eq('id', data.category_id)
      .single()
    setFieldDefs((cat?.required_fields as FieldDef[]) ?? [])
    // RLS filtra: públicas para todos, las propias para asker/vendedor
    const { data: qs } = await supabase
      .from('questions')
      .select('*')
      .eq('listing_id', id!)
      .order('created_at', { ascending: false })
    setQuestions(qs ?? [])
  }

  useEffect(() => {
    load()
    if (id) pushRecentlyViewed(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Rieles del detalle: otras publicaciones del vendedor y similares (misma
  // categoría, otros vendedores). Sin embed de profiles -> sin ambigüedad de FK.
  useEffect(() => {
    if (!listing) return
    // Vista: una sola vez por apertura y sin contar al dueño.
    if (!countedView.current && session?.user.id !== listing.seller_id) {
      countedView.current = true
      supabase.rpc('increment_listing_views', { listing_id: listing.id })
    }
    supabase
      .from('listings')
      .select('id, title, price, currency, photos')
      .eq('seller_id', listing.seller_id)
      .eq('status', 'active')
      .neq('id', listing.id)
      .order('last_renewed_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setSellerItems((data as Listing[]) ?? []))
    supabase
      .from('listings')
      .select('id, title, price, currency, photos')
      .eq('category_id', listing.category_id)
      .eq('status', 'active')
      .neq('id', listing.id)
      .neq('seller_id', listing.seller_id)
      .order('last_renewed_at', { ascending: false })
      .limit(12)
      .then(({ data }) => setSimilar((data as Listing[]) ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id])

  // Cuenta regresiva en vivo (solo si es subasta abierta). En los últimos 10s
  // late: heartbeat + tick por segundo (el clásico "going once, going twice").
  useEffect(() => {
    if (!listing?.is_auction || listing.auction_closed || !listing.auction_ends_at) return
    const endsAt = new Date(listing.auction_ends_at).getTime()
    const t = setInterval(() => {
      const t0 = Date.now()
      setNow(t0)
      const remaining = Math.ceil((endsAt - t0) / 1000)
      // Una vez por segundo entero (el ref persiste aunque el effect se recree
      // por un load() de Realtime → no late doble en el sprint final).
      if (
        remaining > 0 &&
        remaining <= 10 &&
        remaining !== lastTickRef.current &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      ) {
        lastTickRef.current = remaining
        haptic('heartbeat')
        playSound('tick')
      }
    }, 1000)
    return () => clearInterval(t)
  }, [listing?.is_auction, listing?.auction_closed, listing?.auction_ends_at])

  // Subasta vencida sin cerrar: la cierra al abrir (crea el chat ganador↔vendedor).
  useEffect(() => {
    if (!listing?.is_auction || listing.auction_closed || !listing.auction_ends_at) return
    if (new Date(listing.auction_ends_at).getTime() > Date.now() || closedOnce.current) return
    closedOnce.current = true
    supabase.rpc('close_auctions').then(() => load())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id, listing?.auction_closed, listing?.auction_ends_at])

  // Realtime: oferta actual / cantidad en vivo + presencia ("N mirando ahora").
  useEffect(() => {
    if (!listing?.is_auction || !id) return
    const channel = supabase.channel(`listing-${id}`, {
      config: { presence: { key: viewerKey.current } },
    })
    channel
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'listings', filter: `id=eq.${id}` }, (payload) => {
        const next = payload.new as Listing
        // ¿Me superaron? Yo era el mejor postor y la oferta subió por encima de la mía.
        if (
          iWasWinningRef.current &&
          next.current_bid != null &&
          myBidRef.current != null &&
          next.current_bid > myBidRef.current
        ) {
          iWasWinningRef.current = false
          setOutbid(true)
          haptic('heavy')
          playSound('outbid')
        }
        // Anti-snipe: el reloj se extendió respecto al valor previo.
        const nextEnds = next.auction_ends_at ? new Date(next.auction_ends_at).getTime() : null
        if (prevEndsRef.current != null && nextEnds != null && nextEnds > prevEndsRef.current + 1000) {
          setExtended(true)
          haptic('tap')
          window.setTimeout(() => setExtended(false), 2800)
        }
        prevEndsRef.current = nextEnds
        load()
      })
      .on('presence', { event: 'sync' }, () => {
        setWatchers(Object.keys(channel.presenceState()).length)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ at: Date.now() })
      })
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.is_auction, id])

  // Mantiene sincronizado el auction_ends_at previo (para detectar extensiones),
  // rehidrata mi puja guardada (sobrevive recargar) y festeja si ganaste.
  useEffect(() => {
    if (!listing?.is_auction) return
    if (prevEndsRef.current == null && listing.auction_ends_at) {
      prevEndsRef.current = new Date(listing.auction_ends_at).getTime()
    }
    // Rehidratar: si mi puja guardada sigue siendo la más alta, soy el mejor
    // postor; si la superaron mientras no estaba, muestro el aviso al volver.
    if (!rehydratedBid.current && id && listing.current_bid != null) {
      rehydratedBid.current = true
      const mine = readMyBid(id)
      if (mine != null && listing.bids_count < mine.count) {
        // La subasta se relanzó (hay menos ofertas que cuando pujé): mi puja
        // guardada es de la instancia anterior, no cuenta.
        clearMyBid(id)
      } else if (mine != null) {
        myBidRef.current = mine.amount
        if (listing.current_bid > mine.amount) {
          iWasWinningRef.current = false
          if (!listing.auction_closed && !auctionEndedNow(listing)) setOutbid(true)
        } else {
          iWasWinningRef.current = true
        }
      }
    }
    if (listing.auction_closed && !celebratedWin.current && session?.user.id && listing.sold_to === session.user.id) {
      celebratedWin.current = true
      burstConfetti()
      playSound('win')
      haptic('success')
    }
  }, [listing?.is_auction, listing?.auction_ends_at, listing?.auction_closed, listing?.sold_to, session?.user.id])

  async function placeBid(e: FormEvent) {
    e.preventDefault()
    if (!session) return navigate('/auth', { state: { from: `/p/${id}`, back: `/p/${id}` } })
    if (profile?.account_restricted) return toast('Tu cuenta tiene funciones restringidas. Dealr es para mayores de 18 años.')
    const amount = Number(bidAmount)
    // Optimista: marco mi puja ANTES del await. Así, cuando llegue por Realtime
    // el eco de mi propia oferta, myBidRef ya vale `amount` y no se confunde con
    // "me superaron". Si la RPC falla o rebota validación, revierto.
    const prevMyBid = myBidRef.current
    const prevWinning = iWasWinningRef.current
    myBidRef.current = amount
    iWasWinningRef.current = true
    setBidBusy(true)
    const { data, error } = await supabase.rpc('place_bid', { p_listing: id, p_amount: amount })
    setBidBusy(false)
    if (error || data) {
      myBidRef.current = prevMyBid
      iWasWinningRef.current = prevWinning
      haptic('error')
      // `data` = mensaje de validación de la DB; error = fallo de red.
      return toast(error ? 'No pudimos registrar la oferta. Probá de nuevo.' : (data as string))
    }
    // Quedé como mejor postor: persisto la puja para sobrevivir recargar
    // (con el bids_count esperado, para invalidarla si la subasta se relanza).
    if (id) persistMyBid(id, amount, (listing?.bids_count ?? 0) + 1)
    setOutbid(false)
    setBidAmount('')
    playSound('pop')
    haptic('success')
    toast('¡Oferta registrada! Sos el mejor postor.')
    load()
  }

  async function reassignAuction() {
    const { data, error } = await supabase.rpc('reassign_auction', { p_listing: id })
    if (error) return toast('No se pudo reasignar. Probá de nuevo.')
    toast(data ? (data as string) : 'Se ofreció al siguiente postor.')
    load()
  }

  async function askQuestion(e: FormEvent) {
    e.preventDefault()
    if (!session) return navigate('/auth', { state: { from: `/p/${id}`, back: `/p/${id}` } })
    setBusy(true)
    const { error } = await supabase.from('questions').insert({
      listing_id: id,
      asker_id: session.user.id,
      body: questionBody.trim(),
    })
    setBusy(false)
    if (error) {
      toast('No pudimos enviar tu pregunta. Probá de nuevo.')
      return
    }
    capture('question_asked', { listing_id: id })
    setQuestionBody('')
    load()
  }

  async function answerQuestion(questionId: string) {
    const answer = answerDrafts[questionId]?.trim()
    if (!answer) return
    // El trigger de la DB marca answered_at y la hace pública
    const { error } = await supabase.from('questions').update({ answer_body: answer }).eq('id', questionId)
    if (error) {
      toast('No pudimos publicar la respuesta. Probá de nuevo.')
      return
    }
    setAnswerDrafts((d) => ({ ...d, [questionId]: '' }))
    load()
  }

  async function reportQuestion(questionId: string) {
    if (!session) return navigate('/auth', { state: { from: `/p/${id}`, back: `/p/${id}` } })
    const { error } = await supabase.from('reports').insert({
      reporter_id: session.user.id,
      target_type: 'question',
      target_id: questionId,
      reason: 'Contenido inapropiado en pregunta pública',
    })
    toast(
      error
        ? 'No pudimos enviar el reporte. Probá de nuevo.'
        : 'Reporte enviado. Gracias por ayudar a mantener Dealr.',
    )
  }

  // Subasta ganada: doble confirmación de retiro.
  async function confirmPickup() {
    const { data, error } = await supabase.rpc('confirm_auction_pickup', { p_listing: listing!.id })
    if (error) return toast(error.message)
    if (data) return toast(data as string)
    toast('Confirmaste el retiro')
    load()
  }

  async function reportNoShow() {
    setConfirmNoShow(false)
    const { data, error } = await supabase.rpc('report_auction_no_show', { p_listing: listing!.id })
    if (error) return toast(error.message)
    if (data) return toast(data as string)
    toast('Reporte registrado. El equipo va a revisar el caso.')
    load()
  }

  // Moderación del admin (long-press sobre la pregunta).
  async function deleteQuestion(questionId: string) {
    setConfirmDeleteQuestion(null)
    const { error } = await supabase.from('questions').delete().eq('id', questionId)
    if (error) return toast(error.message)
    setQuestions((prev) => prev.filter((x) => x.id !== questionId))
    toast('Pregunta borrada')
  }

  async function sendOffer(e: FormEvent) {
    e.preventDefault()
    if (!session) return navigate('/auth', { state: { from: `/p/${id}`, back: `/p/${id}` } })
    if (profile?.account_restricted) return toast('Tu cuenta tiene funciones restringidas. Dealr es para mayores de 18 años.')
    setBusy(true)
    setOfferError('')
    const { error } = await supabase.from('offers').insert({
      listing_id: id,
      buyer_id: session.user.id,
      amount: Number(offerAmount),
    })
    setBusy(false)
    if (error) {
      setOfferError('No pudimos enviar la oferta. Probá de nuevo.')
      return
    }
    capture('offer_sent', { listing_id: id, amount: Number(offerAmount) })
    setOfferSent(true)
  }

  async function openChat() {
    if (!session) return navigate('/auth', { state: { from: `/p/${id}`, back: `/p/${id}` } })
    if (profile?.account_restricted) return toast('Tu cuenta tiene funciones restringidas. Dealr es para mayores de 18 años.')
    if (!listing) return
    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('listing_id', listing.id)
      .eq('buyer_id', session.user.id)
      .maybeSingle()
    if (existing) return navigate(`/chats/${existing.id}`)
    const { data: created, error } = await supabase
      .from('conversations')
      .insert({ listing_id: listing.id, buyer_id: session.user.id, seller_id: listing.seller_id })
      .select('id')
      .single()
    if (error || !created) {
      toast('No pudimos abrir el chat. Probá de nuevo.')
      return
    }
    capture('chat_opened', { listing_id: listing.id })
    navigate(`/chats/${created.id}`)
  }

  async function setStatus(status: Listing['status'], renew = false) {
    const patch: Record<string, unknown> = { status }
    if (renew) patch.last_renewed_at = new Date().toISOString()
    // Reactivar/renovar limpia la marca de venta: vuelve a estar disponible.
    if (status === 'active') patch.sold_to = null
    setStatusError('')
    const { error } = await supabase.from('listings').update(patch).eq('id', id!)
    if (error) {
      setStatusError('No pudimos actualizar la publicación. Probá de nuevo.')
      return
    }
    invalidateFeedCache()
    load()
  }

  function share() {
    if (!listing) return
    const url = `${window.location.origin}/p/${listing.id}`
    const text = `${listing.title} — ${formatPrice(listing.price, listing.currency)}\n${url}`
    if (navigator.share) {
      navigator.share({ title: listing.title, text, url }).catch(() => {})
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    }
  }

  async function reportListing() {
    if (!session) return navigate('/auth', { state: { from: `/p/${id}`, back: `/p/${id}` } })
    const { error } = await supabase.from('reports').insert({
      reporter_id: session.user.id,
      target_type: 'listing',
      target_id: id,
      reason: 'Publicación reportada',
    })
    toast(
      error
        ? 'No pudimos enviar el reporte. Probá de nuevo.'
        : 'Reporte enviado. Gracias por ayudar a mantener Dealr.',
    )
  }

  async function deleteListing() {
    if (!listing) return
    setDeleting(true)
    // Primero la fila, después las fotos: si el delete falla, la publicación
    // sigue viva CON sus fotos (antes se borraban las fotos primero y un fallo
    // dejaba el aviso vivo con imágenes rotas para siempre). Las fotos son
    // best-effort: si su borrado falla solo quedan huérfanas en storage.
    const { error } = await supabase.from('listings').delete().eq('id', listing.id)
    if (error) {
      setDeleting(false)
      setDeleteOpen(false)
      toast('No pudimos eliminar la publicación. Probá de nuevo.')
      return
    }
    if (listing.photos.length) {
      await supabase.storage.from('listing-photos').remove(listing.photos)
    }
    setDeleting(false)
    invalidateFeedCache()
    navigate('/perfil')
  }

  if (notFound) {
    return (
      <div className="px-8 py-32 text-center text-neutral-400">
        Esta publicación ya no está disponible.
        <Link to="/" className="mt-4 block font-semibold text-white">
          Volver al inicio
        </Link>
      </div>
    )
  }
  if (!listing)
    return (
      <div className="px-4 py-8">
        <div className="aspect-square animate-pulse bg-neutral-900" />
      </div>
    )

  const seller = listing.seller!
  const dropPct = priceDropPct(listing)
  const auction = listing.is_auction
  const auctionEnded = auction && listing.auction_ends_at ? new Date(listing.auction_ends_at).getTime() <= now : false
  const iWon = auction && listing.auction_closed && session?.user.id === listing.sold_to
  // Segundos restantes (para la urgencia visual del countdown).
  const secondsLeft =
    auction && listing.auction_ends_at && !auctionEnded
      ? Math.max(0, Math.ceil((new Date(listing.auction_ends_at).getTime() - now) / 1000))
      : null
  const urgent = secondsLeft != null && secondsLeft <= 60 // último minuto
  const critical = secondsLeft != null && secondsLeft <= 10 // últimos 10s
  // Oferta mínima siguiente: precio inicial si no hay ofertas; si hay, la actual
  // + el salto mínimo configurado por el vendedor.
  const minNextBid =
    listing.current_bid != null ? listing.current_bid + (listing.auction_min_increment || 1) : listing.price
  const buyerLoc = getCachedBuyerLocation()
  const distanceKm =
    listing.lat != null && listing.lng != null && buyerLoc
      ? haversineKm(buyerLoc, { lat: listing.lat, lng: listing.lng })
      : null
  const structuredEntries = fieldDefs
    .map((def) => ({ def, value: listing.structured_fields[def.key] }))
    .filter(
      ({ value }) =>
        value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0),
    )
    // Defensa showIf: si el campo depende de otro (ej. marca solo si
    // tipo=Teléfono) y la condición no se cumple, no mostrarlo aunque haya
    // quedado un valor huérfano guardado (avisos previos a la poda de Publish).
    .filter(
      ({ def }) =>
        !def.showIf || def.showIf.in.includes(String(listing.structured_fields[def.showIf.key] ?? '')),
    )

  return (
    <div className="pb-32">
      {/* Carrusel de fotos */}
      <div className="relative">
        <button
          onClick={() => navigate(-1)}
          aria-label="Volver"
          className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18 9 12l6-6" />
          </svg>
        </button>
        <div className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex gap-2">
          <button
            onClick={share}
            aria-label="Compartir"
            className="rounded-full bg-black/50 p-2 text-white backdrop-blur-sm transition active:scale-90"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <path d="M16 6l-4-4-4 4M12 2v14" />
            </svg>
          </button>
          {!isOwner && (
            <button
              onClick={() => {
                if (!session) return navigate('/auth', { state: { from: `/p/${id}`, back: `/p/${id}` } })
                toggle(listing.id)
              }}
              aria-label={isFavorite(listing.id) ? 'Quitar de guardados' : 'Guardar'}
              aria-pressed={isFavorite(listing.id)}
              className="rounded-full bg-black/50 p-2 text-white backdrop-blur-sm transition active:scale-90"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-5 w-5 ${isFavorite(listing.id) ? 'fill-red-500 stroke-red-500' : 'fill-none stroke-white'}`}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.6 1-1.1a5.5 5.5 0 0 0 0-7.7z" />
              </svg>
            </button>
          )}
        </div>
        <div
          onScroll={(e) => setPhotoIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto bg-neutral-900"
        >
          {(listing.photos.length ? listing.photos : [null]).map((p, i) => (
            <div key={i} className="aspect-square w-full shrink-0 snap-center">
              {p ? (
                <SmartImage
                  src={photoUrl(p)}
                  alt={`${listing.title} foto ${i + 1}`}
                  onClick={() => setViewerAt(i)}
                  wrapperClassName="h-full w-full"
                  className="h-full w-full cursor-zoom-in object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-neutral-700">Sin fotos</div>
              )}
            </div>
          ))}
        </div>
        {listing.photos.length > 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {listing.photos.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === photoIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`}
              />
            ))}
          </div>
        )}
        {listing.status !== 'active' && (
          <div className="absolute inset-x-0 bottom-0 bg-black/80 py-2 text-center text-sm font-bold uppercase tracking-wide text-white backdrop-blur-sm">
            {listing.status === 'sold' ? 'Vendido' : listing.status === 'reserved' ? 'Reservado' : 'Pausado'}
          </div>
        )}
      </div>

      <div className="space-y-6 px-5 py-6">
        <div>
          {auction ? (
            <div>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-bold text-white">{formatPrice(listing.current_bid ?? listing.price, listing.currency)}</p>
                <span className="text-xs text-neutral-500">{listing.current_bid != null ? 'oferta actual' : 'precio inicial'}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                <span className="glow-badge rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400">Subasta</span>
                <span className="text-neutral-400">{listing.bids_count} {listing.bids_count === 1 ? 'oferta' : 'ofertas'}</span>
                <span className="text-neutral-600">·</span>
                <span
                  className={
                    auctionEnded
                      ? 'text-neutral-500'
                      : critical
                        ? 'font-bold text-red-400 [animation:glowBadge_1s_ease-in-out_infinite]'
                        : urgent
                          ? 'font-bold text-amber-400'
                          : 'font-semibold text-white'
                  }
                >
                  {auctionEnded ? 'Finalizada' : `Termina en ${timeLeftLabel(listing.auction_ends_at!, now)}`}
                </span>
                {extended && (
                  <span className="ctx-pop-in rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-black">
                    ⏱ +30s
                  </span>
                )}
                {watchers > 1 && !auctionEnded && (
                  <span className="flex items-center gap-1 text-xs text-neutral-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 [animation:glowBadge_2s_ease-in-out_infinite]" />
                    {watchers} mirando
                  </span>
                )}
              </div>
              {!auctionEnded && (
                <p className="mt-1.5 text-xs text-neutral-500">
                  Próxima oferta mínima: <span className="font-semibold text-neutral-300">{formatPrice(minNextBid, listing.currency)}</span>
                  {listing.auction_min_increment > 0 && ` · salto de ${formatPrice(listing.auction_min_increment, listing.currency)}`}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-3xl font-bold text-white">{formatPrice(listing.price, listing.currency)}</p>
              {dropPct != null && (
                <>
                  <span className="text-base text-neutral-500 line-through">
                    {formatPrice(listing.previous_price!, listing.currency)}
                  </span>
                  <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-bold text-black">Bajó {dropPct}%</span>
                </>
              )}
            </div>
          )}
          <LongPressActions actions={adminListingActions}>
            <h1 className="mt-1.5 text-lg leading-snug text-neutral-200">{listing.title}</h1>
          </LongPressActions>
          {/* El estado del artículo en chip y negritas: perdido en la línea
              gris no se distinguía "Nuevo" de "Con detalles" de un vistazo. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-neutral-500">
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                listing.condition === 'nuevo'
                  ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40'
                  : 'bg-neutral-800 text-white ring-1 ring-neutral-700'
              }`}
            >
              {conditionLabels[listing.condition]}
            </span>
            <span>
              publicado {timeAgo(listing.created_at)}
              {listing.favorites_count > 0 &&
                ` · ${listing.favorites_count} ${listing.favorites_count === 1 ? 'persona lo guardó' : 'personas lo guardaron'}`}
            </span>
          </div>
        </div>

        {listing.description && (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-300">{listing.description}</p>
        )}

        {structuredEntries.length > 0 && (
          <div className="surface p-4">
            <h2 className="mb-1 text-sm font-semibold text-white">Detalles</h2>
            <dl className="divide-y divide-neutral-800/70">
              {structuredEntries.map(({ def, value }) => (
                <div key={def.key} className="flex items-start gap-3 py-2.5 text-sm">
                  <dt className="w-28 shrink-0 pt-0.5 text-neutral-500">{def.label}</dt>
                  <dd className="min-w-0 flex-1 font-medium text-neutral-100">
                    {def.type === 'boolean' ? (
                      <span className={value ? 'text-emerald-400' : 'text-neutral-400'}>{value ? 'Sí' : 'No'}</span>
                    ) : Array.isArray(value) ? (
                      <div className="flex flex-wrap gap-1.5">
                        {value.map((v) => (
                          <span key={String(v)} className="rounded-full bg-neutral-800 px-2.5 py-0.5 text-xs text-neutral-200">
                            {String(v)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      String(value)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Ubicación: área aproximada, nunca el punto exacto */}
        {listing.lat != null && listing.lng != null && (
          <div>
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">Ubicación</h2>
              {distanceKm != null && (
                <span className="text-xs font-medium text-neutral-400">{formatDistance(distanceKm)} de vos</span>
              )}
            </div>
            <LocationMap point={{ lat: listing.lat, lng: listing.lng }} seed={listing.id} />
            <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {listing.location_label ? `Aproximadamente en ${listing.location_label}` : 'Área aproximada'}
            </p>
          </div>
        )}

        {/* Vendedor */}
        <Link to={`/u/${seller.username}`} className="surface block p-4 transition active:opacity-80">
          <div className="flex items-center gap-3">
            <Avatar profile={seller} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-white">{seller.username}</p>
              {seller.seller_score != null ? (
                <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <StarRating value={seller.seller_score} />
                  <span>({seller.seller_ratings_count})</span>
                </div>
              ) : (
                <p className="text-xs text-neutral-500">
                  Usuario nuevo · en Dealr desde{' '}
                  {new Date(seller.created_at).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })}
                </p>
              )}
              {lastSeenLabel(seller.last_seen_at) && (
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {lastSeenLabel(seller.last_seen_at)}
                </p>
              )}
            </div>
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-neutral-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </div>
          <div className="mt-3">
            <SellerBadges profile={seller} />
          </div>
        </Link>

        {listing.is_auction &&
          listing.status === 'sold' &&
          listing.sold_to &&
          (isOwner || session?.user.id === listing.sold_to) && (
            <div className="surface space-y-3 p-4">
              <h2 className="text-sm font-semibold text-white">Confirmá la entrega</h2>
              {listing.pickup_disputed ? (
                <p className="text-xs text-amber-400">Hay reportes en conflicto. Lo está revisando el equipo de Dealr.</p>
              ) : listing.buyer_confirmed_pickup && listing.seller_confirmed_pickup ? (
                <p className="text-xs text-emerald-400">Entrega confirmada por ambos ✓</p>
              ) : isOwner ? (
                listing.seller_confirmed_pickup ? (
                  <p className="text-xs text-emerald-400">Confirmaste que retiró. Falta que lo confirme el comprador.</p>
                ) : listing.seller_reported_no_show ? (
                  <p className="text-xs text-neutral-400">Reportaste que el comprador no retiró.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button onClick={confirmPickup} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black">
                      El comprador retiró
                    </button>
                    <button onClick={() => setConfirmNoShow(true)} className="rounded-full px-4 py-2 text-xs font-semibold text-red-400 ring-1 ring-red-500/30">
                      No retiró
                    </button>
                  </div>
                )
              ) : listing.buyer_confirmed_pickup ? (
                <p className="text-xs text-emerald-400">Confirmaste que retiraste. Falta que lo confirme el vendedor.</p>
              ) : (
                <button onClick={confirmPickup} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black">
                  Sí, retiré
                </button>
              )}
              <p className="text-[11px] leading-relaxed text-neutral-600">
                Los dos confirman el retiro para cerrar la operación. Si ganás una subasta y no retirás, quedás sin
                participar de subastas por un tiempo.
              </p>
            </div>
          )}

        {!isOwner && <ListingRail title="Más de este vendedor" listings={sellerItems} />}

        {!isOwner && (
          <div className="px-1">
            <ReportButton targetType="listing" targetId={listing.id} />
          </div>
        )}

        {/* Acciones del dueño */}
        {isOwner && (
          <div className="surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Tu publicación</h2>
              <p className="flex items-center gap-2.5 text-xs text-neutral-500">
                <span className="flex items-center gap-1">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  {listing.views_count}
                </span>
                <span className="flex items-center gap-1">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" stroke="none">
                    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.6 1-1.1a5.5 5.5 0 0 0 0-7.7z" />
                  </svg>
                  {listing.favorites_count}
                </span>
              </p>
            </div>
            {auction && (
              <p className="glow-text mb-3 text-xs text-amber-400">
                {listing.bids_count} {listing.bids_count === 1 ? 'oferta' : 'ofertas'} ·{' '}
                {listing.auction_closed
                  ? listing.sold_to
                    ? 'Cerrada con ganador (notificado)'
                    : 'Cerrada sin ofertas'
                  : auctionEnded
                    ? 'Finalizó, cerrando…'
                    : `Termina en ${timeLeftLabel(listing.auction_ends_at!, now)}`}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {auction ? (
                <>
                  {listing.auction_closed && listing.auction_cascade && listing.sold_to && (
                    <button onClick={reassignAuction} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black">
                      El ganador no retiró → ofrecer al siguiente
                    </button>
                  )}
                </>
              ) : listing.status === 'active' ? (
                <>
                  <button onClick={() => setStatus('active', true)} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black">
                    Renovar
                  </button>
                  <button onClick={() => setSellOpen(true)} className="rounded-full px-4 py-2 text-xs font-semibold text-neutral-300 ring-1 ring-neutral-700">
                    Ya lo vendí
                  </button>
                  <button onClick={() => setStatus('reserved')} className="rounded-full px-4 py-2 text-xs font-semibold text-neutral-300 ring-1 ring-neutral-700">
                    Reservar
                  </button>
                  <button onClick={() => setStatus('paused')} className="rounded-full px-4 py-2 text-xs font-semibold text-neutral-300 ring-1 ring-neutral-700">
                    Pausar
                  </button>
                </>
              ) : (
                <button onClick={() => setStatus('active', true)} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black">
                  {listing.status === 'reserved' ? 'Quitar reserva' : 'Reactivar'}
                </button>
              )}
              <Link to={`/publicar/${listing.id}`} className="rounded-full px-4 py-2 text-xs font-semibold text-neutral-300 ring-1 ring-neutral-700">
                Editar
              </Link>
              <button onClick={() => setDeleteOpen(true)} className="rounded-full px-4 py-2 text-xs font-semibold text-red-400/90 ring-1 ring-red-500/30">
                Eliminar
              </button>
            </div>
            {statusError && <p className="mt-3 text-xs text-red-400">{statusError}</p>}
          </div>
        )}

        {/* Preguntas */}
        <div>
          <h2 className="text-sm font-semibold text-white">Preguntas</h2>
          <p className="mb-4 mt-0.5 text-xs text-neutral-600">Se publican cuando el vendedor responde.</p>
          {!isOwner && listing.status === 'active' && (
            <form onSubmit={askQuestion} className="mb-5 flex items-end gap-3">
              <input
                value={questionBody}
                onChange={(e) => setQuestionBody(e.target.value)}
                placeholder="Preguntale al vendedor"
                maxLength={500}
                className="input-line"
              />
              <button
                disabled={busy || !questionBody.trim()}
                className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-30"
              >
                Enviar
              </button>
            </form>
          )}
          {questions.length === 0 ? (
            <p className="py-2 text-sm text-neutral-600">Todavía no hay preguntas.</p>
          ) : (
            <ul className="space-y-5">
              {questions.map((q) => (
                <li key={q.id} className="text-sm">
                  <LongPressActions
                    actions={isAdmin ? [{ label: 'Borrar', destructive: true, onClick: () => setConfirmDeleteQuestion(q.id) }] : []}
                  >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-neutral-200">{q.body}</p>
                    {q.is_public && session && q.asker_id !== session.user.id && !isOwner && (
                      <button onClick={() => reportQuestion(q.id)} className="shrink-0 text-xs text-neutral-700 transition hover:text-red-400">
                        Reportar
                      </button>
                    )}
                  </div>
                  {q.answer_body ? (
                    <p className="mt-1.5 border-l border-neutral-700 pl-3 text-neutral-400">{q.answer_body}</p>
                  ) : isOwner ? (
                    <div className="mt-2 flex items-end gap-3">
                      <input
                        value={answerDrafts[q.id] ?? ''}
                        onChange={(e) => setAnswerDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                        placeholder="Respondé para publicarla"
                        className="input-line text-sm"
                      />
                      <button
                        onClick={() => answerQuestion(q.id)}
                        className="shrink-0 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-black"
                      >
                        Responder
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs italic text-neutral-600">Esperando respuesta del vendedor…</p>
                  )}
                  </LongPressActions>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Ofertas recibidas (solo dueño) */}
        {isOwner && <OwnerOffers listingId={listing.id} currency={listing.currency} />}

        {/* Productos similares (misma categoría, otros vendedores) */}
        <ListingRail title="Productos similares" listings={similar} />

        {!isOwner && (
          <button onClick={reportListing} className="flex w-full items-center justify-center gap-1.5 py-2 text-xs text-neutral-600 transition active:text-red-400">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 22V4a1 1 0 0 1 1-1h13l-2 5 2 5H5" />
            </svg>
            Reportar publicación
          </button>
        )}
      </div>

      {/* Barra de acciones del comprador — subasta */}
      {!isOwner && auction && (
        <div className="fixed bottom-0 left-1/2 z-20 w-full max-w-lg -translate-x-1/2 bg-gradient-to-t from-black via-black/95 to-transparent px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-8">
          {iWon ? (
            <button onClick={openChat} className="w-full rounded-full bg-amber-500 py-3 text-sm font-bold text-black">
              🏆 Ganaste — coordinar con el vendedor
            </button>
          ) : auctionEnded || listing.status !== 'active' ? (
            <p className="rounded-full bg-neutral-900 py-3 text-center text-sm font-medium text-neutral-400 ring-1 ring-neutral-800">
              Subasta finalizada
            </p>
          ) : (
            <>
              {outbid && (
                <button
                  type="button"
                  onClick={() => {
                    // Re-puja rápida: prellena con la oferta mínima (actual + salto).
                    setBidAmount(String(minNextBid))
                    setOutbid(false)
                    haptic('tap')
                  }}
                  className="ctx-pop-in mb-2 flex w-full items-center justify-center gap-1.5 rounded-full bg-red-500/15 py-2 text-sm font-bold text-red-400 ring-1 ring-red-500/30"
                >
                  Te superaron la oferta · Tocá para mejorar
                </button>
              )}
              <form onSubmit={placeBid} className="flex items-center gap-2">
                <div className={`flex flex-1 items-center gap-1.5 rounded-full bg-neutral-900 px-4 ring-1 ${outbid ? 'ring-red-500/50' : 'ring-neutral-700'}`}>
                  <span className="text-sm font-semibold text-neutral-500">{listing.currency === 'USD' ? 'US$' : '$'}</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    placeholder={String(minNextBid)}
                    className="w-full bg-transparent py-3 text-sm font-semibold text-white outline-none"
                  />
                </div>
                <button disabled={bidBusy} className="shrink-0 rounded-full bg-amber-500 px-5 py-3 text-sm font-bold text-black disabled:opacity-50">
                  Ofertar
                </button>
              </form>
            </>
          )}
        </div>
      )}

      {/* Barra de acciones del comprador — precio fijo */}
      {!isOwner && !auction && listing.status === 'active' && (
        <div className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-lg -translate-x-1/2 gap-3 bg-gradient-to-t from-black via-black/95 to-transparent px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-8">
          <button
            onClick={() =>
              profile?.account_restricted
                ? toast('Tu cuenta tiene funciones restringidas. Dealr es para mayores de 18 años.')
                : setOfferOpen(true)
            }
            className="flex-1 rounded-full border border-neutral-600 py-3 text-sm font-semibold text-white"
          >
            Hacer oferta
          </button>
          <button onClick={openChat} className="flex-1 rounded-full bg-white py-3 text-sm font-semibold text-black">
            Chatear
          </button>
        </div>
      )}

      {offerOpen && (
        <Modal title="Hacer una oferta" onClose={() => { setOfferOpen(false); setOfferSent(false); setOfferError('') }}>
          {offerSent ? (
            <div className="py-6 text-center">
              <p className="font-semibold text-white">Oferta enviada</p>
              <p className="mt-1 text-sm text-neutral-400">El vendedor la va a ver en su publicación.</p>
            </div>
          ) : (
            <form onSubmit={sendOffer} className="space-y-6">
              <p className="text-sm text-neutral-400">
                Precio publicado: <strong className="text-white">{formatPrice(listing.price, listing.currency)}</strong>
              </p>
              <div className="flex items-end gap-2">
                <span className="pb-2.5 font-semibold text-neutral-500">{listing.currency === 'USD' ? 'US$' : '$'}</span>
                <input
                  type="number"
                  min="1"
                  required
                  autoFocus
                  value={offerAmount}
                  onChange={(e) => setOfferAmount(e.target.value)}
                  placeholder="Tu oferta"
                  className="input-line text-xl font-semibold"
                />
              </div>
              {offerError && <p className="text-xs text-red-400">{offerError}</p>}
              <button disabled={busy} className="btn-primary">
                Enviar oferta
              </button>
            </form>
          )}
        </Modal>
      )}

      {viewerAt !== null && listing.photos.length > 0 && (
        <PhotoViewer photos={listing.photos} index={viewerAt} onClose={() => setViewerAt(null)} />
      )}

      {sellOpen && (
        <SellFlowModal
          listingId={listing.id}
          sellerId={listing.seller_id}
          onClose={() => setSellOpen(false)}
          onSold={load}
        />
      )}

      {deleteOpen && (
        <Modal title="Eliminar publicación" onClose={() => !deleting && setDeleteOpen(false)}>
          <div className="space-y-5 text-sm text-neutral-400">
            <p>
              Vas a eliminar <strong className="text-white">{listing.title}</strong> de forma
              permanente. También se borran sus preguntas y ofertas. Los chats se conservan (sin la
              publicación). Esta acción no se puede deshacer.
            </p>
            <p className="text-xs text-neutral-600">
              Si solo querés que deje de aparecer, mejor usá <strong className="text-neutral-400">Pausar</strong> o <strong className="text-neutral-400">Ya lo vendí</strong>.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className="flex-1 rounded-full py-3 text-sm font-semibold text-neutral-300 ring-1 ring-neutral-700 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={deleteListing}
                disabled={deleting}
                className="flex-1 rounded-full bg-red-500 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirmNoShow && (
        <ConfirmDialog
          title="Reportar que no retiró"
          message="Vas a reportar que el ganador no retiró la compra. El caso queda en revisión del equipo de Dealr, que puede contactar a ambas partes y aplicar sanciones si corresponde."
          confirmLabel="Reportar"
          destructive
          onConfirm={reportNoShow}
          onClose={() => setConfirmNoShow(false)}
        />
      )}

      {confirmDeleteQuestion && (
        <ConfirmDialog
          title="Borrar pregunta"
          message="Vas a borrar esta pregunta de forma permanente."
          confirmLabel="Borrar"
          destructive
          onConfirm={() => deleteQuestion(confirmDeleteQuestion)}
          onClose={() => setConfirmDeleteQuestion(null)}
        />
      )}
    </div>
  )
}

function OwnerOffers({ listingId, currency }: { listingId: string; currency: Listing['currency'] }) {
  const [offers, setOffers] = useState<import('../lib/types').Offer[]>([])
  const toast = useToast()

  async function load() {
    const { data } = await supabase
      .from('offers')
      .select('*, buyer:profiles(username, buyer_score, buyer_ratings_count, identity_verified)')
      .eq('listing_id', listingId)
      .order('created_at', { ascending: false })
    setOffers((data as import('../lib/types').Offer[]) ?? [])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId])

  async function respond(offerId: string, status: 'accepted' | 'rejected') {
    const { error } = await supabase.from('offers').update({ status }).eq('id', offerId)
    if (error) {
      toast('No pudimos actualizar la oferta. Probá de nuevo.')
      return
    }
    load()
  }

  if (offers.length === 0) return null
  return (
    <div className="surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-white">Ofertas recibidas</h2>
      <ul className="space-y-3">
        {offers.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
            <div>
              <p className="font-semibold text-white">{formatPrice(o.amount, currency)}</p>
              <p className="text-xs text-neutral-500">
                {o.buyer?.username}
                {/* El buyer_score visible para el vendedor: elegí al de mejor reputación */}
                {o.buyer?.buyer_score != null && ` · ★ ${o.buyer.buyer_score.toFixed(1)} comprador`}
                {o.buyer?.identity_verified && (
                  <span className="inline-flex items-center gap-0.5 align-middle">
                    {' · '}
                    <VerifiedSeal className="inline h-3.5 w-3.5" /> verificado
                  </span>
                )}
              </p>
            </div>
            {o.status === 'pending' ? (
              <div className="flex gap-2">
                <button onClick={() => respond(o.id, 'accepted')} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black">
                  Aceptar
                </button>
                <button onClick={() => respond(o.id, 'rejected')} className="rounded-full px-3 py-1.5 text-xs font-semibold text-neutral-400 ring-1 ring-neutral-700">
                  Rechazar
                </button>
              </div>
            ) : (
              <span className={`text-xs font-semibold ${o.status === 'accepted' ? 'text-white' : 'text-neutral-600'}`}>
                {o.status === 'accepted' ? 'Aceptada' : 'Rechazada'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
