export type ListingCondition = 'nuevo' | 'como_nuevo' | 'buen_estado' | 'con_detalles'
export type ListingStatus = 'active' | 'paused' | 'sold' | 'expired'
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
  created_at: string
}

export interface FieldDef {
  key: string
  label: string
  type: 'text' | 'boolean' | 'select' | 'multiselect'
  required: boolean
  options?: string[]
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
  listing_id: string
  buyer_id: string
  seller_id: string
  created_at: string
  last_message_at: string
  listing?: Listing
  buyer?: Profile
  seller?: Profile
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
  read_at: string | null
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

export interface AppNotification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
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
