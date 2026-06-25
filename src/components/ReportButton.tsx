import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from './Toast'
import Modal from './Modal'
import type { ReportTargetType } from '../lib/types'

// 'support' no se reporta acá (lo maneja SupportModal): este botón es para
// moderar contenido.
type ReportableType = Exclude<ReportTargetType, 'support'>

// Motivos sugeridos por tipo de contenido (el usuario igual puede escribir).
const reasonsByType: Record<ReportableType, string[]> = {
  listing: ['Estafa o engaño', 'Producto prohibido', 'Precio o info falsa', 'Duplicada', 'Otro'],
  user: ['Acoso o insultos', 'Spam', 'Suplantación de identidad', 'Otro'],
  message: ['Acoso o insultos', 'Spam', 'Contenido inapropiado', 'Otro'],
  review: ['Insultos', 'Spam', 'No es una opinión real', 'Otro'],
  suggestion: ['Inapropiada', 'Spam', 'Otro'],
  question: ['Acoso o insultos', 'Spam', 'Contenido inapropiado', 'Otro'],
}

interface Props {
  targetType: ReportableType
  targetId: string
  // Cómo se ve el disparador. 'text' = link chico; 'icon' = botón ícono.
  variant?: 'text' | 'icon'
  className?: string
}

export default function ReportButton({ targetType, targetId, variant = 'text', className }: Props) {
  const navigate = useNavigate()
  const { session } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  function start() {
    if (!session) {
      navigate('/auth', { state: { from: '/', back: '/' } })
      return
    }
    setOpen(true)
  }

  async function submit() {
    const r = reason.trim()
    if (r.length < 1) return
    setBusy(true)
    const { error } = await supabase
      .from('reports')
      .insert({ reporter_id: session!.user.id, target_type: targetType, target_id: targetId, reason: r })
    setBusy(false)
    if (error) {
      // Constraint unique (reporter_id, target_type, target_id): ya lo reportó.
      toast(error.code === '23505' ? 'Ya reportaste esto. Gracias.' : error.message)
      setOpen(false)
      return
    }
    setOpen(false)
    setReason('')
    toast('Gracias. Recibimos tu reporte.')
  }

  return (
    <>
      <button
        onClick={start}
        className={
          className ??
          (variant === 'icon'
            ? 'rounded-full p-2 text-neutral-500 transition hover:text-red-400'
            : 'text-xs font-medium text-neutral-500 underline-offset-2 hover:text-red-400 hover:underline')
        }
        aria-label="Reportar"
      >
        {variant === 'icon' ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 22V4a1 1 0 0 1 1-1h13l-2.5 4L18 11H5" />
          </svg>
        ) : (
          'Reportar'
        )}
      </button>

      {open && (
        <Modal title="Reportar" onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <p className="text-sm text-neutral-400">Contanos qué pasa. Lo revisa el equipo de Dealr.</p>
            <div className="flex flex-wrap gap-1.5">
              {reasonsByType[targetType].map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    reason === r ? 'bg-white text-black' : 'text-neutral-300 ring-1 ring-neutral-700'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Detalle (opcional si elegiste un motivo)"
              className="input-line resize-none text-sm"
            />
            <button
              onClick={submit}
              disabled={busy || reason.trim().length < 1}
              className="btn-primary w-full py-3 text-sm disabled:opacity-50"
            >
              {busy ? 'Enviando…' : 'Enviar reporte'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
