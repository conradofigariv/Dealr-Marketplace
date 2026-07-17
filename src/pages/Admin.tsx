import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/Toast'
import { timeAgo } from '../lib/format'
import EmptyState from '../components/EmptyState'
import type { Report, ReportTargetType } from '../lib/types'

const typeLabel: Record<ReportTargetType, string> = {
  listing: 'Publicación',
  user: 'Usuario',
  message: 'Mensaje',
  review: 'Opinión',
  suggestion: 'Idea',
  question: 'Pregunta',
  support: 'Soporte',
}

// Tabla a la que pertenece cada tipo (para borrar el contenido). Los usuarios
// no se borran desde acá (cascada peligrosa): se moderan a mano.
const tableByType: Partial<Record<ReportTargetType, string>> = {
  listing: 'listings',
  message: 'messages',
  review: 'app_reviews',
  suggestion: 'feature_suggestions',
  question: 'questions',
}

// Agregados del RPC admin_metrics (00044).
interface Metrics {
  visitors_today: number
  visitors_7d: number
  visitors_total: number
  users_today: number
  users_7d: number
  users_total: number
  viewers_7d: number
  viewers_total: number
  buyers_7d: number
  buyers_total: number
  sellers_7d: number
  sellers_total: number
  listings_active: number
  listings_total: number
}

// Disputa de no-retiro de subasta (RPC admin_auction_disputes, 00046).
interface Dispute {
  listing_id: string
  title: string
  created_at: string
  buyer_id: string
  buyer_username: string
  buyer_avatar: string | null
  buyer_strikes: number
  buyer_banned_until: string | null
  buyer_confirmed: boolean
  seller_id: string
  seller_username: string
  conversation_id: string | null
}

// Porcentaje de conversión entre dos etapas del funnel ("—" sin base).
function pct(part: number, base: number): string {
  if (!base) return '—'
  return `${Math.round((part / base) * 100)}%`
}

function MetricsPanel({ m }: { m: Metrics }) {
  // Funnel de los últimos 7 días: cada etapa con su barra relativa a visitas.
  const funnel = [
    { label: 'Visitaron la app', value: m.visitors_7d },
    { label: 'Se registraron', value: m.users_7d },
    { label: 'Vieron un producto', value: m.viewers_7d },
    { label: 'Iniciaron un chat', value: m.buyers_7d },
    { label: 'Publicaron algo', value: m.sellers_7d },
  ]
  const base = funnel[0].value
  return (
    <div className="space-y-3 px-5 pb-4">
      {/* Tarjetas: hoy / 7 días / total */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { title: 'Visitas hoy', value: m.visitors_today, sub: `${m.visitors_7d} en 7d` },
          { title: 'Usuarios nuevos hoy', value: m.users_today, sub: `${m.users_7d} en 7d` },
          { title: 'Usuarios totales', value: m.users_total, sub: `${m.visitors_total} visitantes` },
        ].map((c) => (
          <div key={c.title} className="surface p-3">
            <p className="text-[11px] leading-tight text-neutral-500">{c.title}</p>
            <p className="mt-1 text-2xl font-bold text-white">{c.value}</p>
            <p className="text-[11px] text-neutral-600">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Funnel 7 días */}
      <div className="surface p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-white">Funnel · últimos 7 días</h2>
          <span className="text-[11px] text-neutral-500">% sobre visitas</span>
        </div>
        <div className="space-y-2.5">
          {funnel.map((f) => (
            <div key={f.label}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="text-neutral-300">{f.label}</span>
                <span className="font-semibold text-white">
                  {f.value} <span className="ml-1 font-normal text-neutral-500">{pct(f.value, base)}</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: base ? `${Math.max(2, (f.value / base) * 100)}%` : '0%' }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
          Conversión visita→registro (7d): <strong className="text-neutral-300">{pct(m.users_7d, m.visitors_7d)}</strong> ·
          registro→publicó (total): <strong className="text-neutral-300">{pct(m.sellers_total, m.users_total)}</strong> ·
          publicaciones activas: <strong className="text-neutral-300">{m.listings_active}</strong> de {m.listings_total}
        </p>
      </div>
    </div>
  )
}

export default function Admin() {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const { profile, loading } = useAuth()
  const toast = useToast()
  const [reports, setReports] = useState<Report[]>([])
  const [fetched, setFetched] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [metricsError, setMetricsError] = useState('')
  // Disputas de no-retiro de subasta (RPC 00046).
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [banningId, setBanningId] = useState<string | null>(null) // listing con el picker de meses abierto
  const [disputeBusy, setDisputeBusy] = useState(false)
  // Concierge: crear vendedor + publicar en su nombre.
  // Abre la sección concierge de una si se llegó desde el acceso directo del
  // perfil ("Crear vendedor y publicar").
  const [conciergeOpen, setConciergeOpen] = useState(
    () => (routerLocation.state as { openConcierge?: boolean } | null)?.openConcierge === true,
  )
  const [sellerEmail, setSellerEmail] = useState('')
  const [sellerName, setSellerName] = useState('')
  const [creatingSeller, setCreatingSeller] = useState(false)

  // Gate: solo admins.
  useEffect(() => {
    if (!loading && !profile?.is_admin) navigate('/', { replace: true })
  }, [loading, profile, navigate])

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('reports')
      .select('*, reporter:profiles!reports_reporter_id_fkey(id, username, avatar_url)')
      .order('resolved', { ascending: true })
      .order('created_at', { ascending: false })
    if (error) toast(error.message)
    setReports((data as Report[]) ?? [])
    setFetched(true)
  }, [toast])

  useEffect(() => {
    if (profile?.is_admin) load()
  }, [profile, load])

  // Métricas del funnel (RPC 00044). Si la migración no está aplicada, se
  // muestra el aviso en vez de romper el panel.
  useEffect(() => {
    if (!profile?.is_admin) return
    supabase.rpc('admin_metrics').then(({ data, error }) => {
      if (error) {
        setMetricsError(
          /function|schema cache/i.test(error.message)
            ? 'Métricas no disponibles: falta aplicar la migración 00044 en Supabase.'
            : error.message,
        )
        return
      }
      setMetrics(data as Metrics)
    })
  }, [profile])

  // Disputas de subasta (RPC 00046). Si la migración no está aplicada, queda
  // vacío y la sección no aparece (degradación silenciosa).
  const loadDisputes = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_auction_disputes')
    if (!error && data) setDisputes(data as Dispute[])
  }, [])

  useEffect(() => {
    if (profile?.is_admin) loadDisputes()
  }, [profile, loadDisputes])

  async function banAuction(d: Dispute, months: number) {
    setDisputeBusy(true)
    const { data, error } = await supabase.rpc('admin_ban_auction', { p_listing: d.listing_id, p_months: months })
    setDisputeBusy(false)
    setBanningId(null)
    if (error || data) return toast(error ? error.message : (data as string))
    toast(`${d.buyer_username} suspendido ${months} ${months === 1 ? 'mes' : 'meses'}`)
    setDisputes((prev) => prev.filter((x) => x.listing_id !== d.listing_id))
  }

  // Crea (o reusa) la cuenta del vendedor por email y abre Publicar en su
  // nombre. La cuenta es reclamable: el vendedor entra con magic link a ese
  // email y encuentra su publicación y mensajes.
  async function createSellerAndPublish(e: React.FormEvent) {
    e.preventDefault()
    setCreatingSeller(true)
    const { data, error } = await supabase.functions.invoke('admin-create-seller', {
      body: { email: sellerEmail.trim(), name: sellerName.trim() },
    })
    setCreatingSeller(false)
    if (error) {
      // invoke pone los 4xx/5xx en `error`; el body con el mensaje viene en
      // error.context (una Response). Lo leemos para mostrar el motivo real.
      let msg = 'No se pudo crear el vendedor'
      try {
        const body = await (error as { context?: Response }).context?.json()
        if (body?.error) msg = body.error
      } catch { /* sin cuerpo legible */ }
      return toast(msg)
    }
    if (data?.error) return toast(data.error)
    toast(data.reused ? 'Vendedor existente — publicando en su cuenta' : `Cuenta creada para ${data.username}`)
    navigate('/publicar', { state: { onBehalf: { id: data.user_id, name: data.username } } })
  }

  async function dismissDispute(d: Dispute) {
    setDisputeBusy(true)
    const { data, error } = await supabase.rpc('admin_dismiss_dispute', { p_listing: d.listing_id })
    setDisputeBusy(false)
    if (error || data) return toast(error ? error.message : (data as string))
    toast('Disputa descartada')
    setDisputes((prev) => prev.filter((x) => x.listing_id !== d.listing_id))
  }

  async function view(r: Report) {
    // Soporte: no hay contenido que ver, vamos al perfil de quien escribió.
    if (r.target_type === 'support') {
      if (r.reporter?.username) navigate(`/u/${r.reporter.username}`)
      else toast('El usuario ya no existe')
      return
    }
    if (r.target_type === 'listing') return navigate(`/p/${r.target_id}`)
    if (r.target_type === 'suggestion' || r.target_type === 'review') return navigate('/opiniones')
    if (r.target_type === 'user') {
      const { data } = await supabase.from('profiles').select('username').eq('id', r.target_id).maybeSingle()
      if (data) navigate(`/u/${data.username}`)
      else toast('El usuario ya no existe')
      return
    }
    if (r.target_type === 'message') {
      const { data } = await supabase.from('messages').select('conversation_id').eq('id', r.target_id).maybeSingle()
      if (data) navigate(`/chats/${data.conversation_id}`)
      else toast('El mensaje ya no existe')
      return
    }
    if (r.target_type === 'question') {
      const { data } = await supabase.from('questions').select('listing_id').eq('id', r.target_id).maybeSingle()
      if (data) navigate(`/p/${data.listing_id}`)
      else toast('La pregunta ya no existe')
    }
  }

  async function deleteContent(r: Report) {
    const table = tableByType[r.target_type]
    if (!table) return
    if (!confirm(`¿Borrar este contenido (${typeLabel[r.target_type]})? No se puede deshacer.`)) return
    const { error } = await supabase.from(table).delete().eq('id', r.target_id)
    if (error) return toast(error.message)
    await supabase.from('reports').update({ resolved: true }).eq('id', r.id)
    setReports((prev) => prev.map((x) => (x.id === r.id ? { ...x, resolved: true } : x)))
    toast('Contenido borrado')
  }

  async function resolve(r: Report) {
    setReports((prev) => prev.map((x) => (x.id === r.id ? { ...x, resolved: !x.resolved } : x)))
    const { error } = await supabase.from('reports').update({ resolved: !r.resolved }).eq('id', r.id)
    if (error) {
      toast(error.message)
      load()
    }
  }

  const visible = reports.filter((r) => showResolved || !r.resolved)
  const pending = reports.filter((r) => !r.resolved).length

  return (
    <div className="pb-28">
      <header className="flex items-center gap-3 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <button onClick={() => navigate(-1)} aria-label="Volver" className="p-2 text-white">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18 9 12l6-6" />
          </svg>
        </button>
        <h1 className="text-xl font-bold tracking-tight text-white">
          Panel de admin {pending > 0 && <span className="text-red-400">({pending})</span>}
        </h1>
      </header>

      {/* Concierge: crear vendedor + publicar en su nombre */}
      <div className="mb-4 px-5">
        {conciergeOpen ? (
          <form onSubmit={createSellerAndPublish} className="surface space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Publicar en nombre de un vendedor</h2>
              <button type="button" onClick={() => setConciergeOpen(false)} className="text-xs text-neutral-500">
                Cerrar
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              Se crea una cuenta real con el email del vendedor (reclamable con magic link). La publicación queda a su nombre, no al tuyo.
            </p>
            <input
              type="text"
              required
              value={sellerName}
              onChange={(e) => setSellerName(e.target.value)}
              placeholder="Nombre del vendedor"
              className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white outline-none ring-1 ring-neutral-800 focus:ring-neutral-600"
            />
            <input
              type="email"
              required
              value={sellerEmail}
              onChange={(e) => setSellerEmail(e.target.value)}
              placeholder="Email del vendedor"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white outline-none ring-1 ring-neutral-800 focus:ring-neutral-600"
            />
            <button
              disabled={creatingSeller}
              className="w-full rounded-full bg-amber-500 py-3 text-sm font-bold text-black disabled:opacity-50"
            >
              {creatingSeller ? 'Creando…' : 'Crear cuenta y publicar →'}
            </button>
          </form>
        ) : (
          <button
            onClick={() => setConciergeOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-amber-500/15 py-3 text-sm font-bold text-amber-400 ring-1 ring-amber-500/30"
          >
            + Publicar en nombre de un vendedor
          </button>
        )}
      </div>

      {/* Métricas + funnel de adquisición */}
      {metrics && <MetricsPanel m={metrics} />}
      {metricsError && <p className="px-5 pb-3 text-xs text-amber-400">{metricsError}</p>}

      {/* Disputas de subasta (no-retiro). Solo aparece si hay casos. */}
      {disputes.length > 0 && (
        <div className="mb-4 px-5">
          <h2 className="pb-2 text-sm font-semibold text-white">
            Disputas de subasta <span className="text-red-400">({disputes.length})</span>
          </h2>
          <ul className="space-y-2">
            {disputes.map((d) => {
              const banned = d.buyer_banned_until && new Date(d.buyer_banned_until) > new Date()
              return (
                <li key={d.listing_id} className="surface p-4">
                  <button onClick={() => navigate(`/p/${d.listing_id}`)} className="block text-left text-sm font-semibold text-white">
                    {d.title}
                  </button>
                  <p className="mt-1 text-xs text-neutral-400">
                    Ganador:{' '}
                    <button onClick={() => navigate(`/u/${d.buyer_username}`)} className="font-semibold text-white underline-offset-2 hover:underline">
                      {d.buyer_username}
                    </button>
                    {d.buyer_strikes > 0 && <span className="ml-1 text-red-400">· {d.buyer_strikes} strike{d.buyer_strikes > 1 ? 's' : ''}</span>}
                    {banned && <span className="ml-1 text-amber-400">· ya suspendido</span>}
                    <span className="text-neutral-600"> · vendedor {d.seller_username}</span>
                  </p>
                  {/* Señal clave: si el comprador YA había confirmado el retiro,
                      el reporte del vendedor es sospechoso → no banear a ciegas. */}
                  {d.buyer_confirmed && (
                    <p className="mt-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 ring-1 ring-amber-500/20">
                      ⚠ El comprador confirmó que retiró. Revisá el chat antes de suspender.
                    </p>
                  )}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {d.conversation_id && (
                      <button
                        onClick={() => navigate(`/chats/${d.conversation_id}`)}
                        className="rounded-full px-3 py-1 text-[11px] font-semibold text-neutral-300 ring-1 ring-neutral-700"
                      >
                        Ver chat
                      </button>
                    )}
                    {banningId === d.listing_id ? (
                      <>
                        <span className="text-[11px] text-neutral-500">Suspender:</span>
                        {[1, 3, 6, 12].map((m) => (
                          <button
                            key={m}
                            onClick={() => banAuction(d, m)}
                            disabled={disputeBusy}
                            className="rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-bold text-red-400 ring-1 ring-red-500/30 disabled:opacity-50"
                          >
                            {m}m
                          </button>
                        ))}
                        <button onClick={() => setBanningId(null)} className="text-[11px] text-neutral-500">
                          cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setBanningId(d.listing_id)}
                          className="rounded-full px-3 py-1 text-[11px] font-semibold text-red-400/90 ring-1 ring-red-500/30"
                        >
                          Suspender al ganador
                        </button>
                        <button
                          onClick={() => dismissDispute(d)}
                          disabled={disputeBusy}
                          className="rounded-full px-3 py-1 text-[11px] font-semibold text-neutral-400 ring-1 ring-neutral-700 disabled:opacity-50"
                        >
                          Descartar
                        </button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <h2 className="px-5 pb-1 text-sm font-semibold text-white">Reportes</h2>
      <div className="mb-2 px-5">
        <button
          onClick={() => setShowResolved((v) => !v)}
          className="text-xs font-medium text-neutral-400 underline-offset-2 hover:underline"
        >
          {showResolved ? 'Ocultar resueltos' : 'Ver resueltos también'}
        </button>
      </div>

      {fetched && visible.length === 0 ? (
        <EmptyState
          icon={<><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="10" /></>}
          title="No hay reportes pendientes. Todo en orden."
        />
      ) : (
        <ul className="space-y-2 px-5">
          {visible.map((r) => (
            <li key={r.id} className={`surface p-4 ${r.resolved ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-300">
                  {typeLabel[r.target_type]}
                </span>
                <span className="text-xs text-neutral-600">{timeAgo(r.created_at)}</span>
                {r.resolved && <span className="text-[10px] font-semibold text-emerald-400">RESUELTO</span>}
              </div>
              <p className="mt-2 text-sm text-white">{r.reason}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {r.target_type === 'support' ? 'Enviado por' : 'Reportado por'} {r.reporter?.username ?? 'usuario'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => view(r)} className="rounded-full px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-neutral-700">
                  Ver
                </button>
                {tableByType[r.target_type] && (
                  <button onClick={() => deleteContent(r)} className="rounded-full bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-400">
                    Borrar contenido
                  </button>
                )}
                <button onClick={() => resolve(r)} className="rounded-full px-3 py-1.5 text-xs font-semibold text-neutral-300 ring-1 ring-neutral-700">
                  {r.resolved ? 'Reabrir' : 'Listo'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
