import { describe, expect, it } from 'vitest'
import {
  centsToInput,
  formatEuros,
  formatEventSchedule,
  formatTimeRange,
  formatRemaining,
  isoToParisLocal,
  parseEurosToCents,
  parisLocalToIso,
} from '../src/lib/format'

describe('fuseau Europe/Paris', () => {
  it('convertit l\'heure d\'été et d\'hiver', () => {
    expect(parisLocalToIso('2026-07-04T20:30')).toBe('2026-07-04T18:30:00.000Z')
    expect(parisLocalToIso('2026-01-15T20:30')).toBe('2026-01-15T19:30:00.000Z')
  })
  it('est réversible', () => {
    for (const local of ['2026-07-04T20:30', '2026-01-15T00:00', '2026-03-29T12:00', '2026-10-25T23:59']) {
      expect(isoToParisLocal(parisLocalToIso(local))).toBe(local)
    }
  })
  it('gère les valeurs vides ou invalides', () => {
    expect(isoToParisLocal(null)).toBe('')
    expect(parisLocalToIso('')).toBeNull()
  })
})

describe('montants saisis', () => {
  it.each([['12', 1200], ['12,5', 1250], ['12.50', 1250], ['0', 0], ['0,05', 5]])('parse %s', (input, cents) =>
    expect(parseEurosToCents(input)).toBe(cents))
  it.each(['', 'abc', '-3', '1,234', '12 €'])('rejette %j', (input) => expect(parseEurosToCents(input)).toBeNull())
  it('formate', () => {
    expect(centsToInput(1250)).toBe('12,50')
    expect(formatEuros(1250)).toMatch(/^12,50\s€$/)
  })
})

describe('temps restant', () => {
  const now = new Date('2026-06-01T12:00:00Z')
  it('formate', () => {
    expect(formatRemaining('2026-06-01T11:00:00Z', now)).toBe('expiré')
    expect(formatRemaining('2026-06-01T12:00:30Z', now)).toBe("moins d'une minute")
    expect(formatRemaining('2026-06-01T12:12:00Z', now)).toBe('12 min')
    expect(formatRemaining('2026-06-02T11:50:00Z', now)).toBe('23 h 50')
    expect(formatRemaining('2026-06-01T14:00:00Z', now)).toBe('2 h')
  })
})

describe('horaires de l\'événement', () => {
  const start = '2026-11-14T18:00:00Z' // samedi 19h (Paris)
  it('écrit le jour puis « de 19h à 2h » sans date de fin', () => {
    expect(formatEventSchedule(start, '2026-11-15T01:00:00Z')).toBe('Samedi 14 novembre, de 19h à 2h')
  })
  it('garde les minutes et écrit « minuit »', () => {
    expect(formatEventSchedule('2026-11-14T18:30:00Z', '2026-11-14T23:00:00Z')).toBe('Samedi 14 novembre, de 19h30 à minuit')
  })
  it('sans heure de fin', () => {
    expect(formatEventSchedule(start, null)).toBe('Samedi 14 novembre à 19h')
    expect(formatTimeRange(start, null)).toBe('19h')
  })
  it('indique les deux jours au-delà de 24 h', () => {
    expect(formatEventSchedule(start, '2026-11-16T01:00:00Z')).toBe('Du samedi 14 novembre à 19h au lundi 16 novembre à 2h')
  })
})
