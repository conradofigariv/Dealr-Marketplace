import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { timeAgo, isOnline } from '../lib/format'
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
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { from: location.pathname, back: '/' } })
  }, [loading, session, location.pathname, navigate])

  useEffect(() => {
    if (!session) return
    supabase
      .from('conversations')
      .select(
        '*, listing:listings(title, photos, status), buyer:profiles!conversations_buyer_id_fkey(username, avatar_url, last_seen_at), seller:profiles!conversations_seller_id_fkey(username, avatar_url, last_seen_at)',
      )
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

  const filtered = query.trim()
    ? conversations.filter((conv) => {
        const other = conv.buyer_id === session?.user.id ? conv.seller : conv.buyer
        const q = query.trim().toLowerCase()
        return conv.listing?.title?.toLowerCase().includes(q) || other?.username.toLowerCase().includes(q)
      })
    : conversations

  return (
    <div className="pb-28">
      <header className="px-5 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-3">
          {searchOpen ? (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar chats…"
              className="w-full rounded-full bg-neutral-900 px-4 py-2 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-800"
            />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight text-white">Chats</h1>
          )}
          <button
            onClick={() => {
              setSearchOpen((s) => !s)
              setQuery('')
            }}
            aria-label={searchOpen ? 'Cerrar búsqueda' : 'Buscar'}
            className="shrink-0 rounded-full p-2 text-neutral-400 transition active:bg-neutral-900 active:text-white"
          >
            {searchOpen ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            )}
          </button>
        </div>
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
          {filtered.map((conv) => {
            const other = conv.buyer_id === session?.user.id ? conv.seller : conv.buyer
            const photo = conv.listing?.photos?.[0]
            const m = meta[conv.id]
            const unread = m?.unread ?? 0
            const online = isOnline(other?.last_seen_at ?? null)
            const preview = m
              ? `${m.senderId === session?.user.id ? 'Vos' : other?.username}: ${m.body}`
              : `con ${other?.username}`
            return (
              <li key={conv.id}>
                <Link to={`/chats/${conv.id}`} className="flex items-center gap-3.5 px-5 py-4 transition active:bg-neutral-900">
                  <div className="relative h-14 w-14 shrink-0">
                    <div className="h-full w-full overflow-hidden rounded-full bg-neutral-900 ring-1 ring-neutral-800">
                      {photo && <img src={photoUrl(photo)} alt="" className="h-full w-full object-cover" />}
                    </div>
                    {online && (
                      <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-black" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="min-w-0 flex-1 truncate text-[15px] text-white">
                        <span className={unread > 0 ? 'font-bold' : 'font-semibold'}>{other?.username}</span>
                        {conv.listing?.title && (
                          <span className="font-normal text-neutral-400"> · {conv.listing.title}</span>
                        )}
                      </p>
                      <span className="shrink-0 text-xs text-neutral-500">{timeAgo(conv.last_message_at)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <p className={`min-w-0 flex-1 truncate text-sm ${unread > 0 ? 'text-neutral-200' : 'text-neutral-500'}`}>
                        {preview}
                        {conv.listing?.status === 'sold' && ' · vendido'}
                      </p>
                      {unread > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                          {unread > 9 ? '9+' : unread}
                        </span>
                      )}
                    </div>
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
