import { useEffect, type ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useNotifications } from '../hooks/useNotifications'
import { timeAgo } from '../lib/format'
import type { NotificationType } from '../lib/types'

const icons: Record<NotificationType, ReactElement> = {
  message: <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1Z" />,
  offer: (
    <>
      <path d="M12 2v20" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  offer_accepted: <path d="M20 6 9 17l-5-5" />,
  question_answered: (
    <>
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
      <circle cx="12" cy="12" r="10" />
    </>
  ),
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

  return (
    <div className="pb-28">
      <header className="px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold tracking-tight text-white">Notificaciones</h1>
      </header>

      {items.length === 0 ? (
        <div className="px-8 py-24 text-center text-sm text-neutral-500">
          No tenés notificaciones todavía.
        </div>
      ) : (
        <ul>
          {items.map((n) => {
            const content = (
              <div className={`flex items-start gap-3.5 px-5 py-3.5 ${!n.read_at ? 'bg-neutral-900/40' : ''}`}>
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white ring-1 ring-neutral-800">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {icons[n.type]}
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{n.title}</p>
                  {n.body && <p className="truncate text-xs text-neutral-400">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-neutral-600">{timeAgo(n.created_at)}</p>
                </div>
                {!n.read_at && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-red-500" />}
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
