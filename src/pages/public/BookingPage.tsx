import { AddressLink } from '../../components/AddressLink'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { BLOCK_REASON_MESSAGES } from '../../../shared/booking'
import type { PaymentMethod } from '../../../shared/constants'
import type { CreatedReservation, Guest, PublicEvent } from '../../../shared/types'
import { EventCover } from '../../components/EventCover'
import { PrivateMeta } from '../../components/PrivateMeta'
import { Button, LinkButton } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { cx } from '../../components/ui/cx'
import { Alert, EmptyState, ErrorState, PageLoader } from '../../components/ui/feedback'
import { TextField } from '../../components/ui/Field'
import { usePublicEvent, type EventMode } from '../../hooks/usePublicEvent'
import { useDocumentTitle } from '../../hooks/usePage'
import { accentFor, accentStyle } from '../../lib/accent'
import { api, ApiClientError, errorMessage } from '../../lib/api'
import { formatEuros, formatEventSchedule, formatPrice, upcomingDoorPrice } from '../../lib/format'
import { fr } from '../../lib/fr'
import { eventPath, invitePath, trackingPath } from '../../lib/links'

interface FormState {
  firstName: string
  lastName: string
  email: string
  phone: string
  quantity: number
  guests: Guest[]
  paymentMethod: PaymentMethod | null
}

const METHOD_INFO: Record<PaymentMethod, { label: string; icon: string; hint: string }> = {
  wero: { label: fr.payment.wero, icon: '📲', hint: 'Virement instantané depuis votre application bancaire' },
  paypal: { label: fr.payment.paypal, icon: '🅿️', hint: 'Via un lien PayPal.Me pré-rempli' },
  revolut: { label: fr.payment.revolut, icon: '💳', hint: 'Via un lien Revolut.me' },
}

function Stepper({ value, max, onChange, error }: { value: number; max: number; onChange: (n: number) => void; error: string | undefined }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-semibold">Nombre de places</legend>
      <div className="inline-flex w-fit items-center gap-1 rounded-full border border-line bg-paper p-1">
        <button
          type="button"
          aria-label="Retirer une place"
          disabled={value <= 1}
          onClick={() => onChange(value - 1)}
          className="grid size-11 place-items-center rounded-full text-xl font-bold text-brand-strong hover:bg-brand-soft disabled:opacity-35"
        >
          −
        </button>
        <output aria-live="polite" aria-invalid={error ? true : undefined} tabIndex={-1} className="min-w-12 text-center font-display text-2xl font-extrabold">{value}</output>
        <button
          type="button"
          aria-label="Ajouter une place"
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className="grid size-11 place-items-center rounded-full text-xl font-bold text-brand-strong hover:bg-brand-soft disabled:opacity-35"
        >
          +
        </button>
      </div>
      <p className="text-xs text-ink-muted">Maximum {max} place{max > 1 ? 's' : ''} pour cette réservation.</p>
      {error && <p className="text-sm font-medium text-bad">⚠ {error}</p>}
    </fieldset>
  )
}

function BookingForm({ event, mode, param }: { event: PublicEvent; mode: EventMode; param: string }) {
  const navigate = useNavigate()
  const formRef = useRef<HTMLFormElement>(null)
  const idempotencyKey = useRef(crypto.randomUUID())
  const [form, setForm] = useState<FormState>({
    firstName: '', lastName: '', email: '', phone: '', quantity: 1, guests: [], paymentMethod: event.paymentMethods[0] ?? null,
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [globalError, setGlobalError] = useState<{ tone: 'bad' | 'warn'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const paid = event.priceCents > 0
  const paymentUnavailable = paid && event.paymentMethods.length === 0
  const maxQuantity = Math.max(1, Math.min(event.maxPerBooking, event.remaining))
  const total = event.priceCents * form.quantity

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setFieldErrors((e) => (e[key] ? { ...e, [key]: '' } : e))
  }

  const setQuantity = (quantity: number) => {
    setForm((f) => ({
      ...f,
      quantity,
      guests: Array.from({ length: quantity - 1 }, (_, i) => f.guests[i] ?? { firstName: '', lastName: '' }),
    }))
    setFieldErrors((e) => (e.quantity ? { ...e, quantity: '' } : e))
  }

  const setGuest = (index: number, key: keyof Guest, value: string) => {
    setForm((f) => ({ ...f, guests: f.guests.map((g, i) => (i === index ? { ...g, [key]: value } : g)) }))
    const errorKey = `guests.${index}.${key}`
    setFieldErrors((e) => (e[errorKey] ? { ...e, [errorKey]: '' } : e))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setGlobalError(null)
    setFieldErrors({})
    try {
      const created = await api.post<CreatedReservation>(`/events/${event.id}/reservations`, {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        quantity: form.quantity,
        guests: form.guests,
        paymentMethod: paid ? form.paymentMethod : null,
        idempotencyKey: idempotencyKey.current,
      })
      navigate(trackingPath(created.accessToken), { replace: true })
    } catch (err) {
      setSubmitting(false)
      if (err instanceof ApiClientError) {
        if (Object.keys(err.fields).length > 0) {
          setFieldErrors(err.fields)
          setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0)
        }
        if (err.status === 409 || err.status === 429 || Object.keys(err.fields).length === 0) {
          setGlobalError({ tone: err.status === 409 || err.status === 429 ? 'warn' : 'bad', text: err.message })
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
        if (err.status === 409 && err.code !== 'duplicate_pending') idempotencyKey.current = crypto.randomUUID()
      } else {
        setGlobalError({ tone: 'bad', text: errorMessage(err) })
      }
    }
  }

  const backPath = mode === 'invite' ? invitePath(param) : eventPath(param)

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <Link to={backPath} className="inline-flex min-h-11 items-center gap-1 rounded-full text-sm font-semibold text-ink-soft hover:text-brand-strong">
        ← {fr.common.back} à l'événement
      </Link>
      <h1 className="mt-2 mb-6 text-3xl font-extrabold sm:text-4xl">Réserver ma place</h1>

      {globalError && <Alert tone={globalError.tone} className="mb-6">{globalError.text}</Alert>}

      <div className="grid gap-8 lg:grid-cols-[1fr_21rem]">
        <form ref={formRef} onSubmit={submit} noValidate className="space-y-6">
          <Card className="space-y-5">
            <h2 className="text-xl font-bold">Vos coordonnées</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField label="Prénom" required autoComplete="given-name" maxLength={80} value={form.firstName} error={fieldErrors.firstName || undefined} onChange={(e) => set('firstName', e.target.value)} />
              <TextField label="Nom" required autoComplete="family-name" maxLength={80} value={form.lastName} error={fieldErrors.lastName || undefined} onChange={(e) => set('lastName', e.target.value)} />
            </div>
            <TextField label="E-mail" type="email" required autoComplete="email" inputMode="email" value={form.email} error={fieldErrors.email || undefined} hint="Vos billets (QR codes) vous seront envoyés à cette adresse après confirmation du paiement. Aucun autre e-mail." onChange={(e) => set('email', e.target.value)} />
            <TextField label="Téléphone" type="tel" required autoComplete="tel" inputMode="tel" value={form.phone} error={fieldErrors.phone || undefined} onChange={(e) => set('phone', e.target.value)} />
            <Stepper value={form.quantity} max={maxQuantity} onChange={setQuantity} error={fieldErrors.quantity || undefined} />
          </Card>

          {form.quantity > 1 && (
            <Card className="space-y-5">
              <div>
                <h2 className="text-xl font-bold">Participants</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  Chaque place a son propre billet : indiquez le prénom et le nom de chaque personne. La place 1 est à votre nom.
                </p>
              </div>
              {fieldErrors.guests && <p className="text-sm font-medium text-bad">⚠ {fieldErrors.guests}</p>}
              {form.guests.map((guest, i) => (
                <fieldset key={i} className="space-y-3">
                  <legend className="mb-2 text-sm font-bold text-brand-strong">Place {i + 2} sur {form.quantity}</legend>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <TextField label="Prénom" required autoComplete="off" maxLength={80} value={guest.firstName} error={fieldErrors[`guests.${i}.firstName`] || undefined} onChange={(e) => setGuest(i, 'firstName', e.target.value)} />
                    <TextField label="Nom" required autoComplete="off" maxLength={80} value={guest.lastName} error={fieldErrors[`guests.${i}.lastName`] || undefined} onChange={(e) => setGuest(i, 'lastName', e.target.value)} />
                  </div>
                </fieldset>
              ))}
            </Card>
          )}

          {paid && (
            <Card className="space-y-4">
              <fieldset>
                <legend className="mb-1 text-xl font-bold">Moyen de paiement</legend>
                <p className="mb-4 text-sm text-ink-soft">
                  Le paiement se fait après la réservation, directement auprès de l'organisateur. Rien n'est débité ici.
                </p>
                {paymentUnavailable ? (
                  <Alert tone="warn" title="Paiement pas encore configuré">
                    L'organisateur n'a pas encore indiqué comment payer. Revenez un peu plus tard.
                  </Alert>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {event.paymentMethods.map((m, i) => (
                      <label
                        key={m}
                        className="relative flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-line bg-paper p-4 transition has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand/25"
                      >
                        <input
                          type="radio"
                          name="paymentMethod"
                          value={m}
                          checked={form.paymentMethod === m}
                          onChange={() => set('paymentMethod', m)}
                          aria-invalid={i === 0 && fieldErrors.paymentMethod ? true : undefined}
                          className="mt-1 size-5 accent-[var(--accent)]"
                        />
                        <span>
                          <span className="block font-bold"><span aria-hidden="true">{METHOD_INFO[m].icon} </span>{METHOD_INFO[m].label}</span>
                          <span className="block text-sm text-ink-soft">{METHOD_INFO[m].hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {fieldErrors.paymentMethod && <p className="mt-2 text-sm font-medium text-bad">⚠ {fieldErrors.paymentMethod}</p>}
              </fieldset>
              <p className="text-xs text-ink-muted">{fr.payment.reminder}</p>
            </Card>
          )}

          <div className="lg:hidden">
            <Summary event={event} quantity={form.quantity} total={total} />
          </div>

          <Button type="submit" size="lg" fullWidth loading={submitting} disabled={paymentUnavailable}>
            {paid ? `Réserver · ${formatEuros(total)}` : 'Réserver gratuitement'}
          </Button>
        </form>

        <aside className="hidden lg:sticky lg:top-6 lg:block lg:self-start" aria-label="Récapitulatif">
          <Summary event={event} quantity={form.quantity} total={total} />
        </aside>
      </div>
    </div>
  )
}

function Summary({ event, quantity, total }: { event: PublicEvent; quantity: number; total: number }) {
  const doorNotice = upcomingDoorPrice(event)
  return (
    <Card className="overflow-hidden p-0">
      <EventCover src={event.coverImageUrl} natural className="w-full bg-ink/5" />
      <div className="space-y-3 p-5">
        <h2 className="text-lg font-bold">{event.title}</h2>
        <p className="text-sm text-ink-soft">
          {formatEventSchedule(event.startsAt, event.endsAt)}
          <br /><span className="font-semibold text-ink">{event.location}</span>
          {event.address && <><br /><AddressLink address={event.address} /></>}
        </p>
        <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
          <div className="flex justify-between"><dt>Prix par place</dt><dd className="font-semibold">{formatPrice(event.priceCents)}</dd></div>
          <div className="flex justify-between"><dt>Places</dt><dd className="font-semibold">× {quantity}</dd></div>
          <div className="flex items-baseline justify-between border-t border-line pt-3 text-base">
            <dt className="font-bold">Total à régler</dt>
            <dd className={cx('font-display text-2xl font-extrabold', total === 0 && 'text-ok')}>{total === 0 ? 'Gratuit' : formatEuros(total)}</dd>
          </div>
        </dl>
        {doorNotice && <p className="text-xs text-ink-muted">Réservez maintenant au tarif ci-dessus : ensuite, {doorNotice}.</p>}
      </div>
    </Card>
  )
}

export default function BookingPage({ mode }: { mode: EventMode }) {
  const params = useParams()
  const param = (mode === 'slug' ? params.slug : params.inviteToken) ?? ''
  const { data: event, error, loading, reload } = usePublicEvent(mode, param)
  useDocumentTitle(event ? `Réserver · ${event.title}` : 'Réserver')

  if (loading && !event) return <PageLoader />
  if (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return <EmptyState icon="🔍" title={fr.event.notFoundTitle} text={fr.event.notFoundText} action={<LinkButton to="/">{fr.common.home}</LinkButton>} />
    }
    return <ErrorState message={errorMessage(error)} onRetry={reload} />
  }
  if (!event) return null

  const back = mode === 'invite' ? invitePath(param) : eventPath(param)
  if (event.blockReason) {
    return (
      <EmptyState
        icon="🚪"
        title="Réservation impossible"
        text={BLOCK_REASON_MESSAGES[event.blockReason]}
        action={<LinkButton to={back} variant="secondary">Voir l'événement</LinkButton>}
      />
    )
  }
  return (
    <div style={accentStyle(accentFor(event.id))}>
      <PrivateMeta />
      <BookingForm event={event} mode={mode} param={param} />
    </div>
  )
}
