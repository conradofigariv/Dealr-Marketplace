import { supabase } from './supabase'

// Registro anónimo de visita (00044): una clave aleatoria por dispositivo
// (localStorage, sin ningún dato personal) y un ping por día. Alimenta el
// funnel del panel de admin (visitas → registros → ...). Todo best-effort:
// si la migración no está aplicada o falla la red, no pasa nada.
const KEY = 'dealr_visitor'
const DAY_KEY = 'dealr_visit_day'

export function trackVisit() {
  try {
    // Día ARGENTINO (no UTC): alinea el throttle local con el corte de la DB
    // (track_visit data por medianoche argentina, 00050). en-CA da YYYY-MM-DD.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    if (localStorage.getItem(DAY_KEY) === today) return // ya contamos hoy
    let key = localStorage.getItem(KEY)
    if (!key) {
      key = crypto.randomUUID()
      localStorage.setItem(KEY, key)
    }
    void supabase.rpc('track_visit', { p_key: key }).then(({ error }) => {
      if (!error) localStorage.setItem(DAY_KEY, today)
    })
  } catch {
    /* storage bloqueado o sin red: da igual */
  }
}
