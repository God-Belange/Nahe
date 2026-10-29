import { Link } from 'react-router'
import type { DashboardStats } from '../../../shared/types'
import { PageHeader } from '../../components/admin/PageHeader'
import { StatCard } from '../../components/admin/StatCard'
import { LinkButton } from '../../components/ui/Button'
import { Alert, ErrorState, Skeleton } from '../../components/ui/feedback'
import { useAsync } from '../../hooks/useAsync'
import { useDocumentTitle } from '../../hooks/usePage'
import { api } from '../../lib/api'
import { formatEuros } from '../../lib/format'

export default function DashboardPage() {
  useDocumentTitle('Tableau de bord')
  const { data, error, loading, reload } = useAsync(() => api.get<DashboardStats>('/admin/dashboard'), [])

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        subtitle="Un coup d'œil sur vos événements et vos paiements."
        actions={<LinkButton to="/admin/evenements/nouveau">+ Créer un événement</LinkButton>}
      />
      {loading && !data && <DashboardSkeleton />}
      {error && !data && <ErrorState message={error.message} onRetry={reload} />}
      {data && <DashboardContent stats={data} />}
    </>
  )
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  )
}

function DashboardContent({ stats }: { stats: DashboardStats }) {
  return (
    <div className="space-y-6 animate-rise">
      {stats.refundsToProcessCents > 0 && (
        <Alert tone="warn" title="Remboursements manuels à traiter">
          {formatEuros(stats.refundsToProcessCents)} de paiements confirmés concernent des événements annulés. Retrouvez le détail
          dans la fiche de chaque événement annulé.
        </Alert>
      )}

      <section aria-label="Activité" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard icon="🎉" label="Événements" value={stats.eventsUpcoming} hint={`à venir · ${stats.eventsTotal} au total`} />
        <StatCard icon="🙌" label="Participants confirmés" value={stats.confirmedParticipants} hint="places confirmées" />
        <StatCard
          icon="⏳"
          label="Réservations en attente"
          value={stats.pendingReservations}
          hint={
            <>
              {stats.declaredPayments > 0 ? (
                <span className="font-semibold text-warn">{stats.declaredPayments} paiement{stats.declaredPayments > 1 ? 's' : ''} déclaré{stats.declaredPayments > 1 ? 's' : ''} à vérifier</span>
              ) : (
                'aucun paiement déclaré'
              )}
              <br />
              <Link to="/admin/reservations?status=pending" className="font-semibold text-brand-strong underline underline-offset-4">
                Voir les réservations
              </Link>
            </>
          }
        />
        <StatCard icon="🎟️" label="Places disponibles" value={stats.availablePlaces} hint="sur les événements à venir" />
      </section>

      <section aria-label="Paiements" className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border-2 border-ok/30 bg-ok-soft p-6">
          <p className="text-sm font-bold uppercase tracking-wide text-ok">Encaissé</p>
          <p className="mt-1 text-sm font-semibold text-ink">Montant encaissé (paiements confirmés)</p>
          <p className="mt-3 font-display text-5xl font-extrabold text-ok">{formatEuros(stats.collectedCents)}</p>
          <p className="mt-2 text-sm text-ink-soft">Argent réellement reçu et vérifié par vos soins.</p>
        </div>
        <div className="rounded-[var(--radius-card)] border-2 border-dashed border-warn/40 bg-warn-soft p-6">
          <p className="text-sm font-bold uppercase tracking-wide text-warn">Attendu</p>
          <p className="mt-1 text-sm font-semibold text-ink">Restant à collecter (réservations en attente, non encaissé)</p>
          <p className="mt-3 font-display text-5xl font-extrabold text-warn">{formatEuros(stats.outstandingCents)}</p>
          <p className="mt-2 text-sm text-ink-soft">Montant espéré : non reçu tant que vous n'avez pas confirmé le paiement.</p>
        </div>
      </section>
    </div>
  )
}
