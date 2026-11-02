export interface RichSegment {
  text: string
  bold: boolean
}

/** Découpe un texte en segments ; `**gras**` (sur une même ligne) est marqué `bold`. */
export function parseBold(source: string): RichSegment[] {
  const segments: RichSegment[] = []
  let last = 0
  for (const m of source.matchAll(/\*\*(.+?)\*\*/g)) {
    if (m.index > last) segments.push({ text: source.slice(last, m.index), bold: false })
    segments.push({ text: m[1]!, bold: true })
    last = m.index + m[0].length
  }
  if (last < source.length) segments.push({ text: source.slice(last), bold: false })
  return segments
}
