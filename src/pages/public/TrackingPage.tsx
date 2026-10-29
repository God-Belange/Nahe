import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { PaymentInstructions, ReservationView, TicketView } from '../../../shared/types'
import { PrivateMeta } from '../../components/PrivateMeta'
import { TicketBadge } from '../../components/TicketBadge'
import { TicketQr } from '../../components/TicketQr'
import { ReservationBadge } from '../../components/ui/Badge'
import { Button, LinkButton } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { CopyButton } from '../../components/ui/CopyButton'
import { cx } from '../../components/ui/cx'
import { Alert, EmptyState, ErrorState, PageLoader } from '../../components/ui/feedback'
import { useToast } from '../../components/ui/Toast'
import { useAsync } from '../../hooks/useAsync'
import { useDocumentTitle } from '../../hooks/usePage'
import { accentFor, accentStyle } from '../../lib/accent'
import { api, ApiClientError, errorMessage } from '../../lib/api'
import { formatEuros, formatEventDate, formatRemaining } from '../../lib/format'
import { fr } from '../../lib/fr'
import { eventPath, trackingUrl, whatsappUrl } from '../../lib/links'
import { ticketPath } from '../../lib/tickets'

function useTick(ms: number) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

function Reference({ value }: { value: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="rounded-xl bg-brand-soft px-4 py-2 font-mono text-2xl font-bold tracking-wider text-brand-strong select-all">{value}</span>
      <CopyButton value={value} label="Copier la référence" />
    </div>
  )
}

function PaymentBlock({ payment, token, declaredAt, onDeclared }: { payment: PaymentInstructions; token: string; declaredAt: string | null; onDeclared: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function declare() {
    setBusy(true)
    try {
      await api.post(`/reservations/${encodeURIComponent(token)}/declare-payment`)
      toast.show("Merci ! L'organisateur a été prévenu.")
      onDeclared()
    } catch (err) {
      toast.show(errorMessage(err), 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-5 border-2 border-brand/30">
      <h2 className="text-2xl font-bold">Comment payer {formatEuros(payment.amountCents)}</h2>

      {payment.method === 'wero' ? (
        <div className="space-y-4">
          <p className="text-sm font-bold tracking-wide text-ink-muted uppercase">Paiement par Wero</p>
          {payment.weroInstructions && <p className="leading-relaxed whitespace-pre-line">{payment.weroInstructions}</p>}
          {payment.weroQrImageUrl && (
            <img
              src={payment.weroQrImageUrl}
              alt="QR code Wero de l'organisateur à scanner avec votre application bancaire"
              className="size-52 rounded-2xl border border-line bg-white object-contain p-2"
            />
          )}
          <p>Montant à envoyer : <strong className="font-display text-xl">{formatEuros(payment.amountCents)}</strong></p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-bold tracking-wide text-ink-muted uppercase">Paiement par PayPal</p>
          {payment.paypalUrl ? (
            <LinkButton href={payment.paypalUrl} size="lg" fullWidth>
              Payer {formatEuros(payment.amountCents)} avec PayPal ↗
            </LinkButton>
          ) : (
            <Alert tone="warn">Le lien PayPal n'est pas disponible. Contactez l'organisateur.</Alert>
          )}
          <p className="text-sm text-ink-soft">Le lien s'ouvre dans un nouvel onglet avec le montant déjà indiqué.</p>
        </div>
      )}

      <div className="space-y-2 rounded-2xl bg-cream p-4">
        <p className="text-sm font-semibold">Indiquez cette référence dans le motif du paiement :</p>
        <Reference value={payment.reference} />
      </div>

      <p className="text-xs text-ink-muted">{fr.payment.reminder}</p>

      <div className="border-t border-line pt-4">
        {declaredAt ? (
          <Alert tone="ok" title="Paiement signalé à l'organisateur">
            En attente de sa vérification : votre réservation sera confirmée dès qu'il aura constaté le paiement.
          </Alert>
        ) : (
          <div className="space-y-2">
            <Button variant="soft" size="lg" fullWidth loading={busy} onClick={declare}>J'ai payé</Button>
            <p className="text-xs text-ink-muted">
              Ce bouton prévient simplement l'organisateur. Il ne confirme pas la réservation : celle-ci l'est uniquement après sa vérification.
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}

function TicketsSection({ view }: { view: ReservationView }) {
  const [enlarged, setEnlarged] = useState<TicketView | null>(null)
  const plural = view.tickets.length > 1
  return (
    <section aria-labelledby="billets" className="space-y-4">
      <div>
        <h2 id="billets" className="text-2xl font-bold">
          <span aria-hidden="true">🎟️ </span>{plural ? 'Vos billets' : 'Votre billet'}
        </h2>
        <p className="text-sm text-ink-soft">1 billet par personne. Présentez un QR code par personne à l'entrée. Un billet = une seule entrée.</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {view.tickets.map((t) => (
          <li key={t.token}>
            <Card className="space-y-3 text-center">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-bold">Billet {t.seq} / {t.total}</h3>
                <TicketBadge state={t.state} />
              </div>
              <TicketQr token={t.token} seq={t.seq} total={t.total} state={t.state} maxWidth="14rem" />
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="soft" size="sm" onClick={() => setEnlarged(t)}>Agrandir</Button>
                <LinkButton to={ticketPath(t.token)} variant="secondary" size="sm">Ouvrir la page du billet</LinkButton>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-muted">
        Les billets vous sont aussi envoyés par e-mail à {view.email} ; vérifiez vos courriers indésirables si besoin. Ils restent toujours disponibles ici.
      </p>
      <Modal
        open={enlarged !== null}
        onClose={() => setEnlarged(null)}
        title={enlarged ? `Billet ${enlarged.seq} / ${enlarged.total}` : 'Billet'}
      >
        {enlarged && (
          <div className="space-y-3 text-center">
            <TicketQr token={enlarged.token} seq={enlarged.seq} total={enlarged.total} state={enlarged.state} maxWidth="min(80vw, 22rem)" />
            <TicketBadge state={enlarged.state} />
            <p className="text-sm text-ink-soft">Augmentez la luminosité de l'écran avant de présenter le QR code.</p>
          </div>
        )}
      </Modal>
    </section>
  )
}

function KeepLink({ view, url }: { view: ReservationView; url: string }) {
  return (
    <Card className="space-y-3 border-2 border-dashed border-sun bg-sun/15">
      <h2 className="text-lg font-bold"><span aria-hidden="true">🔖 </span>Conservez ce lien</h2>
      <p className="text-sm text-ink-soft">
        Ce lien est le seul moyen de retrouver votre réservation (il n'est jamais envoyé par e-mail). Gardez-le en favori ou envoyez-le-vous.
        Il est secret, ne le partagez pas.
      </p>
      <p className="rounded-xl bg-paper px-3 py-2 font-mono text-xs break-all select-all">{url}</p>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={url} label="Copier le lien" size="md" variant="soft" />
        <LinkButton
          href={whatsappUrl(`Mon lien de suivi Nahe? pour « ${view.event.title} » (${view.reference}) : ${url}`)}
          variant="secondary"
        >
          <span aria-hidden="true">💬</span> M'envoyer ce lien
        </LinkButton>
      </div>
    </Card>
  )
}

export default function TrackingPage() {
  const { accessToken = '' } = useParams()
  const { data: view, error, loading, reload } = useAsync(
    () => api.get<ReservationView>(`/reservations/${encodeURIComponent(accessToken)}`),
    [accessToken],
  )
  useTick(30_000)
  useDocumentTitle(view ? `Réservation ${view.reference}` : 'Ma réservation')

  if (loading && !view) return <><PrivateMeta /><PageLoader /></>
  if (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return (
        <>
          <PrivateMeta />
          <EmptyState
            icon="🔒"
            title="Lien de suivi invalide"
            text="Ce lien est incorrect ou a été remplacé. Si vous l'avez perdu, demandez-en un nouveau à l'organisateur."
            action={<LinkButton to="/">{fr.common.home}</LinkButton>}
          />
        </>
      )
    }
    return <><PrivateMeta /><ErrorState message={errorMessage(error)} onRetry={reload} /></>
  }
  if (!view) return null

  const url = trackingUrl(accessToken)
  const expired = view.status === 'expired'
  const hero: Record<string, { icon: string; title: string; text: string }> = {
    pending: { icon: '⏳', title: 'Réservation enregistrée', text: 'Plus qu\'une étape : le paiement. Vos places sont gardées pour vous le temps du délai indiqué.' },
    confirmed: { icon: '🎉', title: 'C\'est confirmé !', text: 'Votre place est réservée. On se retrouve bientôt !' },
    cancelled: { icon: '🫥', title: 'Réservation annulée', text: 'Cette réservation a été annulée. Les places ont été libérées.' },
    expired: { icon: '⌛', title: 'Réservation expirée', text: 'Le délai de paiement est dépassé : les places ont été libérées.' },
  }
  const h = hero[view.status] ?? hero.pending!

  return (
    <div style={accentStyle(accentFor(view.event.slug))} className="mx-auto max-w-2xl space-y-6 px-4 pb-16 sm:px-6">
      <PrivateMeta />
      <header className="animate-rise pt-2 text-center">
        <div className="text-5xl" aria-hidden="true">{h.icon}</div>
        <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">{h.title}</h1>
        <p className="mx-auto mt-2 max-w-md text-ink-soft">{h.text}</p>
      </header>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold">{view.event.title}</h2>
            <p className="text-sm text-ink-soft">{formatEventDate(view.event.startsAt)} · {view.event.location}</p>
          </div>
          <ReservationBadge status={view.status} />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-bold tracking-wide text-ink-muted uppercase">Référence</p>
          <Reference value={view.reference} />
        </div>
        <dl className="grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm">
          <div><dt className="text-ink-muted">Au nom de</dt><dd className="font-semibold">{view.firstName} {view.lastName}</dd></div>
          <div><dt className="text-ink-muted">Places</dt><dd className="font-semibold">{view.quantity}</dd></div>
          <div>
            <dt className="text-ink-muted">Montant total</dt>
            <dd className="font-display text-xl font-extrabold">{view.totalAmountCents === 0 ? 'Gratuit' : formatEuros(view.totalAmountCents)}</dd>
          </div>
          {view.paymentMethod && (
            <div><dt className="text-ink-muted">Moyen de paiement</dt><dd className="font-semibold">{fr.payment[view.paymentMethod]}</dd></div>
          )}
        </dl>
        {view.status === 'pending' && view.expiresAt && (
          <Alert tone="warn">
            Paiement attendu dans les <strong>{formatRemaining(view.expiresAt)}</strong>. Passé ce délai, la réservation expire et les places sont libérées.
          </Alert>
        )}
      </Card>

      {view.status === 'pending' && view.payment && (
        <PaymentBlock payment={view.payment} token={accessToken} declaredAt={view.paymentDeclaredAt} onDeclared={reload} />
      )}

      {(view.status === 'cancelled' || expired) && (
        <div className="text-center">
          <LinkButton to={view.event.status === 'published' ? eventPath(view.event.slug) : '/'} size="lg">
            Refaire une réservation
          </LinkButton>
        </div>
      )}

      {view.status === 'confirmed' && view.totalAmountCents > 0 && (
        <Alert tone="ok" title="Paiement vérifié par l'organisateur" />
      )}

      {view.status === 'confirmed' && view.tickets.length > 0 && <TicketsSection view={view} />}

      <KeepLink view={view} url={url} />

      <p className={cx('text-center text-sm text-ink-muted')}>
        <Link to="/confidentialite" className="underline underline-offset-4 hover:text-brand-strong">Politique de confidentialité</Link>
      </p>
    </div>
  )
}
