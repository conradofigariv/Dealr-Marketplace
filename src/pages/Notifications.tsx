import { useEffect, type ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useNotifications } from '../hooks/useNotifications'
import { timeAgo } from '../lib/format'
import type { AppNotification, NotificationType } from '../lib/types'

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
  question_answered: (
    <>
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
      <circle cx="12" cy="12" r="10" />
    </>
  ),
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

export default function Notifications() {
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  const { items, markAllRead } = useNotifications()

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { from: '/notificaciones', back: '/' } })
  }, [loading, session, navigate])

  // Al abrir el centro, todo lo visto queda leído.
  useEffect(() => {
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
        <div className="px-8 py-24 text-center text-sm text-neutral-500">
          No tenés notificaciones todavía.
        </div>
      ) : (
        <ul>
          {grouped.map((n) => {
            const isUnread = n.hasUnread
            const content = (
              <div className={`flex items-start gap-3.5 px-5 py-3.5 ${isUnread ? 'bg-neutral-900/40' : ''}`}>
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white ring-1 ring-neutral-800">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {icons[n.type]}
                  </svg>
                </span>
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
