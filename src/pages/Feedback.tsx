import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/Toast'
import { capture } from '../lib/analytics'
import { timeAgo } from '../lib/format'
import type { AppReview, FeatureSuggestion, SuggestionStatus } from '../lib/types'

type Tab = 'opiniones' | 'ideas'

const statusLabel: Record<SuggestionStatus, string> = {
  open: 'En revisión',
  planned: 'Planificada',
  in_progress: 'En progreso',
  done: 'Lista',
  declined: 'Descartada',
}

const statusClass: Record<SuggestionStatus, string> = {
  open: 'text-neutral-400 ring-neutral-700',
  planned: 'text-sky-300 ring-sky-800',
  in_progress: 'text-amber-300 ring-amber-800',
  done: 'text-emerald-300 ring-emerald-800',
  declined: 'text-neutral-600 ring-neutral-800',
}

// Fila de 5 estrellas, interactiva si recibe onChange.
function Stars({ value, onChange, size = 'h-5 w-5' }: { value: number; onChange?: (v: number) => void; size?: string }) {
  return (
    <div className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= Math.round(value)
        const star = (
          <svg viewBox="0 0 24 24" className={`${size} ${filled ? 'fill-white' : 'fill-neutral-700'}`}>
            <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8L12 2z" />
          </svg>
        )
        return onChange ? (
          <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} estrellas`} className="p-0.5">
            {star}
          </button>
        ) : (
          <span key={n}>{star}</span>
        )
      })}
    </div>
  )
}

export default function Feedback() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('opiniones')

  const [reviews, setReviews] = useState<AppReview[]>([])
  const [myRating, setMyRating] = useState(0)
  const [myBody, setMyBody] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)

  const [suggestions, setSuggestions] = useState<FeatureSuggestion[]>([])
  const [myVotes, setMyVotes] = useState<Set<string>>(new Set())
  const [ideaTitle, setIdeaTitle] = useState('')
  const [ideaBody, setIdeaBody] = useState('')
  const [ideaBusy, setIdeaBusy] = useState(false)

  function requireLogin() {
    navigate('/auth', { state: { from: '/opiniones', back: '/opiniones' } })
  }

  async function loadReviews() {
    const { data } = await supabase
      .from('app_reviews')
      .select('*, author:profiles(*)')
      .order('updated_at', { ascending: false })
    setReviews(data ?? [])
    const mine = (data ?? []).find((r) => r.user_id === session?.user.id)
    if (mine) {
      setMyRating(mine.rating)
      setMyBody(mine.body ?? '')
    }
  }

  async function loadSuggestions() {
    const { data } = await supabase
      .from('feature_suggestions')
      .select('*, author:profiles(*)')
      .order('vote_count', { ascending: false })
      .order('created_at', { ascending: false })
    setSuggestions(data ?? [])
    if (session) {
      const { data: votes } = await supabase
        .from('feature_votes')
        .select('suggestion_id')
        .eq('user_id', session.user.id)
      setMyVotes(new Set((votes ?? []).map((v) => v.suggestion_id)))
    }
  }

  useEffect(() => {
    loadReviews()
    loadSuggestions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0

  async function submitReview(e: FormEvent) {
    e.preventDefault()
    if (!session) return requireLogin()
    if (myRating < 1) return
    setReviewBusy(true)
    const { error } = await supabase.from('app_reviews').upsert(
      { user_id: session.user.id, rating: myRating, body: myBody.trim() || null, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    setReviewBusy(false)
    if (error) {
      toast(error.message)
      return
    }
    capture('app_review_submitted', { rating: myRating })
    toast('¡Gracias por tu opinión!')
    loadReviews()
  }

  async function submitIdea(e: FormEvent) {
    e.preventDefault()
    if (!session) return requireLogin()
    if (ideaTitle.trim().length < 4) return
    setIdeaBusy(true)
    const { error } = await supabase
      .from('feature_suggestions')
      .insert({ user_id: session.user.id, title: ideaTitle.trim(), body: ideaBody.trim() || null })
    setIdeaBusy(false)
    if (error) {
      toast(error.message)
      return
    }
    capture('suggestion_created')
    setIdeaTitle('')
    setIdeaBody('')
    toast('¡Idea enviada!')
    loadSuggestions()
  }

  async function toggleVote(s: FeatureSuggestion) {
    if (!session) return requireLogin()
    const voted = myVotes.has(s.id)
    // Optimista: actualizamos UI y revertimos si falla.
    setMyVotes((prev) => {
      const next = new Set(prev)
      if (voted) next.delete(s.id)
      else next.add(s.id)
      return next
    })
    setSuggestions((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, vote_count: x.vote_count + (voted ? -1 : 1) } : x)),
    )
    const { error } = voted
      ? await supabase.from('feature_votes').delete().eq('suggestion_id', s.id).eq('user_id', session.user.id)
      : await supabase.from('feature_votes').insert({ suggestion_id: s.id, user_id: session.user.id })
    if (error) {
      toast(error.message)
      loadSuggestions() // revertir al estado real
    } else if (!voted) {
      capture('suggestion_voted', { suggestion_id: s.id })
    }
  }

  return (
    <div className="pb-28">
      <header className="flex items-center gap-3 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <button onClick={() => navigate(-1)} aria-label="Volver" className="p-2 text-white">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18 9 12l6-6" />
          </svg>
        </button>
        <h1 className="text-xl font-bold tracking-tight text-white">Opiniones y mejoras</h1>
      </header>

      <div className="mb-4 flex gap-1 px-5">
        {(['opiniones', 'ideas'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${tab === t ? 'bg-white text-black' : 'text-neutral-400 ring-1 ring-neutral-800'}`}
          >
            {t === 'opiniones' ? 'Opiniones' : 'Ideas y votos'}
          </button>
        ))}
      </div>

      {tab === 'opiniones' ? (
        <div className="space-y-6 px-5">
          {/* Resumen */}
          <div className="surface flex items-center gap-4 p-5">
            <div className="text-center">
              <p className="text-4xl font-bold text-white">{avg ? avg.toFixed(1) : '—'}</p>
              <Stars value={avg} size="h-3.5 w-3.5" />
            </div>
            <p className="text-sm text-neutral-400">
              {reviews.length === 0
                ? 'Todavía no hay opiniones. Sé el primero en dejar la tuya.'
                : `${reviews.length} ${reviews.length === 1 ? 'opinión' : 'opiniones'} de la comunidad.`}
            </p>
          </div>

          {/* Tu opinión */}
          {session ? (
            <form onSubmit={submitReview} className="surface space-y-4 p-5">
              <h2 className="text-sm font-semibold text-white">{myRating ? 'Tu opinión' : 'Dejá tu opinión'}</h2>
              <Stars value={myRating} onChange={setMyRating} />
              <textarea
                rows={3}
                value={myBody}
                onChange={(e) => setMyBody(e.target.value)}
                maxLength={500}
                placeholder="¿Qué te parece Dealr? ¿Qué mejorarías?"
                className="input-line resize-none text-sm"
              />
              <button disabled={reviewBusy || myRating < 1} className="btn-primary py-2.5 text-sm">
                {reviewBusy ? 'Guardando…' : 'Publicar opinión'}
              </button>
            </form>
          ) : (
            <button onClick={requireLogin} className="btn-outline py-3 text-sm">
              Iniciá sesión para opinar
            </button>
          )}

          {/* Lista */}
          <ul className="space-y-4">
            {reviews.map((r) => (
              <li key={r.id} className="surface p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{r.author?.username ?? 'Usuario'}</span>
                  <Stars value={r.rating} size="h-3.5 w-3.5" />
                </div>
                {r.body && <p className="mt-2 text-sm text-neutral-300">{r.body}</p>}
                <p className="mt-2 text-xs text-neutral-600">{timeAgo(r.updated_at)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-6 px-5">
          {/* Proponer idea */}
          {session ? (
            <form onSubmit={submitIdea} className="surface space-y-3 p-5">
              <h2 className="text-sm font-semibold text-white">Proponé una mejora</h2>
              <input
                value={ideaTitle}
                onChange={(e) => setIdeaTitle(e.target.value)}
                maxLength={80}
                placeholder="Tu idea en una línea"
                className="input-line text-sm"
              />
              <textarea
                rows={2}
                value={ideaBody}
                onChange={(e) => setIdeaBody(e.target.value)}
                maxLength={500}
                placeholder="Contá un poco más (opcional)"
                className="input-line resize-none text-sm"
              />
              <button disabled={ideaBusy || ideaTitle.trim().length < 4} className="btn-primary py-2.5 text-sm">
                {ideaBusy ? 'Enviando…' : 'Proponer'}
              </button>
            </form>
          ) : (
            <button onClick={requireLogin} className="btn-outline py-3 text-sm">
              Iniciá sesión para proponer y votar
            </button>
          )}

          {/* Lista de ideas */}
          {suggestions.length === 0 ? (
            <p className="py-2 text-sm text-neutral-600">Todavía no hay ideas. Proponé la primera.</p>
          ) : (
            <ul className="space-y-3">
              {suggestions.map((s) => {
                const voted = myVotes.has(s.id)
                return (
                  <li key={s.id} className="surface flex gap-3 p-4">
                    <button
                      onClick={() => toggleVote(s)}
                      aria-pressed={voted}
                      className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-xl text-sm font-bold transition ${voted ? 'bg-white text-black' : 'text-white ring-1 ring-neutral-700'}`}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m18 15-6-6-6 6" />
                      </svg>
                      {s.vote_count}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-white">{s.title}</p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${statusClass[s.status]}`}>
                          {statusLabel[s.status]}
                        </span>
                      </div>
                      {s.body && <p className="mt-1 text-sm text-neutral-400">{s.body}</p>}
                      <p className="mt-1.5 text-xs text-neutral-600">
                        {s.author?.username ?? 'Usuario'} · {timeAgo(s.created_at)}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
