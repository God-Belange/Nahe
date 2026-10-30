const TZ = 'Europe/Paris'
const LOCALE = 'fr-FR'
const DAY_MS = 86_400_000

const dayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
const clockFormat = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: TZ })

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function clock(iso: string): { h: number; m: number } {
  const parts = clockFormat.formatToParts(new Date(iso))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { h: get('hour'), m: get('minute') }
}

/** « 19h », « 2h », « 19h30 » ; `closing` écrit « minuit » pour 0h00. */
export function formatHour(iso: string, closing = false): string {
  const { h, m } = clock(iso)
  if (closing && h === 0 && m === 0) return 'minuit'
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/** « de 19h à 2h » avec une fin, sinon « 19h ». */
export function formatTimeRange(startsAt: string, endsAt: string | null): string {
  return endsAt ? `de ${formatHour(startsAt)} à ${formatHour(endsAt, true)}` : formatHour(startsAt)
}

/**
 * Quand a lieu l'événement : le jour de début puis les horaires, sans date de fin
 * (« Samedi 14 novembre, de 19h à 2h »). Au-delà de 24 h, les deux jours sont indiqués.
 */
export function formatEventSchedule(startsAt: string, endsAt: string | null): string {
  const day = cap(dayFormat.format(new Date(startsAt)))
  if (!endsAt) return `${day} à ${formatHour(startsAt)}`
  if (new Date(endsAt).getTime() - new Date(startsAt).getTime() > DAY_MS) {
    return `Du ${day.toLowerCase()} à ${formatHour(startsAt)} au ${dayFormat.format(new Date(endsAt))} à ${formatHour(endsAt, true)}`
  }
  return `${day}, ${formatTimeRange(startsAt, endsAt)}`
}
