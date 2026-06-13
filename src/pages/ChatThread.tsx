import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatPrice } from '../lib/format'
import type { Conversation, Message } from '../lib/types'
import Modal from '../components/Modal'

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
  const [ratingOpen, setRatingOpen] = useState(false)
  const [alreadyRated, setAlreadyRated] = useState(false)
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [ratingSent, setRatingSent] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const myId = session?.user.id
  const iAmBuyer = conversation?.buyer_id === myId
  const other = iAmBuyer ? conversation?.seller : conversation?.buyer
  // 4+ mensajes de ambas partes habilitan calificar (regla también en DB)
  const canRate =
    messages.length >= 4 && new Set(messages.map((m) => m.sender_id)).size >= 2 && !alreadyRated

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { from: `/chats/${id}`, back: '/' } })
  }, [loading, session, id, navigate])

  useEffect(() => {
    if (!session || !id) return
    supabase
      .from('conversations')
      .select('*, listing:listings(id, title, price, currency, photos, status), buyer:profiles!conversations_buyer_id_fkey(*), seller:profiles!conversations_seller_id_fkey(*)')
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
    const { data } = await supabase
      .from('messages')
      .insert({ conversation_id: id, sender_id: myId, body: text })
      .select('*')
      .single()
    if (data) {
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(draft)
  }

  async function submitRating() {
    if (!conversation || !myId || stars === 0) return
    const ratedId = iAmBuyer ? conversation.seller_id : conversation.buyer_id
    const { error } = await supabase.from('ratings').insert({
      conversation_id: conversation.id,
      rater_id: myId,
      rated_id: ratedId,
      role: iAmBuyer ? 'rated_as_seller' : 'rated_as_buyer',
      stars,
      comment: comment.trim() || null,
    })
    if (!error) {
      setRatingSent(true)
      setAlreadyRated(true)
    }
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
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender_id === myId ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-3xl px-4 py-2.5 text-[15px] ${
                m.sender_id === myId
                  ? 'rounded-br-lg bg-white text-black'
                  : 'rounded-bl-lg bg-neutral-900 text-neutral-100'
              }`}
            >
              {m.body}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
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

      {ratingOpen && (
        <Modal title={`Calificar a ${other?.username}`} onClose={() => setRatingOpen(false)}>
          {ratingSent ? (
            <div className="py-6 text-center">
              <p className="font-semibold text-white">¡Gracias por calificar!</p>
              <p className="mt-1 text-sm text-neutral-400">
                Tu calificación se publica cuando {other?.username} también califique, o a los 14 días.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-sm text-neutral-400">
                La calificación es ciega: {other?.username} no la ve hasta calificarte también.
              </p>
              <div className="flex justify-center gap-3">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setStars(n)} aria-label={`${n} estrellas`}>
                    <svg
                      viewBox="0 0 24 24"
                      className={`h-9 w-9 transition ${n <= stars ? 'fill-white' : 'fill-neutral-800'}`}
                    >
                      <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8L12 2z" />
                    </svg>
                  </button>
                ))}
              </div>
              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Comentario (opcional)"
                className="input-line resize-none"
              />
              <button onClick={submitRating} disabled={stars === 0} className="btn-primary">
                Enviar calificación
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
