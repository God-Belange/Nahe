const TZ = 'Europe/Paris'
const LOCALE = 'fr-FR'

const euros = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' })

export function formatEuros(cents: number): string {
  return euros.format(cents / 100).replace(/ | /g, ' ')
}

export function formatPrice(cents: number): string {
  return cents === 0 ? 'Gratuit' : formatEuros(cents)
}

const dateLong = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
const dateOnly = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })
const timeOnly = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const fullDate = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ,
})

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const formatEventDate = (iso: string) => `${cap(dateLong.format(new Date(iso)))} à ${formatTime(iso)}`
export const formatDay = (iso: string) => cap(dateLong.format(new Date(iso)))
export const formatShortDate = (iso: string) => cap(dateOnly.format(new Date(iso)))
export const formatTime = (iso: string) => timeOnly.format(new Date(iso)).replace(':', 'h')
export const formatFullDate = (iso: string) => fullDate.format(new Date(iso))

/** Décompose une date ISO en parties affichées dans le fuseau de l'application (pour les pastilles de calendrier). */
export function dateParts(iso: string): { day: string; month: string } {
  const d = new Date(iso)
  return {
    day: new Intl.DateTimeFormat(LOCALE, { day: 'numeric', timeZone: TZ }).format(d),
    month: new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: TZ }).format(d).replace('.', ''),
  }
}

/** Temps restant lisible : « 23 h 10 », « 12 min », « moins d'une minute ». */
export function formatRemaining(iso: string, now = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime()
  if (ms <= 0) return 'expiré'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "moins d'une minute"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`
}

function parisOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - utcMs) / 60_000)
}

/** « 2026-07-04T20:30 » (heure de Paris, saisie datetime-local) → ISO UTC. */
export function parisLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number]
  const naive = Date.UTC(y, mo - 1, d, h, mi)
  let utc = naive - parisOffsetMinutes(naive) * 60_000
  utc = naive - parisOffsetMinutes(utc) * 60_000
  return new Date(utc).toISOString()
}

/** ISO UTC → « 2026-07-04T20:30 » (heure de Paris) pour un input datetime-local. */
export function isoToParisLocal(iso: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  const shifted = new Date(t + parisOffsetMinutes(t) * 60_000)
  return shifted.toISOString().slice(0, 16)
}

/** Texte saisi en euros (« 12,5 ») → centimes entiers, ou null si invalide. */
export function parseEurosToCents(input: string): number | null {
  const cleaned = input.trim().replace(',', '.').replace(/\s/g, '')
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole = '0', frac = ''] = cleaned.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}
