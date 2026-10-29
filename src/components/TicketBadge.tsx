import type { TicketState } from '../../shared/types'
import { TICKET_STATE_LABELS, TICKET_STATE_TONES } from '../lib/tickets'
import { Badge } from './ui/Badge'

export function TicketBadge({ state }: { state: TicketState }) {
  return <Badge tone={TICKET_STATE_TONES[state]}>{TICKET_STATE_LABELS[state]}</Badge>
}
