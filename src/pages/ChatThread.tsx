import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatPrice, isOnline, lastSeenLabel } from '../lib/format'
import { compressPhoto } from '../lib/images'
import type { Conversation, Message } from '../lib/types'
import Modal from '../components/Modal'
import RatingForm from '../components/RatingForm'
import Avatar from '../components/Avatar'
import PhotoViewer from '../components/PhotoViewer'
import SellFlowModal from '../components/SellFlowModal'

// Respuestas rápidas con intención real: evitan el "¿sigue disponible?" vacío
const QUICK_REPLIES = [
  'Me interesa, ¿cuándo y dónde puedo verlo?',
  '¿Aceptás ofertas por este precio?',
  '¿Por qué zona estás para coordinar?',
]

export default function ChatThread() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session, loading } = useAuth()

  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false)
  const [uploadingPreview, setUploadingPreview] = useState<string | null>(null)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [alreadyRated, setAlreadyRated] = useState(false)
  const [othersTyping, setOthersTyping] = useState(false)
  const [viewerPhoto, setViewerPhoto] = useState<string | null>(null)
  const [sellOpen, setSellOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [offerOpen, setOfferOpen] = useState(false)
  const [offerAmount, setOfferAmount] = useState('')
  const [offerSent, setOfferSent] = useState(false)
  const [offerError, setOfferError] = useState('')
  const [offerBusy, setOfferBusy] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const didInitialScroll = useRef(false)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout>>()
  const lastTypingSent = useRef(0)

  const myId = session?.user.id
  const iAmBuyer = conversation?.buyer_id === myId
  const iAmSeller = conversation?.seller_id === myId
  const other = iAmBuyer ? conversation?.seller : conversation?.buyer
  const saleConfirmed =
    conversation?.listing?.status === 'sold' && conversation?.listing?.sold_to === conversation?.buyer_id
  const canRate =
    !alreadyRated &&
    (saleConfirmed || (messages.length >= 4 && new Set(messages.map((m) => m.sender_id)).size >= 2))

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { from: `/chats/${id}`, back: '/' } })
  }, [loading, session, id, navigate])

  function loadConversation() {
    if (!id) return
    supabase
      .from('conversations')
      .select('*, listing:listings(id, title, price, currency, photos, status, sold_to), buyer:profiles!conversations_buyer_id_fkey(*), seller:profiles!conversations_seller_id_fkey(*)')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => setConversation(data as Conversation))
  }

  useEffect(() => {
    if (!session || !id) return
    loadConversation()

    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at')
      .then(({ data }) => setMessages(data ?? []))

    supabase
      .from('ratings')
      .select('id')
      .eq('conversation_id', id)
      .eq('rater_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setAlreadyRated(Boolean(data)))

    // Mensajes en vivo + indicador de "escribiendo…" (broadcast).
    const channel = supabase
      .channel(`conversation-${id}`, { config: { broadcast: { self: false } } })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
        (payload) => {
          setMessages((prev) =>
            prev.some((m) => m.id === (payload.new as Message).id) ? prev : [...prev, payload.new as Message],
          )
          setOthersTyping(false)
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
        (payload) => {
          setMessages((prev) => prev.map((m) => (m.id === (payload.new as Message).id ? (payload.new as Message) : m)))
        },
      )
      .on('broadcast', { event: 'typing' }, () => {
        setOthersTyping(true)
        clearTimeout(typingTimer.current)
        typingTimer.current = setTimeout(() => setOthersTyping(false), 3000)
      })
      .subscribe()
    channelRef.current = channel
    return () => {
      clearTimeout(typingTimer.current)
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [session, id])

  // Posicionar al final: instantáneo la primera vez (no se ve "bajar"),
  // suave para los mensajes nuevos. useLayoutEffect = antes del paint.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: didInitialScroll.current ? 'smooth' : 'auto' })
    didInitialScroll.current = true
  }, [messages, othersTyping, uploadingPreview])

  useEffect(() => {
    if (id && myId && messages.some((m) => m.sender_id !== myId && !m.read_at)) {
      supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', id)
        .neq('sender_id', myId)
        .is('read_at', null)
        .then(() => {})
    }
  }, [messages, id, myId])

  // Avisar "escribiendo…" al otro (throttle de 1,5 s).
  function onDraftChange(value: string) {
    setDraft(value)
    const now = Date.now()
    if (now - lastTypingSent.current > 1500 && channelRef.current) {
      lastTypingSent.current = now
      channelRef.current.send({ type: 'broadcast', event: 'typing', payload: {} })
    }
  }

  async function send(body: string) {
    const text = body.trim()
    if (!text || !myId || !id) return
    setDraft('')
    setSendError('')
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: id, sender_id: myId, body: text })
      .select('*')
      .single()
    if (error || !data) {
      setDraft((d) => d || text)
      setSendError('No se pudo enviar. Probá de nuevo.')
      return
    }
    setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
  }

  async function sendImage(file: File) {
    if (!myId || !id) return
    const preview = URL.createObjectURL(file)
    setUploadingPreview(preview)
    setSending(true)
    setSendError('')
    try {
      const compressed = await compressPhoto(file)
      const path = `chat/${id}/${crypto.randomUUID()}.webp`
      const { error: upErr } = await supabase.storage
        .from('listing-photos')
        .upload(path, compressed, { contentType: 'image/webp' })
      if (upErr) throw upErr
      const { data, error } = await supabase
        .from('messages')
        .insert({ conversation_id: id, sender_id: myId, image_path: path })
        .select('*')
        .single()
      if (error || !data) throw error
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
    } catch {
      setSendError('No se pudo enviar la foto. Probá de nuevo.')
    } finally {
      setSending(false)
      setUploadingPreview(null)
      URL.revokeObjectURL(preview)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(draft)
  }

  async function sendOffer(e: FormEvent) {
    e.preventDefault()
    if (!myId || !conversation) return
    setOfferBusy(true)
    setOfferError('')
    const { error } = await supabase.from('offers').insert({
      listing_id: conversation.listing_id,
      buyer_id: myId,
      amount: Number(offerAmount),
    })
    setOfferBusy(false)
    if (error) {
      setOfferError('No pudimos enviar la oferta. Probá de nuevo.')
      return
    }
    setOfferSent(true)
  }

  if (!conversation) return <div className="p-5 text-sm text-neutral-600">Cargando…</div>

  const listing = conversation.listing!

  return (
    <div className="flex h-dvh flex-col bg-black">
      {/* Encabezado: con quién hablás (tappable a su perfil) + la publicación */}
      <header className="border-b border-neutral-900 px-2 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-1.5">
          <button onClick={() => navigate('/chats')} aria-label="Volver" className="shrink-0 p-1.5 text-white">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18 9 12l6-6" />
            </svg>
          </button>
          {other ? (
            <Link to={`/u/${other.username}`} className="flex min-w-0 flex-1 items-center gap-2.5">
              <div className="relative shrink-0">
                <Avatar profile={other} size="sm" />
                {isOnline(other.last_seen_at) && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-black" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-white">{other.username}</p>
                {othersTyping ? (
                  <p className="text-[11px] text-sky-400">escribiendo…</p>
                ) : isOnline(other.last_seen_at) ? (
                  <p className="text-[11px] text-emerald-400">En línea</p>
                ) : lastSeenLabel(other.last_seen_at) ? (
                  <p className="truncate text-[11px] text-neutral-500">{lastSeenLabel(other.last_seen_at)}</p>
                ) : null}
              </div>
            </Link>
          ) : (
            <div className="flex-1" />
          )}
          {canRate && (
            <button
              onClick={() => setRatingOpen(true)}
              className="shrink-0 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-black"
            >
              Calificar
            </button>
          )}
        </div>
        {/* Contexto: de qué publicación hablan (tappable a la publicación) */}
        <Link to={`/p/${listing.id}`} className="mt-2 flex items-center gap-2.5 rounded-xl bg-neutral-900/70 px-2 py-1.5 transition active:bg-neutral-800">
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-neutral-800">
            {listing.photos?.[0] && (
              <img src={photoUrl(listing.photos[0])} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-neutral-200">{listing.title}</p>
            <p className="text-[11px] text-neutral-500">
              {formatPrice(listing.price, listing.currency)}
              {listing.status === 'sold' && ' · vendido'}
              {listing.status === 'reserved' && ' · reservado'}
            </p>
          </div>
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
        {/* Acción contextual: el vendedor cierra la venta, el comprador ofrece */}
        {listing.status === 'active' && (
          <div className="mt-2">
            {iAmSeller ? (
              <button
                onClick={() => setSellOpen(true)}
                className="w-full rounded-xl bg-neutral-900 py-2 text-xs font-semibold text-white ring-1 ring-neutral-800 transition active:bg-neutral-800"
              >
                Marcar como vendido
              </button>
            ) : (
              <button
                onClick={() => setOfferOpen(true)}
                className="w-full rounded-xl bg-neutral-900 py-2 text-xs font-semibold text-white ring-1 ring-neutral-800 transition active:bg-neutral-800"
              >
                Hacer una oferta
              </button>
            )}
          </div>
        )}
      </header>

      {/* Mensajes */}
      <div ref={scrollerRef} className="thin-scrollbar flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && iAmBuyer && (
          <div className="space-y-2 py-4">
            <p className="pb-2 text-center text-xs text-neutral-600">Empezá con una pregunta concreta:</p>
            {QUICK_REPLIES.map((qr) => (
              <button
                key={qr}
                onClick={() => send(qr)}
                className="block w-full rounded-2xl px-4 py-3 text-left text-sm text-neutral-300 ring-1 ring-neutral-800 transition active:bg-neutral-900"
              >
                {qr}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === myId
          return (
            <div key={m.id} className={`flex items-end gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
              {m.image_path ? (
                <img
                  src={photoUrl(m.image_path)}
                  alt="Foto"
                  onClick={() => setViewerPhoto(m.image_path!)}
                  className="max-h-72 max-w-[70%] cursor-zoom-in rounded-2xl object-cover"
                />
              ) : (
                <div
                  className={`max-w-[80%] rounded-3xl px-4 py-2.5 text-[15px] ${
                    mine ? 'rounded-br-lg bg-white text-black' : 'rounded-bl-lg bg-neutral-900 text-neutral-100'
                  }`}
                >
                  {m.body}
                </div>
              )}
              {mine && (
                <svg
                  viewBox="0 0 24 24"
                  className={`mb-1 h-3.5 w-3.5 shrink-0 ${m.read_at ? 'text-sky-400' : 'text-neutral-600'}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-label={m.read_at ? 'Leído' : 'Enviado'}
                >
                  {m.read_at ? <path d="M1 13l4 4L13 7M11 17l1.5 1.5L23 8" /> : <path d="M4 12l5 5L20 7" />}
                </svg>
              )}
            </div>
          )
        })}
        {uploadingPreview && (
          <div className="flex justify-end">
            <div className="relative max-w-[70%] overflow-hidden rounded-2xl">
              <img src={uploadingPreview} alt="Enviando" className="max-h-72 object-cover opacity-50" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
              </span>
            </div>
          </div>
        )}
        {othersTyping && (
          <div className="flex justify-start">
            <div className="flex gap-1 rounded-3xl rounded-bl-lg bg-neutral-900 px-4 py-3.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      {sendError && <p className="px-4 pb-1 text-center text-xs text-red-400">{sendError}</p>}
      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 border-t border-neutral-900 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) sendImage(file)
            e.target.value = ''
          }}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) sendImage(file)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => setAttachOpen(true)}
          disabled={sending}
          aria-label="Adjuntar"
          className="shrink-0 rounded-full p-2 text-neutral-400 transition active:text-white disabled:opacity-40"
        >
          {sending ? (
            <span className="block h-5 w-5 animate-pulse rounded-full bg-neutral-600" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.19 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.49" />
            </svg>
          )}
        </button>
        <input
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Escribí un mensaje"
          className="w-full rounded-full bg-neutral-900 px-5 py-3 text-[15px] text-white placeholder-neutral-500 outline-none"
        />
        <button
          disabled={!draft.trim()}
          aria-label="Enviar"
          className="shrink-0 rounded-full bg-white p-3 text-black transition disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m22 2-11 11M22 2l-7 20-4-9-9-4 20-7Z" />
          </svg>
        </button>
      </form>

      {attachOpen && (
        <Modal title="Adjuntar" onClose={() => setAttachOpen(false)}>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                setAttachOpen(false)
                cameraInputRef.current?.click()
              }}
              className="flex flex-col items-center gap-2 rounded-2xl bg-neutral-900 py-5 text-sm font-medium text-white ring-1 ring-neutral-800 transition active:bg-neutral-800"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </span>
              Cámara
            </button>
            <button
              onClick={() => {
                setAttachOpen(false)
                galleryInputRef.current?.click()
              }}
              className="flex flex-col items-center gap-2 rounded-2xl bg-neutral-900 py-5 text-sm font-medium text-white ring-1 ring-neutral-800 transition active:bg-neutral-800"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              </span>
              Galería
            </button>
          </div>
        </Modal>
      )}

      {viewerPhoto && <PhotoViewer photos={[viewerPhoto]} onClose={() => setViewerPhoto(null)} />}

      {sellOpen && (
        <SellFlowModal
          listingId={conversation.listing_id}
          sellerId={conversation.seller_id}
          onClose={() => setSellOpen(false)}
          onSold={loadConversation}
        />
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
              <button disabled={offerBusy} className="btn-primary">
                Enviar oferta
              </button>
            </form>
          )}
        </Modal>
      )}

      {ratingOpen && myId && (
        <Modal title={`Calificar a ${other?.username}`} onClose={() => setRatingOpen(false)}>
          <RatingForm
            conversationId={conversation.id}
            raterId={myId}
            ratedId={iAmBuyer ? conversation.seller_id : conversation.buyer_id}
            ratedName={other?.username}
            role={iAmBuyer ? 'rated_as_seller' : 'rated_as_buyer'}
            onDone={() => setAlreadyRated(true)}
          />
        </Modal>
      )}
    </div>
  )
}
