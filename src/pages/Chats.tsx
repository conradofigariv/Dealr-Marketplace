import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { timeAgo } from '../lib/format'
import type { Conversation } from '../lib/types'
import EmptyState from '../components/EmptyState'

interface ConvMeta {
  body: string
  senderId: string
  unread: number
}

interface PreviewRow {
  conversation_id: string
  last_body: string | null
  last_image: boolean
  last_sender: string | null
  last_at: string | null
  unread: number
}

export default function Chats() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [meta, setMeta] = useState<Record<string, ConvMeta>>({})
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { from: location.pathname, back: '/' } })
  }, [loading, session, location.pathname, navigate])

  useEffect(() => {
    if (!session) return
    supabase
      .from('conversations')
      .select('*, listing:listings(title, photos, status), buyer:profiles!conversations_buyer_id_fkey(username), seller:profiles!conversations_seller_id_fkey(username)')
      .order('last_message_at', { ascending: false })
      .then(async ({ data }) => {
        const convs = (data as Conversation[]) ?? []
        setConversations(convs)
        setFetched(true)
        if (convs.length === 0) return
        // Último mensaje + no leídos por conversación en un solo RPC (en vez de
        // traer todos los mensajes y agruparlos en el cliente).
        const { data: previews } = await supabase.rpc('conversation_previews')
        const next: Record<string, ConvMeta> = {}
        for (const p of (previews ?? []) as PreviewRow[]) {
          if (!p.last_sender) continue // conversación sin mensajes todavía
          next[p.conversation_id] = {
            body: p.last_body ?? (p.last_image ? '📷 Foto' : ''),
            senderId: p.last_sender,
            unread: p.unread,
          }
        }
        setMeta(next)
      })
  }, [session])

  return (
    <div className="pb-28">
      <header className="px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold tracking-tight text-white">Chats</h1>
      </header>

      {fetched && conversations.length === 0 ? (
        <EmptyState
          icon={<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1Z" />}
          title="Todavía no tenés conversaciones."
        >
          <Link to="/" className="font-semibold text-white">Explorar productos</Link>
        </EmptyState>
      ) : (
        <ul>
          {conversations.map((conv) => {
            const other = conv.buyer_id === session?.user.id ? conv.seller : conv.buyer
            const photo = conv.listing?.photos?.[0]
            const m = meta[conv.id]
            const unread = m?.unread ?? 0
            const preview = m
              ? `${m.senderId === session?.user.id ? 'Vos: ' : ''}${m.body}`
              : `con ${other?.username}`
            return (
              <li key={conv.id}>
                <Link to={`/chats/${conv.id}`} className="flex items-center gap-4 px-5 py-3.5 transition active:bg-neutral-900">
                  <div className="h-[3.25rem] w-[3.25rem] shrink-0 overflow-hidden rounded-xl bg-neutral-900">
                    {photo && <img src={photoUrl(photo)} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${unread > 0 ? 'font-bold text-white' : 'font-semibold text-white'}`}>
                      {conv.listing?.title}
                    </p>
                    <p className={`truncate text-xs ${unread > 0 ? 'text-neutral-300' : 'text-neutral-500'}`}>
                      {preview}
                      {conv.listing?.status === 'sold' && ' · vendido'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-neutral-600">{timeAgo(conv.last_message_at)}</span>
                    {unread > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
