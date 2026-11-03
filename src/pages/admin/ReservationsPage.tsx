import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { RESERVATION_STATUSES } from '../../../shared/constants'
import type { AdminEvent, AdminReservation, AdminReservationsPage, MailResult, ReservationActionResult } from '../../../shared/types'
import { ConfirmModal } from '../../components/admin/ConfirmModal'
import { PageHeader } from '../../components/admin/PageHeader'
import { ShareButton } from '../../components/ShareButton'
import { Badge, ReservationBadge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { CopyButton } from '../../components/ui/CopyButton'
import { SelectField, TextField } from '../../components/ui/Field'
import { Alert, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { useAsync } from '../../hooks/useAsync'
import { useDocumentTitle } from '../../hooks/usePage'
import { api, errorMessage } from '../../lib/api'
import { formatEuros, formatFullDate } from '../../lib/format'
import { fr } from '../../lib/fr'
import { trackingUrl } from '../../lib/links'

type Status = (typeof RESERVATION_STATUSES)[number]
const STATUS_OPTIONS: Status[] = ['pending', 'confirmed', 'cancelled', 'expired']

function mailToast(result: MailResult | undefined, email: string, confirmed: boolean): { text: string; tone: 'ok' | 'bad' | 'info' } {
  const prefix = confirmed ? 'Paiement confirmé — ' : ''
  switch (result) {
    case 'sent':
      return { text: confirmed ? `Paiement confirmé — billets envoyés à ${email}` : `Billets renvoyés à ${email}`, tone: 'ok' }
    case 'failed':
      return { text: `${prefix}Échec de l'envoi : réessayez plus tard. Les billets restent disponibles sur le lien de suivi.`, tone: 'bad' }
    case 'not_configured':
      return { text: `${prefix}Envoi d'e-mails non configuré (clé Brevo absente). Les billets restent visibles sur le lien de suivi.`, tone: 'info' }
    case 'quota':
      return { text: `${prefix}Quota d'envoi atteint pour aujourd'hui. Les billets restent disponibles sur le lien de suivi.`, tone: 'bad' }
    default:
      return { text: confirmed ? 'Paiement confirmé' : 'Billets traités', tone: 'ok' }
  }
}

function reminderToast(result: MailResult | undefined, email: string): { text: string; tone: 'ok' | 'bad' | 'info' } {
  switch (result) {
    case 'sent':
      return { text: `Relance envoyée à ${email}`, tone: 'ok' }
    case 'not_configured':
      return { text: "Envoi d'e-mails non configuré (clé Brevo absente) : aucune relance envoyée.", tone: 'info' }
    case 'quota':
      return { text: "Quota d'envoi atteint pour aujourd'hui : réessayez plus tard.", tone: 'bad' }
    default:
      return { text: "Échec de l'envoi : réessayez plus tard. Le lien de suivi actuel reste valide.", tone: 'bad' }
  }
}

const methodLabel = (r: AdminReservation) => (r.paymentMethod ? fr.payment[r.paymentMethod] : '—')

type Pending = { kind: 'confirm' | 'cancel' | 'delete' | 'remind'; reservation: AdminReservation }

export default function ReservationsPage() {
  useDocumentTitle('Réservations')
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const eventId = params.get('eventId') ?? ''
  const status = params.get('status') ?? ''
  const urlQ = params.get('q') ?? ''

  const [q, setQ] = useState(urlQ)
  useEffect(() => {
    if (q === urlQ) return
    const t = setTimeout(() => updateParam('q', q), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  function updateParam(key: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  const qs = new URLSearchParams()
  if (urlQ) qs.set('q', urlQ)
  if (eventId) qs.set('eventId', eventId)
  if (status) qs.set('status', status)
  const query = qs.toString()

  const events = useAsync(() => api.get<AdminEvent[]>('/admin/events'), [])
  const list = useAsync(() => api.get<AdminReservationsPage>(`/admin/reservations${query ? `?${query}` : ''}`), [query])

  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [regen, setRegen] = useState<{ reservation: AdminReservation; link: string } | null>(null)

  async function runPending() {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.kind === 'delete') {
        await api.delete(`/admin/reservations/${pending.reservation.id}`)
        toast.show('Réservation supprimée')
      } else if (pending.kind === 'remind') {
        const res = await api.post<ReservationActionResult>(`/admin/reservations/${pending.reservation.id}/remind`)
        const m = reminderToast(res.reminderEmail, pending.reservation.email)
        toast.show(m.text, m.tone)
      } else if (pending.kind === 'confirm') {
        const res = await api.post<ReservationActionResult>(`/admin/reservations/${pending.reservation.id}/confirm`)
        const m = mailToast(res.ticketsEmail, pending.reservation.email, true)
        toast.show(m.text, m.tone)
      } else {
        await api.post<ReservationActionResult>(`/admin/reservations/${pending.reservation.id}/cancel`)
        toast.show('Réservation annulée')
      }
      setPending(null)
      list.reload()
    } catch (err) {
      toast.show(errorMessage(err), 'bad')
      setPending(null)
      list.reload()
    } finally {
      setBusy(false)
    }
  }

  async function resend(r: AdminReservation) {
    try {
      const res = await api.post<ReservationActionResult>(`/admin/reservations/${r.id}/resend-tickets`)
      const m = mailToast(res.ticketsEmail, r.email, false)
      toast.show(m.text, m.tone)
      list.reload()
    } catch (err) {
      toast.show(errorMessage(err), 'bad')
    }
  }

  async function regenerate(r: AdminReservation) {
    try {
      const res = await api.post<{ accessToken: string }>(`/admin/reservations/${r.id}/regenerate-link`)
      setRegen({ reservation: r, link: trackingUrl(res.accessToken) })
    } catch (err) {
      toast.show(errorMessage(err), 'bad')
    }
  }

  const data = list.data
  const filtered = Boolean(urlQ || eventId || status)

  return (
    <>
      <PageHeader
        title="Réservations"
        subtitle="Vérifiez les paiements dans votre application Wero, PayPal ou Revolut, puis confirmez-les ici."
        actions={
          <a
            href={`/api/admin/reservations.csv${query ? `?${query}` : ''}`}
            className="inline-flex min-h-9 items-center justify-center rounded-full border border-line bg-paper px-4 text-sm font-semibold hover:border-ink-muted"
          >
            ⬇ Exporter en CSV
          </a>
        }
      />

      <div className="mb-5 grid gap-3 rounded-[var(--radius-card)] border border-line/70 bg-paper p-4 shadow-card sm:grid-cols-[2fr_1.5fr_1fr]">
        <TextField label="Rechercher" type="search" placeholder="Nom, e-mail ou référence" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectField label="Événement" value={eventId} onChange={(e) => updateParam('eventId', e.target.value)}>
          <option value="">Tous les événements</option>
          {events.data?.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
        </SelectField>
        <SelectField label="Statut" value={status} onChange={(e) => updateParam('status', e.target.value)}>
          <option value="">Tous</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{fr.status.reservation[s]}</option>)}
        </SelectField>
      </div>

      {list.loading && !data && (
        <div aria-busy="true" className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      )}
      {list.error && !data && <ErrorState message={list.error.message} onRetry={list.reload} />}

      {data && (
        <>
          <p className="mb-3 text-sm font-semibold text-ink-soft" role="status" aria-live="polite">
            {data.total} réservation{data.total > 1 ? 's' : ''}{filtered ? ' (filtrées)' : ''}
            {data.total > data.items.length && ` — ${data.items.length} affichées`}
          </p>
          {data.items.length === 0 ? (
            <EmptyState
              icon="🔎"
              title={filtered ? 'Aucun résultat' : 'Aucune réservation pour le moment'}
              text={filtered ? 'Essayez de modifier ou de retirer vos filtres.' : 'Les réservations apparaîtront ici dès que vos invités réserveront.'}
            />
          ) : (
            <>
              <ul className="space-y-3 md:hidden">
                {data.items.map((r) => (
                  <li key={r.id} className="space-y-3 rounded-[var(--radius-card)] border border-line/70 bg-paper p-4 shadow-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold">{r.firstName} {r.lastName}</p>
                        <p className="truncate text-sm text-ink-soft">{r.email}</p>
                        {r.phone && <p className="text-sm text-ink-soft">{r.phone}</p>}
                        {r.guests.length > 0 && <p className="text-sm text-ink-soft">+ {r.guests.map((g) => `${g.firstName} ${g.lastName}`).join(', ')}</p>}
                      </div>
                      <ReservationBadge status={r.status} />
                    </div>
                    <p className="text-sm text-ink-soft">{r.eventTitle}</p>
                    <p className="text-sm">
                      <strong>{r.quantity}</strong> place{r.quantity > 1 ? 's' : ''} · <strong>{formatEuros(r.totalAmountCents)}</strong> · {methodLabel(r)}
                    </p>
                    <p className="text-xs text-ink-muted"><span className="font-mono">{r.reference}</span> · {formatFullDate(r.createdAt)}</p>
                    {r.paymentDeclaredAt && r.status === 'pending' && <Badge tone="sun">💸 Paiement déclaré</Badge>}
                    <TicketsMail r={r} /><ReminderMail r={r} />
                    <RowActions r={r} onConfirm={() => setPending({ kind: 'confirm', reservation: r })} onCancel={() => setPending({ kind: 'cancel', reservation: r })} onDelete={() => setPending({ kind: 'delete', reservation: r })} onRemind={() => setPending({ kind: 'remind', reservation: r })} onRegen={() => regenerate(r)} onResend={() => resend(r)} />
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line/70 bg-paper shadow-card md:block">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Liste des réservations</caption>
                  <thead className="bg-cream text-ink-soft">
                    <tr>
                      {['Participant', 'Événement', 'Places', 'Montant', 'Statut', 'Réservé le', 'Actions'].map((h) => (
                        <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {data.items.map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="px-4 py-3">
                          <p className="font-bold">{r.firstName} {r.lastName}</p>
                          <p className="text-ink-soft">{r.email}</p>
                          {r.phone && <p className="text-ink-soft">{r.phone}</p>}
                          {r.guests.length > 0 && <p className="text-ink-soft">+ {r.guests.map((g) => `${g.firstName} ${g.lastName}`).join(', ')}</p>}
                          <p className="mt-1 font-mono text-xs text-ink-muted">{r.reference}</p>
                        </td>
                        <td className="px-4 py-3">{r.eventTitle}</td>
                        <td className="px-4 py-3">{r.quantity}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{formatEuros(r.totalAmountCents)}</p>
                          <p className="text-ink-muted">{methodLabel(r)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1.5">
                            <ReservationBadge status={r.status} />
                            {r.paymentDeclaredAt && r.status === 'pending' && <Badge tone="sun">💸 Paiement déclaré</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-ink-soft">{formatFullDate(r.createdAt)}</td>
                        <td className="px-4 py-3">
                          <TicketsMail r={r} /><ReminderMail r={r} />
                          <RowActions r={r} onConfirm={() => setPending({ kind: 'confirm', reservation: r })} onCancel={() => setPending({ kind: 'cancel', reservation: r })} onDelete={() => setPending({ kind: 'delete', reservation: r })} onRemind={() => setPending({ kind: 'remind', reservation: r })} onRegen={() => regenerate(r)} onResend={() => resend(r)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <ConfirmModal
        open={pending !== null}
        title={pending?.kind === 'confirm' ? 'Confirmer le paiement ?' : pending?.kind === 'remind' ? 'Relancer par e-mail ?' : pending?.kind === 'delete' ? 'Supprimer la réservation ?' : 'Annuler la réservation ?'}
        confirmLabel={pending?.kind === 'confirm' ? 'Oui, paiement reçu' : pending?.kind === 'remind' ? 'Envoyer la relance' : pending?.kind === 'delete' ? 'Supprimer définitivement' : 'Annuler la réservation'}
        danger={pending?.kind !== 'confirm' && pending?.kind !== 'remind'}
        loading={busy}
        onConfirm={runPending}
        onClose={() => setPending(null)}
      >
        {pending && (
          <>
            <p>
              <strong>{pending.reservation.firstName} {pending.reservation.lastName}</strong> · {pending.reservation.quantity} place{pending.reservation.quantity > 1 ? 's' : ''} · {formatEuros(pending.reservation.totalAmountCents)}
            </p>
            {pending.kind === 'confirm' ? (
              <>
              <Alert tone="info">
                Vérifiez d'abord dans votre application {pending.reservation.paymentMethod ? fr.payment[pending.reservation.paymentMethod] : 'de paiement'} que{' '}
                {formatEuros(pending.reservation.totalAmountCents)} ont bien été reçus avec la référence <strong className="font-mono">{pending.reservation.reference}</strong>.
              </Alert>
              <p className="mt-3">
                Les billets (un QR code par place) seront générés et envoyés par e-mail à {pending.reservation.email}.
              </p>
              </>
            ) : pending.kind === 'remind' ? (
              <>
                <p>
                  Un e-mail de rappel avec le montant à régler et un lien pour payer sera envoyé à {pending.reservation.email}.
                </p>
                <Alert tone="info" className="mt-3">
                  Ce message contient un nouveau lien de suivi : celui de l'e-mail précédent ne fonctionnera plus. Le texte se modifie dans « E-mails ».
                </Alert>
              </>
            ) : pending.kind === 'delete' ? (
              <p>
                La réservation <span className="font-mono">{pending.reservation.reference}</span> sera supprimée <strong>définitivement</strong>, ainsi que ses billets et son lien de suivi. Cette action est irréversible.
              </p>
            ) : (
              <p>
                Les places seront libérées.
                {pending.reservation.status === 'confirmed' && pending.reservation.totalAmountCents > 0 && (
                  <> Le paiement déjà reçu <strong>n'est pas remboursé automatiquement</strong> : pensez à le rembourser vous-même.</>
                )}
              </p>
            )}
          </>
        )}
      </ConfirmModal>

      <Modal
        open={regen !== null}
        onClose={() => setRegen(null)}
        title="Nouveau lien de suivi"
        footer={<Button onClick={() => setRegen(null)}>Terminé</Button>}
      >
        {regen && (
          <div className="space-y-4">
            <Alert tone="warn" title="L'ancien lien est désormais invalide">
              Transmettez ce nouveau lien à {regen.reservation.firstName}. Il ne sera plus affiché ensuite.
            </Alert>
            <input readOnly aria-label="Nouveau lien de suivi" value={regen.link} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm" />
            <div className="flex flex-wrap gap-2">
              <CopyButton value={regen.link} label="Copier le lien" />
              <ShareButton text={`Voici ton nouveau lien de suivi Nahe? pour ta réservation ${regen.reservation.reference} : ${regen.link}`} />
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

function TicketsMail({ r }: { r: AdminReservation }) {
  if (r.status !== 'confirmed') return null
  return (
    <p className="my-2 text-xs font-semibold">
      {r.ticketsEmailedAt ? (
        <span className="text-ok">✉ Billets envoyés le {formatFullDate(r.ticketsEmailedAt)}</span>
      ) : (
        <span className="text-warn">⚠ Billets non envoyés</span>
      )}
    </p>
  )
}

function ReminderMail({ r }: { r: AdminReservation }) {
  if (r.status !== 'pending' || !r.remindedAt) return null
  return <p className="my-2 text-xs font-semibold text-ink-soft">✉ Relancé le {formatFullDate(r.remindedAt)}</p>
}

function RowActions({ r, onConfirm, onCancel, onDelete, onRemind, onRegen, onResend }: { r: AdminReservation; onConfirm: () => void; onCancel: () => void; onDelete: () => void; onRemind: () => void; onRegen: () => void; onResend: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {r.status === 'pending' && <Button size="sm" onClick={onConfirm}>Confirmer le paiement</Button>}
      {r.status === 'pending' && <Button size="sm" variant="soft" onClick={onRemind}>Relancer</Button>}
      {r.status === 'confirmed' && <Button size="sm" variant="soft" onClick={onResend}>Renvoyer les billets</Button>}
      {(r.status === 'pending' || r.status === 'confirmed') && <Button size="sm" variant="secondary" onClick={onCancel}>Annuler</Button>}
      {(r.status === 'cancelled' || r.status === 'expired') && <Button size="sm" variant="secondary" onClick={onDelete}>Supprimer</Button>}
      <Button size="sm" variant="ghost" onClick={onRegen}>Nouveau lien</Button>
    </div>
  )
}
