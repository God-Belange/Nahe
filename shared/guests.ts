import type { Guest } from './types'

export function parseGuests(json: string | null): Guest[] {
  if (!json) return []
  try {
    const raw: unknown = JSON.parse(json)
    if (!Array.isArray(raw)) return []
    return raw.flatMap((g) =>
      g && typeof g.firstName === 'string' && typeof g.lastName === 'string'
        ? [{ firstName: g.firstName, lastName: g.lastName }]
        : [],
    )
  } catch {
    return []
  }
}

/** La place 1 appartient au titulaire de la réservation, les suivantes aux invités saisis. */
export function ticketHolder(
  owner: Guest,
  guests: Guest[],
  seq: number,
): Guest {
  return seq <= 1 ? owner : (guests[seq - 2] ?? owner)
}

export const fullName = (g: Guest) => `${g.firstName} ${g.lastName}`.trim()
