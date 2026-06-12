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
    <div className="pb-20">
      <header className="bg-brand-700 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="text-xl font-extrabold text-white">Chats</h1>
      </header>

      {fetched && conversations.length === 0 ? (
        <div className="px-4 py-16 text-center text-sm text-gray-500">
          <p className="mb-1 text-3xl">💬</p>
          Todavía no tenés conversaciones.
          <Link to="/" className="mt-2 block font-semibold text-brand-700">Explorar productos</Link>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {conversations.map((conv) => {
            const other = conv.buyer_id === session?.user.id ? conv.seller : conv.buyer
            const photo = conv.listing?.photos?.[0]
            return (
              <li key={conv.id}>
                <Link to={`/chats/${conv.id}`} className="flex items-center gap-3 bg-white px-4 py-3 active:bg-gray-50">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {photo && <img src={photoUrl(photo)} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{conv.listing?.title}</p>
                    <p className="truncate text-xs text-gray-500">
                      con {other?.username}
                      {conv.listing?.status === 'sold' && ' · vendido'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-400">{timeAgo(conv.last_message_at)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
