/** Extrait le compte d'un lien Revolut.me (domaine revolut.me uniquement, HTTPS). */
export function parseRevolutMe(url: string): { account: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname !== 'revolut.me' && parsed.hostname !== 'www.revolut.me') return null
  const account = parsed.pathname.split('/').filter(Boolean)[0]
  if (!account || !/^[A-Za-z0-9._-]{1,60}$/.test(account)) return null
  return { account }
}

/** Lien normalisé vers le profil Revolut.me : le montant n'est pas pré-rempli. */
export function buildRevolutLink(revolutMeUrl: string): string | null {
  const parsed = parseRevolutMe(revolutMeUrl)
  return parsed ? `https://revolut.me/${parsed.account}` : null
}
