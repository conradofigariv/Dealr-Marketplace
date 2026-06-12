import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, photoUrl } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatPrice, timeAgo } from '../lib/format'
import type { Listing } from '../lib/types'
import SellerBadges from '../components/SellerBadges'
import StarRating from '../components/StarRating'
import Modal from '../components/Modal'

const statusLabels: Record<Listing['status'], string> = {
  active: 'Activa',
  paused: 'Pausada',
  sold: 'Vendida',
  expired: 'Vencida',
}

export default function Profile() {
  const navigate = useNavigate()
  const { session, profile, loading, refreshProfile } = useAuth()
  const [listings, setListings] = useState<Listing[]>([])
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameError, setNameError] = useState('')
  const [verifyOpen, setVerifyOpen] = useState(false)

  useEffect(() => {
    if (!loading && !session) navigate('/auth')
  }, [loading, session, navigate])

  async function loadListings() {
    if (!session) return
    const { data } = await supabase
      .from('listings')
      .select('*')
      .eq('seller_id', session.user.id)
      .order('created_at', { ascending: false })
    setListings(data ?? [])
  }

  useEffect(() => {
    loadListings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function saveName() {
    setNameError('')
    const { error } = await supabase
      .from('profiles')
      .update({ username: nameDraft.trim() })
      .eq('id', session!.user.id)
    if (error) {
      setNameError(error.message.includes('unique') ? 'Ese nombre ya está en uso' : error.message)
      return
    }
    setEditingName(false)
    refreshProfile()
  }

  async function setStatus(listingId: string, status: Listing['status'], renew = false) {
    const patch: Record<string, unknown> = { status }
    if (renew) patch.last_renewed_at = new Date().toISOString()
    await supabase.from('listings').update(patch).eq('id', listingId)
    loadListings()
  }

  async function logout() {
    await supabase.auth.signOut()
    navigate('/')
  }

  if (!profile) return null

  return (
    <div className="pb-20">
      <header className="bg-brand-700 px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="mb-4 text-xl font-extrabold text-white">Mi perfil</h1>
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-xl font-bold text-white">
            {profile.username.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            {editingName ? (
              <div className="flex gap-2">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  minLength={3}
                  maxLength={30}
                  className="w-40 rounded-lg px-2 py-1 text-sm outline-none"
                />
                <button onClick={saveName} className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-brand-700">
                  OK
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setNameDraft(profile.username)
                  setEditingName(true)
                }}
                className="flex items-center gap-1.5 text-lg font-bold text-white"
              >
                {profile.username}
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-brand-200" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />
                </svg>
              </button>
            )}
            <p className="text-xs text-brand-100">En Dealr desde {new Date(profile.created_at).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</p>
          </div>
        </div>
        {nameError && <p className="mt-2 text-xs text-red-200">{nameError}</p>}
      </header>

      <div className="space-y-4 px-4 py-4">
        {/* Reputación */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-100">
          <h2 className="mb-3 text-sm font-bold">Reputación</h2>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg bg-gray-50 py-3">
              {profile.seller_score != null ? (
                <div className="flex justify-center"><StarRating value={profile.seller_score} /></div>
              ) : (
                <p className="text-sm font-semibold text-gray-400">Sin datos aún</p>
              )}
              <p className="mt-1 text-xs text-gray-500">Como vendedor ({profile.seller_ratings_count})</p>
            </div>
            <div className="rounded-lg bg-gray-50 py-3">
              {profile.buyer_score != null ? (
                <div className="flex justify-center"><StarRating value={profile.buyer_score} /></div>
              ) : (
                <p className="text-sm font-semibold text-gray-400">Sin datos aún</p>
              )}
              <p className="mt-1 text-xs text-gray-500">Como comprador ({profile.buyer_ratings_count})</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Los puntajes aparecen al acumular 3 calificaciones. Mientras tanto, tus insignias hablan por vos.
          </p>
          <div className="mt-3">
            <SellerBadges profile={profile} />
          </div>
          {!profile.identity_verified && (
            <button
              onClick={() => setVerifyOpen(true)}
              className="mt-3 w-full rounded-xl border-2 border-brand-700 py-2.5 text-sm font-bold text-brand-700"
            >
              Verificar mi identidad
            </button>
          )}
        </div>

        {/* Mis publicaciones */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-100">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold">Mis publicaciones</h2>
            <Link to="/publicar" className="text-xs font-semibold text-brand-700">+ Vender algo</Link>
          </div>
          {listings.length === 0 ? (
            <p className="py-2 text-sm text-gray-400">Todavía no publicaste nada.</p>
          ) : (
            <ul className="space-y-3">
              {listings.map((l) => (
                <li key={l.id} className="flex gap-3">
                  <Link to={`/p/${l.id}`} className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {l.photos[0] && <img src={photoUrl(l.photos[0])} alt="" className="h-full w-full object-cover" />}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/p/${l.id}`} className="block truncate text-sm font-semibold">{l.title}</Link>
                    <p className="text-xs text-gray-500">
                      {formatPrice(l.price, l.currency)} ·{' '}
                      <span className={l.status === 'active' ? 'text-brand-600 font-semibold' : ''}>
                        {statusLabels[l.status]}
                      </span>
                      {l.status === 'active' && ` · renovada ${timeAgo(l.last_renewed_at)}`}
                    </p>
                    <div className="mt-1 flex gap-1.5">
                      {l.status === 'active' ? (
                        <>
                          <button onClick={() => setStatus(l.id, 'active', true)} className="rounded-md bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
                            Sigue disponible
                          </button>
                          <button onClick={() => setStatus(l.id, 'sold')} className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                            Ya lo vendí
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setStatus(l.id, 'active', true)} className="rounded-md bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
                          Reactivar
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button onClick={logout} className="w-full rounded-xl bg-white py-3 text-sm font-semibold text-red-600 ring-1 ring-gray-200">
          Cerrar sesión
        </button>
      </div>

      {verifyOpen && (
        <Modal title="Verificar identidad" onClose={() => setVerifyOpen(false)}>
          <div className="space-y-3 text-sm text-gray-600">
            <p>
              La verificación valida tu DNI contra RENAPER con una foto del documento y una selfie.
              Es opcional y gratuita, y te da la insignia <strong>✓ Identidad verificada</strong> en tu
              perfil y en todas tus publicaciones.
            </p>
            <p>
              Tus fotos y datos del documento <strong>no se guardan en Dealr</strong>; solo el resultado
              de la verificación.
            </p>
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              La verificación con Didit estará disponible muy pronto. Te avisamos cuando puedas hacerla.
            </p>
            <button onClick={() => setVerifyOpen(false)} className="w-full rounded-xl bg-brand-700 py-3 font-semibold text-white">
              Entendido
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
