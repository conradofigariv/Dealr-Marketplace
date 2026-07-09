import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatPrice, isOnline, lastSeenLabel } from '../lib/format'
import { compressPhoto, mirrorImage } from '../lib/images'
import { vibrate, haptic } from '../lib/notify'
import type { Conversation, Message } from '../lib/types'
import Modal from '../components/Modal'
import ActionMenu, { type MenuAction } from '../components/ActionMenu'
import { useToast } from '../components/Toast'
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

// Menú contextual estilo iOS: clona el mensaje tocado en su posición exacta
// (queda nítido, sin selección de texto, con un pop elástico al aparecer) y
// difumina todo lo demás detrás, con un popup chico al lado.
function MessageContextMenu({
  message,
  rect,
  mine,
  actions,
  onClose,
}: {
  message: Message
  rect: DOMRect
  mine: boolean
  actions: MenuAction[]
  onClose: () => void
}) {
  return (
    <ActionMenu
      rect={rect}
      actions={actions}
      onClose={onClose}
      anchor={
        message.image_path ? (
          <img src={photoUrl(message.image_path)} alt="" className="h-full w-full rounded-2xl object-cover" draggable={false} />
        ) : (
          <div
            className={`flex h-full w-full items-center whitespace-pre-line rounded-3xl px-4 py-2.5 text-[15px] ${
              mine ? 'rounded-br-lg bg-white text-black' : 'rounded-bl-lg bg-neutral-900 text-neutral-100'
            }`}
          >
            {message.body}
          </div>
        )
      }
    />
  )
}

export default function ChatThread() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session, profile, loading } = useAuth()
  const toast = useToast()
  const isAdmin = Boolean(profile?.is_admin)

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
  const [contextMenu, setContextMenu] = useState<{ message: Message; rect: DOMRect } | null>(null)
  const [pressingId, setPressingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [reportingMsg, setReportingMsg] = useState<Message | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [pendingPhoto, setPendingPhoto] = useState<{ file: File; preview: string; mirrored: boolean } | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const didInitialScroll = useRef(false)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout>>()
  const lastTypingSent = useRef(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>()
  const longPressMoved = useRef(false)

  // El teclado no achica el `dvh` en iOS (PWA instalada), así que tapa el input
  // y el navegador empuja todo hacia arriba. Seguimos el visualViewport para que
  // el contenedor del chat use el alto VISIBLE (descontando el teclado) y la
  // pantalla no se deslice. En Android lo respeta igual.
  // OJO: depende de que exista el div con rootRef, que recién se monta cuando
  // cargó la conversación (antes hay un early-return "Cargando…") — por eso la
  // dep: con [] el efecto corría una sola vez, encontraba root=null y nunca se
  // enganchaba (el teclado tapaba el input siempre).
  const chatReady = Boolean(conversation)
  useEffect(() => {
    const vv = window.visualViewport
    const root = rootRef.current
    if (!vv || !root) return
    let raf = 0
    const update = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        root.style.height = `${vv.height}px`
        if (window.scrollY !== 0) window.scrollTo(0, 0) // no dejar que la página se corra
      })
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(raf)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.height = ''
    }
  }, [chatReady])

  const myId = session?.user.id
  const iAmBuyer = conversation?.buyer_id === myId
  const iAmSeller = conversation?.seller_id === myId
  const other = iAmBuyer ? conversation?.seller : conversation?.buyer
  const saleConfirmed =
    conversation?.listing?.status === 'sold' && conversation?.listing?.sold_to === conversation?.buyer_id
  const canRate =
    !alreadyRated &&
    // El DM de bienvenida del admin no es una operación: no se califica.
    conversation?.kind !== 'welcome' &&
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
          const incoming = payload.new as Message
          // Vibración sutil al recibir un mensaje del otro con el chat abierto.
          if (incoming.sender_id !== session.user.id) haptic('tap')
          setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]))
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
    haptic('tap') // feedback inmediato al enviar
    setDraft('')
    setSendError('')
    // Burbuja optimista: el mensaje aparece al instante (levemente translúcido)
    // y se reemplaza por el real cuando el insert confirma. En conexión lenta,
    // antes el texto "desaparecía" del input y tardaba en aparecer.
    const tempId = `temp-${crypto.randomUUID()}`
    const temp = {
      id: tempId,
      conversation_id: id,
      sender_id: myId,
      body: text,
      image_path: null,
      created_at: new Date().toISOString(),
      read_at: null,
      edited_at: null,
      deleted_at: null,
    } as Message
    setMessages((prev) => [...prev, temp])
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: id, sender_id: myId, body: text })
      .select('*')
      .single()
    if (error || !data) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      setDraft((d) => d || text)
      setSendError('No se pudo enviar. Probá de nuevo.')
      return
    }
    setMessages((prev) => {
      const withoutTemp = prev.filter((m) => m.id !== tempId)
      // El eco de Realtime puede haber llegado antes que esta respuesta.
      return withoutTemp.some((m) => m.id === data.id) ? withoutTemp : [...withoutTemp, data]
    })
  }

  async function sendImage(file: File, mirrored = false) {
    if (!myId || !id) return
    const preview = URL.createObjectURL(file)
    setUploadingPreview(preview)
    setSending(true)
    setSendError('')
    try {
      const source = mirrored ? await mirrorImage(file) : file
      const compressed = await compressPhoto(source)
      // El path arranca con el uid: la policy de Storage exige que la primera
      // carpeta sea auth.uid() (igual que las fotos de publicaciones).
      const path = `${myId}/chat/${id}/${crypto.randomUUID()}.webp`
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
    } catch (err) {
      // Mostramos la causa real: si falta la migración 00013 (columna
      // image_path / body nullable), el insert falla y conviene saberlo.
      const e = err as { message?: string; details?: string; hint?: string; code?: string } | null
      const message = e?.message ?? (err instanceof Error ? err.message : '')
      const full = [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(' · ') || JSON.stringify(err)
      setSendError(
        /network|fetch/i.test(message)
          ? 'Problema de conexión. Probá de nuevo.'
          : /could not find|schema cache|column .* does not exist|violates not-null|messages_body_check|messages_content_check/i.test(message)
            ? `Falta aplicar la migración 00013 en Supabase: ${full}`
            : `No se pudo enviar la foto: ${full}`,
      )
    } finally {
      setSending(false)
      setUploadingPreview(null)
      URL.revokeObjectURL(preview)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (editingId) editMessage(editingId, draft)
    else send(draft)
  }

  async function editMessage(messageId: string, body: string) {
    const text = body.trim()
    if (!text) return
    setDraft('')
    setEditingId(null)
    setSendError('')
    const { data, error } = await supabase.rpc('edit_message', { p_message_id: messageId, p_body: text }).single()
    if (error || !data) {
      setSendError('No se pudo editar el mensaje.')
      return
    }
    setMessages((prev) => prev.map((m) => (m.id === (data as Message).id ? (data as Message) : m)))
  }

  async function deleteMessage(messageId: string) {
    const { data, error } = await supabase.rpc('delete_message', { p_message_id: messageId }).single()
    if (error || !data) {
      setSendError('No se pudo borrar el mensaje.')
      return
    }
    setMessages((prev) => prev.map((m) => (m.id === (data as Message).id ? (data as Message) : m)))
  }

  // Mensaje propio: copiar/editar/borrar. Mensaje ajeno: copiar (si tiene
  // texto), reportar y —si sos admin— borrar. Si no hay sesión, no hay menú.
  function hasMenu(m: Message): boolean {
    if (m.deleted_at) return false
    if (m.id.startsWith('temp-')) return false // burbuja optimista aún sin id real
    return m.sender_id === myId || Boolean(session)
  }

  async function submitReport() {
    if (!reportingMsg || reportReason.trim().length < 1) return
    const { error } = await supabase.from('reports').insert({
      reporter_id: myId,
      target_type: 'message',
      target_id: reportingMsg.id,
      reason: reportReason.trim(),
    })
    setReportingMsg(null)
    setReportReason('')
    toast(error ? (error.code === '23505' ? 'Ya reportaste este mensaje.' : error.message) : 'Gracias. Recibimos tu reporte.')
  }

  // Borrado de moderación (admin): hard delete vía RLS, no el RPC de borrado
  // propio. Realtime puede no avisar el DELETE, así que lo sacamos local.
  async function adminDeleteMessage(messageId: string) {
    const { error } = await supabase.from('messages').delete().eq('id', messageId)
    if (error) return toast(error.message)
    setMessages((prev) => prev.filter((m) => m.id !== messageId))
    toast('Mensaje borrado')
  }

  function startLongPress(m: Message, el: HTMLElement) {
    if (!hasMenu(m)) return
    longPressMoved.current = false
    setPressingId(m.id)
    longPressTimer.current = setTimeout(() => {
      setPressingId(null)
      if (!longPressMoved.current) {
        vibrate(12)
        setContextMenu({ message: m, rect: el.getBoundingClientRect() })
      }
    }, 450)
  }

  function cancelLongPress() {
    clearTimeout(longPressTimer.current)
    setPressingId(null)
  }

  function moveLongPress() {
    longPressMoved.current = true
    setPressingId(null)
  }

  function startEdit(m: Message) {
    setEditingId(m.id)
    setDraft(m.body ?? '')
    setContextMenu(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft('')
  }

  async function copyMessage(m: Message) {
    if (!m.body) return
    try {
      await navigator.clipboard.writeText(m.body)
      toast('Mensaje copiado')
    } catch {
      toast('No se pudo copiar')
    }
    setContextMenu(null)
  }

  async function sendOffer(e: FormEvent) {
    e.preventDefault()
    if (!myId || !conversation || !conversation.listing_id) return
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

  // La publicación puede no existir si el vendedor la borró: la conversación
  // sobrevive (00027), pero `listing` queda null y la UI lo refleja.
  const listing = conversation.listing

  return (
    <div ref={rootRef} className="flex h-dvh flex-col bg-black">
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
        {/* Contexto: de qué publicación hablan (tappable a la publicación).
            Si la borraron, no hay link: solo un cartel "Publicación eliminada". */}
        {listing ? (
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
        ) : conversation.kind === 'welcome' ? (
          <div className="mt-2 flex items-center gap-2.5 rounded-xl bg-neutral-900/70 px-2 py-1.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-neutral-300">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <p className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-300">Mensaje de bienvenida</p>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2.5 rounded-xl bg-neutral-900/70 px-2 py-1.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-neutral-600">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3l18 18M10.5 5.5A9 9 0 0 1 21 12a9 9 0 0 1-1.6 2.6M6.6 6.6A9 9 0 0 0 3 12a9 9 0 0 0 9 9 9 9 0 0 0 5.4-1.8" />
              </svg>
            </div>
            <p className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-500">Publicación eliminada</p>
          </div>
        )}
        {/* Acción contextual: el vendedor cierra la venta, el comprador ofrece */}
        {listing?.status === 'active' && (
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
              {m.deleted_at ? (
                <div
                  className={`max-w-[80%] rounded-3xl px-4 py-2.5 text-[15px] italic text-neutral-500 ${
                    mine ? 'rounded-br-lg bg-neutral-900' : 'rounded-bl-lg bg-neutral-900'
                  }`}
                >
                  Mensaje eliminado
                </div>
              ) : m.image_path ? (
                <img
                  src={photoUrl(m.image_path)}
                  alt="Foto"
                  onClick={() => setViewerPhoto(m.image_path!)}
                  onPointerDown={(e) => startLongPress(m, e.currentTarget)}
                  onPointerUp={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onPointerMove={moveLongPress}
                  onContextMenu={(e) => {
                    if (hasMenu(m)) {
                      e.preventDefault()
                      setContextMenu({ message: m, rect: e.currentTarget.getBoundingClientRect() })
                    }
                  }}
                  className={`msg-pressable max-h-72 max-w-[70%] cursor-zoom-in rounded-2xl object-cover ${
                    pressingId === m.id ? 'msg-pressing' : ''
                  }`}
                />
              ) : (
                <div
                  onPointerDown={(e) => startLongPress(m, e.currentTarget)}
                  onPointerUp={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onPointerMove={moveLongPress}
                  onContextMenu={(e) => {
                    if (hasMenu(m)) {
                      e.preventDefault()
                      setContextMenu({ message: m, rect: e.currentTarget.getBoundingClientRect() })
                    }
                  }}
                  className={`msg-pressable max-w-[80%] whitespace-pre-line rounded-3xl px-4 py-2.5 text-[15px] ${
                    mine ? 'rounded-br-lg bg-white text-black' : 'rounded-bl-lg bg-neutral-900 text-neutral-100'
                  } ${pressingId === m.id ? 'msg-pressing' : ''} ${m.id.startsWith('temp-') ? 'opacity-60' : ''}`}
                >
                  {m.body}
                  {m.edited_at && (
                    <span className={`ml-1.5 text-[11px] ${mine ? 'text-neutral-500' : 'text-neutral-500'}`}>
                      editado
                    </span>
                  )}
                </div>
              )}
              {mine && !m.deleted_at && !m.id.startsWith('temp-') && (
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
      {editingId && (
        <div className="flex items-center justify-between border-t border-neutral-900 bg-neutral-950 px-4 py-2">
          <p className="text-xs font-medium text-sky-400">Editando mensaje</p>
          <button onClick={cancelEdit} aria-label="Cancelar edición" className="text-neutral-500">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      )}
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
            if (file) setPendingPhoto({ file, preview: URL.createObjectURL(file), mirrored: false })
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
            if (file) setPendingPhoto({ file, preview: URL.createObjectURL(file), mirrored: false })
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
          onFocus={() => {
            // Al abrir el teclado, llevar el scroll al último mensaje.
            requestAnimationFrame(() => {
              const s = scrollerRef.current
              if (s) s.scrollTop = s.scrollHeight
            })
          }}
          placeholder="Escribí un mensaje"
          className="w-full rounded-full bg-neutral-900 px-5 py-3 text-[15px] text-white placeholder-neutral-500 outline-none"
        />
        <button
          disabled={!draft.trim()}
          aria-label="Enviar"
          // Evita que el botón le robe el foco al input al tocarlo: así el
          // teclado NO se cierra al enviar (el submit se dispara igual por el click).
          onMouseDown={(e) => e.preventDefault()}
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

      {contextMenu &&
        (() => {
          const m = contextMenu.message
          const mine = m.sender_id === myId
          const actions: MenuAction[] = []
          if (m.body) actions.push({ label: 'Copiar', onClick: () => copyMessage(m) })
          if (mine && !m.image_path) actions.push({ label: 'Editar', onClick: () => startEdit(m) })
          if (mine)
            actions.push({
              label: 'Eliminar',
              destructive: true,
              onClick: () => {
                deleteMessage(m.id)
                setContextMenu(null)
              },
            })
          if (!mine)
            actions.push({
              label: 'Reportar',
              onClick: () => {
                setReportingMsg(m)
                setContextMenu(null)
              },
            })
          if (!mine && isAdmin)
            actions.push({
              label: 'Borrar (admin)',
              destructive: true,
              onClick: () => {
                adminDeleteMessage(m.id)
                setContextMenu(null)
              },
            })
          return (
            <MessageContextMenu
              message={m}
              rect={contextMenu.rect}
              mine={mine}
              actions={actions}
              onClose={() => setContextMenu(null)}
            />
          )
        })()}

      {reportingMsg && (
        <Modal title="Reportar mensaje" onClose={() => setReportingMsg(null)}>
          <div className="space-y-4">
            <p className="text-sm text-neutral-400">Contanos qué pasa. Lo revisa el equipo de Dealr.</p>
            <div className="flex flex-wrap gap-1.5">
              {['Acoso o insultos', 'Spam', 'Contenido inapropiado', 'Otro'].map((r) => (
                <button
                  key={r}
                  onClick={() => setReportReason(r)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    reportReason === r ? 'bg-white text-black' : 'text-neutral-300 ring-1 ring-neutral-700'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              maxLength={500}
              placeholder="Detalle (opcional si elegiste un motivo)"
              className="input-line resize-none text-sm"
            />
            <button
              onClick={submitReport}
              disabled={reportReason.trim().length < 1}
              className="btn-primary w-full py-3 text-sm disabled:opacity-50"
            >
              Enviar reporte
            </button>
          </div>
        </Modal>
      )}

      {pendingPhoto && (
        <Modal
          title="Enviar foto"
          onClose={() => {
            URL.revokeObjectURL(pendingPhoto.preview)
            setPendingPhoto(null)
          }}
        >
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl bg-neutral-900">
              <img
                src={pendingPhoto.preview}
                alt="Vista previa"
                className="max-h-96 w-full object-contain"
                style={{ transform: pendingPhoto.mirrored ? 'scaleX(-1)' : undefined }}
              />
            </div>
            <button
              type="button"
              onClick={() => setPendingPhoto((p) => (p ? { ...p, mirrored: !p.mirrored } : p))}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-neutral-900 py-2.5 text-sm font-medium text-white ring-1 ring-neutral-800 transition active:bg-neutral-800"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18M16 7l4 5-4 5M8 7 4 12l4 5" />
              </svg>
              Espejar
            </button>
            <button
              onClick={() => {
                const { file, mirrored, preview } = pendingPhoto
                setPendingPhoto(null)
                sendImage(file, mirrored)
                URL.revokeObjectURL(preview)
              }}
              className="btn-primary"
            >
              Enviar
            </button>
          </div>
        </Modal>
      )}

      {viewerPhoto && <PhotoViewer photos={[viewerPhoto]} onClose={() => setViewerPhoto(null)} />}

      {sellOpen && conversation.listing_id && (
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
                Precio publicado: <strong className="text-white">{formatPrice(listing?.price ?? 0, listing?.currency ?? 'ARS')}</strong>
              </p>
              <div className="flex items-end gap-2">
                <span className="pb-2.5 font-semibold text-neutral-500">{listing?.currency === 'USD' ? 'US$' : '$'}</span>
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
