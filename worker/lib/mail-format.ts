const formatter = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
})

export function formatEventDateForMail(iso: string): string {
  const text = formatter.format(new Date(iso))
  return text.charAt(0).toUpperCase() + text.slice(1)
}
