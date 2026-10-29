export interface Accent {
  accent: string
  strong: string
  soft: string
}

/** Palette d'accents validés pour un texte blanc (contraste AA). */
const PALETTE: Accent[] = [
  { accent: '#5b35d5', strong: '#4624b8', soft: '#f0ebff' },
  { accent: '#b3267a', strong: '#8f1b60', soft: '#fdebf5' },
  { accent: '#0b7a75', strong: '#085e5a', soft: '#e0f5f3' },
  { accent: '#b4510c', strong: '#8f3f07', soft: '#fff0e1' },
  { accent: '#1f5fd0', strong: '#1748a3', soft: '#e8f0ff' },
  { accent: '#1c7a3e', strong: '#145c2e', soft: '#e3f6ea' },
]

export function accentFor(seed: string): Accent {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]!
}

export function accentStyle(a: Accent): Record<string, string> {
  return { '--accent': a.accent, '--accent-strong': a.strong, '--accent-soft': a.soft }
}
