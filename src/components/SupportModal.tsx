import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from './Toast'
import Modal from './Modal'

// Temas sugeridos: prellenan el textarea como punto de partida (el usuario
// igual escribe lo que quiera).
const TOPICS = ['Problema con una publicación', 'Mi cuenta', 'Reportar un error', 'Sugerencia', 'Otro']

// "Ayuda y soporte": la consulta del usuario entra a la bandeja de reportes
// del admin (target_type 'support', 00029). Sin target real → target_id es un
// uuid aleatorio (satisface el not-null y el unique, permite varias consultas).
export default function SupportModal({ onClose }: { onClose: () => void }) {
  const { session } = useAuth()
  const toast = useToast()
  const [topic, setTopic] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const text = message.trim()
    if (!session || text.length < 1) return
    setBusy(true)
    const reason = topic ? `[${topic}] ${text}` : text
    const { error } = await supabase.from('reports').insert({
      reporter_id: session.user.id,
      target_type: 'support',
      target_id: crypto.randomUUID(),
      reason: reason.slice(0, 500),
    })
    setBusy(false)
    if (error) {
      toast(error.message)
      return
    }
    onClose()
    toast('Recibimos tu consulta. Te respondemos a la brevedad.')
  }

  return (
    <Modal title="Ayuda y soporte" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-neutral-400">
          Contanos tu duda o problema. Lo recibe el equipo de Dealr y te respondemos a la brevedad.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TOPICS.map((t) => (
            <button
              key={t}
              onClick={() => setTopic((prev) => (prev === t ? '' : t))}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                topic === t ? 'bg-white text-black' : 'text-neutral-300 ring-1 ring-neutral-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <textarea
          rows={4}
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={480}
          placeholder="Escribí tu consulta…"
          className="input-line resize-none text-sm"
        />
        <button
          onClick={submit}
          disabled={busy || message.trim().length < 1}
          className="btn-primary w-full py-3 text-sm disabled:opacity-50"
        >
          {busy ? 'Enviando…' : 'Enviar consulta'}
        </button>
      </div>
    </Modal>
  )
}
