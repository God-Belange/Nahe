import type { ReactNode } from 'react'
import type { EventStatus, ReservationStatus } from '../../../shared/constants'
import { fr } from '../../lib/fr'
import { cx } from './cx'

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'sun'

const TONES: Record<Tone, string> = {
  neutral: 'bg-line/60 text-ink-soft',
  brand: 'bg-brand-soft text-brand-strong',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  sun: 'bg-sun text-ink',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap', TONES[tone], className)}>
      {children}
    </span>
  )
}

const RESERVATION_TONE: Record<ReservationStatus, Tone> = { pending: 'warn', confirmed: 'ok', cancelled: 'neutral', expired: 'bad' }
export const ReservationBadge = ({ status }: { status: ReservationStatus }) => (
  <Badge tone={RESERVATION_TONE[status]}>{fr.status.reservation[status]}</Badge>
)

const EVENT_TONE: Record<EventStatus, Tone> = { draft: 'neutral', published: 'ok', closed: 'warn', cancelled: 'bad' }
export const EventBadge = ({ status }: { status: EventStatus }) => (
  <Badge tone={EVENT_TONE[status]}>{fr.status.event[status]}</Badge>
)
