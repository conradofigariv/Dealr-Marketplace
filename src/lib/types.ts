export type ListingCondition = 'nuevo' | 'como_nuevo' | 'buen_estado' | 'con_detalles'
export type ListingStatus = 'active' | 'paused' | 'sold' | 'expired' | 'reserved'
export type Currency = 'ARS' | 'USD'
export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired'

export interface Profile {
  id: string
  username: string
  avatar_url: string | null
  zone: string | null
  phone_verified: boolean
  identity_verified: boolean
  seller_score: number | null
  buyer_score: number | null
  seller_ratings_count: number
  buyer_ratings_count: number
  lat: number | null
  lng: number | null
  last_seen_at: string | null
  is_admin: boolean
  auction_strikes: number
  auction_banned_until: string | null
  terms_accepted_at: string | null
  is_minor: boolean
  account_restricted: boolean
  created_at: string
}

export interface FieldDef {
  key: string
  label: string
  type: 'text' | 'boolean' | 'select' | 'multiselect'
  required: boolean
  options?: string[]
  // Si está presente, el campo ofrece un filtro por rango numérico en el feed
  // (ej. Año, Kilómetros, Superficie). La comparación se hace contra esta
  // columna generada de `listings` (numérica e indexada), no contra el jsonb,
  // para comparar como número y no como texto.
  filterRange?: { column: string; unit?: string }
  // Filtro como DESLIZABLE (un solo valor). `bound` = si el valor elegido es el
  // mínimo ('min' → "desde N") o el máximo ('max' → "hasta N"). Compara contra
  // la columna generada. Escribe en el mismo `fieldRanges` que filterRange.
  filterSlider?: { column: string; min: number; max: number; step: number; unit?: string; bound: 'min' | 'max' }
  // Filtro como chips de valor MÁXIMO (ej. expensas: hasta 100mil/200mil…).
  // Cada opción es un tope; filtra `column <= value`. También usa `fieldRanges`.
  filterMaxChips?: { column: string; options: { label: string; value: number }[] }
  // Si está presente, el campo solo se muestra (y se exige/guarda) cuando el
  // valor del campo `key` cae dentro de `in`. Permite campos condicionados por
  // otro (ej. en Celulares: marca/modelo/almacenamiento solo aplican si
  // "Tipo" = Teléfono; un accesorio no los pide). La validación y la poda al
  // guardar respetan esto; en el feed (sin contexto) el filtro los ignora.
  showIf?: { key: string; in: string[] }
}

export interface Category {
  id: number
  name: string
  slug: string
  parent_id: number | null
  required_fields: FieldDef[]
}

export interface Listing {
  id: string
  seller_id: string
  title: string
  description: string
  price: number
  currency: Currency
  category_id: number
  condition: ListingCondition
  structured_fields: Record<string, unknown>
  status: ListingStatus
  verified: boolean
  photos: string[]
  sold_to: string | null
  lat: number | null
  lng: number | null
  location_label: string | null
  favorites_count: number
  views_count: number
  previous_price: number | null
  price_dropped_at: string | null
  is_auction: boolean
  auction_ends_at: string | null
  current_bid: number | null
  bids_count: number
  auction_closed: boolean
  auction_cascade: boolean
  auction_min_increment: number
  buyer_confirmed_pickup: boolean
  seller_confirmed_pickup: boolean
  seller_reported_no_show: boolean
  pickup_disputed: boolean
  created_at: string
  last_renewed_at: string
  seller?: Profile
}

export interface Question {
  id: string
  listing_id: string
  asker_id: string
  body: string
  answer_body: string | null
  answered_at: string | null
  is_public: boolean
  created_at: string
}

export interface Conversation {
  id: string
  listing_id: string | null
  buyer_id: string
  seller_id: string
  // Tipo de chat. 'welcome' = DM de bienvenida del admin (00030): el front
  // muestra "Mensaje de bienvenida" en vez de "Publicación eliminada". null =
  // chat normal de una publicación.
  kind: 'welcome' | null
  created_at: string
  last_message_at: string
  listing?: Listing | null
  buyer?: Profile
  seller?: Profile
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  body: string | null
  image_path: string | null
  created_at: string
  read_at: string | null
  edited_at: string | null
  deleted_at: string | null
}

export interface Offer {
  id: string
  listing_id: string
  buyer_id: string
  amount: number
  status: OfferStatus
  created_at: string
  buyer?: Profile
}

export interface AppReview {
  id: string
  user_id: string
  rating: number
  body: string | null
  created_at: string
  updated_at: string
  author?: Profile
}

export type NotificationType =
  | 'message'
  | 'offer'
  | 'offer_accepted'
  | 'question_answered'
  | 'sale_confirmed'
  | 'price_drop'
  | 'saved_search'
  | 'bid'
  | 'outbid'
  | 'auction_won'
  | 'report'
  | 'question'

export interface AppNotification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
  // Quién disparó la notificación (NULL para anónimas como pujas de subasta).
  // El embed fija la FK porque hay dos FKs a profiles (user_id y actor_id).
  actor_id: string | null
  actor?: Pick<Profile, 'id' | 'username' | 'avatar_url'> | null
}

export interface SavedSearch {
  id: string
  user_id: string
  query: string | null
  category_id: number | null
  min_price: number | null
  max_price: number | null
  currency: Currency | null
  conditions: ListingCondition[] | null
  created_at: string
}

export type ReportTargetType = 'question' | 'listing' | 'user' | 'message' | 'review' | 'suggestion' | 'support'

export interface Report {
  id: string
  reporter_id: string
  target_type: ReportTargetType
  target_id: string
  reason: string
  resolved: boolean
  created_at: string
  reporter?: Pick<Profile, 'id' | 'username' | 'avatar_url'> | null
}

export type SuggestionStatus = 'open' | 'planned' | 'in_progress' | 'done' | 'declined'

export interface FeatureSuggestion {
  id: string
  user_id: string
  title: string
  body: string | null
  status: SuggestionStatus
  vote_count: number
  created_at: string
  author?: Profile
}
