/** Vrai si l'erreur (ou sa cause) est une violation d'unicité SQLite portant sur `column` (ex. "events.slug"). */
export function isUniqueViolation(err: unknown, column?: string): boolean {
  let current: unknown = err
  for (let depth = 0; depth < 5 && current; depth++) {
    const message = current instanceof Error ? current.message : String(current)
    if (message.includes('UNIQUE constraint failed')) {
      return column === undefined || message.includes(column)
    }
    current = current instanceof Error ? current.cause : undefined
  }
  return false
}
