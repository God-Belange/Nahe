import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { EventVisibility } from '../../../shared/constants'
import type { AdminEventDetail, EventTickets } from '../../../shared/types'
import { CoverImageField } from '../../components/admin/CoverImageField'
import { ConfirmModal } from '../../components/admin/ConfirmModal'
import { PageHeader } from '../../components/admin/PageHeader'
import { ShareButton } from '../../components/ShareButton'
import { Badge, EventBadge } from '../../components/ui/Badge'
import { Button, LinkButton } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { CopyButton } from '../../components/ui/CopyButton'
import { CheckboxField, TextAreaField, TextField } from '../../components/ui/Field'
import { Alert, ErrorState, Skeleton } from '../../components/ui/feedback'
import { useToast } from '../../components/ui/Toast'
import { useAsync } from '../../hooks/useAsync'
import { useDocumentTitle } from '../../hooks/usePage'
import { ApiClientError, api, errorMessage } from '../../lib/api'
import {
  centsToInput,
  formatEuros,
  isoToParisLocal,
  parseEurosToCents,
  parisLocalToIso,
} from '../../lib/format'
import { fr } from '../../lib/fr'
import { shareUrl } from '../../lib/links'
import { invitationText } from './EventsPage'

interface FormState {
  title: string
  description: string
  coverImageUrl: string
  location: string
  address: string
  startsAt: string
  endsAt: string
  bookingDeadline: string
  price: string
  capacity: string
  maxPerBooking: string
  showRemaining: boolean
  visibility: EventVisibility
  slug: string
  extraInfo: string
}

const EMPTY: FormState = {
  title: '',
  description: '',
  coverImageUrl: '',
  location: '',
  address: '',
  startsAt: '',
  endsAt: '',
  bookingDeadline: '',
  price: '',
  capacity: '20',
  maxPerBooking: '10',
  showRemaining: true,
  visibility: 'public',
  slug: '',
  extraInfo: '',
}

function toForm(e: AdminEventDetail): FormState {
  return {
    title: e.title,
    description: e.description,
    coverImageUrl: e.coverImageUrl ?? '',
    location: e.location,
    address: e.address,
    startsAt: isoToParisLocal(e.startsAt),
    endsAt: isoToParisLocal(e.endsAt),
    bookingDeadline: isoToParisLocal(e.bookingDeadline),
    price: centsToInput(e.priceCents),
    capacity: String(e.capacity),
    maxPerBooking: String(e.maxPerBooking),
    showRemaining: e.showRemaining,
    visibility: e.visibility,
    slug: e.slug,
    extraInfo: e.extraInfo,
  }
}

type Errors = Partial<Record<string, string>>

function buildPayload(form: FormState): { payload?: Record<string, unknown>; errors: Errors } {
  const errors: Errors = {}
  const priceCents = parseEurosToCents(form.price === '' ? '0' : form.price)
  if (priceCents === null) errors.priceCents = 'Montant invalide (ex. 12,50)'
  const startsAt = parisLocalToIso(form.startsAt)
  if (!startsAt) errors.startsAt = 'Ce champ est obligatoire'
  const endsAt = form.endsAt ? parisLocalToIso(form.endsAt) : null
  const bookingDeadline = form.bookingDeadline ? parisLocalToIso(form.bookingDeadline) : null
  const capacity = Number(form.capacity)
  if (!Number.isInteger(capacity) || capacity < 1) errors.capacity = 'Entier supérieur ou égal à 1'
  const maxPerBooking = Number(form.maxPerBooking)
  if (!Number.isInteger(maxPerBooking) || maxPerBooking < 1) errors.maxPerBooking = 'Entier supérieur ou égal à 1'
  if (form.title.trim() === '') errors.title = 'Ce champ est obligatoire'
  if (form.location.trim() === '') errors.location = 'Ce champ est obligatoire'
  if (Object.keys(errors).length > 0) return { errors }
  return {
    errors,
    payload: {
      title: form.title,
      description: form.description,
      coverImageUrl: form.coverImageUrl.trim() === '' ? null : form.coverImageUrl.trim(),
      location: form.location,
      address: form.address,
      startsAt,
      endsAt,
      bookingDeadline,
      priceCents,
      capacity,
      maxPerBooking,
      showRemaining: form.showRemaining,
      visibility: form.visibility,
      extraInfo: form.extraInfo,
      ...(form.slug.trim() !== '' ? { slug: form.slug.trim() } : {}),
    },
  }
}

type Action = 'publish' | 'unpublish' | 'close' | 'cancel'

const ACTIONS: Record<Action, { label: string; title: string; done: string; danger?: boolean; text: string }> = {
  publish: {
    label: 'Publier',
    title: "Publier l'événement ?",
    done: 'Événement publié',
    text: "Il sera visible et ouvert aux réservations (s'il est public, il apparaîtra sur l'accueil).",
  },
  unpublish: {
    label: 'Dépublier',
    title: "Repasser l'événement en brouillon ?",
    done: 'Événement repassé en brouillon',
    text: "Il ne sera plus accessible aux invités. Les réservations existantes restent consultables via leur lien de suivi.",
  },
  close: {
    label: 'Fermer les réservations',
    title: 'Fermer les réservations ?',
    done: 'Réservations fermées',
    text: "L'événement reste visible mais plus personne ne pourra réserver. Vous pourrez le republier pour rouvrir.",
  },
  cancel: {
    label: "Annuler l'événement",
    title: "Annuler l'événement ?",
    done: 'Événement annulé',
    danger: true,
    text: "Cette action est définitive.",
  },
}

function availableActions(status: AdminEventDetail['status']): Action[] {
  switch (status) {
    case 'draft': return ['publish', 'cancel']
    case 'published': return ['close', 'unpublish', 'cancel']
    case 'closed': return ['publish', 'unpublish', 'cancel']
    case 'cancelled': return []
  }
}

export default function EventFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  useDocumentTitle(isEdit ? "Modifier l'événement" : 'Nouvel événement')
  const navigate = useNavigate()
  const toast = useToast()

  const { data, error, loading, reload } = useAsync<AdminEventDetail | undefined>(
    () => (id ? api.get<AdminEventDetail>(`/admin/events/${id}`) : Promise.resolve(undefined)),
    [id],
  )
  const attendance = useAsync<EventTickets | undefined>(
    () => (id ? api.get<EventTickets>(`/admin/events/${id}/tickets`) : Promise.resolve(undefined)),
    [id],
  )
  const [detail, setDetail] = useState<AdminEventDetail>()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    if (data) {
      setDetail(data)
      setForm(toForm(data))
    } else if (!id) {
      setDetail(undefined)
      setForm(EMPTY)
    }
  }, [data, id])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(undefined)
    const built = buildPayload(form)
    setErrors(built.errors)
    if (!built.payload) {
      setFormError('Corrigez les champs signalés.')
      return
    }
    setSaving(true)
    try {
      if (id) {
        const updated = await api.patch<AdminEventDetail>(`/admin/events/${id}`, built.payload)
        setDetail(updated)
        setForm(toForm(updated))
        toast.show('Modifications enregistrées')
      } else {
        const created = await api.post<AdminEventDetail>('/admin/events', built.payload)
        toast.show('Événement créé (brouillon). Publiez-le quand vous êtes prêt !')
        navigate(`/admin/evenements/${created.id}`, { replace: true })
      }
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fields).length > 0) setErrors(err.fields)
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function runAction() {
    if (!action || !id) return
    setActing(true)
    try {
      const updated = await api.post<AdminEventDetail>(`/admin/events/${id}/${action}`)
      setDetail(updated)
      toast.show(ACTIONS[action].done)
      setAction(null)
    } catch (err) {
      toast.show(errorMessage(err), 'bad')
      setAction(null)
    } finally {
      setActing(false)
    }
  }

  if (isEdit && loading && !detail) {
    return (
      <div aria-busy="true" className="space-y-4">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-96" />
      </div>
    )
  }
  if (isEdit && error && !detail) return <ErrorState message={error.message} onRetry={reload} />

  const cancelled = detail?.status === 'cancelled'
  const priceCentsPreview = parseEurosToCents(form.price === '' ? '0' : form.price)

  return (
    <>
      <PageHeader
        title={isEdit ? (detail?.title ?? 'Événement') : 'Nouvel événement'}
        subtitle={isEdit ? undefined : 'Il sera créé en brouillon : publiez-le quand tout est prêt.'}
        actions={<LinkButton to="/admin/evenements" variant="secondary" size="sm">← Événements</LinkButton>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form onSubmit={onSubmit} noValidate className="space-y-5 order-2 lg:order-1">
          {formError && <Alert tone="bad">{formError}</Alert>}

          <Card className="space-y-4">
            <h2 className="text-xl font-bold">L'essentiel</h2>
            <TextField label="Titre" required value={form.title} error={errors.title} onChange={(e) => set('title', e.target.value)} maxLength={120} />
            <TextAreaField label="Description" value={form.description} error={errors.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
            <TextField label="Nom du lieu" required placeholder="Chez Sam, Salle des fêtes…" value={form.location} error={errors.location} onChange={(e) => set('location', e.target.value)} maxLength={200} />
            <TextField label="Adresse" optional placeholder="12 rue des Lilas, 59000 Lille" autoComplete="street-address" value={form.address} error={errors.address} onChange={(e) => set('address', e.target.value)} maxLength={300} />
            <CoverImageField value={form.coverImageUrl} error={errors.coverImageUrl} onChange={(url) => set('coverImageUrl', url)} />
          </Card>

          <Card className="space-y-4">
            <h2 className="text-xl font-bold">Date et horaires</h2>
            <p className="text-sm text-ink-muted">Heures saisies en heure de Paris.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Début" type="datetime-local" required value={form.startsAt} error={errors.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
              <TextField label="Fin" type="datetime-local" optional value={form.endsAt} error={errors.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
            </div>
            <TextField
              label="Date limite de réservation"
              type="datetime-local"
              optional
              value={form.bookingDeadline}
              error={errors.bookingDeadline}
              onChange={(e) => set('bookingDeadline', e.target.value)}
              hint="Doit précéder le début. Sans date limite, on peut réserver jusqu'au début de l'événement."
            />
          </Card>

          <Card className="space-y-4">
            <h2 className="text-xl font-bold">Prix et places</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                label="Prix par place (€)"
                inputMode="decimal"
                placeholder="0"
                value={form.price}
                error={errors.priceCents}
                onChange={(e) => set('price', e.target.value)}
                hint={priceCentsPreview === 0 ? 'Gratuit : réservations confirmées automatiquement.' : 'Le montant est figé à la réservation.'}
              />
              <TextField label="Capacité" type="number" inputMode="numeric" min={1} required value={form.capacity} error={errors.capacity} onChange={(e) => set('capacity', e.target.value)} />
              <TextField label="Max. par réservation" type="number" inputMode="numeric" min={1} required value={form.maxPerBooking} error={errors.maxPerBooking} onChange={(e) => set('maxPerBooking', e.target.value)} />
            </div>
            <CheckboxField
              label="Afficher le nombre de places restantes"
              hint="Décoché : les visiteurs ne voient pas le compteur, seule la mention « Complet » apparaît quand il n'y a plus de place."
              checked={form.showRemaining}
              onChange={(e) => set('showRemaining', e.target.checked)}
            />
          </Card>

          <Card className="space-y-4">
            <h2 className="text-xl font-bold">Visibilité</h2>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">Visibilité de l'événement</legend>
              {(
                [
                  ['public', '🌍 Public', "Listé sur l'accueil et accessible via son adresse."],
                  ['private', '🔒 Privé', "Non listé : accessible uniquement avec le lien d'invitation secret."],
                ] as const
              ).map(([value, title, text]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer gap-3 rounded-2xl border-2 p-4 transition has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${
                    form.visibility === value ? 'border-brand bg-brand-soft' : 'border-line hover:border-ink-muted'
                  }`}
                >
                  <input type="radio" name="visibility" value={value} checked={form.visibility === value} onChange={() => set('visibility', value)} className="mt-1 size-4 accent-[var(--accent)]" />
                  <span>
                    <span className="block font-bold">{title}</span>
                    <span className="block text-sm text-ink-soft">{text}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {errors.visibility && <p className="text-sm font-medium text-bad">⚠ {errors.visibility}</p>}
            <TextField
              label="Adresse personnalisée (slug)"
              optional
              placeholder="barbecue-chez-sam"
              value={form.slug}
              error={errors.slug}
              onChange={(e) => set('slug', e.target.value)}
              hint="Lettres minuscules, chiffres et tirets. Laissez vide pour la générer à partir du titre."
            />
            <TextAreaField label="Informations complémentaires" optional value={form.extraInfo} error={errors.extraInfo} onChange={(e) => set('extraInfo', e.target.value)} maxLength={2000} hint="Parking, ce qu'il faut apporter, code d'entrée…" />
          </Card>

          <div className="sticky bottom-0 -mx-4 flex justify-end gap-3 border-t border-line/70 bg-cream/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            <LinkButton to="/admin/evenements" variant="secondary">Annuler</LinkButton>
            <Button type="submit" loading={saving}>{isEdit ? 'Enregistrer' : "Créer l'événement"}</Button>
          </div>
        </form>

        {detail && (
          <aside className="order-1 space-y-4 lg:order-2" aria-label="État, partage et statistiques">
            <Card className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold">État</h2>
                <EventBadge status={detail.status} />
              </div>
              {availableActions(detail.status).length > 0 ? (
                <div className="flex flex-col gap-2">
                  {availableActions(detail.status).map((a) => (
                    <Button key={a} variant={a === 'publish' ? 'primary' : ACTIONS[a].danger ? 'danger' : 'secondary'} fullWidth onClick={() => setAction(a)}>
                      {ACTIONS[a].label}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-soft">Cet événement est annulé : plus aucune action possible.</p>
              )}
            </Card>

            <Card className="space-y-3">
              <h2 className="text-lg font-bold">Partage</h2>
              {detail.status === 'draft' && <p className="text-sm text-warn">Brouillon : le lien ne fonctionnera qu'une fois l'événement publié.</p>}
              <input
                readOnly
                aria-label="Lien de partage"
                value={shareUrl(detail)}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <CopyButton value={shareUrl(detail)} label="Copier le lien" />
                <ShareButton text={invitationText(detail)} />
              </div>
              {detail.visibility === 'private' && <Badge tone="brand">🔒 Lien secret : ne le publiez pas</Badge>}
            </Card>

            <Card className="space-y-3">
              <h2 className="text-lg font-bold">Places</h2>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-ok-soft p-2"><dt className="text-xs font-semibold text-ok">Confirmées</dt><dd className="text-2xl font-extrabold text-ok">{detail.confirmedPlaces}</dd></div>
                <div className="rounded-xl bg-warn-soft p-2"><dt className="text-xs font-semibold text-warn">En attente</dt><dd className="text-2xl font-extrabold text-warn">{detail.pendingPlaces}</dd></div>
                <div className="rounded-xl bg-brand-soft p-2"><dt className="text-xs font-semibold text-brand-strong">Restantes</dt><dd className="text-2xl font-extrabold text-brand-strong">{detail.remaining}</dd></div>
              </dl>
              <Link to={`/admin/reservations?eventId=${detail.id}`} className="inline-block text-sm font-semibold text-brand-strong underline underline-offset-4">
                Voir les réservations →
              </Link>
            </Card>

            <Card className="space-y-3">
              <h2 className="text-lg font-bold">Contrôle d'entrée</h2>
              {attendance.data && attendance.data.expected > 0 && (
                <p className="text-2xl font-extrabold" role="status">
                  {attendance.data.checkedIn} <span className="text-base font-semibold text-ink-soft">entrés /</span> {attendance.data.expected} <span className="text-base font-semibold text-ink-soft">attendus</span>
                </p>
              )}
              <LinkButton to={`/admin/scan?eventId=${detail.id}`} variant="soft" fullWidth>
                📷 Contrôle d'entrée
              </LinkButton>
            </Card>
          </aside>
        )}
      </div>

      {cancelled && detail && (
        <section className="mt-8" aria-label="Remboursements à traiter">
          <Alert tone="warn" title="Remboursements à traiter manuellement">
            Les paiements ne sont pas remboursés automatiquement. Remboursez ces participants depuis votre application Wero, PayPal ou Revolut.
          </Alert>
          {detail.refundsToProcess.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">Aucun paiement confirmé à rembourser.</p>
          ) : (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {detail.refundsToProcess.map((r) => (
                <li key={r.reservationId}>
                  <Card className="space-y-1 !p-4">
                    <p className="font-bold">{r.name}</p>
                    <p className="text-sm text-ink-soft">{r.email}</p>
                    <p className="text-sm">
                      <strong>{formatEuros(r.amountCents)}</strong> · {r.paymentMethod ? fr.payment[r.paymentMethod] : '—'} · <span className="font-mono">{r.reference}</span>
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ConfirmModal
        open={action !== null}
        title={action ? ACTIONS[action].title : ''}
        confirmLabel={action ? ACTIONS[action].label : ''}
        danger={action ? ACTIONS[action].danger : false}
        loading={acting}
        onConfirm={runAction}
        onClose={() => setAction(null)}
      >
        {action && <p>{ACTIONS[action].text}</p>}
        {action === 'cancel' && (
          <Alert tone="warn" title="Aucun remboursement automatique">
            Les paiements déjà reçus ne sont PAS remboursés : après l'annulation, la liste des remboursements à effectuer manuellement s'affichera sur cette page.
          </Alert>
        )}
      </ConfirmModal>
    </>
  )
}
