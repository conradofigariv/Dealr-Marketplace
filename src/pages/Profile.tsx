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
    <div className="pb-28">
      <header className="px-5 pb-6 pt-[max(2rem,env(safe-area-inset-top))] text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-neutral-900 text-2xl font-bold text-white ring-1 ring-neutral-800">
          {profile.username.slice(0, 1).toUpperCase()}
        </div>
        {editingName ? (
          <div className="mx-auto flex max-w-xs items-end gap-3">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              minLength={3}
              maxLength={30}
              className="input-line text-center text-lg font-semibold"
            />
            <button onClick={saveName} className="shrink-0 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-black">
              OK
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setNameDraft(profile.username)
              setEditingName(true)
            }}
            className="text-xl font-bold text-white"
          >
            {profile.username}
            <span className="ml-2 text-sm font-normal text-neutral-600">editar</span>
          </button>
        )}
        <p className="mt-1 text-xs text-neutral-500">
          En Dealr desde {new Date(profile.created_at).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
        </p>
        {nameError && <p className="mt-2 text-xs text-red-400">{nameError}</p>}
        <div className="mt-4 flex justify-center">
          <SellerBadges profile={profile} />
        </div>
      </header>

      <div className="space-y-6 px-5">
        {/* Reputación */}
        <div className="surface p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Reputación</h2>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              {profile.seller_score != null ? (
                <div className="flex justify-center"><StarRating value={profile.seller_score} /></div>
              ) : (
                <p className="text-sm text-neutral-600">Sin datos aún</p>
              )}
              <p className="mt-1 text-xs text-neutral-500">Vendedor ({profile.seller_ratings_count})</p>
            </div>
            <div>
              {profile.buyer_score != null ? (
                <div className="flex justify-center"><StarRating value={profile.buyer_score} /></div>
              ) : (
                <p className="text-sm text-neutral-600">Sin datos aún</p>
              )}
              <p className="mt-1 text-xs text-neutral-500">Comprador ({profile.buyer_ratings_count})</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-neutral-600">
            Los puntajes aparecen al acumular 3 calificaciones. Mientras tanto, tus insignias hablan por vos.
          </p>
          {!profile.identity_verified && (
            <button onClick={() => setVerifyOpen(true)} className="btn-outline mt-4 py-2.5 text-sm">
              Verificar mi identidad
            </button>
          )}
        </div>

        {/* Mis publicaciones */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Mis publicaciones</h2>
            <Link to="/publicar" className="text-xs font-semibold text-neutral-400">+ Vender algo</Link>
          </div>
          {listings.length === 0 ? (
            <p className="py-2 text-sm text-neutral-600">Todavía no publicaste nada.</p>
          ) : (
            <ul className="space-y-4">
              {listings.map((l) => (
                <li key={l.id} className="flex gap-4">
                  <Link to={`/p/${l.id}`} className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-neutral-900">
                    {l.photos[0] && <img src={photoUrl(l.photos[0])} alt="" className="h-full w-full object-cover" />}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/p/${l.id}`} className="block truncate text-sm font-semibold text-white">{l.title}</Link>
                    <p className="text-xs text-neutral-500">
                      {formatPrice(l.price, l.currency)} ·{' '}
                      <span className={l.status === 'active' ? 'text-white' : ''}>{statusLabels[l.status]}</span>
                      {l.status === 'active' && ` · renovada ${timeAgo(l.last_renewed_at)}`}
                    </p>
                    <div className="mt-1.5 flex gap-2">
                      {l.status === 'active' ? (
                        <>
                          <button onClick={() => setStatus(l.id, 'active', true)} className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black">
                            Sigue disponible
                          </button>
                          <button onClick={() => setStatus(l.id, 'sold')} className="rounded-full px-3 py-1 text-[11px] font-semibold text-neutral-400 ring-1 ring-neutral-700">
                            Ya lo vendí
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setStatus(l.id, 'active', true)} className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black">
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

        <button onClick={logout} className="w-full py-3 text-center text-sm text-neutral-500">
          Cerrar sesión
        </button>
      </div>

      {verifyOpen && (
        <Modal title="Verificar identidad" onClose={() => setVerifyOpen(false)}>
          <div className="space-y-4 text-sm text-neutral-400">
            <p>
              La verificación valida tu DNI contra RENAPER con una foto del documento y una selfie.
              Es opcional y gratuita, y te da la insignia{' '}
              <strong className="text-white">✓ Identidad verificada</strong> en tu perfil y en todas
              tus publicaciones.
            </p>
            <p>
              Tus fotos y datos del documento <strong className="text-white">no se guardan en Dealr</strong>;
              solo el resultado de la verificación.
            </p>
            <p className="rounded-xl bg-neutral-900 p-3.5 text-xs text-neutral-400 ring-1 ring-neutral-800">
              La verificación estará disponible muy pronto. Te avisamos cuando puedas hacerla.
            </p>
            <button onClick={() => setVerifyOpen(false)} className="btn-primary">
              Entendido
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
