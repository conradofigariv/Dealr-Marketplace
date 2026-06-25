import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

export default function Admin() {
  const navigate = useNavigate()
  const { profile, loading } = useAuth()
  const toast = useToast()
  const [reports, setReports] = useState<Report[]>([])
  const [fetched, setFetched] = useState(false)
  const [showResolved, setShowResolved] = useState(false)

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
          Reportes {pending > 0 && <span className="text-red-400">({pending})</span>}
        </h1>
      </header>

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
