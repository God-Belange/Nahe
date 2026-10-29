import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { PaymentSettings } from '../../../shared/types'
import { buildPaypalLink } from '../../../shared/paypal'
import { PageHeader } from '../../components/admin/PageHeader'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { TextAreaField, TextField } from '../../components/ui/Field'
import { Alert, ErrorState, Skeleton } from '../../components/ui/feedback'
import { useToast } from '../../components/ui/Toast'
import { useAsync } from '../../hooks/useAsync'
import { useDocumentTitle } from '../../hooks/usePage'
import { ApiClientError, api, errorMessage } from '../../lib/api'
import { fr } from '../../lib/fr'

interface FormState {
  weroInstructions: string
  weroQrImageUrl: string
  paypalMeUrl: string
  pendingTtlHours: string
}

const IMAGE_HINT = "Déposez d'abord le fichier dans public/images/ du dépôt, puis redéployez. Saisissez ici son chemin, par exemple /images/wero-qr.png."

function toForm(s: PaymentSettings): FormState {
  return {
    weroInstructions: s.weroInstructions,
    weroQrImageUrl: s.weroQrImageUrl ?? '',
    paypalMeUrl: s.paypalMeUrl ?? '',
    pendingTtlHours: String(s.pendingTtlHours),
  }
}

export default function SettingsPage() {
  useDocumentTitle('Paramètres de paiement')
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.get<PaymentSettings>('/admin/payment-settings'), [])
  const [form, setForm] = useState<FormState>({ weroInstructions: '', weroQrImageUrl: '', paypalMeUrl: '', pendingTtlHours: '24' })
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [formError, setFormError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [failedQr, setFailedQr] = useState<string>()

  useEffect(() => {
    if (data) setForm(toForm(data))
  }, [data])
  const qrFailed = failedQr !== undefined && failedQr === form.weroQrImageUrl

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(undefined)
    const ttl = Number(form.pendingTtlHours)
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 168) {
      setErrors({ pendingTtlHours: 'Entre 1 et 168 heures' })
      setFormError('Corrigez les champs signalés.')
      return
    }
    setErrors({})
    setSaving(true)
    try {
      const saved = await api.put<PaymentSettings>('/admin/payment-settings', {
        weroInstructions: form.weroInstructions,
        weroQrImageUrl: form.weroQrImageUrl.trim() === '' ? null : form.weroQrImageUrl.trim(),
        paypalMeUrl: form.paypalMeUrl.trim() === '' ? null : form.paypalMeUrl.trim(),
        pendingTtlHours: ttl,
      })
      setForm(toForm(saved))
      toast.show('Paramètres enregistrés')
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fields).length > 0) setErrors(err.fields)
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) {
    return <div aria-busy="true" className="space-y-4"><Skeleton className="h-12 w-72" /><Skeleton className="h-80" /></div>
  }
  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />

  const paypalPreview = form.paypalMeUrl.trim() ? buildPaypalLink(form.paypalMeUrl.trim(), 1000) : null
  const qr = form.weroQrImageUrl.trim()

  return (
    <>
      <PageHeader title="Paiements" subtitle="Ce que vos invités voient pour régler leur place. Aucune API : vous confirmez chaque paiement à la main." />
      <Alert tone="info" className="mb-6">{fr.payment.reminder}</Alert>

      <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-5">
        {formError && <Alert tone="bad">{formError}</Alert>}

        <Card className="space-y-4">
          <h2 className="text-xl font-bold">Wero</h2>
          <TextAreaField
            label="Instructions Wero"
            value={form.weroInstructions}
            error={errors.weroInstructions}
            onChange={(e) => set('weroInstructions', e.target.value)}
            maxLength={1000}
            placeholder="Envoyez le montant au 06 12 34 56 78 et indiquez la référence en motif."
            hint="Wero n'est proposé aux invités que si des instructions ou un QR code sont renseignés."
          />
          <TextField
            label="QR code Wero"
            optional
            placeholder="/images/wero-qr.png"
            value={form.weroQrImageUrl}
            error={errors.weroQrImageUrl}
            onChange={(e) => set('weroQrImageUrl', e.target.value)}
            hint={IMAGE_HINT}
          />
          {qr.startsWith('/images/') &&
            (qrFailed ? (
              <p className="text-sm text-warn">Aperçu indisponible : aucun fichier à cet emplacement (pour l'instant).</p>
            ) : (
              <img src={qr} alt="Aperçu du QR code Wero" onError={() => setFailedQr(form.weroQrImageUrl)} className="size-40 rounded-2xl border border-line bg-white object-contain p-2" />
            ))}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-xl font-bold">PayPal</h2>
          <TextField
            label="Lien PayPal.Me"
            optional
            type="url"
            placeholder="https://paypal.me/votrecompte"
            value={form.paypalMeUrl}
            error={errors.paypalMeUrl}
            onChange={(e) => set('paypalMeUrl', e.target.value)}
            hint="Domaine paypal.me uniquement. Le montant est ajouté automatiquement pour chaque réservation."
          />
          {paypalPreview && (
            <p className="text-sm text-ink-soft">
              Exemple pour 10 € :{' '}
              <a href={paypalPreview} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-brand-strong underline underline-offset-4">
                {paypalPreview}
              </a>
            </p>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-xl font-bold">Délai de paiement</h2>
          <TextField
            label="Expiration des réservations en attente (heures)"
            type="number"
            inputMode="numeric"
            min={1}
            max={168}
            required
            value={form.pendingTtlHours}
            error={errors.pendingTtlHours}
            onChange={(e) => set('pendingTtlHours', e.target.value)}
            hint="Passé ce délai sans confirmation, la réservation expire et libère ses places. S'applique aux nouvelles réservations."
          />
        </Card>

        <div className="flex justify-end">
          <Button type="submit" size="lg" loading={saving}>{fr.common.save}</Button>
        </div>
      </form>
    </>
  )
}
