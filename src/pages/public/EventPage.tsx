import { useParams } from 'react-router'
import { BLOCK_REASON_MESSAGES } from '../../../shared/booking'
import type { PublicEvent } from '../../../shared/types'
import { AddressLink } from '../../components/AddressLink'
import { EventCover } from '../../components/EventCover'
import { ShareButton } from '../../components/ShareButton'
import { RichText } from '../../components/RichText'
import { PrivateMeta } from '../../components/PrivateMeta'
import { Badge } from '../../components/ui/Badge'
import { Button, LinkButton } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { cx } from '../../components/ui/cx'
import { Alert, EmptyState, ErrorState, PageLoader } from '../../components/ui/feedback'
import { usePublicEvent, type EventMode } from '../../hooks/usePublicEvent'
import { useDocumentTitle } from '../../hooks/usePage'
import { accentFor, accentStyle } from '../../lib/accent'
import { ApiClientError, errorMessage } from '../../lib/api'
import { formatEventSchedule, formatFullDate, formatPlacesLeft, formatPrice } from '../../lib/format'
import { fr } from '../../lib/fr'
import { eventPath, invitePath } from '../../lib/links'

function bookingPath(event: PublicEvent, mode: EventMode, inviteToken: string | undefined): string {
  return mode === 'invite' && inviteToken ? `${invitePath(inviteToken)}/reserver` : `${eventPath(event.slug)}/reserver`
}

function Fact({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-lg" aria-hidden="true">{icon}</span>
      <div>
        <span className="block text-xs font-bold tracking-wide text-ink-muted uppercase">{label}</span>
        <span className="block font-semibold">{children}</span>
      </div>
    </li>
  )
}

function Gauge({ event }: { event: PublicEvent }) {
  if (!event.showRemaining) {
    return event.remaining <= 0 ? <p className="text-sm font-semibold text-bad">{fr.event.full}</p> : null
  }
  const taken = event.capacity - event.remaining
  const pct = Math.min(100, Math.round((taken / event.capacity) * 100))
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-sm">
        <span className="font-semibold">
          {event.remaining <= 0 ? fr.event.full : formatPlacesLeft(event.remaining)}
        </span>
        <span className="text-ink-muted">sur {event.capacity}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Places réservées"
        aria-valuemin={0}
        aria-valuemax={event.capacity}
        aria-valuenow={taken}
        className="h-2.5 overflow-hidden rounded-full bg-line"
      >
        <div className={cx('h-full rounded-full bg-brand transition-all duration-700', event.remaining <= 0 && 'bg-bad')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function EventPage({ mode }: { mode: EventMode }) {
  const params = useParams()
  const param = (mode === 'slug' ? params.slug : params.inviteToken) ?? ''
  const { data: event, error, loading, reload } = usePublicEvent(mode, param)
  useDocumentTitle(event?.title)

  if (loading && !event) return <PageLoader />
  if (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return <EmptyState icon="🔍" title={fr.event.notFoundTitle} text={fr.event.notFoundText} action={<LinkButton to="/">{fr.common.home}</LinkButton>} />
    }
    return <ErrorState message={errorMessage(error)} onRetry={reload} />
  }
  if (!event) return null

  const blocked = event.blockReason !== null
  const reserveHref = bookingPath(event, mode, mode === 'invite' ? param : undefined)
  const shareText = `${event.title} — ${formatEventSchedule(event.startsAt, event.endsAt)}, ${event.location}. Réserve ta place : ${window.location.href}`

  const cta = blocked ? (
    <Button size="lg" fullWidth disabled>{fr.event.reserve}</Button>
  ) : (
    <LinkButton to={reserveHref} size="lg" fullWidth>{fr.event.reserve}</LinkButton>
  )

  return (
    <div style={accentStyle(accentFor(event.id))} className="pb-28 lg:pb-0">
      {mode === 'invite' && <PrivateMeta />}
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="relative animate-rise overflow-hidden rounded-[var(--radius-card)] shadow-card">
          <EventCover src={event.coverImageUrl} alt={`Illustration : ${event.title}`} eager natural className="w-full bg-ink/5" />
          <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 sm:bottom-4 sm:left-4">
            {event.status === 'closed' && <Badge tone="warn" className="shadow-card">{fr.event.closed}</Badge>}
            {event.status === 'cancelled' && <Badge tone="bad" className="shadow-card">Annulé</Badge>}
            <Badge tone="sun" className="shadow-card">{formatPrice(event.priceCents)}</Badge>
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-8">
            {blocked && event.blockReason && (
              <Alert tone={event.blockReason === 'full' ? 'warn' : 'info'} title={BLOCK_REASON_MESSAGES[event.blockReason]} />
            )}
            <section aria-labelledby="titre">
              <h1 id="titre" className="mb-3 text-3xl font-extrabold text-balance sm:text-4xl">{event.title}</h1>
              {event.description && <p className="leading-relaxed whitespace-pre-line text-ink-soft"><RichText text={event.description} /></p>}
            </section>
            {event.extraInfo && (
              <section aria-labelledby="infos">
                <h2 id="infos" className="mb-3 text-2xl font-bold">Infos pratiques</h2>
                <Card className="bg-brand-soft/60 leading-relaxed whitespace-pre-line text-ink-soft">{event.extraInfo}</Card>
              </section>
            )}
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start" aria-label="Détails et réservation">
            <Card className="space-y-5">
              <ul className="space-y-4">
                <Fact icon="📅" label="Quand">{formatEventSchedule(event.startsAt, event.endsAt)}</Fact>
                <Fact icon="📍" label="Où">
                  {event.location}
                  {event.address && <span className="block text-sm font-normal text-ink-soft"><AddressLink address={event.address} /></span>}
                </Fact>
                <Fact icon="💶" label="Prix par place">{formatPrice(event.priceCents)}</Fact>
                {event.bookingDeadline && <Fact icon="⏳" label="Réserver avant le">{formatFullDate(event.bookingDeadline)}</Fact>}
              </ul>
              <Gauge event={event} />
              <div className="hidden lg:block">{cta}</div>
              {blocked && event.blockReason && <p className="text-sm text-ink-soft">{BLOCK_REASON_MESSAGES[event.blockReason]}</p>}
              <ShareButton text={shareText} title={event.title} label={fr.event.share} size="md" fullWidth />
            </Card>
          </aside>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-pop backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <div className="shrink-0 leading-tight">
            <p className="font-display text-xl font-extrabold">{formatPrice(event.priceCents)}</p>
            {event.remaining <= 0 ? (
              <p className="text-xs text-ink-muted">{fr.event.full}</p>
            ) : (
              event.showRemaining && <p className="text-xs text-ink-muted">{event.remaining} restante{event.remaining > 1 ? 's' : ''}</p>
            )}
          </div>
          <div className="flex-1">{cta}</div>
        </div>
      </div>
    </div>
  )
}
