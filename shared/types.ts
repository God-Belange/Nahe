import type { BookingBlockReason } from './booking'
import type {
  EventStatus,
  EventVisibility,
  PaymentMethod,
  ReservationStatus,
} from './constants'

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> }
}

export interface PublicEvent {
  id: string
  slug: string
  title: string
  description: string
  coverImageUrl: string | null
  location: string
  startsAt: string
  endsAt: string | null
  priceCents: number
  capacity: number
  remaining: number
  bookingDeadline: string | null
  extraInfo: string
  status: EventStatus
  maxPerBooking: number
  /** moyens de paiement configurés (vide si l'événement est gratuit) */
  paymentMethods: PaymentMethod[]
  /** null si les réservations sont ouvertes */
  blockReason: BookingBlockReason | null
}

export interface PaymentInstructions {
  method: PaymentMethod
  amountCents: number
  reference: string
  weroInstructions?: string
  weroQrImageUrl?: string | null
  paypalUrl?: string | null
}

export interface ReservationView {
  reference: string
  firstName: string
  lastName: string
  email: string
  quantity: number
  totalAmountCents: number
  paymentMethod: PaymentMethod | null
  status: ReservationStatus
  paymentDeclaredAt: string | null
  expiresAt: string | null
  createdAt: string
  event: Pick<
    PublicEvent,
    'title' | 'slug' | 'startsAt' | 'location' | 'coverImageUrl' | 'status'
  >
  /** présent uniquement tant que la réservation attend un paiement */
  payment: PaymentInstructions | null
  /** un billet par place, uniquement quand la réservation est confirmée */
  tickets: TicketView[]
}

export type TicketState = 'valid' | 'used' | 'void'

export interface TicketView {
  seq: number
  total: number
  token: string
  state: TicketState
  checkedInAt: string | null
}

export interface PublicTicket {
  seq: number
  total: number
  holderFirstName: string
  state: TicketState
  token: string
  event: Pick<PublicEvent, 'title' | 'slug' | 'startsAt' | 'location' | 'coverImageUrl' | 'status'>
}

export type ScanResult =
  | 'ok'
  | 'admitted'
  | 'already_used'
  | 'void'
  | 'wrong_event'
  | 'event_cancelled'
  | 'invalid'

export interface ScanTicketInfo {
  ticketId: string
  seq: number
  total: number
  holderName: string
  reference: string
  eventId: string
  eventTitle: string
  startsAt: string
  checkedInAt: string | null
}

export interface ScanOutcome {
  result: ScanResult
  ticket: ScanTicketInfo | null
}

export interface EventTicketRow {
  ticketId: string
  seq: number
  total: number
  holderName: string
  reference: string
  state: TicketState
  checkedInAt: string | null
}

export interface EventTickets {
  expected: number
  checkedIn: number
  items: EventTicketRow[]
}

export type MailResult = 'sent' | 'not_configured' | 'quota' | 'failed'

export interface CreatedReservation {
  accessToken: string
  reservation: ReservationView
}

export interface AdminEvent extends PublicEvent {
  visibility: EventVisibility
  inviteToken: string
  confirmedPlaces: number
  pendingPlaces: number
  createdAt: string
  updatedAt: string
}

export interface RefundItem {
  reservationId: string
  reference: string
  name: string
  email: string
  amountCents: number
  paymentMethod: PaymentMethod | null
}

export interface AdminEventDetail extends AdminEvent {
  refundsToProcess: RefundItem[]
}

export interface AdminReservation {
  id: string
  eventId: string
  eventTitle: string
  reference: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  quantity: number
  totalAmountCents: number
  paymentMethod: PaymentMethod | null
  status: ReservationStatus
  paymentDeclaredAt: string | null
  expiresAt: string | null
  createdAt: string
  ticketsEmailedAt: string | null
}

export interface ReservationActionResult extends AdminReservation {
  ticketsEmail?: MailResult
}

export interface AdminReservationsPage {
  items: AdminReservation[]
  total: number
}

export interface DashboardStats {
  eventsTotal: number
  eventsUpcoming: number
  confirmedParticipants: number
  pendingReservations: number
  availablePlaces: number
  collectedCents: number
  outstandingCents: number
  declaredPayments: number
  refundsToProcessCents: number
}

export interface PaymentSettings {
  weroInstructions: string
  weroQrImageUrl: string | null
  paypalMeUrl: string | null
  pendingTtlHours: number
  updatedAt: string | null
}

export interface SessionInfo {
  authenticated: boolean
  csrfToken?: string
}
