import { AddressLink } from '../../components/AddressLink'
import { useParams } from 'react-router'
import type { PublicTicket } from '../../../shared/types'
import { PrivateMeta } from '../../components/PrivateMeta'
import { TicketBadge } from '../../components/TicketBadge'
import { TicketQr } from '../../components/TicketQr'
import { LinkButton } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Alert, EmptyState, ErrorState, PageLoader } from '../../components/ui/feedback'
import { useAsync } from '../../hooks/useAsync'
import { useDocumentTitle } from '../../hooks/usePage'
import { accentFor, accentStyle } from '../../lib/accent'
import { api, ApiClientError, errorMessage } from '../../lib/api'
import { formatEventSchedule } from '../../lib/format'
import { fr } from '../../lib/fr'
import { TICKET_STATE_MESSAGES } from '../../lib/tickets'

export default function TicketPage() {
  const { token = '' } = useParams()
  const { data: ticket, error, loading, reload } = useAsync(
    () => api.get<PublicTicket>(`/tickets/${encodeURIComponent(token)}`),
    [token],
  )
  useDocumentTitle(ticket ? `Billet ${ticket.seq}/${ticket.total}` : 'Mon billet')

  if (loading && !ticket) return <><PrivateMeta /><PageLoader /></>
  if (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return (
        <>
          <PrivateMeta />
          <EmptyState
            icon="🎟️"
            title="Billet introuvable"
            text="Ce lien de billet est incorrect. Vérifiez l'e-mail reçu ou votre page de suivi."
            action={<LinkButton to="/">{fr.common.home}</LinkButton>}
          />
        </>
      )
    }
    return <><PrivateMeta /><ErrorState message={errorMessage(error)} onRetry={reload} /></>
  }
  if (!ticket) return null

  return (
    <div style={accentStyle(accentFor(ticket.event.slug))} className="mx-auto max-w-md space-y-5 px-4 pb-16 sm:px-6">
      <PrivateMeta />
      <header className="animate-rise pt-2 text-center">
        <p className="text-sm font-bold tracking-wide text-brand-strong uppercase">Billet {ticket.seq} / {ticket.total}</p>
        <h1 className="mt-1 text-3xl font-extrabold sm:text-4xl">{ticket.event.title}</h1>
        <p className="mt-2 text-ink-soft">{formatEventSchedule(ticket.event.startsAt, ticket.event.endsAt)}</p>
        <p className="font-semibold text-ink">{ticket.event.location}</p>
        {ticket.event.address && <p className="text-ink-soft"><AddressLink address={ticket.event.address} /></p>}
      </header>

      <Card className="animate-rise space-y-4 text-center">
        <TicketQr token={ticket.token} seq={ticket.seq} total={ticket.total} state={ticket.state} maxWidth="min(90vw, 24rem)" />
        <div className="space-y-2">
          <p className="text-lg font-bold">{ticket.holderFirstName}</p>
          <TicketBadge state={ticket.state} />
        </div>
      </Card>

      {ticket.state === 'valid' ? (
        <Alert tone="info" title="À l'entrée">
          Présentez ce QR code à l'entrée (capture d'écran acceptée), augmentez la luminosité de l'écran. Un billet = une seule entrée.
        </Alert>
      ) : (
        <Alert tone={ticket.state === 'used' ? 'warn' : 'bad'}>{TICKET_STATE_MESSAGES[ticket.state]}</Alert>
      )}
    </div>
  )
}
