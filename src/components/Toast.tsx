import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

// Toast simple: reemplaza los alert() del navegador. useToast() devuelve una
// función para mostrar un mensaje que se desvanece solo.
const ToastContext = createContext<(message: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  const show = useCallback((msg: string) => {
    setMessage(msg)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), 3200)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6rem)] z-[70] flex justify-center px-6">
          <div className="sheet-in max-w-sm rounded-full bg-neutral-800 px-5 py-3 text-center text-sm font-medium text-white shadow-lg ring-1 ring-white/10">
            {message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
