/** 1250 -> "12.50" (format attendu par PayPal.Me). */
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const euros = Math.floor(abs / 100)
  const rest = String(abs % 100).padStart(2, '0')
  return `${sign}${euros}.${rest}`
}

export function computeTotalCents(unitPriceCents: number, quantity: number): number {
  return unitPriceCents * quantity
}
