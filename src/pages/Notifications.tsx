import { useEffect, type ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useNotifications } from '../hooks/useNotifications'
import { photoUrl } from '../lib/supabase'
import { timeAgo } from '../lib/format'
import type { AppNotification, NotificationType } from '../lib/types'
import EmptyState from '../components/EmptyState'

const icons: Record<NotificationType, ReactElement> = {
  message: <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1Z" />,
  offer: (
    <>
      <path d="M12 2v20" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  offer_accepted: <path d="M20 6 9 17l-5-5" />,
  sale_confirmed: <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8L12 2z" />,
  price_drop: (
    <>
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </>
  ),
  saved_search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  bid: (
    <>
      <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
      <circle cx="7" cy="7" r="1.2" />
    </>
  ),
  outbid: (
    <>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </>
  ),
  auction_won: (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M5 6H3a2 2 0 0 0 2 3M19 6h2a2 2 0 0 1-2 3" />
    </>
  ),
  question_answered: (
    <>
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
      <circle cx="12" cy="12" r="10" />
    </>
  ),
  question: (
    <>
      <path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z" />
      <path d="M9.8 9.2a2.5 2.5 0 0 1 4.85.8c0 1.7-2.35 2.2-2.35 2.2" />
      <path d="M12.3 15h.01" />
    </>
  ),
  report: (
    <>
      <path d="M4 22V4a1 1 0 0 1 1-1h13l-2.5 4L18 11H5" />
    </>
  ),
}

// Color por tipo: `badge` = fondo sólido del badge chico (con ícono blanco),
// `soft` = círculo tenue cuando no hay avatar (sistema / anónimas).
const typeStyles: Record<NotificationType, { badge: string; soft: string }> = {
  message: { badge: 'bg-blue-500', soft: 'bg-blue-500/15 text-blue-400' },
  offer: { badge: 'bg-emerald-500', soft: 'bg-emerald-500/15 text-emerald-400' },
  offer_accepted: { badge: 'bg-emerald-500', soft: 'bg-emerald-500/15 text-emerald-400' },
  sale_confirmed: { badge: 'bg-amber-500', soft: 'bg-amber-500/15 text-amber-400' },
  question_answered: { badge: 'bg-violet-500', soft: 'bg-violet-500/15 text-violet-400' },
  question: { badge: 'bg-violet-500', soft: 'bg-violet-500/15 text-violet-400' },
  price_drop: { badge: 'bg-rose-500', soft: 'bg-rose-500/15 text-rose-400' },
  saved_search: { badge: 'bg-sky-500', soft: 'bg-sky-500/15 text-sky-400' },
  bid: { badge: 'bg-amber-500', soft: 'bg-amber-500/15 text-amber-400' },
  outbid: { badge: 'bg-orange-500', soft: 'bg-orange-500/15 text-orange-400' },
  auction_won: { badge: 'bg-amber-500', soft: 'bg-amber-500/15 text-amber-400' },
  report: { badge: 'bg-red-500', soft: 'bg-red-500/15 text-red-400' },
}

type GroupedNotification = AppNotification & { count: number; hasUnread: boolean }

function groupNotifications(items: AppNotification[]): GroupedNotification[] {
  return items.reduce<GroupedNotification[]>((acc, n) => {
    if (n.type === 'message' && n.link) {
      const existing = acc.find((item) => item.type === 'message' && item.link === n.link)
      if (existing) {
        existing.count++
        if (!n.read_at) existing.hasUnread = true
        return acc
      }
    }
    acc.push({ ...n, count: 1, hasUnread: !n.read_at })
    return acc
  }, [])
}

// Círculo principal: avatar del que la envía + badge del tipo encima. Si no
// hay actor (subastas anónimas / sistema), el círculo es el ícono del tipo.
function NotificationIcon({ n }: { n: AppNotification }) {
  const style = typeStyles[n.type]
  const badge = (
    <span
      className={`absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-black ${style.badge}`}
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {icons[n.type]}
      </svg>
    </span>
  )

  if (n.actor) {
    return (
      <div className="relative shrink-0">
        <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-neutral-900 text-base font-bold text-white ring-1 ring-neutral-800">
          {n.actor.avatar_url ? (
            <img src={photoUrl(n.actor.avatar_url)} alt={n.actor.username} className="h-full w-full object-cover" />
          ) : (
            n.actor.username.slice(0, 1).toUpperCase()
          )}
        </div>
        {badge}
      </div>
    )
  }

  return (
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${style.soft}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {icons[n.type]}
      </svg>
    </span>
  )
}

export default function Notifications() {
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  const { items, markAllRead, refresh } = useNotifications()

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { from: '/notificaciones', back: '/' } })
  }, [loading, session, navigate])

  // Al abrir el centro: refrescamos (para traer el avatar del actor de las que
  // llegaron por Realtime) y marcamos todo como leído.
  useEffect(() => {
    refresh()
    markAllRead()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grouped = groupNotifications(items)

  return (
    <div className="pb-28">
      <header className="px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold tracking-tight text-white">Notificaciones</h1>
      </header>

      {grouped.length === 0 ? (
        <EmptyState
          icon={<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>}
          title="No tenés notificaciones todavía."
        />
      ) : (
        <ul>
          {grouped.map((n) => {
            const isUnread = n.hasUnread
            const content = (
              <div className={`flex items-start gap-3.5 px-5 py-3.5 ${isUnread ? 'bg-neutral-900/40' : ''}`}>
                <div className="mt-0.5">
                  <NotificationIcon n={n} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{n.title}</p>
                  {n.count > 1 ? (
                    <p className="text-xs text-neutral-400">
                      {n.count} mensajes{n.body ? ` · ${n.body}` : ''}
                    </p>
                  ) : (
                    n.body && <p className="truncate text-xs text-neutral-400">{n.body}</p>
                  )}
                  <p className="mt-0.5 text-xs text-neutral-600">{timeAgo(n.created_at)}</p>
                </div>
                {isUnread && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-red-500" />}
              </div>
            )
            return (
              <li key={n.id} className="transition active:bg-neutral-900">
                {n.link ? <Link to={n.link}>{content}</Link> : content}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
