import type { TicketState } from '../../shared/types'
import { TICKET_STATE_MESSAGES, ticketQrPayload } from '../lib/tickets'
import { QrCode } from './QrCode'
import { cx } from './ui/cx'

interface TicketQrProps {
  token: string
  seq: number
  total: number
  state: TicketState
  maxWidth?: string
}

/** QR d'un billet ; grisé et barré s'il n'est plus utilisable. */
export function TicketQr({ token, seq, total, state, maxWidth }: TicketQrProps) {
  const label = `QR code du billet ${seq} sur ${total}`
  return (
    <div className="relative mx-auto w-full" style={{ maxWidth: maxWidth ?? '24rem' }}>
      <div className={cx(state !== 'valid' && 'opacity-25 grayscale')}>
        <QrCode value={ticketQrPayload(token)} label={label} {...(maxWidth ? { maxWidth } : {})} />
      </div>
      {state !== 'valid' && (
        <div className="absolute inset-0 grid place-items-center" role="status">
          <span className="-rotate-12 rounded-xl border-4 border-bad bg-white/95 px-4 py-2 text-center font-display text-xl font-extrabold text-bad uppercase">
            {state === 'used' ? 'Déjà utilisé' : 'Annulé'}
          </span>
          <span className="sr-only">{TICKET_STATE_MESSAGES[state]}</span>
        </div>
      )}
    </div>
  )
}
