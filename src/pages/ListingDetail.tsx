import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { FieldDef, Listing, Question } from '../lib/types'
import { formatPrice, conditionLabels, timeAgo } from '../lib/format'
import { capture } from '../lib/analytics'
import { useFavorites } from '../hooks/useFavorites'
import Avatar from '../components/Avatar'
import StarRating from '../components/StarRating'
import SellerBadges from '../components/SellerBadges'
import Modal from '../components/Modal'
import SellFlowModal from '../components/SellFlowModal'
import { invalidateFeedCache } from './Home'

export default function ListingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { isFavorite, toggle } = useFavorites()

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
  const [deleting, setDeleting] = useState(false)
  const [sellOpen, setSellOpen] = useState(false)
  const [statusError, setStatusError] = useState('')

  const isOwner = session?.user.id === listing?.seller_id

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

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
    if (!error) {
      capture('question_asked', { listing_id: id })
      setQuestionBody('')
      load()
    }
  }

  async function answerQuestion(questionId: string) {
    const answer = answerDrafts[questionId]?.trim()
    if (!answer) return
    // El trigger de la DB marca answered_at y la hace pública
    const { error } = await supabase.from('questions').update({ answer_body: answer }).eq('id', questionId)
    if (error) {
      alert('No pudimos publicar la respuesta. Probá de nuevo.')
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
    alert(
      error
        ? 'No pudimos enviar el reporte. Probá de nuevo.'
        : 'Reporte enviado. Gracias por ayudar a mantener Dealr.',
    )
  }

  async function sendOffer(e: FormEvent) {
    e.preventDefault()
    if (!session) return navigate('/auth', { state: { from: `/p/${id}`, back: `/p/${id}` } })
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
      alert('No pudimos abrir el chat. Probá de nuevo.')
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

  async function deleteListing() {
    if (!listing) return
    setDeleting(true)
    // Las fotos van por separado; preguntas/ofertas/chats caen por el cascade del FK.
    if (listing.photos.length) {
      await supabase.storage.from('listing-photos').remove(listing.photos)
    }
    const { error } = await supabase.from('listings').delete().eq('id', listing.id)
    setDeleting(false)
    if (error) return
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
  const structuredEntries = fieldDefs
    .map((def) => ({ def, value: listing.structured_fields[def.key] }))
    .filter(({ value }) => value !== undefined && value !== null && value !== '')

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
        {!isOwner && (
          <button
            onClick={() => {
              if (!session) return navigate('/auth', { state: { from: `/p/${id}`, back: `/p/${id}` } })
              toggle(listing.id)
            }}
            aria-label={isFavorite(listing.id) ? 'Quitar de guardados' : 'Guardar'}
            aria-pressed={isFavorite(listing.id)}
            className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm transition active:scale-90"
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
        <div className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto bg-neutral-900">
          {(listing.photos.length ? listing.photos : [null]).map((p, i) => (
            <div key={i} className="aspect-square w-full shrink-0 snap-center">
              {p ? (
                <img src={photoUrl(p)} alt={`${listing.title} foto ${i + 1}`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-neutral-700">Sin fotos</div>
              )}
            </div>
          ))}
        </div>
        {listing.status !== 'active' && (
          <div className="absolute inset-x-0 bottom-0 bg-black/80 py-2 text-center text-sm font-bold uppercase tracking-wide text-white backdrop-blur-sm">
            {listing.status === 'sold' ? 'Vendido' : 'Pausado'}
          </div>
        )}
      </div>

      <div className="space-y-6 px-5 py-6">
        <div>
          <p className="text-3xl font-bold text-white">{formatPrice(listing.price, listing.currency)}</p>
          <h1 className="mt-1.5 text-lg leading-snug text-neutral-200">{listing.title}</h1>
          <p className="mt-2 text-sm text-neutral-500">
            {conditionLabels[listing.condition]} · publicado {timeAgo(listing.created_at)}
          </p>
        </div>

        {listing.description && (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-300">{listing.description}</p>
        )}

        {structuredEntries.length > 0 && (
          <div className="surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-white">Detalles</h2>
            <dl className="space-y-2">
              {structuredEntries.map(({ def, value }) => (
                <div key={def.key} className="flex justify-between gap-4 text-sm">
                  <dt className="text-neutral-500">{def.label}</dt>
                  <dd className="text-right font-medium text-neutral-200">
                    {def.type === 'boolean' ? (value ? 'Sí' : 'No') : Array.isArray(value) ? value.join(', ') : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
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
            </div>
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-neutral-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </div>
          <div className="mt-3">
            <SellerBadges profile={seller} />
          </div>
        </Link>

        {/* Acciones del dueño */}
        {isOwner && (
          <div className="surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-white">Tu publicación</h2>
            <div className="flex flex-wrap gap-2">
              {listing.status === 'active' ? (
                <>
                  <button onClick={() => setStatus('active', true)} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black">
                    Renovar
                  </button>
                  <button onClick={() => setSellOpen(true)} className="rounded-full px-4 py-2 text-xs font-semibold text-neutral-300 ring-1 ring-neutral-700">
                    Ya lo vendí
                  </button>
                  <button onClick={() => setStatus('paused')} className="rounded-full px-4 py-2 text-xs font-semibold text-neutral-300 ring-1 ring-neutral-700">
                    Pausar
                  </button>
                </>
              ) : (
                <button onClick={() => setStatus('active', true)} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black">
                  Reactivar
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
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Ofertas recibidas (solo dueño) */}
        {isOwner && <OwnerOffers listingId={listing.id} currency={listing.currency} />}
      </div>

      {/* Barra de acciones del comprador */}
      {!isOwner && listing.status === 'active' && (
        <div className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-lg -translate-x-1/2 gap-3 bg-gradient-to-t from-black via-black/95 to-transparent px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-8">
          <button
            onClick={() => setOfferOpen(true)}
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
              permanente. También se borran sus preguntas, ofertas y chats. Esta acción no se puede
              deshacer.
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
    const { error } = await supabase.from('offers').update({ status }).eq('id', offerId)
    if (error) {
      alert('No pudimos actualizar la oferta. Probá de nuevo.')
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
                {o.buyer?.identity_verified && ' · ✓ verificado'}
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
