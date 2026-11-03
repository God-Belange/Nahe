import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_LABELS,
  EMAIL_TEMPLATE_LIMITS,
  EMAIL_VARIABLES,
  capitalizeFirst,
  fillPlaceholders,
  renderPlainText,
  sampleValues,
} from '../../../shared/email-templates'
import type { EmailTemplateContent } from '../../../shared/email-templates'
import type { EmailTemplateView } from '../../../shared/types'
import { RichText } from '../../components/RichText'
import { ConfirmModal } from '../../components/admin/ConfirmModal'
import { PageHeader } from '../../components/admin/PageHeader'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { TextAreaField, TextField } from '../../components/ui/Field'
import { Alert, ErrorState, Skeleton } from '../../components/ui/feedback'
import { useToast } from '../../components/ui/Toast'
import { useAsync } from '../../hooks/useAsync'
import { useDocumentTitle } from '../../hooks/usePage'
import { ApiClientError, api, errorMessage } from '../../lib/api'

function TemplateEditor({ template, onChange }: { template: EmailTemplateView; onChange: (t: EmailTemplateView) => void }) {
  const toast = useToast()
  const { kind } = template
  const label = EMAIL_TEMPLATE_LABELS[kind]
  const [form, setForm] = useState<EmailTemplateContent>({ subject: template.subject, intro: template.intro, footer: template.footer })
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [formError, setFormError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    setForm({ subject: template.subject, intro: template.intro, footer: template.footer })
  }, [template])

  const set = <K extends keyof EmailTemplateContent>(key: K, value: string) => setForm((f) => ({ ...f, [key]: value }))
  const isDefault = form.subject === DEFAULT_EMAIL_TEMPLATES[kind].subject
    && form.intro === DEFAULT_EMAIL_TEMPLATES[kind].intro
    && form.footer === DEFAULT_EMAIL_TEMPLATES[kind].footer
  const dirty = form.subject !== template.subject || form.intro !== template.intro || form.footer !== template.footer

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(undefined)
    setErrors({})
    setSaving(true)
    try {
      const saved = await api.put<EmailTemplateView>(`/admin/email-templates/${kind}`, form)
      onChange(saved)
      toast.show('Modèle enregistré')
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fields).length > 0) setErrors(err.fields)
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    setSaving(true)
    try {
      onChange(await api.delete<EmailTemplateView>(`/admin/email-templates/${kind}`))
      setErrors({})
      setFormError(undefined)
      toast.show('Texte par défaut rétabli')
      setConfirmReset(false)
    } catch (err) {
      setConfirmReset(false)
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const sample = sampleValues(kind)

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">{label.title}</h2>
        <p className="mt-1 text-sm text-ink-soft">{label.description}</p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="bad">{formError}</Alert>}
        <TextField
          label="Objet"
          required
          value={form.subject}
          error={errors.subject}
          onChange={(e) => set('subject', e.target.value)}
          maxLength={EMAIL_TEMPLATE_LIMITS.subject}
        />
        <TextAreaField
          label="Introduction"
          required
          value={form.intro}
          error={errors.intro}
          onChange={(e) => set('intro', e.target.value)}
          maxLength={EMAIL_TEMPLATE_LIMITS.intro}
          hint="Une ligne = un paragraphe. Entourez un mot de **deux astérisques** pour le mettre en gras."
        />
        <TextAreaField
          label="Conclusion"
          optional
          value={form.footer}
          error={errors.footer}
          onChange={(e) => set('footer', e.target.value)}
          maxLength={EMAIL_TEMPLATE_LIMITS.footer}
          hint="Entourez un texte de **deux astérisques** pour le mettre en gras."
        />

        <details className="rounded-[var(--radius-control)] border border-line bg-cream/60 px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold">Variables disponibles</summary>
          <ul className="mt-2 space-y-1">
            {EMAIL_VARIABLES[kind].map((v) => (
              <li key={v.name}>
                <code className="rounded bg-line/50 px-1.5 py-0.5 font-mono text-[0.85em]">{`{{${v.name}}}`}</code>{' '}
                <span className="text-ink-soft">{v.description}</span>
              </li>
            ))}
          </ul>
        </details>

        <section aria-label={`Aperçu de ${label.title}`} className="rounded-[var(--radius-control)] border border-dashed border-line px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Aperçu avec un exemple</p>
          <p className="mt-2 text-sm"><span className="text-ink-muted">Objet : </span><strong>{capitalizeFirst(renderPlainText(form.subject, sample))}</strong></p>
          <p className="mt-2 whitespace-pre-line text-sm"><RichText text={fillPlaceholders(form.intro, sample)} /></p>
          <p className="my-2 text-sm italic text-ink-muted">[ détails de l'événement{kind === 'tickets' ? ' et QR codes des billets' : kind === 'reminder' ? ' et bouton « Payer ma réservation »' : ' et bouton « Suivre ma réservation »'} ]</p>
          {form.footer.trim() && <p className="whitespace-pre-line text-sm text-ink-soft"><RichText text={fillPlaceholders(form.footer, sample)} /></p>}
        </section>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmReset(true)} disabled={saving || (!template.customized && isDefault)}>
            Rétablir le texte par défaut
          </Button>
          <Button type="submit" loading={saving} disabled={!dirty}>Enregistrer</Button>
        </div>
      </form>

      <ConfirmModal
        open={confirmReset}
        title="Rétablir le texte par défaut ?"
        confirmLabel="Rétablir"
        danger
        loading={saving}
        onConfirm={reset}
        onClose={() => setConfirmReset(false)}
      >
        <p>Votre version personnalisée de « {label.title} » sera remplacée par le texte d'origine.</p>
      </ConfirmModal>
    </Card>
  )
}

export default function EmailTemplatesPage() {
  useDocumentTitle('Modèles d’e-mails')
  const { data, error, loading, reload } = useAsync(() => api.get<EmailTemplateView[]>('/admin/email-templates'), [])
  const [templates, setTemplates] = useState<EmailTemplateView[]>([])

  useEffect(() => {
    if (data) setTemplates(data)
  }, [data])

  if (loading && !data) {
    return <div aria-busy="true" className="space-y-4"><Skeleton className="h-12 w-72" /><Skeleton className="h-96" /></div>
  }
  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />

  return (
    <>
      <PageHeader title="E-mails" subtitle="Personnalisez le texte des e-mails envoyés à vos invités. La mise en page, les QR codes et les liens restent gérés automatiquement." />
      <Alert tone="info" className="mb-6">
        Les modifications s'appliquent aux prochains envois. Sans réglage de votre part, le texte par défaut est utilisé.
      </Alert>
      <div className="max-w-3xl space-y-5">
        {templates.map((t) => (
          <TemplateEditor
            key={t.kind}
            template={t}
            onChange={(saved) => setTemplates((list) => list.map((x) => (x.kind === saved.kind ? saved : x)))}
          />
        ))}
      </div>
    </>
  )
}
