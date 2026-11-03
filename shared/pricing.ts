export interface PricedEvent {
  priceCents: number
  doorPriceCents: number | null
  doorPriceFrom: string | null
}

/** Prix par place applicable à `now` : le prix « sur place » prend le relais à sa date d'effet. */
export function currentPriceCents(event: PricedEvent, now: Date): number {
  if (
    event.doorPriceCents !== null &&
    event.doorPriceFrom !== null &&
    event.doorPriceFrom <= now.toISOString()
  ) {
    return event.doorPriceCents
  }
  return event.priceCents
}

/** Même règle que `currentPriceCents`, en SQL (`?` = paramètre ISO « maintenant »). */
export function currentPriceSql(alias: string, nowParam: string): string {
  return `(CASE WHEN ${alias}.door_price_from IS NOT NULL AND ${alias}.door_price_from <= ${nowParam} THEN ${alias}.door_price_cents ELSE ${alias}.price_cents END)`
}
