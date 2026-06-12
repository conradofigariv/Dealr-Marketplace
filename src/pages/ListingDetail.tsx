import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { FieldDef, Listing, Question } from '../lib/types'
import { formatPrice, conditionLabels, timeAgo } from '../lib/format'
import StarRating from '../components/StarRating'
import SellerBadges from '../components/SellerBadges'
import Modal from '../components/Modal'

export default function ListingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()

  const [listing, setListing] = useState<Listing | null>(null)
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [notFound, setNotFound] = useState(false)
  const [questionBody, setQuestionBody] = useState('')
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({})
  const [offerOpen, setOfferOpen] = useState(false)
  const [offerAmount, setOfferAmount] = useState('')
  const [offerSent, setOfferSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const isOwner = session?.user.id === listing?.seller_id

  async function load() {
    const { data } = await supabase
      .from('listings')
      .select('*, seller:profiles(*)')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function askQuestion(e: FormEvent) {
    e.preventDefault()
    if (!session) return navigate('/auth')
    setBusy(true)
    const { error } = await supabase.from('questions').insert({
      listing_id: id,
      asker_id: session.user.id,
      body: questionBody.trim(),
    })
    setBusy(false)
    if (!error) {
      setQuestionBody('')
      load()
    }
  }

  async function answerQuestion(questionId: string) {
    const answer = answerDrafts[questionId]?.trim()
    if (!answer) return
    // El trigger de la DB marca answered_at y la hace pública
    await supabase.from('questions').update({ answer_body: answer }).eq('id', questionId)
    setAnswerDrafts((d) => ({ ...d, [questionId]: '' }))
    load()
  }

  async function reportQuestion(questionId: string) {
    if (!session) return navigate('/auth')
    await supabase.from('reports').insert({
      reporter_id: session.user.id,
      target_type: 'question',
      target_id: questionId,
      reason: 'Contenido inapropiado en pregunta pública',
    })
    alert('Reporte enviado. Gracias por ayudar a mantener Dealr.')
  }

  async function sendOffer(e: FormEvent) {
    e.preventDefault()
    if (!session) return navigate('/auth')
    setBusy(true)
    const { error } = await supabase.from('offers').insert({
      listing_id: id,
      buyer_id: session.user.id,
      amount: Number(offerAmount),
    })
    setBusy(false)
    if (!error) setOfferSent(true)
  }

  async function openChat() {
    if (!session) return navigate('/auth')
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
    if (!error && created) navigate(`/chats/${created.id}`)
  }

  async function setStatus(status: Listing['status'], renew = false) {
    const patch: Record<string, unknown> = { status }
    if (renew) patch.last_renewed_at = new Date().toISOString()
    await supabase.from('listings').update(patch).eq('id', id!)
    load()
  }

  if (notFound) {
    return (
      <div className="px-4 py-20 text-center text-gray-500">
        <p className="mb-2 text-3xl">🤷</p>
        Esta publicación ya no está disponible.
        <Link to="/" className="mt-4 block font-semibold text-brand-700">
          Volver al inicio
        </Link>
      </div>
    )
  }
  if (!listing) return <div className="px-4 py-8"><div className="aspect-square animate-pulse rounded-xl bg-gray-200" /></div>

  const seller = listing.seller!
  const structuredEntries = fieldDefs
    .map((def) => ({ def, value: listing.structured_fields[def.key] }))
    .filter(({ value }) => value !== undefined && value !== null && value !== '')

  return (
    <div className="pb-36">
      {/* Carrusel de fotos */}
      <div className="relative">
        <button
          onClick={() => navigate(-1)}
          aria-label="Volver"
          className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 rounded-full bg-white/90 p-2 shadow"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18 9 12l6-6" />
          </svg>
        </button>
        <div className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto bg-gray-100">
          {(listing.photos.length ? listing.photos : [null]).map((p, i) => (
            <div key={i} className="aspect-square w-full shrink-0 snap-center">
              {p ? (
                <img src={photoUrl(p)} alt={`${listing.title} foto ${i + 1}`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-gray-300">Sin fotos</div>
              )}
            </div>
          ))}
        </div>
        {listing.status !== 'active' && (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 py-2 text-center text-sm font-bold uppercase text-white">
            {listing.status === 'sold' ? 'Vendido' : 'Pausado'}
          </div>
        )}
      </div>

      <div className="space-y-4 px-4 py-4">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-lg font-bold leading-snug">{listing.title}</h1>
            <span className="shrink-0 rounded-md bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">
              {conditionLabels[listing.condition]}
            </span>
          </div>
          <p className="mt-1 text-2xl font-extrabold text-brand-700">
            {formatPrice(listing.price, listing.currency)}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">Publicado {timeAgo(listing.created_at)}</p>
        </div>

        {listing.description && (
          <p className="whitespace-pre-wrap text-sm text-gray-700">{listing.description}</p>
        )}

        {structuredEntries.length > 0 && (
          <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
            <h2 className="mb-2 text-sm font-bold">Detalles</h2>
            <dl className="space-y-1.5">
              {structuredEntries.map(({ def, value }) => (
                <div key={def.key} className="flex justify-between gap-4 text-sm">
                  <dt className="text-gray-500">{def.label}</dt>
                  <dd className="text-right font-medium">
                    {def.type === 'boolean' ? (value ? 'Sí' : 'No') : Array.isArray(value) ? value.join(', ') : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Vendedor */}
        <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{seller.username}</p>
              {seller.seller_score != null ? (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <StarRating value={seller.seller_score} />
                  <span>({seller.seller_ratings_count})</span>
                </div>
              ) : (
                <p className="text-xs text-gray-500">
                  Usuario nuevo · en Dealr desde {new Date(seller.created_at).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>
          <div className="mt-2">
            <SellerBadges profile={seller} />
          </div>
        </div>

        {/* Acciones del dueño */}
        {isOwner && (
          <div className="rounded-xl bg-brand-50 p-3 ring-1 ring-brand-200">
            <h2 className="mb-2 text-sm font-bold text-brand-800">Tu publicación</h2>
            <div className="flex flex-wrap gap-2">
              {listing.status === 'active' ? (
                <>
                  <button onClick={() => setStatus('active', true)} className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white">
                    Renovar (subir en el feed)
                  </button>
                  <button onClick={() => setStatus('sold')} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">
                    Ya lo vendí
                  </button>
                  <button onClick={() => setStatus('paused')} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">
                    Pausar
                  </button>
                </>
              ) : (
                <button onClick={() => setStatus('active', true)} className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white">
                  Reactivar
                </button>
              )}
              <Link to={`/publicar/${listing.id}`} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">
                Editar
              </Link>
            </div>
          </div>
        )}

        {/* Preguntas */}
        <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
          <h2 className="mb-1 text-sm font-bold">Preguntas</h2>
          <p className="mb-3 text-xs text-gray-400">
            Las preguntas se publican cuando el vendedor responde.
          </p>
          {!isOwner && listing.status === 'active' && (
            <form onSubmit={askQuestion} className="mb-3 flex gap-2">
              <input
                value={questionBody}
                onChange={(e) => setQuestionBody(e.target.value)}
                placeholder="Preguntale al vendedor..."
                maxLength={500}
                className="w-full rounded-full border border-gray-200 px-4 py-2 text-sm outline-none focus:border-brand-500"
              />
              <button
                disabled={busy || !questionBody.trim()}
                className="shrink-0 rounded-full bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Enviar
              </button>
            </form>
          )}
          {questions.length === 0 ? (
            <p className="py-2 text-sm text-gray-400">Todavía no hay preguntas.</p>
          ) : (
            <ul className="space-y-3">
              {questions.map((q) => (
                <li key={q.id} className="text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{q.body}</p>
                    {q.is_public && session && q.asker_id !== session.user.id && !isOwner && (
                      <button onClick={() => reportQuestion(q.id)} className="shrink-0 text-xs text-gray-300 hover:text-red-500">
                        Reportar
                      </button>
                    )}
                  </div>
                  {q.answer_body ? (
                    <p className="mt-1 border-l-2 border-brand-200 pl-2 text-gray-600">{q.answer_body}</p>
                  ) : isOwner ? (
                    <div className="mt-1.5 flex gap-2">
                      <input
                        value={answerDrafts[q.id] ?? ''}
                        onChange={(e) => setAnswerDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                        placeholder="Respondé para publicarla..."
                        className="w-full rounded-full border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
                      />
                      <button
                        onClick={() => answerQuestion(q.id)}
                        className="shrink-0 rounded-full bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Responder
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs italic text-gray-400">Esperando respuesta del vendedor…</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Barra de acciones del comprador */}
      {!isOwner && listing.status === 'active' && (
        <div className="fixed bottom-[calc(3.6rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex w-full max-w-lg -translate-x-1/2 gap-2 border-t border-gray-100 bg-white px-4 py-3">
          <button
            onClick={() => setOfferOpen(true)}
            className="flex-1 rounded-xl border-2 border-brand-700 py-2.5 text-sm font-bold text-brand-700"
          >
            Hacer oferta
          </button>
          <button
            onClick={openChat}
            className="flex-1 rounded-xl bg-brand-700 py-2.5 text-sm font-bold text-white"
          >
            Chatear
          </button>
        </div>
      )}

      {offerOpen && (
        <Modal title="Hacer una oferta" onClose={() => { setOfferOpen(false); setOfferSent(false) }}>
          {offerSent ? (
            <div className="py-4 text-center">
              <p className="mb-1 text-3xl">🤝</p>
              <p className="font-semibold">Oferta enviada</p>
              <p className="text-sm text-gray-500">El vendedor la va a ver en su publicación.</p>
            </div>
          ) : (
            <form onSubmit={sendOffer} className="space-y-3">
              <p className="text-sm text-gray-600">
                Precio publicado: <strong>{formatPrice(listing.price, listing.currency)}</strong>
              </p>
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-3 focus-within:border-brand-500">
                <span className="font-semibold text-gray-500">{listing.currency === 'USD' ? 'US$' : '$'}</span>
                <input
                  type="number"
                  min="1"
                  required
                  value={offerAmount}
                  onChange={(e) => setOfferAmount(e.target.value)}
                  placeholder="Tu oferta"
                  className="w-full text-lg font-semibold outline-none"
                />
              </div>
              <button disabled={busy} className="w-full rounded-xl bg-brand-700 py-3 font-semibold text-white disabled:opacity-50">
                Enviar oferta
              </button>
            </form>
          )}
        </Modal>
      )}

      {/* Ofertas recibidas (solo dueño) */}
      {isOwner && <OwnerOffers listingId={listing.id} currency={listing.currency} />}
    </div>
  )
}

function OwnerOffers({ listingId, currency }: { listingId: string; currency: Listing['currency'] }) {
  const [offers, setOffers] = useState<import('../lib/types').Offer[]>([])

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
    await supabase.from('offers').update({ status }).eq('id', offerId)
    load()
  }

  if (offers.length === 0) return null
  return (
    <div className="mx-4 rounded-xl bg-white p-3 ring-1 ring-gray-100">
      <h2 className="mb-2 text-sm font-bold">Ofertas recibidas</h2>
      <ul className="space-y-2">
        {offers.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
            <div>
              <p className="font-semibold">{formatPrice(o.amount, currency)}</p>
              <p className="text-xs text-gray-500">
                {o.buyer?.username}
                {/* El buyer_score visible para el vendedor: elegí al de mejor reputación */}
                {o.buyer?.buyer_score != null && ` · ★ ${o.buyer.buyer_score.toFixed(1)} comprador`}
                {o.buyer?.identity_verified && ' · ✓ verificado'}
              </p>
            </div>
            {o.status === 'pending' ? (
              <div className="flex gap-1.5">
                <button onClick={() => respond(o.id, 'accepted')} className="rounded-lg bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white">
                  Aceptar
                </button>
                <button onClick={() => respond(o.id, 'rejected')} className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">
                  Rechazar
                </button>
              </div>
            ) : (
              <span className={`text-xs font-semibold ${o.status === 'accepted' ? 'text-brand-600' : 'text-gray-400'}`}>
                {o.status === 'accepted' ? 'Aceptada' : 'Rechazada'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
