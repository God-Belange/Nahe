import type { TicketState } from '../../shared/types'

/** Doit rester IDENTIQUE à ticketQrPayload de worker/routes/public.ts. */
export const ticketQrPayload = (token: string) =>
  `${window.location.origin}/admin/scan?t=${encodeURIComponent(token)}`

export const ticketPath = (token: string) => `/t/${token}`

export const TICKET_STATE_LABELS: Record<TicketState, string> = {
  valid: 'Valide',
  used: 'Déjà utilisé',
  void: 'Annulé',
}

export const TICKET_STATE_TONES: Record<TicketState, 'ok' | 'neutral' | 'bad'> = {
  valid: 'ok',
  used: 'neutral',
  void: 'bad',
}

export const TICKET_STATE_MESSAGES: Record<Exclude<TicketState, 'valid'>, string> = {
  used: 'Ce billet a déjà été utilisé.',
  void: 'Ce billet est annulé.',
}
