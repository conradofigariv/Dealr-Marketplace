import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { capture } from '../lib/analytics'

type RatingRole = 'rated_as_seller' | 'rated_as_buyer'

// Formulario de calificación ciega reutilizable (chat y cierre de venta).
// Inserta en `ratings`; la calificación se revela cuando ambas partes
// califican, o a los 14 días.
export default function RatingForm({
  conversationId,
  raterId,
  ratedId,
  ratedName,
  role,
  onDone,
}: {
  conversationId: string
  raterId: string
  ratedId: string
  ratedName?: string
  role: RatingRole
  onDone?: () => void
}) {
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (stars === 0) return
    setBusy(true)
    setError('')
    const { error: err } = await supabase.from('ratings').insert({
      conversation_id: conversationId,
      rater_id: raterId,
      rated_id: ratedId,
      role,
      stars,
      comment: comment.trim() || null,
    })
    setBusy(false)
    if (err) {
      setError('No pudimos guardar tu calificación. Probá de nuevo.')
      return
    }
    capture('rating_submitted', { role, stars })
    setSent(true)
    onDone?.()
  }

  if (sent) {
    return (
      <div className="py-6 text-center">
        <p className="font-semibold text-white">¡Gracias por calificar!</p>
        <p className="mt-1 text-sm text-neutral-400">
          {ratedName ? `Tu calificación se publica cuando ${ratedName} también califique, o a los 14 días.` : 'Tu calificación se publica cuando la otra parte también califique, o a los 14 días.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {ratedName && (
        <p className="text-sm text-neutral-400">
          La calificación es ciega: {ratedName} no la ve hasta calificarte también.
        </p>
      )}
      <div className="flex justify-center gap-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setStars(n)} aria-label={`${n} estrellas`}>
            <svg viewBox="0 0 24 24" className={`h-9 w-9 transition ${n <= stars ? 'fill-white' : 'fill-neutral-800'}`}>
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
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button onClick={submit} disabled={stars === 0 || busy} className="btn-primary">
        {busy ? 'Enviando…' : 'Enviar calificación'}
      </button>
    </div>
  )
}

export type { RatingRole }
