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
    if (!loading && !session) navigate('/auth')
  }, [loading, session, navigate])

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

  if (!conversation) return <div className="p-4 text-sm text-gray-400">Cargando…</div>

  const listing = conversation.listing!

  return (
    <div className="flex h-dvh flex-col">
      {/* Encabezado con contexto de la publicación */}
      <header className="bg-brand-700 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/chats')} aria-label="Volver" className="p-1 text-white">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18 9 12l6-6" />
            </svg>
          </button>
          <Link to={`/p/${listing.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/20">
              {listing.photos?.[0] && (
                <img src={photoUrl(listing.photos[0])} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{listing.title}</p>
              <p className="text-xs text-brand-100">
                {formatPrice(listing.price, listing.currency)} · con {other?.username}
              </p>
            </div>
          </Link>
          {canRate && (
            <button
              onClick={() => setRatingOpen(true)}
              className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-brand-700"
            >
              Calificar
            </button>
          )}
        </div>
      </header>

      {/* Mensajes */}
      <div className="flex-1 space-y-2 overflow-y-auto bg-gray-50 px-3 py-3">
        {messages.length === 0 && iAmBuyer && (
          <div className="space-y-2 py-4">
            <p className="text-center text-xs text-gray-400">Empezá con una pregunta concreta:</p>
            {QUICK_REPLIES.map((qr) => (
              <button
                key={qr}
                onClick={() => send(qr)}
                className="block w-full rounded-xl bg-white px-4 py-2.5 text-left text-sm text-gray-700 ring-1 ring-gray-200"
              >
                {qr}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender_id === myId ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                m.sender_id === myId
                  ? 'rounded-br-md bg-brand-700 text-white'
                  : 'rounded-bl-md bg-white text-gray-800 ring-1 ring-gray-200'
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
        className="flex gap-2 border-t border-gray-200 bg-white px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribí un mensaje..."
          className="w-full rounded-full border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-brand-500"
        />
        <button
          disabled={!draft.trim()}
          aria-label="Enviar"
          className="shrink-0 rounded-full bg-brand-700 p-2.5 text-white disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m22 2-11 11M22 2l-7 20-4-9-9-4 20-7Z" />
          </svg>
        </button>
      </form>

      {ratingOpen && (
        <Modal title={`Calificar a ${other?.username}`} onClose={() => setRatingOpen(false)}>
          {ratingSent ? (
            <div className="py-4 text-center">
              <p className="mb-1 text-3xl">⭐</p>
              <p className="font-semibold">¡Gracias por calificar!</p>
              <p className="mt-1 text-sm text-gray-500">
                Tu calificación se publica cuando {other?.username} también califique, o a los 14 días.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                La calificación es ciega: {other?.username} no la ve hasta calificarte también.
              </p>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setStars(n)} aria-label={`${n} estrellas`}>
                    <svg
                      viewBox="0 0 24 24"
                      className={`h-9 w-9 ${n <= stars ? 'fill-amber-400' : 'fill-gray-200'}`}
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
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-brand-500"
              />
              <button
                onClick={submitRating}
                disabled={stars === 0}
                className="w-full rounded-xl bg-brand-700 py-3 font-semibold text-white disabled:opacity-40"
              >
                Enviar calificación
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
