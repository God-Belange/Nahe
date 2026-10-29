import type { AdminEvent } from '../../../shared/types'
import { PageHeader } from '../../components/admin/PageHeader'
import { WhatsAppButton } from '../../components/admin/WhatsAppButton'
import { Badge, EventBadge } from '../../components/ui/Badge'
import { LinkButton } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { CopyButton } from '../../components/ui/CopyButton'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback'
import { useAsync } from '../../hooks/useAsync'
import { useDocumentTitle } from '../../hooks/usePage'
import { api } from '../../lib/api'
import { formatEventDate, formatPrice } from '../../lib/format'
import { shareUrl } from '../../lib/links'

export function invitationText(event: AdminEvent): string {
  return `🎉 ${event.title}\n📅 ${formatEventDate(event.startsAt)}\n📍 ${event.location}\n\nRéserve ta place sur Nahe? 👉 ${shareUrl(event)}`
}

function Visibility({ event }: { event: AdminEvent }) {
  return event.visibility === 'private' ? <Badge tone="brand">🔒 Privé</Badge> : <Badge>🌍 Public</Badge>
}

function Places({ event }: { event: AdminEvent }) {
  const taken = event.confirmedPlaces + event.pendingPlaces
  return (
    <span>
      <strong>{taken}</strong> / {event.capacity}
      <span className="block text-xs text-ink-muted">{event.confirmedPlaces} conf. · {event.pendingPlaces} en attente</span>
    </span>
  )
}

function Actions({ event }: { event: AdminEvent }) {
  return (
    <div className="flex flex-wrap gap-2">
      <LinkButton to={`/admin/evenements/${event.id}`} variant="secondary" size="sm">Modifier</LinkButton>
      <CopyButton value={shareUrl(event)} label="Copier le lien" />
      <WhatsAppButton text={invitationText(event)} />
    </div>
  )
}

export default function EventsPage() {
  useDocumentTitle('Événements')
  const { data, error, loading, reload } = useAsync(() => api.get<AdminEvent[]>('/admin/events'), [])

  return (
    <>
      <PageHeader title="Événements" actions={<LinkButton to="/admin/evenements/nouveau">+ Nouvel événement</LinkButton>} />
      {loading && !data && (
        <div aria-busy="true" className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}
      {error && !data && <ErrorState message={error.message} onRetry={reload} />}
      {data && data.length === 0 && (
        <EmptyState
          title="Aucun événement pour l'instant"
          text="Créez votre premier rendez-vous en quelques minutes."
          action={<LinkButton to="/admin/evenements/nouveau">Créer un événement</LinkButton>}
        />
      )}
      {data && data.length > 0 && (
        <>
          <ul className="space-y-3 md:hidden">
            {data.map((e) => (
              <li key={e.id}>
                <Card className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-bold">{e.title}</h2>
                      <p className="text-sm text-ink-soft">{formatEventDate(e.startsAt)}</p>
                    </div>
                    <EventBadge status={e.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Visibility event={e} />
                    <Badge>{formatPrice(e.priceCents)}</Badge>
                    <Places event={e} />
                  </div>
                  <Actions event={e} />
                </Card>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line/70 bg-paper shadow-card md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Liste des événements</caption>
              <thead className="bg-cream text-ink-soft">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Événement</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Visibilité</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Prix</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Places</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {data.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-bold">{e.title}</p>
                      <p className="text-ink-soft">{formatEventDate(e.startsAt)}</p>
                    </td>
                    <td className="px-4 py-3"><EventBadge status={e.status} /></td>
                    <td className="px-4 py-3"><Visibility event={e} /></td>
                    <td className="px-4 py-3">{formatPrice(e.priceCents)}</td>
                    <td className="px-4 py-3"><Places event={e} /></td>
                    <td className="px-4 py-3"><Actions event={e} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
