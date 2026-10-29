export const EVENT_STATUSES = ['draft', 'published', 'closed', 'cancelled'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

export const EVENT_VISIBILITIES = ['public', 'private'] as const
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number]

export const PAYMENT_METHODS = ['wero', 'paypal'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const RESERVATION_STATUSES = ['pending', 'confirmed', 'cancelled', 'expired'] as const
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

export const DEFAULT_PENDING_TTL_HOURS = 24
export const DEFAULT_MAX_PER_BOOKING = 10
export const RETENTION_MONTHS = 6
