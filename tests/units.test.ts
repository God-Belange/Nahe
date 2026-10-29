import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { addHours, bookingBlockReason } from '../shared/booking'
import { centsToDecimalString } from '../shared/money'
import { normalizePhone } from '../shared/phone'
import { buildPaypalLink, parsePaypalMe } from '../shared/paypal'
import { checkEventDates, createEventSchema, reservationInputSchema } from '../shared/schemas'
import {
  hashPassword,
  randomReference,
  randomToken,
  sha256Hex,
  timingSafeEqual,
  verifyPassword,
} from '../worker/lib/crypto'
import { slugify } from '../worker/services/events'
import { runMaintenance } from '../worker/services/maintenance'
import { csvCell } from '../worker/services/reservations'
import { configurePayments, makeEvent, reserve } from './helpers'

describe('téléphone', () => {
  it.each([
    ['06 12 34 56 78', '+33612345678'],
    ['06.12.34.56.78', '+33612345678'],
    ['+33 6 12 34 56 78', '+33612345678'],
    ['0033612345678', '+33612345678'],
    ['+32 470 12 34 56', '+32470123456'],
  ])('normalise %s', (input, expected) => expect(normalizePhone(input)).toBe(expected))

  it.each(['', 'abc', '123', '+0612345678'])('rejette %j', (input) =>
    expect(normalizePhone(input)).toBeNull(),
  )
})

describe('PayPal.Me', () => {
  it('accepte uniquement https://paypal.me', () => {
    expect(parsePaypalMe('https://paypal.me/sam')).toEqual({ account: 'sam' })
    expect(parsePaypalMe('https://www.paypal.me/sam/20')).toEqual({ account: 'sam' })
    expect(parsePaypalMe('http://paypal.me/sam')).toBeNull()
    expect(parsePaypalMe('https://paypal.me.evil.com/sam')).toBeNull()
    expect(parsePaypalMe('https://evil.com/paypal.me/sam')).toBeNull()
    expect(parsePaypalMe('https://paypal.me/')).toBeNull()
    expect(parsePaypalMe('pas une url')).toBeNull()
    expect(parsePaypalMe('https://paypal.me/sa<m>')).toBeNull()
  })

  it('construit le lien avec le montant', () => {
    expect(buildPaypalLink('https://paypal.me/sam', 1250)).toBe('https://paypal.me/sam/12.50EUR')
    expect(buildPaypalLink('https://paypal.me/sam', 5)).toBe('https://paypal.me/sam/0.05EUR')
    expect(buildPaypalLink('https://evil.com/sam', 100)).toBeNull()
  })
})

describe('montants', () => {
  it('formate les centimes sans flottants', () => {
    expect(centsToDecimalString(0)).toBe('0.00')
    expect(centsToDecimalString(1999)).toBe('19.99')
    expect(centsToDecimalString(100000)).toBe('1000.00')
  })
})

describe('règles d\'ouverture', () => {
  const now = new Date('2026-06-01T12:00:00.000Z')
  const base = { status: 'published' as const, startsAt: '2026-07-01T18:00:00.000Z', bookingDeadline: null }
  it('ouvert', () => expect(bookingBlockReason(base, 3, now)).toBeNull())
  it('complet', () => expect(bookingBlockReason(base, 0, now)).toBe('full'))
  it('brouillon / fermé / annulé', () => {
    expect(bookingBlockReason({ ...base, status: 'draft' }, 3, now)).toBe('not_published')
    expect(bookingBlockReason({ ...base, status: 'closed' }, 3, now)).toBe('closed')
    expect(bookingBlockReason({ ...base, status: 'cancelled' }, 3, now)).toBe('cancelled')
  })
  it('passé et date limite', () => {
    expect(bookingBlockReason({ ...base, startsAt: '2026-05-01T18:00:00.000Z' }, 3, now)).toBe('past')
    expect(bookingBlockReason({ ...base, bookingDeadline: '2026-05-30T00:00:00.000Z' }, 3, now)).toBe('deadline_passed')
    expect(bookingBlockReason({ ...base, bookingDeadline: '2026-06-20T00:00:00.000Z' }, 3, now)).toBeNull()
  })
  it('addHours', () => expect(addHours(now, 24).toISOString()).toBe('2026-06-02T12:00:00.000Z'))
})

describe('schémas partagés', () => {
  it('normalise l\'e-mail, le téléphone et les valeurs par défaut', () => {
    const r = reservationInputSchema.parse({ firstName: ' Ana ', lastName: 'B', email: ' ANA@Example.COM ', phone: '', quantity: 2 })
    expect(r).toMatchObject({ firstName: 'Ana', email: 'ana@example.com', phone: null, quantity: 2, paymentMethod: null })
    expect(reservationInputSchema.parse({ firstName: 'a', lastName: 'b', email: 'a@b.fr' }).quantity).toBe(1)
  })

  it('refuse un moyen de paiement inconnu et une clé d\'idempotence invalide', () => {
    const base = { firstName: 'a', lastName: 'b', email: 'a@b.fr' }
    expect(reservationInputSchema.safeParse({ ...base, paymentMethod: 'cash' }).success).toBe(false)
    expect(reservationInputSchema.safeParse({ ...base, idempotencyKey: 'x' }).success).toBe(false)
  })

  it('messages d\'erreur en français', () => {
    const r = reservationInputSchema.safeParse({ firstName: '', lastName: 'b', email: 'nope' })
    expect(r.success).toBe(false)
    const fields = Object.fromEntries(r.error!.issues.map((i) => [i.path[0], i.message]))
    expect(fields.firstName).toBe('Ce champ est obligatoire')
    expect(fields.email).toBe('Adresse e-mail invalide')
  })

  it('convertit les dates en ISO UTC', () => {
    const e = createEventSchema.parse({
      title: 'x', location: 'y', startsAt: '2030-01-01T20:00:00+01:00', priceCents: 0, capacity: 1,
    })
    expect(e.startsAt).toBe('2030-01-01T19:00:00.000Z')
  })

  it('checkEventDates', () => {
    expect(checkEventDates({ startsAt: 'b', endsAt: 'a', bookingDeadline: null }).endsAt).toBeDefined()
    expect(checkEventDates({ startsAt: 'b', endsAt: null, bookingDeadline: 'c' }).bookingDeadline).toBeDefined()
    expect(checkEventDates({ startsAt: 'b', endsAt: 'c', bookingDeadline: 'a' })).toEqual({})
  })
})

describe('cryptographie', () => {
  it('hache et vérifie un mot de passe (PBKDF2 100 000 itérations)', async () => {
    const stored = await hashPassword('secret')
    expect(stored).toMatch(/^pbkdf2-sha256\$100000\$/)
    expect(await verifyPassword('secret', stored)).toBe(true)
    expect(await verifyPassword('Secret', stored)).toBe(false)
    expect(await hashPassword('secret')).not.toBe(stored)
  })

  it('rejette les hash malformés ou aux itérations excessives', async () => {
    expect(await verifyPassword('x', '')).toBe(false)
    expect(await verifyPassword('x', 'bcrypt$10$a$b')).toBe(false)
    expect(await verifyPassword('x', 'pbkdf2-sha256$100001$AAAA$AAAA')).toBe(false)
    expect(await verifyPassword('x', 'pbkdf2-sha256$abc$AAAA$AAAA')).toBe(false)
  })

  it('jetons aléatoires >= 128 bits, références lisibles', () => {
    expect(randomToken(16)).toHaveLength(22)
    expect(new Set(Array.from({ length: 100 }, () => randomToken())).size).toBe(100)
    for (let i = 0; i < 200; i++) expect(randomReference()).toMatch(/^NAHE-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)
  })

  it('sha256 et comparaison en temps constant', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('utilitaires', () => {
  it('slugify', () => {
    expect(slugify('Soirée d\'été à Lille !')).toBe('soiree-d-ete-a-lille')
    expect(slugify('🎉')).toBe('evenement')
    expect(slugify('  --A--  ')).toBe('evenement')
  })

  it('csvCell neutralise les formules et échappe', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('+33612345678')).toBe("'+33612345678")
    expect(csvCell('-5')).toBe("'-5")
    expect(csvCell('@a')).toBe("'@a")
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('a\nb')).toBe('"a\nb"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(12)).toBe('12')
  })
})

describe('maintenance quotidienne (cron)', () => {
  it('anonymise les réservations 6 mois après l\'événement et invalide le lien de suivi', async () => {
    await configurePayments()
    const old = await makeEvent({ title: 'Ancien' })
    const recent = await makeEvent({ title: 'Récent' })
    const a = await reserve(old.id, { firstName: 'Léa', lastName: 'Ancienne', email: 'lea@example.com', phone: '0611223344' })
    const b = await reserve(recent.id, { firstName: 'Max', lastName: 'Récent', email: 'max@example.com' })
    const longAgo = new Date(Date.now() - 200 * 86_400_000).toISOString()
    const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString()
    await env.DB.prepare('UPDATE events SET starts_at = ?1 WHERE id = ?2').bind(longAgo, old.id).run()
    await env.DB.prepare('UPDATE events SET starts_at = ?1 WHERE id = ?2').bind(lastWeek, recent.id).run()

    const report = await runMaintenance(env, new Date())
    expect(report.anonymized).toBe(1)

    const rows = await env.DB.prepare('SELECT first_name, last_name, email, phone, anonymized_at, reference FROM reservations ORDER BY first_name').all<any>()
    const anonymous = rows.results.find((r) => r.reference === a.data.reservation.reference)
    expect(anonymous).toMatchObject({ first_name: 'Anonyme', last_name: '', phone: null })
    expect(anonymous.email).toMatch(/@anonymise\.invalid$/)
    expect(anonymous.anonymized_at).not.toBeNull()
    const kept = rows.results.find((r) => r.reference === b.data.reservation.reference)
    expect(kept.first_name).toBe('Max')

    const { api } = await import('./helpers')
    expect((await api(`/reservations/${a.data.accessToken}`)).status).toBe(404)
    expect((await api(`/reservations/${b.data.accessToken}`)).status).toBe(200)

    // idempotent
    expect((await runMaintenance(env, new Date())).anonymized).toBe(0)
  })

  it('purge les compteurs de limitation et les sessions expirées, marque les réservations expirées', async () => {
    await configurePayments()
    const event = await makeEvent()
    await reserve(event.id)
    await env.DB.prepare("UPDATE reservations SET expires_at = '2020-01-01T00:00:00.000Z'").run()
    await env.DB.prepare("INSERT INTO admin_sessions (id, session_token_hash, csrf_token_hash, expires_at, created_at) VALUES ('s','h','c','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')").run()
    await env.DB.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES ('old', 1000, 3)").run()
    await runMaintenance(env, new Date())
    expect((await env.DB.prepare("SELECT payment_status FROM reservations").first<any>()).payment_status).toBe('expired')
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_sessions WHERE id = 's'").first<any>()).n).toBe(0)
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE key = 'old'").first<any>()).n).toBe(0)
  })
})
