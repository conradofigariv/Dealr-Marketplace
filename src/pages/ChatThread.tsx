import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatPrice } from '../lib/format'
import type { Conversation, Message } from '../lib/types'
import Modal from '../components/Modal'
import RatingForm from '../components/RatingForm'

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
  const [ratingOpen, setRatingOpen] = useState(false)
  const [alreadyRated, setAlreadyRated] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const myId = session?.user.id
  const iAmBuyer = conversation?.buyer_id === myId
  const other = iAmBuyer ? conversation?.seller : conversation?.buyer
  // La venta confirmada (vendedor marcó "vendido" a este comprador) habilita
  // calificar de una. Si no, hace falta una charla real: 4+ mensajes de ambas
  // partes (misma regla en la DB).
  const saleConfirmed =
    conversation?.listing?.status === 'sold' && conversation?.listing?.sold_to === conversation?.buyer_id
  const canRate =
    !alreadyRated &&
    (saleConfirmed || (messages.length >= 4 && new Set(messages.map((m) => m.sender_id)).size >= 2))

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { from: `/chats/${id}`, back: '/' } })
  }, [loading, session, id, navigate])

  useEffect(() => {
    if (!session || !id) return
    supabase
      .from('conversations')
      .select('*, listing:listings(id, title, price, currency, photos, status, sold_to), buyer:profiles!conversations_buyer_id_fkey(*), seller:profiles!conversations_seller_id_fkey(*)')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => setConversation(data as Conversation))

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

    // Mensajes en vivo vía Supabase Realtime
    const channel = supabase
      .channel(`conversation-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
        (payload) => {
          setMessages((prev) =>
            prev.some((m) => m.id === (payload.new as Message).id)
              ? prev
              : [...prev, payload.new as Message],
          )
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
        (payload) => {
          // Refleja el "leído" del otro en mis mensajes (doble tilde).
          setMessages((prev) => prev.map((m) => (m.id === (payload.new as Message).id ? (payload.new as Message) : m)))
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [session, id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    // Marcar como leídos los mensajes del otro
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
      // Devolvemos el texto al input para que se pueda reintentar sin reescribir.
      setDraft((d) => d || text)
      setSendError('No se pudo enviar. Probá de nuevo.')
      return
    }
    setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(draft)
  }

  if (!conversation) return <div className="p-5 text-sm text-neutral-600">Cargando…</div>

  const listing = conversation.listing!

  return (
    <div className="flex h-dvh flex-col bg-black">
      {/* Encabezado con contexto de la publicación */}
      <header className="border-b border-neutral-900 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/chats')} aria-label="Volver" className="p-1.5 text-white">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18 9 12l6-6" />
            </svg>
          </button>
          <Link to={`/p/${listing.id}`} className="flex min-w-0 flex-1 items-center gap-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-neutral-900">
              {listing.photos?.[0] && (
                <img src={photoUrl(listing.photos[0])} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{listing.title}</p>
              <p className="text-xs text-neutral-500">
                {formatPrice(listing.price, listing.currency)} · con {other?.username}
              </p>
            </div>
          </Link>
          {canRate && (
            <button
              onClick={() => setRatingOpen(true)}
              className="shrink-0 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-black"
            >
              Calificar
            </button>
          )}
        </div>
      </header>

      {/* Mensajes */}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
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
              <div
                className={`max-w-[80%] rounded-3xl px-4 py-2.5 text-[15px] ${
                  mine ? 'rounded-br-lg bg-white text-black' : 'rounded-bl-lg bg-neutral-900 text-neutral-100'
                }`}
              >
                {m.body}
              </div>
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
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {sendError && (
        <p className="px-4 pb-1 text-center text-xs text-red-400">{sendError}</p>
      )}
      <form
        onSubmit={onSubmit}
        className="flex items-center gap-3 border-t border-neutral-900 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
