import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from './Toast'
import { canUseCotillon, listenCotillon } from '../lib/cotillon'
import { burstConfetti } from '../lib/confetti'
import { playSound, haptic } from '../lib/notify'

// Escucha global del easter egg del cotillón (ver lib/cotillon.ts). Sin UI:
// solo se suscribe cuando el usuario logueado es uno de los habilitados y,
// al recibir, dispara la misma celebración que publicar (confeti + sonido +
// háptico) + un toast. Montado en Shell para recibir en cualquier pantalla.
export default function CotillonListener() {
  const { session } = useAuth()
  const toast = useToast()
  const email = session?.user?.email

  useEffect(() => {
    if (!canUseCotillon(email)) return
    return listenCotillon((fromName) => {
      burstConfetti()
      playSound('win')
      haptic('success')
      toast(`🎉 ${fromName} te mandó cotillón`)
    })
  }, [email, toast])

  return null
}
