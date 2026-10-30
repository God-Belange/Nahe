import { Link } from 'react-router'
import type { PublicEvent } from '../../shared/types'
import { accentFor, accentStyle } from '../lib/accent'
import { dateParts, formatPlacesLeft, formatPrice, formatTimeRange } from '../lib/format'
import { eventPath } from '../lib/links'
import { fr } from '../lib/fr'
import { AddressLink } from './AddressLink'
import { EventCover } from './EventCover'
import { Badge } from './ui/Badge'

export function EventCard({ event, index = 0 }: { event: PublicEvent; index?: number }) {
  const { day, month } = dateParts(event.startsAt)
  const isFull = event.remaining <= 0
  return (
    <article
      style={{ ...accentStyle(accentFor(event.id)), animationDelay: `${index * 70}ms` }}
      className="group relative flex animate-rise flex-col overflow-hidden rounded-[var(--radius-card)] border border-line/70 bg-paper shadow-card transition hover:-translate-y-1 hover:shadow-pop focus-within:-translate-y-1"
    >
      <div className="relative">
        <EventCover src={event.coverImageUrl} className="aspect-[16/10] w-full transition duration-500 group-hover:scale-[1.03]" />
        <div className="absolute left-3 top-3 flex min-w-14 flex-col items-center rounded-2xl bg-paper px-3 py-1.5 text-center shadow-card" aria-hidden="true">
          <span className="font-display text-2xl leading-none font-extrabold text-brand">{day}</span>
          <span className="text-xs font-bold tracking-wide text-ink-soft uppercase">{month}</span>
        </div>
        {event.status === 'closed' && (
          <Badge tone="warn" className="absolute right-3 top-3 shadow-card">{fr.event.closed}</Badge>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 className="text-xl leading-snug font-bold">
          <Link
            to={eventPath(event.slug)}
            className="rounded-md after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-[var(--radius-card)]"
          >
            {event.title}
          </Link>
        </h3>
        <ul className="space-y-1 text-sm text-ink-soft">
          <li><span aria-hidden="true">🕗 </span><span className="sr-only">Heure : </span>{formatTimeRange(event.startsAt, event.endsAt)}</li>
          <li>
            <span aria-hidden="true">📍 </span><span className="sr-only">Lieu : </span>
            <span className="font-semibold text-ink">{event.location}</span>
            {event.address && <span className="block pl-6"><AddressLink address={event.address} /></span>}
          </li>
        </ul>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <Badge tone="sun">{formatPrice(event.priceCents)}</Badge>
          {isFull ? (
            <Badge tone="bad">{fr.event.full}</Badge>
          ) : (
            event.showRemaining && <Badge tone="brand">{formatPlacesLeft(event.remaining)}</Badge>
          )}
        </div>
        <span aria-hidden="true" className="mt-1 inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 text-[0.95rem] font-semibold text-white transition group-hover:bg-brand-strong">
          {fr.event.see} →
        </span>
      </div>
    </article>
  )
}
