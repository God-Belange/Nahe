import { eq } from 'drizzle-orm'
import {
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_KINDS,
  type EmailTemplateContent,
  type EmailTemplateKind,
} from '../../shared/email-templates'
import type { EmailTemplateInput } from '../../shared/schemas'
import type { EmailTemplateView } from '../../shared/types'
import { emailTemplates } from '../db/schema'
import type { Db } from '../lib/db'

function toView(kind: EmailTemplateKind, row: typeof emailTemplates.$inferSelect | undefined): EmailTemplateView {
  if (!row) return { kind, ...DEFAULT_EMAIL_TEMPLATES[kind], customized: false, updatedAt: null }
  return { kind, subject: row.subject, intro: row.intro, footer: row.footer, customized: true, updatedAt: row.updatedAt }
}

/** Modèle à utiliser pour l'envoi : celui de l'organisateur, sinon le texte par défaut. */
export async function getEmailTemplate(db: Db, kind: EmailTemplateKind): Promise<EmailTemplateContent> {
  const { subject, intro, footer } = toView(
    kind,
    await db.select().from(emailTemplates).where(eq(emailTemplates.kind, kind)).get(),
  )
  return { subject, intro, footer }
}

export async function listEmailTemplates(db: Db): Promise<EmailTemplateView[]> {
  const rows = await db.select().from(emailTemplates)
  return EMAIL_TEMPLATE_KINDS.map((kind) => toView(kind, rows.find((r) => r.kind === kind)))
}

export async function saveEmailTemplate(
  db: Db,
  kind: EmailTemplateKind,
  input: EmailTemplateInput,
  now: Date,
): Promise<EmailTemplateView> {
  const values = { subject: input.subject, intro: input.intro, footer: input.footer, updatedAt: now.toISOString() }
  await db
    .insert(emailTemplates)
    .values({ kind, ...values })
    .onConflictDoUpdate({ target: emailTemplates.kind, set: values })
  return toView(kind, await db.select().from(emailTemplates).where(eq(emailTemplates.kind, kind)).get())
}

/** Revient au texte par défaut en supprimant la personnalisation. */
export async function resetEmailTemplate(db: Db, kind: EmailTemplateKind): Promise<EmailTemplateView> {
  await db.delete(emailTemplates).where(eq(emailTemplates.kind, kind))
  return toView(kind, undefined)
}
