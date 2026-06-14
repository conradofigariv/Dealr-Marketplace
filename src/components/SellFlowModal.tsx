import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { capture } from '../lib/analytics'
import type { Profile } from '../lib/types'
import Modal from './Modal'
import Avatar from './Avatar'
import RatingForm from './RatingForm'
import { invalidateFeedCache } from '../pages/Home'

interface BuyerConv {
  id: string // conversation id
  buyer: Profile
}

// Flujo de cierre de venta: el vendedor elige al comprador (de sus chats),
// se marca la venta y se le ofrece calificarlo en el acto. El comprador
// recibe una notificación para calificar (trigger en la DB).
export default function SellFlowModal({
  listingId,
  sellerId,
  onClose,
  onSold,
}: {
  listingId: string
  sellerId: string
  onClose: () => void
  onSold: () => void
}) {
  const [convs, setConvs] = useState<BuyerConv[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  // null = elegir; objeto = ya se vendió a ese comprador y toca calificarlo
  const [rating, setRating] = useState<BuyerConv | null>(null)

  useEffect(() => {
    supabase
      .from('conversations')
      .select('id, buyer:profiles!conversations_buyer_id_fkey(*)')
      .eq('listing_id', listingId)
      .order('last_message_at', { ascending: false })
      .then(({ data }) => {
        setConvs(((data ?? []) as unknown as BuyerConv[]).filter((c) => c.buyer))
        setLoaded(true)
      })
  }, [listingId])

  async function markSold(soldTo: string | null): Promise<boolean> {
    setBusy(true)
    const { error } = await supabase
      .from('listings')
      .update({ status: 'sold', sold_to: soldTo })
      .eq('id', listingId)
    setBusy(false)
    if (error) return false
    invalidateFeedCache()
    capture('listing_sold', { listing_id: listingId, in_app_buyer: Boolean(soldTo) })
    onSold()
    return true
  }

  async function sellTo(conv: BuyerConv) {
    if (await markSold(conv.buyer.id)) setRating(conv) // pasa al paso de calificación
  }

  if (rating) {
    return (
      <Modal title={`Calificá a ${rating.buyer.username}`} onClose={onClose}>
        <RatingForm
          conversationId={rating.id}
          raterId={sellerId}
          ratedId={rating.buyer.id}
          ratedName={rating.buyer.username}
          role="rated_as_buyer"
        />
      </Modal>
    )
  }

  return (
    <Modal title="Marcar como vendido" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-neutral-400">¿A quién se lo vendiste?</p>

        {!loaded ? (
          <p className="py-4 text-center text-sm text-neutral-600">Cargando…</p>
        ) : (
          <div className="space-y-2">
            {convs.map((conv) => (
              <button
                key={conv.id}
                disabled={busy}
                onClick={() => sellTo(conv)}
                className="flex w-full items-center gap-3 rounded-2xl bg-neutral-900 px-4 py-3 text-left ring-1 ring-neutral-800 transition active:bg-neutral-800 disabled:opacity-50"
              >
                <Avatar profile={conv.buyer} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                  {conv.buyer.username}
                </span>
                <span className="shrink-0 text-xs text-neutral-500">Calificar →</span>
              </button>
            ))}
            {convs.length === 0 && (
              <p className="rounded-xl bg-neutral-900 px-4 py-3 text-xs text-neutral-500 ring-1 ring-neutral-800">
                Nadie te escribió por esta publicación. Si la vendiste por fuera de Dealr, usá la opción de abajo.
              </p>
            )}
          </div>
        )}

        <button
          disabled={busy}
          onClick={async () => {
            if (await markSold(null)) onClose()
          }}
          className="w-full rounded-2xl px-4 py-3 text-sm font-medium text-neutral-300 ring-1 ring-neutral-700 transition active:bg-neutral-900 disabled:opacity-50"
        >
          La vendí por fuera de Dealr
        </button>
      </div>
    </Modal>
  )
}
