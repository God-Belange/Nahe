/** Lien de recherche Google Maps (gratuit, sans clé API) ; s'ouvre dans l'appli cartes sur mobile. */
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}
