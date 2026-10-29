import { centsToDecimalString } from './money'

/** Extrait le compte d'une URL PayPal.Me (domaine paypal.me uniquement, HTTPS). */
export function parsePaypalMe(url: string): { account: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname !== 'paypal.me' && parsed.hostname !== 'www.paypal.me') return null
  const account = parsed.pathname.split('/').filter(Boolean)[0]
  if (!account || !/^[A-Za-z0-9._-]{1,60}$/.test(account)) return null
  return { account }
}

export function buildPaypalLink(paypalMeUrl: string, amountCents: number): string | null {
  const parsed = parsePaypalMe(paypalMeUrl)
  if (!parsed) return null
  return `https://paypal.me/${parsed.account}/${centsToDecimalString(amountCents)}EUR`
}
