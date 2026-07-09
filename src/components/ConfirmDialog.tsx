import Modal from './Modal'

// Confirmación consistente con el design system (reemplaza los confirm() del
// navegador, que rompían la estética y no se podían estilar).
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal title={title} onClose={() => !busy && onClose()}>
      <div className="space-y-5">
        <p className="text-sm text-neutral-400">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-full py-3 text-sm font-semibold text-neutral-300 ring-1 ring-neutral-700 transition active:bg-neutral-900 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 rounded-full py-3 text-sm font-semibold transition disabled:opacity-50 ${
              destructive ? 'bg-red-500 text-white' : 'bg-white text-black'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
