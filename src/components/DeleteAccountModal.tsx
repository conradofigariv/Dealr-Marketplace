import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import Modal from './Modal'

// Motivos de baja, mismo patrón visual que la encuesta de onboarding
// (signup_surveys): chips + "Otro" con texto libre.
const REASONS = [
  'No encontré lo que buscaba',
  'Uso otra app',
  'Mala experiencia',
  'Me preocupa mi privacidad',
  'Ya no necesito comprar/vender',
  'Otro',
]

const CONFIRM_WORD = 'ELIMINAR'

// Eliminar cuenta = anonimizar (ver 00049 + Edge Function delete-account).
// Dos pasos: elegir motivo, después confirmar escribiendo "ELIMINAR" (fricción
// deliberada — es una acción irreversible). Si el usuario tiene una subasta
// en curso o una entrega pendiente de confirmar, el servidor lo bloquea con
// un mensaje concreto en vez de dejarlo desaparecer a mitad de una operación.
export default function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState<'reason' | 'confirm'>('reason')
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('delete-account', {
      body: { reason, detail: reason === 'Otro' ? detail.trim() : '' },
    })
    setBusy(false)
    if (error) {
      // invoke pone los 4xx/5xx (incluida la validación de obligaciones
      // activas) en `error`; el mensaje real viene en el cuerpo de la Response.
      let msg = 'No se pudo eliminar la cuenta. Probá de nuevo.'
      try {
        const body = await (error as { context?: Response }).context?.json()
        if (body?.error) msg = body.error
      } catch { /* sin cuerpo legible */ }
      onClose()
      toast(msg)
      return
    }
    if (data?.error) {
      onClose()
      toast(data.error)
      return
    }
    await supabase.auth.signOut()
    toast('Tu cuenta fue eliminada. ¡Gracias por haber usado Dealr!')
    navigate('/', { replace: true })
  }

  return (
    <Modal title={step === 'reason' ? 'Eliminar cuenta' : 'Confirmá la eliminación'} onClose={onClose}>
      {step === 'reason' ? (
        <div className="space-y-4">
          <p className="text-sm text-neutral-400">
            Antes de irte, contanos por qué (nos ayuda a mejorar). Tu cuenta queda inaccesible: tus
            chats y calificaciones se conservan para la otra parte, pero tus datos personales se borran.
          </p>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(reason === r ? '' : r)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  reason === r ? 'bg-white text-black' : 'text-neutral-300 ring-1 ring-neutral-700'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {reason === 'Otro' && (
            <input
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Contanos qué pasó"
              maxLength={200}
              className="input-line text-sm"
            />
          )}
          <button
            disabled={!reason}
            onClick={() => setStep('confirm')}
            className="w-full rounded-full bg-red-500/15 py-3 text-sm font-bold text-red-400 ring-1 ring-red-500/30 transition disabled:opacity-40"
          >
            Continuar
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-neutral-400">
            Esto es <strong className="text-white">permanente</strong>: no vas a poder volver a entrar con
            este email ni con Google. Si tenés una subasta en curso o algo pendiente de confirmar, te lo
            vamos a avisar y no se va a poder eliminar todavía.
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-neutral-500">
              Escribí {CONFIRM_WORD} para confirmar
            </label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              className="input-line text-sm"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep('reason')}
              disabled={busy}
              className="flex-1 rounded-full py-3 text-sm font-semibold text-neutral-300 ring-1 ring-neutral-700 disabled:opacity-50"
            >
              Volver
            </button>
            <button
              onClick={submit}
              disabled={busy || confirmText.trim().toUpperCase() !== CONFIRM_WORD}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-red-500 py-3 text-sm font-bold text-white transition disabled:opacity-40"
            >
              {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {busy ? 'Eliminando…' : 'Eliminar mi cuenta'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
