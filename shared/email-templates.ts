export const EMAIL_TEMPLATE_KINDS = ['tickets', 'tracking'] as const
export type EmailTemplateKind = (typeof EMAIL_TEMPLATE_KINDS)[number]

export interface EmailTemplateContent {
  subject: string
  intro: string
  footer: string
}

export const EMAIL_TEMPLATE_LIMITS = { subject: 150, intro: 1000, footer: 1500 } as const

export const EMAIL_TEMPLATE_LABELS: Record<EmailTemplateKind, { title: string; description: string }> = {
  tickets: {
    title: 'E-mail des billets',
    description: "Envoyé à l'invité quand vous confirmez son paiement. Les QR codes des billets sont ajoutés automatiquement entre l'introduction et la conclusion.",
  },
  tracking: {
    title: 'E-mail de suivi de réservation',
    description: "Envoyé à l'invité dès qu'il réserve. Le bouton « Suivre ma réservation » est ajouté automatiquement sous l'introduction.",
  },
}

export interface EmailVariable {
  name: string
  description: string
  example: string
}

const COMMON_VARIABLES: EmailVariable[] = [
  { name: 'prenom', description: "Prénom de l'invité", example: 'Camille' },
  { name: 'evenement', description: "Titre de l'événement", example: 'Soirée d’été' },
  { name: 'date', description: "Date et horaires de l'événement", example: 'Samedi 14 novembre, de 19h à 2h' },
  { name: 'lieu', description: 'Nom du lieu', example: 'Chez Léa' },
  { name: 'adresse', description: 'Adresse (vide si non renseignée)', example: '12 rue des Lilas, Lyon' },
  { name: 'reference', description: 'Référence de la réservation', example: 'NAHE-ABC234' },
]

export const EMAIL_VARIABLES: Record<EmailTemplateKind, EmailVariable[]> = {
  tickets: [
    ...COMMON_VARIABLES,
    { name: 'billets', description: '« votre billet » ou « vos billets »', example: 'vos billets' },
    { name: 'billets_avec_nombre', description: '« votre billet » ou « vos 3 billets »', example: 'vos 2 billets' },
    { name: 'nb_billets', description: 'Nombre de billets', example: '2' },
  ],
  tracking: [
    ...COMMON_VARIABLES,
    { name: 'lien', description: 'Lien de suivi secret (cliquable dans l’e-mail)', example: 'https://nahe.example/r/…' },
  ],
}

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateKind, EmailTemplateContent> = {
  tickets: {
    subject: '{{billets}} pour {{evenement}}',
    intro: 'Bonjour {{prenom}}, votre paiement est confirmé. Voici {{billets_avec_nombre}} :',
    footer:
      "Présentez le QR code à l'entrée (capture d'écran acceptée). **Un billet = une seule entrée** : chaque personne doit avoir le sien. Si les images ne s'affichent pas, ouvrez les liens ci-dessus.",
  },
  tracking: {
    subject: 'Votre réservation pour {{evenement}}',
    intro:
      "Bonjour {{prenom}}, votre réservation est enregistrée. Elle est valide une fois le paiement confirmé par l'organisateur.",
    footer:
      'Référence {{reference}}. Ce lien vous permet de payer, de suivre votre réservation et de retrouver vos billets.\nIl est secret : ne le partagez pas. Lien direct : {{lien}}',
  },
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g

/** Remplace chaque `{{variable}}` connue ; les variables inconnues restent telles quelles. */
export function fillPlaceholders(
  source: string,
  values: Record<string, string>,
  transform: (value: string, name: string) => string = (v) => v,
): string {
  return source.replace(PLACEHOLDER, (whole, name: string) =>
    Object.hasOwn(values, name) ? transform(values[name]!, name) : whole,
  )
}

export function unknownPlaceholders(kind: EmailTemplateKind, content: EmailTemplateContent): string[] {
  const known = new Set(EMAIL_VARIABLES[kind].map((v) => v.name))
  const found = new Set<string>()
  for (const text of [content.subject, content.intro, content.footer]) {
    for (const m of text.matchAll(PLACEHOLDER)) if (!known.has(m[1]!)) found.add(m[1]!)
  }
  return [...found]
}

export function sampleValues(kind: EmailTemplateKind): Record<string, string> {
  return Object.fromEntries(EMAIL_VARIABLES[kind].map((v) => [v.name, v.example]))
}

export function capitalizeFirst(value: string): string {
  const trimmed = value.trim()
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

/** Aperçu texte brut (le gras `**…**` est retiré). */
export function renderPlainText(source: string, values: Record<string, string>): string {
  return fillPlaceholders(source, values).replaceAll('**', '')
}
