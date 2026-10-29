import type { PublicEvent } from '../../../shared/types'
import { EventCard } from '../../components/EventCard'
import { Logo } from '../../components/Logo'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback'
import { useAsync } from '../../hooks/useAsync'
import { useDocumentTitle } from '../../hooks/usePage'
import { api, errorMessage } from '../../lib/api'
import { fr } from '../../lib/fr'

function EventSkeletons() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label={fr.common.loading}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="overflow-hidden rounded-[var(--radius-card)] border border-line/70 bg-paper shadow-card">
          <Skeleton className="aspect-[16/10] w-full rounded-none" />
          <div className="space-y-3 p-5">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-4 h-11 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function HomePage() {
  useDocumentTitle()
  const { data, error, loading, reload } = useAsync(() => api.get<PublicEvent[]>('/events'), [])

  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pt-6 pb-10 text-center sm:px-6 sm:pt-12 sm:pb-14">
        <h1 className="sr-only">Nahe ? — {fr.brand.slogan}</h1>
        <div className="animate-rise">
          <Logo size="xl" asLink={false} />
        </div>
        <p className="mx-auto mt-5 max-w-xl animate-rise text-lg text-ink-soft [animation-delay:120ms] sm:text-xl">
          {fr.brand.slogan} Réservez votre place pour les prochaines soirées entre amis.
        </p>
      </section>

      <section aria-labelledby="prochains" className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="prochains" className="mb-6 text-2xl font-extrabold sm:text-3xl">Prochains événements</h2>
        {loading && !data ? (
          <EventSkeletons />
        ) : error ? (
          <ErrorState message={errorMessage(error)} onRetry={reload} />
        ) : data && data.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((event, i) => (
              <EventCard key={event.id} event={event} index={i} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="🌙"
            title="Rien de prévu pour le moment"
            text="Aucun événement n'est ouvert aux réservations. Revenez bientôt, ou demandez le lien d'invitation à l'organisateur."
          />
        )}
      </section>
    </>
  )
}
