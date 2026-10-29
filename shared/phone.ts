/**
 * Normalise un numéro vers un format international (+33612345678).
 * Retourne null si le numéro n'est pas exploitable.
 */
export function normalizePhone(input: string): string | null {
  let value = input.trim().replace(/[\s().\-/]/g, '')
  if (value === '') return null
  if (value.startsWith('00')) value = `+${value.slice(2)}`
  if (/^0\d{9}$/.test(value)) value = `+33${value.slice(1)}`
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return null
  return value
}
