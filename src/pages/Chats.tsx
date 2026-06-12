import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { timeAgo } from '../lib/format'
import type { Conversation } from '../lib/types'

export default function Chats() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    if (!loading && !session) navigate('/auth')
  }, [loading, session, navigate])

  useEffect(() => {
    if (!session) return
    supabase
      .from('conversations')
      .select('*, listing:listings(title, photos, status), buyer:profiles!conversations_buyer_id_fkey(username), seller:profiles!conversations_seller_id_fkey(username)')
      .order('last_message_at', { ascending: false })
      .then(({ data }) => {
        setConversations((data as Conversation[]) ?? [])
        setFetched(true)
      })
  }, [session])

  return (
    <div className="pb-28">
      <header className="px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold tracking-tight text-white">Chats</h1>
      </header>

      {fetched && conversations.length === 0 ? (
        <div className="px-8 py-24 text-center text-sm text-neutral-500">
          Todavía no tenés conversaciones.
          <Link to="/" className="mt-2 block font-semibold text-white">Explorar productos</Link>
        </div>
      ) : (
        <ul>
          {conversations.map((conv) => {
            const other = conv.buyer_id === session?.user.id ? conv.seller : conv.buyer
            const photo = conv.listing?.photos?.[0]
            return (
              <li key={conv.id}>
                <Link to={`/chats/${conv.id}`} className="flex items-center gap-4 px-5 py-3.5 transition active:bg-neutral-900">
                  <div className="h-[3.25rem] w-[3.25rem] shrink-0 overflow-hidden rounded-xl bg-neutral-900">
                    {photo && <img src={photoUrl(photo)} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{conv.listing?.title}</p>
                    <p className="truncate text-xs text-neutral-500">
                      con {other?.username}
                      {conv.listing?.status === 'sold' && ' · vendido'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-neutral-600">{timeAgo(conv.last_message_at)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
