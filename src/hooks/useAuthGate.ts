import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'

// Guardia de pantallas que requieren cuenta, tolerante a cómo iOS restaura
// la PWA. El problema que resuelve: al reabrir la app en una pantalla
// protegida (iOS resume donde quedaste), la sesión puede tardar en
// confirmarse o haberse perdido la renovación del token al despertar — el
// guard viejo te expulsaba AL LOGIN en ese instante, y parecía aleatorio
// ("a veces abre en login, a veces en Home").
//
// - App recién abierta (<5s): la falta de sesión puede ser transitoria.
//   Espera 2s de gracia (si la sesión aparece, no pasa nada) y, si sigue sin
//   sesión, va a HOME — nunca muestra el login espontáneamente.
// - App ya corriendo: es una navegación deliberada de alguien sin cuenta →
//   al login YA, con `from` para volver a donde iba después de loguearse.
export function useAuthGate(from: string, back = '/') {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (loading || session) return
    if (performance.now() > 5000) {
      navigate('/auth', { state: { from, back } })
      return
    }
    const t = setTimeout(() => navigate('/', { replace: true }), 2000)
    return () => clearTimeout(t)
  }, [loading, session, navigate, from, back])
}
