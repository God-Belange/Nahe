import type { EventStatus } from './constants'

export type BookingBlockReason =
  | 'not_published'
  | 'cancelled'
  | 'closed'
  | 'past'
  | 'deadline_passed'
  | 'full'

export interface BookabilityInput {
  status: EventStatus
  startsAt: string
  bookingDeadline: string | null
}

/** Renvoie la raison pour laquelle l'événement n'accepte pas de réservation, ou null s'il est ouvert. */
export function bookingBlockReason(
  event: BookabilityInput,
  remaining: number,
  now: Date,
): BookingBlockReason | null {
  if (event.status === 'draft') return 'not_published'
  if (event.status === 'cancelled') return 'cancelled'
  if (event.status === 'closed') return 'closed'
  const nowIso = now.toISOString()
  if (event.startsAt <= nowIso) return 'past'
  if (event.bookingDeadline !== null && event.bookingDeadline <= nowIso) return 'deadline_passed'
  if (remaining <= 0) return 'full'
  return null
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000)
}

export const BLOCK_REASON_MESSAGES: Record<BookingBlockReason, string> = {
  not_published: "Cet événement n'est pas encore ouvert aux réservations.",
  cancelled: 'Cet événement a été annulé.',
  closed: 'Les réservations pour cet événement sont fermées.',
  past: 'Cet événement est déjà passé.',
  deadline_passed: 'La date limite de réservation est dépassée.',
  full: 'Cet événement est complet.',
}
